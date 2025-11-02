// supabase/functions/janus-create-room/index.ts
// Creates a Janus video room for an Enlisted Club session

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Janus Admin API URL (configure this in Supabase secrets)
const JANUS_ADMIN_URL = Deno.env.get("JANUS_ADMIN_URL") || "";
const JANUS_ADMIN_SECRET = Deno.env.get("JANUS_ADMIN_SECRET") || "";

Deno.serve(async (req) => {
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
      .select("id, host_id, room_id, max_participants")
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

    // Check if session was admin-killed
    if (session.admin_killed) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "This session was terminated by an administrator." 
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If room already exists, return existing room info
    if (session.room_id) {
      // Room ID is the Janus room number
      return new Response(
        JSON.stringify({
          ok: true,
          room_id: session.room_id,
          room_url: `janus://${session.room_id}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate unique room ID (numeric for Janus video rooms)
    // Use timestamp-based room ID to ensure uniqueness
    const roomId = Math.floor(Date.now() / 1000) % 1000000; // Last 6 digits of timestamp

    // Create Janus video room via Admin API
    if (JANUS_ADMIN_URL && JANUS_ADMIN_SECRET) {
      try {
        const janusResponse = await fetch(`${JANUS_ADMIN_URL}/rooms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${JANUS_ADMIN_SECRET}`,
          },
          body: JSON.stringify({
            room: roomId,
            description: `Enlisted Club Session ${session_id.slice(0, 8)}`,
            publishers: session.max_participants || 100,
            bitrate: 128000,
            fir_freq: 10,
            video_codec: "vp8",
            record: false,
          }),
        });

        if (!janusResponse.ok) {
          console.error("Failed to create Janus room via API:", await janusResponse.text());
          // Continue anyway - room might be created on first join
        }
      } catch (error) {
        console.error("Error calling Janus Admin API:", error);
        // Continue anyway - Janus creates rooms automatically on first join
      }
    }

    // Save room_id to session
    await supabase
      .from("enlisted_club_sessions")
      .update({
        room_id: roomId.toString(),
        video_url: `janus://${roomId}`,
      })
      .eq("id", session_id);

    return new Response(
      JSON.stringify({
        ok: true,
        room_id: roomId.toString(),
        room_url: `janus://${roomId}`,
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

