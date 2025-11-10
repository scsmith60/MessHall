// supabase/functions/admin-reject-creator/index.ts
// Rejects a creator application and updates their profile status

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
    // 1) Set up Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
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
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: 'not_authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.is_admin) {
      return new Response(
        JSON.stringify({ error: 'not_authorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3) Get application_id and note from request body
    const { application_id, note } = await req.json();

    if (!application_id) {
      return new Response(
        JSON.stringify({ error: 'application_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4) Get the application (use admin client to bypass RLS)
    const { data: application, error: appError } = await supabaseAdmin
      .from('creator_applications')
      .select('id, user_id, status')
      .eq('id', application_id)
      .maybeSingle();

    if (appError || !application) {
      return new Response(
        JSON.stringify({ error: 'Application not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (application.status === 'rejected') {
      return new Response(
        JSON.stringify({ ok: true, message: 'Application already rejected' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5) Update the application status (use admin client to bypass RLS)
    const { error: updateAppError } = await supabaseAdmin
      .from('creator_applications')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewer: user.id,
        notes: note || null,
      })
      .eq('id', application_id);

    if (updateAppError) {
      console.error('Error updating application:', updateAppError);
      return new Response(
        JSON.stringify({ error: updateAppError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 6) Update the user's profile (use admin client to bypass RLS)
    const { error: updateProfileError } = await supabaseAdmin
      .from('profiles')
      .update({
        creator_status: 'rejected',
        // Don't set monetize_enabled_at for rejected applications
      })
      .eq('id', application.user_id);

    if (updateProfileError) {
      console.error('Error updating profile:', updateProfileError);
      return new Response(
        JSON.stringify({ error: `Failed to update profile: ${updateProfileError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message: 'Application rejected successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in admin-reject-creator:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

