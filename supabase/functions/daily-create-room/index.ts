// supabase/functions/daily-create-room/index.ts
// Creates a Daily.co room for an Enlisted Club session and returns room URL + token

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
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

    // Verify user is the host of the session
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

    const { data: session, error: sessionError } = await supabase
      .from("enlisted_club_sessions")
      .select("id, host_id, room_id")
      .eq("id", session_id)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ ok: false, error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (session.host_id !== user_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Only the host can create the video room" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If room already exists, return existing room info
    if (session.room_id) {
      // Get Daily API key from environment
      const dailyApiKey = Deno.env.get("DAILY_API_KEY");
      if (!dailyApiKey) {
        return new Response(
          JSON.stringify({ ok: false, error: "Daily.co API key not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get room info from Daily
      const dailyResponse = await fetch(`https://api.daily.co/v1/rooms/${session.room_id}`, {
        headers: {
          Authorization: `Bearer ${dailyApiKey}`,
        },
      });

      if (dailyResponse.ok) {
        const roomData = await dailyResponse.json();
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
              is_owner: true,
            },
          }),
        });

        const tokenData = await tokenResponse.json();

        return new Response(
          JSON.stringify({
            ok: true,
            room_url: roomData.config.url || `https://${session.room_id}.daily.co`,
            token: tokenData.token,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Create new Daily room
    const dailyApiKey = Deno.env.get("DAILY_API_KEY");
    if (!dailyApiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Daily.co API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const roomName = `enlisted-${session_id.slice(0, 8)}`;
    const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days from now

    const dailyResponse = await fetch("https://api.daily.co/v1/rooms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dailyApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: roomName,
        privacy: "public",
        properties: {
          exp: expiresAt,
          enable_screenshare: true,
          enable_chat: false, // We have our own chat
          enable_knocking: true, // Host can approve participants
          start_video_off: false,
          start_audio_off: false,
          max_participants: session.max_participants || 50,
        },
      }),
    });

    if (!dailyResponse.ok) {
      const error = await dailyResponse.json();
      return new Response(
        JSON.stringify({ ok: false, error: error.error || "Failed to create Daily room" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const roomData = await dailyResponse.json();

    // Generate participant token for host
    const tokenResponse = await fetch(`https://api.daily.co/v1/meeting-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dailyApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          is_owner: true,
        },
      }),
    });

    const tokenData = await tokenResponse.json();

    // Save room_id to session
    await supabase
      .from("enlisted_club_sessions")
      .update({
        room_id: roomName,
        video_url: roomData.url,
      })
      .eq("id", session_id);

    return new Response(
      JSON.stringify({
        ok: true,
        room_url: roomData.url,
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

