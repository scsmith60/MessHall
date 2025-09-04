// lib/supabase.ts
// LIKE I'M 5: this is our door to Supabase.
// - We make the client (same as you had).
// - We add tiny helper functions so comments "just work".
// - No paid services. Just SQL + RLS + Realtime.
//
// ENV you must have in app config (.env):
//   EXPO_PUBLIC_SUPABASE_URL=https://YOURREF.supabase.co
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=ey...
//
// HOW TO USE (examples):
//   import { supabase, addComment, listCommentsPage, subscribeToRecipeComments, reportComment, blockUser } from '@/lib/supabase';
//   await addComment(recipeId, null, "Nice recipe!");
//   const { rows, hasMore, nextCursor } = await listCommentsPage(recipeId);
//   const channel = subscribeToRecipeComments(recipeId, (row) => console.log('new comment', row));
//   channel.unsubscribe(); // when done
//   await reportComment(commentId, 'harassment', 'rude words');
//   await blockUser(otherUserId);

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 1) Read env (like secret notes). The "!" means we expect them to exist.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// 2) Make the client = our door.
//    (Same config you had; we keep session in AsyncStorage; no URL hash parsing)
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// ===============================
// 🧰 COMMENT HELPERS (no AI)
// ===============================

// A tiny shape for one comment row (matches your table)
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
  // If you created the view recipe_comments_with_profiles, these may appear:
  username?: string | null;
  avatar_url?: string | null;
};

// 3) Add a comment using the secure RPC (server sets user_id from auth.uid())
//    - p_parent_id = null means top-level
//    - p_parent_id = some comment id means "reply"
export async function addComment(
  recipeId: string,
  parentId: string | null,
  body: string
): Promise<RecipeComment> {
  const { data, error } = await supabase.rpc('add_comment', {
    p_recipe_id: recipeId,
    p_parent_id: parentId,
    p_body: body,
  });

  if (error) throw error;
  return data as RecipeComment;
}

// 4) List comments by pages (newest first).
//    We use created_at as a cursor so "Load more" is easy.
export async function listCommentsPage(
  recipeId: string,
  opts?: { cursor?: string | null; limit?: number; withProfiles?: boolean }
): Promise<{ rows: RecipeComment[]; hasMore: boolean; nextCursor: string | null; }> {
  const limit = opts?.limit ?? 20;
  const cursor = opts?.cursor ?? null;
  const table = (opts?.withProfiles ?? true)
    ? 'recipe_comments_with_profiles' // view (if you created it)
    : 'recipe_comments';              // table (works even if no view)

  let q = supabase
    .from(table)
    .select('*')
    .eq('recipe_id', recipeId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as RecipeComment[];
  const nextCursor = rows.length ? rows[rows.length - 1].created_at : null;
  const hasMore = rows.length === limit;
  return { rows, hasMore, nextCursor };
}

// 5) Realtime subscribe to new comments for one recipe.
//    - call this when you open a recipe
//    - remember to unsubscribe when you close the screen
export function subscribeToRecipeComments(
  recipeId: string,
  onInsert: (row: RecipeComment) => void
) {
  // ⚠️ Make sure "Realtime" is enabled for public.recipe_comments in the dashboard.
  const channel = supabase
    .channel(`rc_${recipeId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'recipe_comments', filter: `recipe_id=eq.${recipeId}` },
      (payload) => onInsert(payload.new as RecipeComment)
    )
    .subscribe();

  // return the channel so caller can do channel.unsubscribe()
  return channel;
}

// 6) Report a bad comment (goes into moderation_reports). Mods can review later.
export async function reportComment(
  commentId: string,
  reason:
    | 'spam'
    | 'harassment'
    | 'hate'
    | 'sexual_content'
    | 'self_harm'
    | 'violence_or_threat'
    | 'illegal_activity'
    | 'other' = 'harassment',
  notes?: string | null
) {
  const { error } = await supabase.from('moderation_reports').insert({
    target_comment_id: commentId,
    reason,
    notes: notes ?? null,
  });
  if (error) throw error;
}

// 7) Block a user (you won’t see each other’s comments).
export async function blockUser(blockedUserId: string) {
  const { error } = await supabase.from('user_blocks').insert({ blocked_id: blockedUserId });
  if (error) throw error;
}

// 8) Optional: quick utilities for counts (if you keep recipes.comment_count updated by trigger).
export async function getRecipeCommentCount(recipeId: string): Promise<number> {
  // If you store counts on recipes
  const { data, error } = await supabase
    .from('recipes')
    .select('comment_count')
    .eq('id', recipeId)
    .maybeSingle();

  if (error) throw error;
  return data?.comment_count ?? 0;
}
