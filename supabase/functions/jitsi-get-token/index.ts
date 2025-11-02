// supabase/functions/jitsi-get-token/index.ts
// Gets Jitsi room URL for participants to join

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
    // Validate environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing environment variables:", {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseKey,
      });
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "Server configuration error: Missing environment variables" 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body with better error handling
    let body;
    try {
      body = await req.json();
    } catch (jsonError: any) {
      console.error("JSON parse error:", jsonError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: `Invalid request body: ${jsonError.message}` 
        }),
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

    const supabase = createClient(
      supabaseUrl,
      supabaseKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: session, error: sessionError } = await supabase
      .from("enlisted_club_sessions")
      .select("id, room_id, video_url, status")
      .eq("id", session_id)
      .single();

    if (sessionError) {
      console.error("Session lookup error:", sessionError);
      return new Response(
        JSON.stringify({ ok: false, error: `Database error: ${sessionError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!session) {
      return new Response(
        JSON.stringify({ ok: false, error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!session.room_id && !session.video_url) {
      return new Response(
        JSON.stringify({ ok: false, error: "Host hasn't started video yet" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (session.status !== "active") {
      return new Response(
        JSON.stringify({ ok: false, error: "Session is not active" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if session was admin-killed (only if column exists)
    // Note: admin_killed column may not exist yet - check gracefully
    if ((session as any).admin_killed) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "This session was terminated by an administrator." 
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Construct Jitsi room URL
    const roomUrl = session.video_url || 
      (session.room_id?.startsWith("http") 
        ? session.room_id 
        : `https://meet.jit.si/${session.room_id}`);

    return new Response(
      JSON.stringify({
        ok: true,
        room_url: roomUrl,
        room_id: session.room_id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Unhandled error in jitsi-get-token:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
      error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    });
    
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: error.message || "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

