// supabase/functions/admin-list-creator-apps/index.ts
// Returns a list of creator applications for admin review
// Includes user stats, Stripe status, but NOT 2FA (removed requirement)

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
    // 1) Set up Supabase client with auth
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: {
            Authorization: req.headers.get('Authorization') ?? ''
          }
        }
      }
    );

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

    // 3) Get status filter from request (body or query string)
    let statusFilter: string | null = null;
    try {
      if (req.method === 'POST') {
        const body = await req.json();
        statusFilter = body?.status || null;
      }
    } catch (e) {
      // If JSON parse fails, try query string
    }
    
    // Try query string if not found in body
    if (!statusFilter) {
      try {
        const url = new URL(req.url);
        statusFilter = url.searchParams.get('status');
      } catch (e) {
        // Ignore URL parse errors
      }
    }

    // 4) Query creator applications
    let applicationsQuery = supabase
      .from('creator_applications')
      .select(`
        id,
        user_id,
        status,
        submitted_at,
        reviewed_at,
        reviewer,
        notes
      `)
      .order('submitted_at', { ascending: false });

    if (statusFilter) {
      applicationsQuery = applicationsQuery.eq('status', statusFilter);
    }

    const { data: applications, error: appsError } = await applicationsQuery;

    if (appsError) {
      console.error('Error fetching applications:', appsError);
      return new Response(
        JSON.stringify({ error: appsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!applications || applications.length === 0) {
      return new Response(
        JSON.stringify({ items: [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 5) Get user IDs and fetch profile data
    const userIds = applications.map(app => app.user_id);
    
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, username, email, creator_status, stripe_account_id, details_submitted')
      .in('id', userIds);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
    }

    // 6) Get user stats (recipes, followers, views)
    const { data: recipes, error: recipesError } = await supabase
      .from('recipes')
      .select('user_id, is_private, view_count, viewed_at')
      .in('user_id', userIds);

    const { data: follows, error: followsError } = await supabase
      .from('follows')
      .select('following_id')
      .in('following_id', userIds);

    // 7) Build response items
    const items = applications.map(app => {
      const userProfile = profiles?.find(p => p.id === app.user_id);
      
      // Count recipes
      const userRecipes = recipes?.filter(r => r.user_id === app.user_id && !r.is_private) || [];
      const recipesPublished = userRecipes.length;
      
      // Count views in last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const views30d = userRecipes
        .filter(r => r.viewed_at && new Date(r.viewed_at) > thirtyDaysAgo)
        .reduce((sum, r) => sum + (r.view_count || 0), 0);
      
      // Count followers
      const followers = follows?.filter(f => f.following_id === app.user_id).length || 0;

      return {
        application_id: app.id,
        user_id: app.user_id,
        application_status: app.status,
        submitted_at: app.submitted_at,
        reviewed_at: app.reviewed_at,
        reviewer: app.reviewer,
        notes: app.notes,
        username: userProfile?.username || null,
        email: userProfile?.email || null,
        creator_status: userProfile?.creator_status || null,
        followers: followers,
        recipes_published: recipesPublished,
        views_30d: views30d,
        avg_rating: null, // TODO: Calculate from ratings table if you have one
        affiliate_conversions_60d: null, // TODO: Calculate from conversions table if you have one
        stripe_account_id: userProfile?.stripe_account_id || null,
        details_submitted: userProfile?.details_submitted || false
      };
    });

    return new Response(
      JSON.stringify({ items }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in admin-list-creator-apps:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
