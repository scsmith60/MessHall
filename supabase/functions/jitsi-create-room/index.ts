// supabase/functions/jitsi-create-room/index.ts
// Creates a Jitsi Meet room URL (100% FREE, no API keys needed)
// Uses public meet.jit.si server - completely free forever

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Verify user is the host
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

    // If room already exists, return it
    if (session.room_id && session.video_url) {
      return new Response(
        JSON.stringify({
          ok: true,
          room_url: session.video_url,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // If room_id exists but video_url doesn't, reconstruct it
    if (session.room_id) {
      const roomUrl = session.room_id.startsWith("http") 
        ? session.room_id 
        : `https://meet.jit.si/${session.room_id}`;
      // Update video_url for consistency
      await supabase
        .from("enlisted_club_sessions")
        .update({ video_url: roomUrl })
        .eq("id", session_id);
      return new Response(
        JSON.stringify({
          ok: true,
          room_url: roomUrl,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate unique room name
    const roomName = `enlisted-${session_id.slice(0, 8)}-${Date.now().toString(36)}`;
    const roomUrl = `https://meet.jit.si/${roomName}`;

    // Save room_id to session (just the room name, not full URL)
    await supabase
      .from("enlisted_club_sessions")
      .update({
        room_id: roomName,
        video_url: roomUrl,
      })
      .eq("id", session_id);

    return new Response(
      JSON.stringify({
        ok: true,
        room_url: roomUrl,
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

