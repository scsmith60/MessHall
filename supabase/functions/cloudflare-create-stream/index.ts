// supabase/functions/cloudflare-create-stream/index.ts
// Creates a Cloudflare Stream live input for an Enlisted Club session

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
        JSON.stringify({ ok: false, error: "Only the host can create the video stream" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If stream already exists, return existing stream info
    if (session.room_id) {
      const cloudflareApiKey = Deno.env.get("CLOUDFLARE_STREAM_API_KEY");
      const cloudflareAccountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");

      if (!cloudflareApiKey || !cloudflareAccountId) {
        return new Response(
          JSON.stringify({ ok: false, error: "Cloudflare Stream not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get existing live input
      const streamResponse = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/stream/live_inputs/${session.room_id}`,
        {
          headers: {
            Authorization: `Bearer ${cloudflareApiKey}`,
          },
        }
      );

      if (streamResponse.ok) {
        const streamData = await streamResponse.json();
        const input = streamData.result;
        
        return new Response(
          JSON.stringify({
            ok: true,
            stream_id: input.uid,
            rtmp_url: input.rtmps?.url || input.rtmps?.streamKey ? 
              `${input.rtmps.url}/${input.rtmps.streamKey}` : null,
            hls_url: input.playback?.hls || null,
            stream_key: input.rtmps?.streamKey || null,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Create new Cloudflare Stream live input
    const cloudflareApiKey = Deno.env.get("CLOUDFLARE_STREAM_API_KEY");
    const cloudflareAccountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");

    if (!cloudflareApiKey || !cloudflareAccountId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Cloudflare Stream not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create live input
    const streamResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/stream/live_inputs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cloudflareApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meta: {
            name: `enlisted-${session_id.slice(0, 8)}`,
          },
          // Enable RTMPS for streaming from mobile
          recording: {
            mode: "automatic",
          },
        }),
      }
    );

    if (!streamResponse.ok) {
      const error = await streamResponse.json();
      return new Response(
        JSON.stringify({ ok: false, error: error.errors?.[0]?.message || "Failed to create stream" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const streamData = await streamResponse.json();
    const input = streamData.result;

    // Save stream_id to session
    await supabase
      .from("enlisted_club_sessions")
      .update({
        room_id: input.uid,
        video_url: input.playback?.hls || null,
      })
      .eq("id", session_id);

    return new Response(
      JSON.stringify({
        ok: true,
        stream_id: input.uid,
        rtmp_url: input.rtmps?.url || input.rtmps?.streamKey ? 
          `${input.rtmps.url}/${input.rtmps.streamKey}` : null,
        hls_url: input.playback?.hls || null,
        stream_key: input.rtmps?.streamKey || null,
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





