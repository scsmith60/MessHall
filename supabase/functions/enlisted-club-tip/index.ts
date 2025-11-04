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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const from_user_id = user.id;

    // Parse request
    const { session_id, to_user_id, amount_cents, message }: TipRequest = await req.json();

    // Validation
    if (!session_id || !to_user_id || !amount_cents || amount_cents <= 0) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields or invalid amount" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Minimum tip: $0.50 (50 cents)
    if (amount_cents < 50) {
      return new Response(
        JSON.stringify({ ok: false, error: "Minimum tip is $0.50" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Maximum tip: $500 (50,000 cents)
    if (amount_cents > 50000) {
      return new Response(
        JSON.stringify({ ok: false, error: "Maximum tip is $500.00" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (session.status !== "active") {
      return new Response(
        JSON.stringify({ ok: false, error: "Session is not active" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is participant in session
    const { data: participant, error: participantError } = await supabase
      .from("enlisted_club_participants")
      .select("id")
      .eq("session_id", session_id)
      .eq("user_id", from_user_id)
      .is("left_at", null)
      .maybeSingle();

    if (participantError || !participant) {
      return new Response(
        JSON.stringify({ ok: false, error: "You must be in the session to send a tip" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify recipient is the host
    if (to_user_id !== session.host_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Tips can only be sent to the session host" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Stripe keys
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create payment intent with Stripe
    const stripeResponse = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: amount_cents.toString(),
        currency: "usd",
        payment_method_types: "card",
        transfer_data: JSON.stringify({
          destination: recipientProfile.stripe_account_id,
        }),
        application_fee_amount: Math.round(amount_cents * 0.1), // 10% platform fee
        metadata: JSON.stringify({
          session_id,
          from_user_id,
          to_user_id,
          type: "enlisted_club_tip",
        }),
      }),
    });

    const stripeData = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error("Stripe error:", stripeData);
      return new Response(
        JSON.stringify({ ok: false, error: stripeData.error?.message || "Payment processing failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error processing tip:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});



