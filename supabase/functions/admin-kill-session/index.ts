// supabase/functions/admin-kill-session/index.ts
// Admin function to kill/terminate a video session (moderation)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { session_id, reason } = await req.json();

    if (!session_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with user's auth token
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Verify user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.is_admin) {
      return new Response(
        JSON.stringify({ ok: false, error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role to kill session (bypass RLS)
    const serviceSupabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Check if session exists
    const { data: session, error: sessionError } = await serviceSupabase
      .from("enlisted_club_sessions")
      .select("id, status, room_id")
      .eq("id", session_id)
      .maybeSingle();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ ok: false, error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (session.status === "ended") {
      return new Response(
        JSON.stringify({ ok: false, error: "Session is already ended" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Kill the session
    const { error: updateError } = await serviceSupabase
      .from("enlisted_club_sessions")
      .update({
        status: "ended",
        admin_killed: true,
        admin_kill_reason: reason || "Session terminated by administrator",
        killed_by_user_id: user.id,
        killed_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
      })
      .eq("id", session_id);

    if (updateError) {
      throw updateError;
    }

    // If using Daily.co, delete the room (optional cleanup)
    const dailyApiKey = Deno.env.get("DAILY_API_KEY");
    if (dailyApiKey && session.room_id) {
      try {
        await fetch(`https://api.daily.co/v1/rooms/${session.room_id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${dailyApiKey}`,
          },
        });
      } catch (e) {
        // Ignore errors - room deletion is optional
        console.error("Failed to delete Daily.co room:", e);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Session terminated successfully",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

