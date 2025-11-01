// lib/supabase.ts
// 🧸 like I'm 5: this file makes the Supabase "door" for our app.
// IMPORTANT:
// - We create ONE client for the whole app.
// - We DO NOT put a global onAuthStateChange here (the AuthProvider owns that).
// - We keep your comment helpers exactly as before.
//
// Extras:
// - Tiny startup peek (console + debug log) so we can see if a session exists on boot.
// - RN storage settings so auth works on mobile (AsyncStorage, no URL parsing).

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// (optional) our notebook logger; safe to keep
import { d, summarizeSession } from "./debug";

// 1) read secrets from env (Expo style)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// Validate that we have the required environment variables
if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error(
    "[supabase] Missing required environment variables. Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file"
  );
  // In development, provide a fallback client that will fail gracefully
  // This prevents the app from crashing during route discovery
}

// 2) make the client (this is "the door")
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON || "placeholder-key",
  {
  auth: {
    storage: AsyncStorage,     // ✅ use RN storage
    persistSession: true,      // ✅ remember session on device
    autoRefreshToken: true,    // ✅ refresh tokens automatically
    detectSessionInUrl: false, // ✅ no web URL parsing in RN
    // PKCE is the recommended OAuth flow for native apps (Expo/React Native)
    flowType: "pkce",
  },
});

// 3) (optional) little startup note so we can see current session on app boot
(async () => {
  try {
    const { data } = await supabase.auth.getSession();
    const snap = summarizeSession ? summarizeSession(data?.session) : data?.session;
    // write to our notebook + console (harmless)
    await d.log("[supabase]", "startup getSession()", snap);
  } catch (err) {
    // if debug module isn't available, at least console.log
    // (this should never throw)
    console.log("[supabase] startup getSession() failed", err);
  }
})();

// ❌ DO NOT: add supabase.auth.onAuthStateChange here.
// The ONE place that should subscribe is lib/auth.tsx (AuthProvider).
// This avoids duplicate listeners and timing races across hot reloads.

// (optional) expose on global for quick poking in dev
try {
  (globalThis as any).__supabase = supabase;
} catch {
  // ignore
}

/* =============================================================================
   🧰 COMMENT HELPERS (unchanged behaviour)
   Like I'm 5: these are tiny helpers for your recipe comment features.
   - addComment: call the DB function to insert a comment
   - listCommentsPage: fetch a page of comments (with/without profiles)
   - subscribeToRecipeComments: realtime insert subscription for one recipe
   - reportComment: create a moderation report row
   - blockUser: add a user block row
   - getRecipeCommentCount: read the cached count from recipes table
============================================================================= */

export type RecipeComment = {
  id: string;
  recipe_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  is_hidden: boolean;
  is_flagged: boolean;
  flagged_reason: string | null;
  // denormalized profile bits when you query the view
  username?: string | null;
  avatar_url?: string | null;
};

/**
 * Insert a comment via Postgres function `add_comment`.
 * It handles setting user_id server-side.
 */
export async function addComment(
  recipeId: string,
  parentId: string | null,
  body: string
): Promise<RecipeComment> {
  const { data, error } = await supabase.rpc("add_comment", {
    p_recipe_id: recipeId,
    p_parent_id: parentId,
    p_body: body,
  });

  if (error) throw error;
  return data as RecipeComment;
}

/**
 * Paginated comment list (newest first). Uses either the view with profiles
 * or the base table, based on opts.withProfiles (default true).
 */
export async function listCommentsPage(
  recipeId: string,
  opts?: { cursor?: string | null; limit?: number; withProfiles?: boolean }
): Promise<{ rows: RecipeComment[]; hasMore: boolean; nextCursor: string | null }> {
  const limit = opts?.limit ?? 20;
  const cursor = opts?.cursor ?? null;
  const useProfiles = opts?.withProfiles ?? true;

  const table = useProfiles ? "recipe_comments_with_profiles" : "recipe_comments";

  let q = supabase
    .from(table)
    .select("*")
    .eq("recipe_id", recipeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) {
    q = q.lt("created_at", cursor);
  }

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as RecipeComment[];
  const nextCursor = rows.length ? rows[rows.length - 1].created_at : null;
  const hasMore = rows.length === limit;

  return { rows, hasMore, nextCursor };
}

/**
 * Realtime subscription for new comments on a recipe.
 * Returns the channel so you can .unsubscribe() on unmount.
 */
export function subscribeToRecipeComments(
  recipeId: string,
  onInsert: (row: RecipeComment) => void
) {
  const channel = supabase
    .channel(`rc_${recipeId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "recipe_comments", filter: `recipe_id=eq.${recipeId}` },
      (payload) => onInsert(payload.new as RecipeComment)
    )
    .subscribe();

  return channel;
}

/**
 * Report a comment for moderation (simple row insert).
 */
export async function reportComment(
  commentId: string,
  reason:
    | "spam"
    | "harassment"
    | "hate"
    | "sexual_content"
    | "self_harm"
    | "violence_or_threat"
    | "illegal_activity"
    | "other" = "harassment",
  notes?: string | null
) {
  const { error } = await supabase.from("moderation_reports").insert({
    target_comment_id: commentId,
    reason,
    notes: notes ?? null,
  });
  if (error) throw error;
}

/**
 * Block another user (simple row insert).
 */
export async function blockUser(blockedUserId: string) {
  const { error } = await supabase.from("user_blocks").insert({ blocked_id: blockedUserId });
  if (error) throw error;
}

/**
 * Read the cached comment_count from recipes table.
 */
export async function getRecipeCommentCount(recipeId: string): Promise<number> {
  const { data, error } = await supabase
    .from("recipes")
    .select("comment_count")
    .eq("id", recipeId)
    .maybeSingle();

  if (error) throw error;
  return data?.comment_count ?? 0;
}
