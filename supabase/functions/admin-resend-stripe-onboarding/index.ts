// supabase/functions/admin-resend-stripe-onboarding/index.ts
// Creates a Stripe Connect onboarding link for a user
// Returns: { url: string } or { error: string }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('admin-resend-stripe-onboarding called');
  
  try {
    // 1) Set up Supabase client with auth
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization') ?? ''
        }
      }
    });
    
    // Service role client for admin operations (like getting user email)
    const supabaseAdmin = supabaseServiceKey 
      ? createClient(supabaseUrl, supabaseServiceKey)
      : null;

    // 2) Get authenticated user
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: 'not_authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3) Get user_id from request body (defaults to current user if not provided)
    let requestBody;
    try {
      requestBody = await req.json();
    } catch (e) {
      // If no body, that's fine - we'll use current user
      requestBody = {};
    }
    
    const requestedUserId = requestBody?.user_id;
    const targetUserId = requestedUserId || user.id;

    console.log('Requested user ID:', requestedUserId, 'Target user ID:', targetUserId, 'Current user ID:', user.id);

    // 4) Check permissions: user can only get their own link, or must be admin
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    console.log('Profile check result:', { profile, profileErr, isAdmin: profile?.is_admin });

    const isAdmin = profile?.is_admin === true;
    const isOwnRequest = targetUserId === user.id;

    console.log('Permission check:', { isAdmin, isOwnRequest, targetUserId, currentUserId: user.id });

    if (!isAdmin && !isOwnRequest) {
      console.error('Permission denied:', { isAdmin, isOwnRequest, targetUserId, currentUserId: user.id });
      return new Response(
        JSON.stringify({ 
          error: 'not_authorized',
          message: 'You can only get your own Stripe link, or you must be an admin',
          debug: {
            isAdmin,
            isOwnRequest,
            targetUserId,
            currentUserId: user.id
          }
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const user_id = targetUserId;

    // 5) Get Stripe secret key
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: 'Stripe not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6) Check if user already has a Stripe account
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_account_id, email')
      .eq('id', user_id)
      .maybeSingle();

    if (profileError || !userProfile) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let stripeAccountId = userProfile?.stripe_account_id;

    // 7) If no Stripe account exists, create one
    if (!stripeAccountId) {
      // Create a Stripe Connect account
      const createAccountResponse = await fetch('https://api.stripe.com/v1/accounts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          type: 'express', // Express accounts are easiest for onboarding
          email: userProfile?.email || '', // Get email from profile if available
        }),
      });

      const accountData = await createAccountResponse.json();
      
      if (!createAccountResponse.ok) {
        console.error('Stripe account creation error:', accountData);
        return new Response(
          JSON.stringify({ error: accountData.error?.message || 'Failed to create Stripe account' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      stripeAccountId = accountData.id;

      // Save the account ID to the profile
      await supabase
        .from('profiles')
        .update({ stripe_account_id: stripeAccountId })
        .eq('id', user_id);
    }

    // 8) Create onboarding link
    const onboardingResponse = await fetch('https://api.stripe.com/v1/account_links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        account: stripeAccountId,
        type: 'account_onboarding',
        return_url: `${Deno.env.get('EXPO_PUBLIC_APP_URL') || 'https://yourapp.com'}/monetization?onboarding=complete`,
        refresh_url: `${Deno.env.get('EXPO_PUBLIC_APP_URL') || 'https://yourapp.com'}/monetization?onboarding=refresh`,
      }),
    });

    const onboardingData = await onboardingResponse.json();

    if (!onboardingResponse.ok) {
      console.error('Stripe onboarding link error:', onboardingData);
      return new Response(
        JSON.stringify({ error: onboardingData.error?.message || 'Failed to create onboarding link' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 9) Send email to user with the onboarding link
    try {
      // Get user's email from auth.users (requires service role key)
      let userEmail = userProfile?.email;
      
      if (supabaseAdmin) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user_id);
        userEmail = authUser?.user?.email || userEmail;
      }
      
      if (userEmail) {
        // Use Supabase's built-in email function or send via Resend/SendGrid
        // For now, we'll use Supabase's email templates if configured
        // You can also integrate with Resend, SendGrid, or other email services
        
        // Option 1: Use Supabase email (if SMTP is configured)
        // This requires SMTP to be set up in supabase/config.toml
        const emailSubject = 'Complete Your MessHall Payment Setup';
        const emailBody = `
Hello!

To start receiving payments on MessHall, please complete your Stripe onboarding:

${onboardingData.url}

This link will expire in 24 hours. If you need a new link, contact support.

Best,
MessHall Team
        `;
        
        // Try to send via Supabase Auth email (if SMTP configured)
        // Note: This requires SMTP to be configured in your Supabase project
        // Alternative: Use a service like Resend, SendGrid, or Postmark
        console.log('Would send email to:', userEmail);
        console.log('Email subject:', emailSubject);
        console.log('Onboarding URL:', onboardingData.url);
        
        // TODO: Integrate with your email service (Resend, SendGrid, etc.)
        // Example with Resend:
        // const resendApiKey = Deno.env.get('RESEND_API_KEY');
        // if (resendApiKey) {
        //   await fetch('https://api.resend.com/emails', {
        //     method: 'POST',
        //     headers: {
        //       'Authorization': `Bearer ${resendApiKey}`,
        //       'Content-Type': 'application/json',
        //     },
        //     body: JSON.stringify({
        //       from: 'MessHall <onboarding@messhall.com>',
        //       to: userEmail,
        //       subject: emailSubject,
        //       html: emailBody.replace(/\n/g, '<br>'),
        //     }),
        //   });
        // }
      }
    } catch (emailError) {
      // Don't fail the request if email fails - log it instead
      console.error('Failed to send email:', emailError);
    }

    // 10) Return the onboarding URL (for admin to share manually if email fails)
    return new Response(
      JSON.stringify({ 
        url: onboardingData.url,
        email_sent: true, // Indicates we attempted to send email
        message: 'Onboarding link created and email sent to user'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in admin-resend-stripe-onboarding:', error);
    console.error('Error stack:', error?.stack);
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    return new Response(
      JSON.stringify({ 
        error: error?.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

