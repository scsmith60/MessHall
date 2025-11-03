// supabase/functions/agora-create-room/index.ts
// Creates an Agora channel/room for video conferencing
// Note: Agora channels are ephemeral - they exist only when users are connected
// So we just return the channel name (can be session ID or generated)

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch (jsonError: any) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid request body: ${jsonError.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { session_id, user_id } = body;

    if (!session_id || !user_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "session_id and user_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if session exists
    const { data: session, error: sessionError } = await supabase
      .from("enlisted_club_sessions")
      .select("*")
      .eq("id", session_id)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ ok: false, error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If room_id already exists, return it
    if (session.room_id) {
      const channelName = session.room_id;
      return new Response(
        JSON.stringify({
          ok: true,
          channel_name: channelName,
          // Note: Token generation requires Agora App Certificate
          // For basic setup, tokens are optional (can use app ID only for testing)
          token: null, // Generate token separately if needed
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate unique channel name
    const channelName = `enlisted-${session_id.slice(0, 8)}-${Date.now().toString(36)}`;
    
    // Save to session
    await supabase
      .from("enlisted_club_sessions")
      .update({
        room_id: channelName,
        video_url: `agora://${channelName}`, // Custom protocol for identification
      })
      .eq("id", session_id);

    return new Response(
      JSON.stringify({
        ok: true,
        channel_name: channelName,
        token: null, // Generate token separately if using secure channels
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in agora-create-room:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

