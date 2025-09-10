// 🔧 This file gives you simple "get recipes" functions that ALWAYS respect privacy.
// 🧸 We also add super-clear comments so future-you knows what each bit does.

import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";

// ✅ Use your existing client if you already have one.
//    If you do, delete this and import your client instead.
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
);

// 🏷️ CHANGE THIS if your owner column is named something else (e.g., "user_id")
const OWNER_COLUMN = "author_id";

// 🧃 What fields do we want back for a recipe card?
//    Keep this aligned with your UI needs.
const RECIPE_CARD_FIELDS =
  "id,title,cover_image,created_at,is_private,author_id";

// 🍎 FEED: show only NON-private recipes for everyone
export async function getFeedRecipes(limit = 50) {
  // Even though RLS protects us, we still add the filter so we don't ask for junk
  const { data, error } = await supabase
    .from("recipes")
    .select(RECIPE_CARD_FIELDS)
    .eq("is_private", false) // 🛡️ hide private recipes
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// 🫶 USER PAGE: show recipes for a given profile
// viewerId = the logged-in user's id (or null if logged out)
// profileId = the user whose profile we are looking at
export async function getUserRecipes(profileId: string, viewerId: string | null) {
  // If I'm looking at MY OWN profile, show all my recipes (private + public)
  const viewingOwnProfile = viewerId && viewerId === profileId;

  let query = supabase
    .from("recipes")
    .select(RECIPE_CARD_FIELDS)
    .eq(OWNER_COLUMN, profileId) // 🎯 only this user's recipes
    .order("created_at", { ascending: false });

  if (!viewingOwnProfile) {
    // If I'm looking at someone ELSE, only show public recipes
    query = query.eq("is_private", false);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// 🔢 Keep counts consistent with what we display on screen
// - visibleCount: what the current viewer actually sees
// - totalCountForOwner: owner's own total (for "You have X recipes" on their page)
export async function getUserRecipeCounts(profileId: string, viewerId: string | null) {
  const viewingOwnProfile = viewerId && viewerId === profileId;

  // Count visible to viewer (public only if not owner)
  let visible = supabase
    .from("recipes")
    .select("id", { count: "exact", head: true })
    .eq(OWNER_COLUMN, profileId);

  if (!viewingOwnProfile) {
    visible = visible.eq("is_private", false);
  }

  const { count: visibleCount, error: visibleErr } = await visible;
  if (visibleErr) throw visibleErr;

  // Count everything for owner display (used only when it's their own page)
  const { count: totalCountForOwner, error: totalErr } = await supabase
    .from("recipes")
    .select("id", { count: "exact", head: true })
    .eq(OWNER_COLUMN, profileId);

  if (totalErr) throw totalErr;

  return {
    visibleCount: visibleCount ?? 0,
    totalCountForOwner: totalCountForOwner ?? 0,
  };
}
