// supabase/functions/daily-get-token/index.ts
// Generates a Daily.co participant token for joining a session

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { session_id, user_id } = await req.json();

    if (!session_id || !user_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "session_id and user_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Get session and verify user is a participant
    const { data: session, error: sessionError } = await supabase
      .from("enlisted_club_sessions")
      .select("id, host_id, room_id, status")
      .eq("id", session_id)
      .single();

    if (sessionError || !session || !session.room_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Session or room not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (session.status !== "active" && session.status !== "scheduled") {
      return new Response(
        JSON.stringify({ ok: false, error: "Session is not active" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is a participant
    const { data: participant } = await supabase
      .from("enlisted_club_participants")
      .select("user_id")
      .eq("session_id", session_id)
      .eq("user_id", user_id)
      .is("left_at", null)
      .maybeSingle();

    if (!participant && session.host_id !== user_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "You must join the session first" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dailyApiKey = Deno.env.get("DAILY_API_KEY");
    if (!dailyApiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Daily.co API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate participant token
    const tokenResponse = await fetch(`https://api.daily.co/v1/meeting-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dailyApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          room_name: session.room_id,
          is_owner: session.host_id === user_id,
        },
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      return new Response(
        JSON.stringify({ ok: false, error: error.error || "Failed to generate token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData = await tokenResponse.json();

    // Get room URL
    const roomResponse = await fetch(`https://api.daily.co/v1/rooms/${session.room_id}`, {
      headers: {
        Authorization: `Bearer ${dailyApiKey}`,
      },
    });

    let roomUrl = `https://${session.room_id}.daily.co`;
    if (roomResponse.ok) {
      const roomData = await roomResponse.json();
      roomUrl = roomData.config.url || roomUrl;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        room_url: roomUrl,
        token: tokenData.token,
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

