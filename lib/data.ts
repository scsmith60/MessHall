// lib/data.ts
// PURPOSE: one friendly place to read/write data, so screens don't care about SQL.
// LIKE I'M 5: screens ask for stuff (like "give me recipes"), and this file talks to the database nicely.

import { supabase } from './supabase';
// storage helpers for recipe images
import {
  replaceRecipeImage as replaceRecipeImageUpload,
  deleteRecipeAssets,
} from './uploads';

/* -----------------------------
   Tiny helper types
------------------------------*/
type StepRow = { text: string; seconds: number | null };
type UserStats = { medals_total: number; cooks_total: number };

/* -----------------------------
   Public API (used by screens)
------------------------------*/
export interface DataAPI {
  getFeedPage(
    page: number,
    size: number
  ): Promise<
    Array<
      | {
          type: 'recipe';
          id: string;
          title: string;
          image: string;
          creator: string;              // callsign
          creatorAvatar?: string | null;// 👶 face picture
          knives: number;               // creator lifetime medals
          cooks: number;                // this recipe’s medals (cooks_count)
          likes: number;                // ❤️ likes_count
          createdAt: string;
          ownerId: string;              // owner id (uuid)
        }
      | {
          type: 'sponsored';
          id: string;
          brand: string;
          title: string;
          image: string;
          cta: string;
        }
    >
  >;

  getRecipeById(id: string): Promise<{
    id: string;
    title: string;
    image: string;
    creator: string;
    creatorAvatar?: string | null;
    knives: number;
    cooks: number;
    createdAt: string;
    ingredients: string[];
    steps: StepRow[];
    // extra flags for pills / edit
    is_private: boolean;
    monetization_eligible: boolean;
    sourceUrl: string | null;
    image_url?: string | null;
  } | null>;

  // saves / likes / cooked
  toggleSave(recipeId: string): Promise<boolean>;
  toggleLike(recipeId: string): Promise<{ liked: boolean; likesCount: number }>;
  markCooked(recipeId: string): Promise<void>; // legacy helper

  // user stats (for medal pill on creator)
  getUserStats(userId: string): Promise<UserStats | null>;

  // owner helpers
  getRecipeOwnerId(recipeId: string): Promise<string | null>;
  updateRecipe(
    recipeId: string,
    patch: { title?: string; image_url?: string | null; minutes?: number | null }
  ): Promise<{ id: string; title: string; image_url: string | null; updated_at: string }>;
  deleteRecipe(recipeId: string): Promise<void>;

  // full edit flow (base fields + ingredients + steps)
  updateRecipeFull(args: {
    id: string;
    title?: string;
    image_url?: string | null;
    ingredients: string[];
    steps: { text: string; seconds: number | null }[];
    is_private?: boolean;
    monetization_eligible?: boolean;
    source_url?: string | null;
    minutes?: number | null; // 👶 uses your existing column
  }): Promise<void>;

  // upload new image & persist url (also cleans old)
  replaceRecipeImage(recipeId: string, sourceUri: string): Promise<string>;

  // 👶 ADVANCED: minutes + diet + ingredient filters (server-side)
  searchRecipesAdvanced(args: {
    text?: string;                      // title contains (case-insensitive)
    maxMinutes?: number;                // recipes.minutes <= this
    diet?: Array<'vegan' | 'gluten_free' | 'dairy_free'>; // overlaps diet_tags
    includeIngredients?: string[];      // overlaps main_ingredients
    excludeIngredients?: string[];      // NOT overlaps
    limit?: number;                     // default 50
  }): Promise<Array<{ id: string; title: string; image: string | null; creator: string }>>;

  // 👶 SIMPLE: free-text fallback (kept for backward compatibility)
  searchRecipes(query: string): Promise<
    Array<{ id: string; title: string; image: string | null; creator: string }>
  >;
}

/* ---------------------------------------------------------
   LITTLE HELPERS
--------------------------------------------------------- */

// who am I (throws if not signed in)
async function getViewerIdStrict(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

// who owns a recipe
async function getOwnerId(recipeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('recipes')
    .select('user_id')
    .eq('id', recipeId)
    .maybeSingle();
  if (error) return null;
  return data?.user_id ?? null;
}

// no liking your own recipe
async function assertNotOwnerForLike(recipeId: string, viewerId: string): Promise<void> {
  const ownerId = await getOwnerId(recipeId);
  if (ownerId && ownerId === viewerId) {
    throw new Error('You cannot like your own recipe');
  }
}

// no cooking your own recipe
async function assertNotOwnerForCook(recipeId: string, viewerId: string): Promise<void> {
  const ownerId = await getOwnerId(recipeId);
  if (ownerId && ownerId === viewerId) {
    throw new Error('You cannot mark your own recipe as cooked');
  }
}

/* ---------------------------------------------------------
   MAIN DATA API
--------------------------------------------------------- */
export const dataAPI: DataAPI = {
  // 1) FEED LIST
  async getFeedPage(page, size) {
    const from = page * size;
    const to = from + size - 1;

    // grab recipes with creator's username + avatar
    const { data: recipes, error } = await supabase
      .from('recipes')
      .select(`
        id, title, image_url, cooks_count, likes_count, created_at, minutes,
        diet_tags, main_ingredients,
        user_id,
        profiles!recipes_user_id_fkey ( username, avatar_url )
      `)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    // sponsored slots (optional sprinkle)
    const nowIso = new Date().toISOString();
    const { data: ads } = await supabase
      .from('sponsored_slots')
      .select('*')
      .lte('active_from', nowIso)
      .or(`active_to.is.null,active_to.gte.${nowIso}`);

    // batch stats for medal pill
    const creatorIds = Array.from(new Set((recipes ?? []).map((r: any) => r.user_id).filter(Boolean)));
    let statsMap: Record<string, UserStats> = {};
    if (creatorIds.length) {
      const { data: statsRows, error: statsErr } = await supabase
        .from('user_stats')
        .select('user_id, medals_total, cooks_total')
        .in('user_id', creatorIds);
      if (statsErr) throw statsErr;
      statsMap = Object.fromEntries(
        (statsRows ?? []).map((s: any) => [s.user_id, { medals_total: s.medals_total ?? 0, cooks_total: s.cooks_total ?? 0 }])
      );
    }

    // compose
    const out: any[] = [];
    let adIdx = 0;
    recipes?.forEach((r: any, i: number) => {
      // sprinkle an ad sometimes (example: after every ~6)
      if (ads && i > 0 && i % 6 === 4 && adIdx < ads.length) {
        const a = ads[adIdx++];
        out.push({ type: 'sponsored', id: a.id, brand: a.brand, title: a.title, image: a.image_url, cta: a.cta_url });
      }
      const userStats = statsMap[r.user_id] ?? { medals_total: 0, cooks_total: 0 };
      out.push({
        type: 'recipe',
        id: r.id,
        title: r.title,
        image: r.image_url,
        creator: r.profiles?.username ?? 'someone',
        creatorAvatar: r.profiles?.avatar_url ?? null, // 👶 tiny face
        knives: userStats.medals_total,
        cooks: r.cooks_count ?? 0,
        likes: r.likes_count ?? 0,
        createdAt: r.created_at,
        ownerId: r.user_id,
      });
    });

    return out;
  },

  // 2) READ ONE RECIPE
  async getRecipeById(id) {
    const { data: r, error } = await supabase
      .from('recipes')
      .select(`
        id, title, image_url, cooks_count, created_at, source_url, minutes,
        is_private, monetization_eligible,
        user_id,
        profiles!recipes_user_id_fkey ( username, avatar_url ),
        recipe_ingredients ( pos, text ),
        recipe_steps ( pos, text, seconds )
      `)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!r) return null;

    // creator lifetime medals (for the medal pill)
    let creatorMedals = 0;
    if (r.user_id) {
      const { data: s } = await supabase
        .from('user_stats')
        .select('medals_total')
        .eq('user_id', r.user_id)
        .maybeSingle();
      creatorMedals = s?.medals_total ?? 0;
    }

    const ings = (r.recipe_ingredients || [])
      .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((x: any) => x.text ?? '')
      .filter(Boolean);

    const steps = (r.recipe_steps || [])
      .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((x: any) => ({ text: x.text ?? '', seconds: x.seconds ?? null }));

    return {
      id: String(r.id),
      title: r.title ?? '',
      image: r.image_url ?? '',
      creator: r.profiles?.username ?? 'someone',
      creatorAvatar: r.profiles?.avatar_url ?? null,
      knives: Number(creatorMedals ?? 0),
      cooks: Number(r.cooks_count ?? 0),
      createdAt: r.created_at,
      ingredients: ings,
      steps,
      is_private: !!r.is_private,
      monetization_eligible: !!r.monetization_eligible,
      sourceUrl: r.source_url ?? null,
      image_url: r.image_url ?? null,
    };
  },

  // 3) SAVE / LIKE / COOKED
  async toggleSave(recipeId: string) {
    const userId = await getViewerIdStrict();
    // do I already have it saved?
    const { data: existing } = await supabase
      .from('recipe_saves')
      .select('user_id')
      .eq('user_id', userId)
      .eq('recipe_id', recipeId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('recipe_saves')
        .delete()
        .eq('user_id', userId)
        .eq('recipe_id', recipeId);
      if (error) throw error;
      return false;
    } else {
      const { error } = await supabase
        .from('recipe_saves')
        .insert({ user_id: userId, recipe_id: recipeId });
      if (error) throw error;
      return true;
    }
  },

  async toggleLike(recipeId: string) {
    const userId = await getViewerIdStrict();
    await assertNotOwnerForLike(recipeId, userId);

    const { data: existing } = await supabase
      .from('recipe_likes')
      .select('user_id')
      .eq('user_id', userId)
      .eq('recipe_id', recipeId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('recipe_likes')
        .delete()
        .eq('user_id', userId)
        .eq('recipe_id', recipeId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('recipe_likes')
        .insert({ user_id: userId, recipe_id: recipeId });
      // ignore duplicate (race conditions)
      // @ts-ignore
      if (error && error.code !== '23505') throw error;
    }

    // return fresh count + state
    const [{ count }, { data: mine }] = await Promise.all([
      supabase.from('recipe_likes').select('user_id', { count: 'exact', head: true }).eq('recipe_id', recipeId),
      supabase.from('recipe_likes').select('user_id').eq('recipe_id', recipeId).eq('user_id', userId).maybeSingle(),
    ]);

    return { liked: !!mine, likesCount: count ?? 0 };
  },

  async markCooked(recipeId: string) {
    const userId = await getViewerIdStrict();
    await assertNotOwnerForCook(recipeId, userId);
    const { error } = await supabase
      .from('recipe_cooks')
      .insert({ user_id: userId, recipe_id: recipeId });
    // ignore duplicate unique error
    // @ts-ignore
    if (error && error.code !== '23505') throw error;
  },

  // 4) USER STATS
  async getUserStats(userId: string) {
    const { data, error } = await supabase
      .from('user_stats')
      .select('medals_total, cooks_total')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return data ?? null;
  },

  // 5) OWNER HELPERS
  async getRecipeOwnerId(recipeId: string) {
    return await getOwnerId(recipeId);
  },

  async updateRecipe(recipeId, patch) {
    const { data, error } = await supabase
      .from('recipes')
      .update({ ...patch })
      .eq('id', recipeId)
      .select('id, title, image_url, updated_at')
      .maybeSingle();
    if (error) throw error;
    return data!;
  },

  async deleteRecipe(recipeId: string) {
    const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
    if (error) throw error;
    // best-effort storage cleanup
    try { await deleteRecipeAssets(recipeId); } catch {}
  },

  // 6) FULL EDIT (replace base + ingredients + steps)
  async updateRecipeFull(args) {
    const {
      id, title, image_url, ingredients, steps,
      is_private, monetization_eligible, source_url, minutes
    } = args;

    // base fields
    const { error: baseErr } = await supabase
      .from('recipes')
      .update({
        ...(title !== undefined ? { title } : {}),
        ...(image_url !== undefined ? { image_url } : {}),
        ...(is_private !== undefined ? { is_private } : {}),
        ...(monetization_eligible !== undefined ? { monetization_eligible } : {}),
        ...(source_url !== undefined ? { source_url } : {}),
        ...(minutes !== undefined ? { minutes } : {}), // 👶 use your existing minutes column
      })
      .eq('id', id);
    if (baseErr) throw baseErr;

    // ingredients
    const { error: delIngErr } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', id);
    if (delIngErr) throw delIngErr;
    if (ingredients?.length) {
      const rows = ingredients.map((text, i) => ({ recipe_id: id, pos: i, text }));
      const { error: insIngErr } = await supabase.from('recipe_ingredients').insert(rows);
      if (insIngErr) throw insIngErr;
    }

    // steps
    const { error: delStepErr } = await supabase.from('recipe_steps').delete().eq('recipe_id', id);
    if (delStepErr) throw delStepErr;
    if (steps?.length) {
      const rows = steps.map((s, i) => ({ recipe_id: id, pos: i, text: s.text, seconds: s.seconds }));
      const { error: insStepErr } = await supabase.from('recipe_steps').insert(rows);
      if (insStepErr) throw insStepErr;
    }
  },

  // 7) IMAGE REPLACER (upload + persist)
  async replaceRecipeImage(recipeId: string, sourceUri: string) {
    const url = await replaceRecipeImageUpload(recipeId, sourceUri);
    const { error } = await supabase.from('recipes').update({ image_url: url }).eq('id', recipeId);
    if (error) throw error;
    return url;
  },

  // 8A) 👶 NEW: ADVANCED server-side search (fast + precise)
  // LIKE I'M 5:
  // - We search title text,
  // - AND/OR keep only recipes with minutes <= number,
  // - AND/OR match diet tags (vegan/gluten_free/dairy_free),
  // - AND/OR match key ingredients (chicken/pasta/etc.)
  async searchRecipesAdvanced({
    text, maxMinutes, diet = [], includeIngredients = [], excludeIngredients = [], limit = 50,
  }) {
    let q = supabase
      .from('recipes')
      .select(`
        id, title, image_url, minutes, diet_tags, main_ingredients,
        profiles!recipes_user_id_fkey ( username )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (text && text.trim()) q = q.ilike('title', `%${text.trim()}%`);
    if (typeof maxMinutes === 'number') q = q.lte('minutes', maxMinutes);
    if (diet.length) q = q.overlaps('diet_tags', diet);
    if (includeIngredients.length) q = q.overlaps('main_ingredients', includeIngredients.map((x) => x.toLowerCase()));
    if (excludeIngredients.length) q = q.not('main_ingredients', 'overlaps', excludeIngredients.map((x) => x.toLowerCase()));

    const { data, error } = await q;
    if (error) throw error;

    return (data ?? []).map((r: any) => ({
      id: String(r.id),
      title: r.title ?? '',
      image: r.image_url ?? null,
      creator: r.profiles?.username ?? 'someone',
    }));
  },

  // 8B) 👶 SIMPLE: free-text search (title → ingredient fallback)
  async searchRecipes(query: string) {
    const q = (query || '').trim();
    if (!q) return [];

    // (A) title match
    const { data: titleRows, error: titleErr } = await supabase
      .from('recipes')
      .select(`
        id, title, image_url,
        user_id,
        profiles!recipes_user_id_fkey ( username )
      `)
      .ilike('title', `%${q}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (titleErr) throw titleErr;

    let rows = titleRows ?? [];

    // (B) if no title hits, try ingredient text
    if (!rows.length) {
      const { data: ingMatches } = await supabase
        .from('recipe_ingredients')
        .select('recipe_id')
        .ilike('text', `%${q}%`)
        .limit(50);

      const ids = Array.from(new Set((ingMatches ?? []).map((r: any) => r.recipe_id))).filter(Boolean);
      if (ids.length) {
        const { data: byIng } = await supabase
          .from('recipes')
          .select(`
            id, title, image_url,
            user_id,
            profiles!recipes_user_id_fkey ( username )
          `)
          .in('id', ids)
          .order('created_at', { ascending: false })
          .limit(50);
        rows = byIng ?? [];
      }
    }

    return (rows ?? []).map((r: any) => ({
      id: String(r.id),
      title: r.title ?? '',
      image: r.image_url ?? null,
      creator: r.profiles?.username ?? 'someone',
    }));
  },
};

/* ---------------------------------------------------------
   SOCIAL / FOLLOW HELPERS (named exports used by followers.tsx/following.tsx)
--------------------------------------------------------- */

// Who am I? Throws if not signed in.
async function viewerIdStrict(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

// Find a user's id from their callsign (username). Returns null if not found.
export async function getUserIdByUsername(username: string): Promise<string | null> {
  const clean = (username || '').trim();
  if (!clean) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', clean) // case-insensitive match
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

// People who follow TARGET (→ rows about the FOLLOWERS).
export async function listFollowers(targetUserId: string): Promise<
  Array<{ id: string; username: string | null; avatar_url: string | null; bio: string | null }>
> {
  if (!targetUserId) return [];
  const { data, error } = await supabase
    .from('follows')
    .select(`
      follower_id,
      profiles:follower_id ( id, username, avatar_url, bio )
    `)
    .eq('following_id', targetUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? [])
    .map((r: any) => r.profiles)
    .filter(Boolean)
    .map((p: any) => ({
      id: p.id,
      username: p.username ?? null,
      avatar_url: p.avatar_url ?? null,
      bio: p.bio ?? null,
    }));
}

// People TARGET is following (→ rows about the FOLLOWING).
export async function listFollowing(targetUserId: string): Promise<
  Array<{ id: string; username: string | null; avatar_url: string | null; bio: string | null }>
> {
  if (!targetUserId) return [];
  const { data, error } = await supabase
    .from('follows')
    .select(`
      following_id,
      profiles:following_id ( id, username, avatar_url, bio )
    `)
    .eq('follower_id', targetUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return (data ?? [])
    .map((r: any) => r.profiles)
    .filter(Boolean)
    .map((p: any) => ({
      id: p.id,
      username: p.username ?? null,
      avatar_url: p.avatar_url ?? null,
      bio: p.bio ?? null,
    }));
}

// Do *I* (viewer) follow `otherUserId`? Returns true/false.
export async function getFollowState(otherUserId: string): Promise<boolean> {
  const me = await viewerIdStrict();
  if (!otherUserId || otherUserId === me) return false;

  const { data, error } = await supabase
    .from('follows')
    // NOTE: your table has no "id", so select a key column
    .select('follower_id')
    .eq('follower_id', me)
    .eq('following_id', otherUserId)
    .maybeSingle();

  // ignore PostgREST "no rows" code; treat as false
  // @ts-ignore
  if (error && error.code !== 'PGRST116') throw error;
  return !!data;
}

// Follow/unfollow `otherUserId`. Returns the NEW state (true = following).
export async function toggleFollow(otherUserId: string): Promise<boolean> {
  const me = await viewerIdStrict();
  if (!otherUserId || otherUserId === me) throw new Error('Cannot follow yourself');

  // check current state
  const { data: existing, error: chkErr } = await supabase
    .from('follows')
    .select('follower_id') // composite key; no "id" column
    .eq('follower_id', me)
    .eq('following_id', otherUserId)
    .maybeSingle();
  // @ts-ignore
  if (chkErr && chkErr.code !== 'PGRST116') throw chkErr;

  if (existing) {
    // UNFOLLOW: delete by keys
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', me)
      .eq('following_id', otherUserId);
    if (error) throw error;
    return false;
  }

  // FOLLOW: insert (ignore duplicate on race)
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: me, following_id: otherUserId });
  // @ts-ignore
  if (error && error.code !== '23505') throw error;

  return true;
}
