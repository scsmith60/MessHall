// supabase/functions/eligibility-check/index.ts
// Purpose: Check if the current user meets monetization rules,
// update their profile status, and return a friendly checklist
// with "what is this?" tips and "fix it" routes.

// -----------------------------
// Imports
// -----------------------------
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// -----------------------------
// Build the master list of rules
// -----------------------------
// NOTE: We return ALL items. Each item has `passed` computed by checking
// if it's NOT in the missing[] list returned by the SQL function.
function checklistMaster() {
  return [
    {
      key: 'age_18_plus',
      label: 'You are 18 or older',
      help: 'We need you to be a grown-up to earn money.',
      ctaRoute: '/(account)/profile/edit-birthdate'
    },
    {
      key: 'no_recent_strikes',
      label: 'No policy strikes in last 90 days',
      help: 'If you had a rule-break, we need a little cool-down time.'
    },
    {
      key: 'recipes_≥_3',
      label: 'At least 3 published recipes',
      help: 'Make and publish 3 yummy recipes so fans can enjoy your work.',
      ctaRoute: '/(tabs)/capture' // your recipe creator screen
    },
    {
      key: 'followers_≥_500_or_views30d_≥_10000',
      label: '500 followers OR 10,000 views (last 30 days)',
      help: 'We want to see that people are watching. Grow followers or views.',
      ctaRoute: '/(account)/growth' // maybe a tips/how-to screen
    },
    {
      key: 'account_age_≥_30_days',
      label: 'Account is at least 30 days old',
      help: 'New accounts need a short waiting period before earning.'
    },
    {
      key: 'stripe_account_setup',
      label: 'Stripe payment account is set up',
      help: 'You need to complete Stripe onboarding to receive payments. This is the final step before applying.',
      ctaRoute: '/(account)/monetization' // Will show Stripe setup link
    }
  ];
}

// -----------------------------
// Convert to API response items
// -----------------------------
function buildChecklist(missing: string[]) {
  const master = checklistMaster();
  return master.map((i) => ({
    label: i.label,
    help: i.help,
    ctaRoute: i.ctaRoute,
    ctaExternal: i.ctaExternal,
    passed: !missing.includes(i.key)
  }));
}

// -----------------------------
// Main handler
// -----------------------------
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Eligibility check function called');
    
    // Create Supabase client with auth passthrough
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
      return new Response(
        JSON.stringify({ error: 'Server configuration error', eligible: false, checklist: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization') ?? ''
        }
      }
    });

    // 1) who is calling?
    console.log('Checking user authentication...');
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      console.error('Auth error:', userErr);
      return new Response(
        JSON.stringify({ error: 'not_authenticated', eligible: false, checklist: [] }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('User authenticated:', user.id);

    // 2) ask Postgres to check the rules
    console.log('Calling check_creator_eligibility RPC...');
    const { data, error } = await supabase.rpc('check_creator_eligibility', {
      p_user: user.id
    });
    
    console.log('RPC response - data:', data, 'error:', error);

    if (error) {
      console.error('RPC error:', error);
      console.error('RPC error code:', error.code);
      console.error('RPC error message:', error.message);
      console.error('RPC error details:', JSON.stringify(error, null, 2));
      
      // If function doesn't exist (42883 = undefined_function), return a helpful error
      if (error.code === '42883' || error.message?.includes('does not exist') || error.message?.includes('function')) {
        console.error('Database function check_creator_eligibility does not exist!');
        return new Response(
          JSON.stringify({ 
            error: 'Database function not found. Please run the migration: create_creator_eligibility_check.sql',
            eligible: false,
            checklist: buildChecklist([])
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Return error but still try to provide a basic checklist
      return new Response(
        JSON.stringify({ 
          error: error.message || 'Database error',
          eligible: false,
          checklist: buildChecklist([]) // Return empty checklist on error
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      console.error('RPC returned no data:', data);
      return new Response(
        JSON.stringify({
          error: 'No eligibility data returned',
          eligible: false,
          checklist: buildChecklist([])
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const row = data[0];
    if (!row) {
      console.error('RPC returned empty row:', data);
      return new Response(
        JSON.stringify({
          error: 'Invalid eligibility data format',
          eligible: false,
          checklist: buildChecklist([])
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const eligible = !!row?.eligible;
    const missing = Array.isArray(row?.missing) ? row.missing : [];

    // 3) build friendly checklist
    const checklist = buildChecklist(missing);

    // 4) auto-set profile status (easy: none/eligible)
    await supabase
      .from('profiles')
      .update({
        creator_status: eligible ? 'eligible' : 'none'
      })
      .eq('id', user.id);

    // 5) send to app
    console.log('Returning success response - eligible:', eligible, 'checklist length:', checklist.length);
    return new Response(
      JSON.stringify({
        eligible,
        checklist
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'content-type': 'application/json'
        }
      }
    );
  } catch (error: any) {
    console.error('Eligibility check error:', error);
    console.error('Error stack:', error?.stack);
    console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
    // Return a response with an empty checklist so the UI can still render
    return new Response(
      JSON.stringify({
        error: error?.message || 'Failed to check eligibility',
        eligible: false,
        checklist: buildChecklist([]) // Return empty checklist so UI doesn't break
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
