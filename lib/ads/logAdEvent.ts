// lib/ads/logAdEvent.ts
// ELI5: we write a tiny note when an ad is seen (impression) or tapped (click).
// 1) Try the server RPC (best).
// 2) If told to, or if RPC fails, write directly.
// We log loudly so you can see what's happening in Metro.

import { supabase } from "../supabase";

type Placement = "rail" | "feed";
type EventType = "click" | "impression";

export type LogArgs = {
  placement: Placement;
  slot_id?: string | null;
  creative_id?: string | null;
  event_type?: EventType;        // default "click"
  meta?: Record<string, any>;
  forceDirect?: boolean;         // <-- NEW: bypass RPC for debugging
};

// uuid guard
function looksLikeUUID(v?: string | null) {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function normalizePlacement(p?: string | null): Placement {
  return p === "rail" ? "rail" : "feed";
}

// throttle memory: impressions only (5s)
const lastSent: Record<string, number> = {};

export async function logAdEvent({
  placement,
  slot_id = null,
  creative_id = null,
  event_type = "click",
  meta = {},
  forceDirect = false,
}: LogArgs): Promise<boolean> {
  const safePlacement = normalizePlacement(placement);
  const key = `${event_type}:${safePlacement}:${slot_id ?? "-"}:${creative_id ?? "-"}`;
  const now = Date.now();
  const cooldownMs = event_type === "impression" ? 5000 : 0;
  if (cooldownMs && now - (lastSent[key] ?? 0) < cooldownMs) {
    console.log("[logAdEvent] throttle skip", key);
    return false;
  }
  lastSent[key] = now;

  const { data: auth } = await supabase.auth.getUser();
  const user_id = auth.user?.id ?? null;
  const occurred_at = new Date().toISOString();

  const rpcPayload: any = {
    p_event_type: event_type,
    p_placement: safePlacement,
    p_slot_id: looksLikeUUID(slot_id) ? slot_id : null,
    p_creative_id: looksLikeUUID(creative_id) ? creative_id : null,
    p_user_id: user_id,
    p_meta: meta ?? {},
    p_occurred_at: occurred_at,
  };

  // ── Path A: RPC (unless forceDirect)
  if (!forceDirect) {
    try {
      const { error } = await supabase.rpc("log_ad_event_rpc", rpcPayload);
      if (!error) {
        console.log("[logAdEvent] RPC ok", { event_type, placement: safePlacement, slot_id: rpcPayload.p_slot_id });
        return true;
      }
      console.log("[logAdEvent] RPC failed:", error.message);
    } catch (e: any) {
      console.log("[logAdEvent] RPC threw:", e?.message || e);
    }
  } else {
    console.log("[logAdEvent] forceDirect=true, skipping RPC");
  }

  // ── Path B: direct insert (fallback or forced)
  const direct: any = {
    user_id,
    placement: safePlacement,
    event_type,
    meta: meta ?? {},
    occurred_at,
    created_at: new Date().toISOString(),
  };
  if (looksLikeUUID(slot_id)) direct.slot_id = slot_id!;
  if (looksLikeUUID(creative_id)) direct.creative_id = creative_id!;

  try {
    const { error } = await supabase.from("ad_events").insert(direct);
    if (!error) {
      console.log("[logAdEvent] direct insert ok", { event_type, placement: safePlacement, slot_id: direct.slot_id });
      return true;
    }
    console.log("[logAdEvent] direct insert error:", error.message);
    return false;
  } catch (e: any) {
    console.log("[logAdEvent] direct insert threw:", e?.message || e);
    return false;
  }
}

export async function logAdImpression(args: Omit<LogArgs, "event_type">) {
  return logAdEvent({ ...args, event_type: "impression" });
}
export async function logAdClick(args: Omit<LogArgs, "event_type">) {
  return logAdEvent({ ...args, event_type: "click" });
}
