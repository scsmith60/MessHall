// supabase/functions/admin-approve-creator/index.ts
// Approves a creator application and updates their profile status

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

  try {
    console.log('admin-approve-creator called');
    console.log('Request method:', req.method);
    
    // 1) Set up Supabase clients
    console.log('Setting up Supabase clients...');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    console.log('Environment check:', {
      hasUrl: !!supabaseUrl,
      hasAnonKey: !!supabaseAnonKey,
      hasServiceKey: !!supabaseServiceKey
    });
    
    if (!supabaseServiceKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set!');
      return new Response(
        JSON.stringify({ error: 'Server configuration error: Service role key not set' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('Service role key is set, continuing...');
    
    // Client with user's auth token (for checking admin status)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization') ?? ''
        }
      }
    });
    
    // Service role client (bypasses RLS for admin operations)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // 2) Check if user is admin
    console.log('Checking user authentication...');
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      console.error('Auth error:', userErr);
      return new Response(
        JSON.stringify({ error: 'not_authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log('User authenticated:', user.id);

    console.log('Checking admin status...');
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    console.log('Profile check result:', { profile, isAdmin: profile?.is_admin });

    if (!profile?.is_admin) {
      console.error('User is not admin');
      return new Response(
        JSON.stringify({ error: 'not_authorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log('User is admin, proceeding...');

    // 3) Get application_id and note from request body
    console.log('Parsing request body...');
    let requestBody;
    try {
      requestBody = await req.json();
      console.log('Request body:', requestBody);
    } catch (e: any) {
      console.error('Error parsing request body:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('About to extract application_id from requestBody...');
    const { application_id, note } = requestBody;
    console.log('Extracted application_id:', application_id, 'note:', note);
    console.log('Type of application_id:', typeof application_id);

    if (!application_id) {
      console.error('application_id is missing');
      return new Response(
        JSON.stringify({ error: 'application_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4) Get the application (use admin client to bypass RLS)
    console.log('Fetching application with id:', application_id);
    const { data: application, error: appError } = await supabaseAdmin
      .from('creator_applications')
      .select('id, user_id, status')
      .eq('id', application_id)
      .maybeSingle();
    
    console.log('Application fetch result:', { application, appError });

    if (appError || !application) {
      console.error('Application not found or error:', { appError, application });
      return new Response(
        JSON.stringify({ error: 'Application not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Application found:', { id: application.id, user_id: application.user_id, status: application.status });

    // If already approved, still check and update profile if needed
    if (application.status === 'approved') {
      console.log('Application already approved, but checking profile status...');
      
      // Check if profile needs updating
      const { data: currentProfile } = await supabaseAdmin
        .from('profiles')
        .select('creator_status, monetize_enabled_at')
        .eq('id', application.user_id)
        .maybeSingle();
      
      console.log('Current profile status:', currentProfile);
      
      // If profile is not approved, update it
      if (currentProfile?.creator_status !== 'approved') {
        console.log('Profile is not approved, updating it now...');
        const now = new Date().toISOString();
        const { error: profileUpdateError } = await supabaseAdmin
          .from('profiles')
          .update({
            creator_status: 'approved',
            monetize_enabled_at: currentProfile?.monetize_enabled_at || now,
          })
          .eq('id', application.user_id);
        
        if (profileUpdateError) {
          console.error('Error updating profile:', profileUpdateError);
          return new Response(
            JSON.stringify({ 
              ok: true, 
              message: 'Application already approved, but failed to sync profile',
              error: profileUpdateError.message
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        console.log('Profile updated successfully');
        return new Response(
          JSON.stringify({ ok: true, message: 'Application already approved, profile synced' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log('Profile is already approved, nothing to do');
      return new Response(
        JSON.stringify({ ok: true, message: 'Application and profile already approved' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5) Update the application status (use admin client to bypass RLS)
    console.log('Updating application status to approved...');
    const { error: updateAppError } = await supabaseAdmin
      .from('creator_applications')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewer: user.id,
        notes: note || null,
      })
      .eq('id', application_id);
    
    console.log('Application update result:', { updateAppError });

    if (updateAppError) {
      console.error('Error updating application:', updateAppError);
      return new Response(
        JSON.stringify({ error: updateAppError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6) Update the user's profile (use admin client to bypass RLS)
    const now = new Date().toISOString();
    console.log('Updating profile for user:', application.user_id);
    console.log('Service role key available:', !!supabaseServiceKey);
    
    // First, verify the user exists
    const { data: existingProfile, error: checkError } = await supabaseAdmin
      .from('profiles')
      .select('id, creator_status, monetize_enabled_at')
      .eq('id', application.user_id)
      .maybeSingle();
    
    if (checkError) {
      console.error('Error checking profile:', checkError);
      return new Response(
        JSON.stringify({ error: `Failed to check profile: ${checkError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!existingProfile) {
      console.error('Profile not found for user:', application.user_id);
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('Existing profile before update:', existingProfile);
    
    // Use database function directly (more reliable, bypasses RLS)
    console.log('Calling admin_update_creator_status database function...');
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('admin_update_creator_status', {
      p_user_id: application.user_id,
      p_status: 'approved',
      p_monetize_enabled_at: now
    });
    
    if (rpcError) {
      console.error('Database function failed:', rpcError);
      console.error('RPC error details:', JSON.stringify(rpcError, null, 2));
      
      // Fallback to direct update if RPC doesn't exist
      console.log('Falling back to direct update...');
      const { data: updatedProfile, error: updateProfileError } = await supabaseAdmin
        .from('profiles')
        .update({
          creator_status: 'approved',
          monetize_enabled_at: now,
        })
        .eq('id', application.user_id)
        .select('id, creator_status, monetize_enabled_at')
        .single();

      if (updateProfileError) {
        console.error('Direct update also failed:', updateProfileError);
        return new Response(
          JSON.stringify({ 
            error: `Failed to update profile: ${rpcError.message || updateProfileError.message}`,
            rpc_error: rpcError,
            direct_error: updateProfileError
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log('Direct update succeeded:', updatedProfile);
    } else {
      console.log('Database function succeeded:', rpcResult);
    }
    
    // Verify the update worked
    const { data: verifyProfile, error: verifyError } = await supabaseAdmin
      .from('profiles')
      .select('id, creator_status, monetize_enabled_at')
      .eq('id', application.user_id)
      .maybeSingle();
    
    if (verifyError) {
      console.error('Error verifying update:', verifyError);
    } else {
      console.log('Profile after update (verification):', verifyProfile);
      if (verifyProfile?.creator_status !== 'approved') {
        console.error('WARNING: Profile status is still not approved!', verifyProfile);
        return new Response(
          JSON.stringify({ 
            error: 'Profile update did not succeed - status is still not approved',
            current_status: verifyProfile?.creator_status,
            expected: 'approved'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log('Profile updated successfully!');

    return new Response(
      JSON.stringify({ 
        ok: true, 
        message: 'Application approved successfully',
        profile_updated: verifyProfile || existingProfile
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('CRITICAL ERROR in admin-approve-creator:', error);
    console.error('Error stack:', error?.stack);
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return new Response(
      JSON.stringify({ 
        error: error?.message || 'Internal server error',
        details: error?.toString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

