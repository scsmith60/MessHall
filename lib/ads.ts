// /lib/ads.ts
// ELI5: We put a little note in the database when someone sees or clicks an ad/shelf.
// This file already had logAdEvent. We keep it AND add a helper for shelves.

import { supabase } from "./supabase";

export type AdEventType = "impression" | "click";

/** ELI5: Save "I saw/clicked ad X (or shelf X) creative Y". */
export async function logAdEvent(
  slotId: string,
  type: AdEventType,
  meta?: Record<string, any>,
  creativeId?: string
) {
  try {
    if (!slotId || (type !== "impression" && type !== "click")) return;
    const { data: u } = await supabase.auth.getUser();
    const payload = {
      slot_id: slotId,           // NOTE: for shelves we pass shelf_id here too
      creative_id: creativeId ?? null,
      event_type: type,
      user_id: u?.user?.id ?? null,
      meta: meta ?? null,        // we’ll put {unit:"rail_shelf"} for shelves
    };
    const { error } = await supabase.from("ad_events").insert(payload);
    if (error) console.log("ad_events insert error", error.message);
  } catch (e) {
    console.log("ad_events insert failed", e);
  }
}

/** Sugar: use this if you want super clear shelf logging from other screens. */
export async function logShelfEvent(
  shelfId: string,
  type: AdEventType,
  itemId?: string,
  more?: Record<string, any>
) {
  return logAdEvent(shelfId, type, { unit: "rail_shelf", ...(more ?? {}) }, itemId);
}
