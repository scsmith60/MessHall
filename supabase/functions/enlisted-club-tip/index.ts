// supabase/functions/enlisted-club-tip/index.ts
// LIKE I'M 5: This processes tips during Enlisted Club sessions.
// - Creates a Stripe Payment Intent
// - Records the tip in the database
// - Updates session tip totals

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TipRequest = {
  session_id: string;
  to_user_id: string; // The host/creator receiving the tip
  amount_cents: number;
  message?: string;
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing authorization header" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user is authenticated
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid or expired token" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const from_user_id = user.id;

    // Parse request
    const { session_id, to_user_id, amount_cents, message }: TipRequest = await req.json();

    // Validation
    if (!session_id || !to_user_id || !amount_cents || amount_cents <= 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields or invalid amount" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Minimum tip: $0.50 (50 cents)
    if (amount_cents < 50) {
      return new Response(
        JSON.stringify({ ok: false, error: "Minimum tip is $0.50" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Maximum tip: $500 (50,000 cents)
    if (amount_cents > 50000) {
      return new Response(
        JSON.stringify({ ok: false, error: "Maximum tip is $500.00" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify session exists and is active
    const { data: session, error: sessionError } = await supabase
      .from("enlisted_club_sessions")
      .select("id, status, host_id")
      .eq("id", session_id)
      .maybeSingle();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ ok: false, error: "Session not found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Allow tipping for active or scheduled sessions
    // Users viewing these sessions can tip even if not in participants table
    if (session.status !== "active" && session.status !== "scheduled") {
      return new Response(
        JSON.stringify({ ok: false, error: "Session is not active" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Note: We allow tipping for active/scheduled sessions regardless of participant status
    // This allows users viewing the session to tip without requiring them to join video first

    // Verify recipient is the host
    if (to_user_id !== session.host_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Tips can only be sent to the session host" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Stripe keys
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Stripe not configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get recipient's Stripe account (from profiles table)
    const { data: recipientProfile, error: profileError } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", to_user_id)
      .maybeSingle();

    if (profileError || !recipientProfile?.stripe_account_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Recipient has not set up payments" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify the Stripe account exists and check its status
    // Request capabilities explicitly as they may not be included by default
    const accountResponse = await fetch(`https://api.stripe.com/v1/accounts/${recipientProfile.stripe_account_id}?expand[]=capabilities`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
      },
    });

    const accountData = await accountResponse.json();

    if (!accountResponse.ok) {
      console.error("Stripe account check error:", accountData);
      return new Response(
        JSON.stringify({ ok: false, error: "Unable to verify recipient's payment account. Please contact support." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log account status for debugging (but don't block based on it)
    console.log("Stripe account check:", {
      account_id: recipientProfile.stripe_account_id,
      account_type: accountData.type,
      charges_enabled: accountData.charges_enabled,
      payouts_enabled: accountData.payouts_enabled,
      details_submitted: accountData.details_submitted,
      capabilities: accountData.capabilities || {},
      requirements: accountData.requirements || {},
    });

    // Check if account has pending requirements that might block transfers
    // Even if dashboard shows enabled, API might show requirements
    const requirements = accountData.requirements || {};
    const hasPendingRequirements = 
      (requirements.currently_due && requirements.currently_due.length > 0) ||
      (requirements.past_due && requirements.past_due.length > 0);

    if (hasPendingRequirements) {
      console.log("Account has pending requirements:", {
        currently_due: requirements.currently_due,
        past_due: requirements.past_due,
      });
    }

    // Don't block based on capabilities check - let Stripe validate when creating payment intent
    // Some accounts may have capabilities enabled in dashboard but API shows differently
    // Stripe will return a clear error if the account can't receive transfers

    // Create payment intent with Stripe
    // Note: For form-encoded data, arrays need [] suffix
    const formData = new URLSearchParams();
    formData.append("amount", amount_cents.toString());
    formData.append("currency", "usd");
    formData.append("payment_method_types[]", "card");
    
    // Use transfer_data.destination for both Express and Standard accounts
    // This transfers funds to the connected account
    formData.append("transfer_data[destination]", recipientProfile.stripe_account_id);
    
    // Fee structure: Platform gets 10%, host covers Stripe processing fee
    // Stripe charges: 2.9% + $0.30 per transaction (charged to platform account)
    const PLATFORM_FEE_PERCENT = 0.1; // 10% platform fee
    const STRIPE_PROCESSING_FEE_PERCENT = 0.029; // 2.9%
    const STRIPE_PROCESSING_FEE_FIXED = 30; // $0.30 in cents
    
    // Platform fee: Simple 10% of tip amount
    const platformFeeCents = Math.round(amount_cents * PLATFORM_FEE_PERCENT);
    
    // Estimate Stripe processing fee (will be charged to platform account)
    const estimatedStripeFeeCents = Math.round(
      (amount_cents * STRIPE_PROCESSING_FEE_PERCENT) + STRIPE_PROCESSING_FEE_FIXED
    );
    
    // Calculate transfer amount to host: tip - platform fee - Stripe fee
    // This makes the host cover Stripe's processing fee
    const transferToHostCents = amount_cents - platformFeeCents - estimatedStripeFeeCents;
    
    // To ensure platform gets full 10% after Stripe deducts their fee,
    // we need to add Stripe's fee to the application fee
    // So platform receives: (10% + Stripe fee), then Stripe deducts their fee, leaving 10% net
    const applicationFeeCents = platformFeeCents + estimatedStripeFeeCents;
    
    console.log("Fee calculation breakdown:", {
      tip_amount_cents: amount_cents,
      tip_amount_dollars: (amount_cents / 100).toFixed(2),
      platform_fee_cents: platformFeeCents,
      platform_fee_dollars: (platformFeeCents / 100).toFixed(2),
      platform_fee_percent: (PLATFORM_FEE_PERCENT * 100).toFixed(1) + "%",
      stripe_processing_fee_cents: estimatedStripeFeeCents,
      stripe_processing_fee_dollars: (estimatedStripeFeeCents / 100).toFixed(2),
      application_fee_cents: applicationFeeCents,
      application_fee_dollars: (applicationFeeCents / 100).toFixed(2),
      application_fee_percent: ((applicationFeeCents / amount_cents) * 100).toFixed(2) + "%",
      platform_net_after_stripe_cents: platformFeeCents,
      platform_net_after_stripe_dollars: (platformFeeCents / 100).toFixed(2),
      platform_net_percent: (PLATFORM_FEE_PERCENT * 100).toFixed(1) + "%",
      host_receives_cents: transferToHostCents,
      host_receives_dollars: (transferToHostCents / 100).toFixed(2),
      note: "Platform gets full 10% (Stripe fee is added to application_fee, then deducted, leaving 10% net). Host covers Stripe fee by receiving reduced transfer amount.",
    });
    
    formData.append("application_fee_amount", applicationFeeCents.toString());
    
    // Note: Stripe automatically calculates transfer amount as: amount - application_fee_amount
    // So host will receive: $5.00 - $0.95 = $4.05 (which is tip - platform fee - Stripe fee)
    // We don't need to set transfer_data[amount] explicitly - Stripe handles it
    formData.append("metadata[session_id]", session_id);
    formData.append("metadata[from_user_id]", from_user_id);
    formData.append("metadata[to_user_id]", to_user_id);
    formData.append("metadata[type]", "enlisted_club_tip");

    const stripeResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData,
    });

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error("Stripe payment intent creation error:", {
        error: stripeData.error,
        account_id: recipientProfile.stripe_account_id,
        account_type: accountData.type,
        capabilities: accountData.capabilities,
      });
      
      // Provide user-friendly error messages for common issues
      const errorMessage = stripeData.error?.message || "Payment processing failed";
      const errorCode = stripeData.error?.code;
      let userFriendlyError = errorMessage;
      
      // Handle specific Stripe error codes
      if (errorCode === "insufficient_capabilities_for_transfer" || errorCode === "account_invalid" || errorMessage.includes("capabilities enabled") || errorMessage.includes("transfers")) {
        // Check if account needs additional setup based on Stripe's API response
        // Note: We check Stripe's API, not the database field, as it's the source of truth
        const stripeDetailsSubmitted = accountData.details_submitted;
        const requirements = accountData.requirements || {};
        const hasPendingRequirements = 
          (requirements.currently_due && requirements.currently_due.length > 0) ||
          (requirements.past_due && requirements.past_due.length > 0);
        
        if (stripeDetailsSubmitted === false || hasPendingRequirements) {
          // Account exists but onboarding not completed or has pending requirements
          // Even if dashboard shows enabled, API might show requirements
          const pendingItems = [
            ...(requirements.currently_due || []),
            ...(requirements.past_due || []),
          ];
          
          if (pendingItems.length > 0) {
            userFriendlyError = `The host's Stripe Connect account has pending requirements that must be completed: ${pendingItems.join(", ")}. They should check their Stripe dashboard (https://dashboard.stripe.com/connect/accounts/overview) or complete the onboarding link to finish setup.`;
          } else {
            userFriendlyError = "The host's Stripe Connect account is not fully set up. They need to complete onboarding to enable transfers. They should check their email for the onboarding link or go to Profile → Monetization → 'Get Stripe Onboarding Link'. Even if the dashboard shows enabled, the account may need additional verification.";
          }
        } else {
          // Account says details_submitted: true but still can't receive transfers
          // This might be a capabilities issue or account restrictions
          // Dashboard might show enabled but API doesn't - trust the API
          userFriendlyError = `The host's Stripe account cannot receive transfers according to Stripe's API (error: ${errorMessage}). Even if the dashboard shows transfers enabled, the account may need additional setup. They should check their Stripe dashboard (https://dashboard.stripe.com/connect/accounts/overview) or contact Stripe support.`;
        }
      } else if (errorMessage.includes("destination account")) {
        userFriendlyError = "The host's payment account is not configured to receive transfers. They need to complete Stripe Connect onboarding.";
      } else if (errorCode === "parameter_invalid_empty" && errorMessage.includes("destination")) {
        userFriendlyError = "The host's payment account is not properly configured. Please contact support.";
      }
      
      // Always log the full error for debugging
      console.error("Full Stripe error details:", {
        error: stripeData.error,
        account_id: recipientProfile.stripe_account_id,
        account_type: accountData.type,
        account_status: {
          charges_enabled: accountData.charges_enabled,
          payouts_enabled: accountData.payouts_enabled,
          details_submitted: accountData.details_submitted,
          capabilities: accountData.capabilities,
        },
      });
      
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: userFriendlyError,
          // Include original Stripe error code for debugging
          error_code: errorCode,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Record tip in database
    const { data: tip, error: tipError } = await supabase
      .from("enlisted_club_tips")
      .insert({
        session_id,
        from_user_id,
        to_user_id,
        amount_cents,
        stripe_payment_intent_id: stripeData.id,
        status: "processing",
        message: message || null,
      })
      .select()
      .single();

    if (tipError) {
      console.error("Database error:", tipError);
      // Try to cancel the payment intent
      await fetch(`https://api.stripe.com/v1/payment_intents/${stripeData.id}/cancel`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${stripeSecretKey}`,
        },
      });
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to record tip" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a chat message announcing the tip so the host can thank them
    try {
      // Get the tipper's username
      const { data: tipperProfile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", from_user_id)
        .maybeSingle();

      const username = tipperProfile?.username || "Someone";
      const amountDollars = (amount_cents / 100).toFixed(2);
      
      // Create the tip announcement message
      const tipMessage = `💰 ${username} tipped $${amountDollars}!`;
      
      // Insert the chat message (using service role key, so RLS won't block)
      const { error: chatError } = await supabase
        .from("enlisted_club_messages")
        .insert({
          session_id,
          user_id: from_user_id, // The tipper's user_id
          message: tipMessage,
        });

      if (chatError) {
        // Log but don't fail the tip if chat message fails
        console.error("Failed to create tip announcement message:", chatError);
      }
    } catch (chatErr: any) {
      // Log but don't fail the tip if chat message creation fails
      console.error("Error creating tip announcement message:", chatErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        tip: {
          id: tip.id,
          amount_cents: tip.amount_cents,
          status: tip.status,
          client_secret: stripeData.client_secret,
          payment_intent_id: stripeData.id,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error processing tip:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Internal server error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});



