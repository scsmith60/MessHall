// supabase/functions/creator-apply/index.ts
//
// LIKE I'M 5:
// • When you press the green "Apply" button, this little helper runs.
// • It checks: "Are you logged in?"  If not, we say no.
// • Then it checks your profile: if you're already approved (monetize date set),
//   we don't make a new application — we just say "you're already enabled!".
// • If you already sent an application and it's still waiting (pending), we reuse it.
// • If you were rejected, you can resubmit — we create a new pending application.
// • Otherwise, we make ONE new "pending" application for you.
// • If two taps happen at once, the database's unique rule prevents duplicates,
//   and we calmly reuse the latest pending row instead.
//
// REQUIREMENTS (safe to keep as-is):
// • Table: public.creator_applications (status in 'pending','approved','rejected','withdrawn')
// • Optional: Partial unique index to enforce one pending per user:
//     create unique index if not exists uniq_creator_pending
//     on public.creator_applications (user_id) where (status = 'pending');
// • RLS policies allowing a logged-in user to INSERT+SELECT their own rows.
//
// This function returns JSON like:
//   { ok: true, application_id: 123, reused: false }
// Or, if you're already enabled/approved:
//   { ok: true, already_enabled: true, status: "approved" }
// If something goes wrong: { error: "message here" } with proper HTTP status.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// tiny helper so responses are tidy
function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    }
  });
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return json({ ok: true });
  }

  // 0) set up client that carries the user's auth token
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

  // 1) who is calling?
  const { data: au, error: auErr } = await supabase.auth.getUser();
  if (auErr || !au?.user?.id) {
    return json({
      error: 'not_authenticated'
    }, 401);
  }

  const uid = au.user.id;

  // 2) if profile already shows "enabled/approved", skip inserting
  //    We first try to read both fields; if the column `creator_status` doesn't exist,
  //    we gracefully fall back to only `monetize_enabled_at`.
  let monetizeEnabledAt = null;
  let creatorStatus = null;
  let profileErr = null;

  {
    const { data, error } = await supabase
      .from('profiles')
      .select('monetize_enabled_at, creator_status')
      .eq('id', uid)
      .maybeSingle();

    if (!error) {
      monetizeEnabledAt = data?.monetize_enabled_at ?? null;
      creatorStatus = (data?.creator_status ?? null)?.toLowerCase?.() ?? null;
    } else {
      profileErr = error;
    }
  }

  // if that failed because creator_status might not exist, try just monetize_enabled_at
  if (profileErr) {
    const { data, error } = await supabase
      .from('profiles')
      .select('monetize_enabled_at')
      .eq('id', uid)
      .maybeSingle();
    if (!error) monetizeEnabledAt = data?.monetize_enabled_at ?? null;
    // if still error, we ignore — not critical for applying
  }

  // If we detect you're already approved/enabled, we don't create anything.
  // (Some projects set only monetize_enabled_at; others also set creator_status='approved')
  const alreadyEnabled = !!monetizeEnabledAt || creatorStatus === 'approved' || creatorStatus === 'active';

  if (alreadyEnabled) {
    return json({
      ok: true,
      already_enabled: true,
      status: 'approved'
    });
  }

  // 3) do you already have a pending application? if yes → reuse
  //    Note: Rejected applications are NOT checked here, so users can resubmit after rejection
  {
    const { data: existing, error } = await supabase
      .from('creator_applications')
      .select('id, status')
      .eq('user_id', uid)
      .in('status', ['pending', 'approved']) // if somehow already approved in this table, report back
      .order('submitted_at', { ascending: false })
      .limit(1);

    if (!error && Array.isArray(existing) && existing.length > 0) {
      const row = existing[0];
      if (row.status === 'approved') {
        return json({
          ok: true,
          already_enabled: true,
          status: 'approved'
        });
      }

      // pending → reuse the same application id
      return json({
        ok: true,
        application_id: row.id,
        reused: true
      });
    }
  }

  // 4) create a new pending application
  //    We handle the "unique pending per user" rule by:
  //    - trying an insert
  //    - if DB says "duplicate" (23505), we fetch and reuse the existing pending row.
  //    This also allows resubmission after rejection (rejected status doesn't block new pending apps).
  try {
    const { data: inserted, error: insErr } = await supabase
      .from('creator_applications')
      .insert({
        user_id: uid,
        status: 'pending',
        submitted_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (insErr) throw insErr;

    // Update profile creator_status to 'applied' when creating new application
    await supabase
      .from('profiles')
      .update({ creator_status: 'applied' })
      .eq('id', uid)
      .then(() => {
        // Ignore errors if creator_status column doesn't exist
      });

    return json({
      ok: true,
      application_id: inserted.id,
      reused: false
    });
  } catch (e: any) {
    // If the database has a UNIQUE partial index for (user_id) where status='pending',
    // simultaneous taps will throw 23505; in that case we read the existing row and reuse it.
    const code = e?.code || e?.details || '';
    const isUniqueViolation =
      String(code).includes('23505') ||
      String(e?.message || '').toLowerCase().includes('duplicate') ||
      String(e?.message || '').toLowerCase().includes('unique');

    if (isUniqueViolation) {
      const { data: existing } = await supabase
        .from('creator_applications')
        .select('id')
        .eq('user_id', uid)
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false })
        .limit(1);

      const appId = existing?.[0]?.id;
      if (appId) {
        return json({
          ok: true,
          application_id: appId,
          reused: true
        });
      }
    }

    // some other error
    return json({
      error: e?.message || 'apply_failed'
    }, 500);
  }
});
