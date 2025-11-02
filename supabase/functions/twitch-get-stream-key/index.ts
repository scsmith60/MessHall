// supabase/functions/twitch-get-stream-key/index.ts
// Gets Twitch stream key for hosting (requires OAuth setup)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Twitch API credentials (set in Supabase secrets)
const TWITCH_CLIENT_ID = Deno.env.get("TWITCH_CLIENT_ID") || "";
const TWITCH_CLIENT_SECRET = Deno.env.get("TWITCH_CLIENT_SECRET") || "";

Deno.serve(async (req) => {
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
        JSON.stringify({ ok: false, error: "Only the host can get the stream key" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if Twitch channel already exists for this session
    if (session.room_id && session.room_id.startsWith("twitch:")) {
      const channelName = session.room_id.replace("twitch:", "");
      return new Response(
        JSON.stringify({
          ok: true,
          channel_name: channelName,
          stream_key: "Use OBS to stream to Twitch", // Stream key managed by Twitch
          rtmp_url: "rtmp://live.twitch.tv/app/",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Note: Full Twitch integration requires:
    // 1. Twitch OAuth setup
    // 2. User authorization flow
    // 3. Getting actual stream key from Twitch API
    // For now, return instructions
    
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Twitch integration requires OAuth setup. Use manual channel name for now.",
        instructions: "Host should provide their Twitch channel name. Viewers watch via embed.",
      }),
      { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

