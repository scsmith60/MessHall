// lib/data.ts
// PURPOSE: one friendly place to read/write data, so screens don't care about SQL.
// LIKE I'M 5: screens say "please get/change a recipe", and this file talks to the database nicely.

import { supabase } from './supabase';
// ⬇️ reuse the upload/cleanup helpers so storage stays tidy
import {
  replaceRecipeImage as replaceRecipeImageUpload,
  deleteRecipeAssets,
} from './uploads';

type StepRow = { text: string; seconds: number | null };

// 🔹 tiny shape for user_stats rows
type UserStats = { medals_total: number; cooks_total: number };

export interface DataAPI {
  // feed cards (recipes + sponsored)
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
          creator: string;
          knives: number;   // = creator’s medals (user_stats.medals_total)
          cooks: number;    // recipe_cooks count
          likes: number;    // ❤️ likes_count
          createdAt: string;
          ownerId: string;  // who owns this recipe (so cards can hide buttons)
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

  // one recipe (with ingredients + steps)
  getRecipeById(id: string): Promise<{
    id: string;
    title: string;
    image: string;
    creator: string;
    knives: number;     // = creator’s medals (user_stats.medals_total)
    cooks: number;      // recipe_cooks count
    createdAt: string;
    ingredients: string[];
    steps: StepRow[];
    sourceUrl: string | null; // original page URL (if any)
  } | null>;

  // saves/likes/cooked
  toggleSave(recipeId: string): Promise<boolean>;
  toggleLike(recipeId: string): Promise<{ liked: boolean; likesCount: number }>;
  markCooked(recipeId: string): Promise<void>;

  // lifetime stats (for medal pill)
  getUserStats(userId: string): Promise<UserStats | null>;

  // owner helpers
  getRecipeOwnerId(recipeId: string): Promise<string | null>;
  updateRecipe(
    recipeId: string,
    patch: { title?: string; image_url?: string | null }
  ): Promise<{ id: string; title: string; image_url: string | null; updated_at: string }>;

  // delete recipe (also cleans storage folder)
  deleteRecipe(recipeId: string): Promise<void>;

  // full edit (replace ingredients + steps rows)
  updateRecipeFull(args: {
    id: string;
    title?: string;
    image_url?: string | null;
    ingredients: string[]; // whole list in order
    steps: { text: string; seconds: number | null }[]; // whole list in order
  }): Promise<void>;

  // replace image & delete the old file automatically
  replaceRecipeImage(recipeId: string, sourceUri: string): Promise<string>;
}

/* ---------------------------------------------------------
   LITTLE HELPERS (like tiny kitchen tools)
   ---------------------------------------------------------
   - getViewerIdStrict(): "who am I" (throws if not signed in)
   - getOwnerId(): "who owns that recipe?"
   - assertNotOwnerForLike/Cook(): block self-like/cooked with clear errors
--------------------------------------------------------- */

async function getViewerIdStrict(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error('Not signed in');
  return data.user.id;
}

async function getOwnerId(recipeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('recipes')
    .select('user_id')
    .eq('id', recipeId)
    .maybeSingle();

  if (error) return null;
  return data?.user_id ?? null;
}

async function assertNotOwnerForLike(recipeId: string, viewerId: string): Promise<void> {
  const ownerId = await getOwnerId(recipeId);
  if (ownerId && ownerId === viewerId) {
    // LIKE I'M 5: you can't give yourself a heart. That's not fair.
    throw new Error('You cannot like your own recipe');
  }
}

async function assertNotOwnerForCook(recipeId: string, viewerId: string): Promise<void> {
  const ownerId = await getOwnerId(recipeId);
  if (ownerId && ownerId === viewerId) {
    // LIKE I'M 5: you can't mark your own recipe as cooked to earn medals.
    throw new Error('You cannot mark your own recipe as cooked');
  }
}

export const dataAPI: DataAPI = {
  // ---------------- FEED ----------------
  async getFeedPage(page, size) {
    const from = page * size;
    const to = from + size - 1;

    // 1) get recipes with counts + owner + username
    const { data: recipes, error } = await supabase
      .from('recipes')
      .select(`
        id, title, image_url, cooks_count, likes_count, created_at,
        user_id, profiles!recipes_user_id_fkey ( username )
      `)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    // 2) sponsored slots (unchanged)
    const nowIso = new Date().toISOString();
    const { data: ads } = await supabase
      .from('sponsored_slots')
      .select('*')
      .lte('active_from', nowIso)
      .or(`active_to.is.null,active_to.gte.${nowIso}`);

    // 3) batch-fetch creator stats for medal pill
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

    // 4) compose feed
    const out: any[] = [];
    let adIdx = 0;
    recipes?.forEach((r: any, i: number) => {
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
        knives: userStats.medals_total,
        cooks: r.cooks_count ?? 0,
        likes: r.likes_count ?? 0,      // ❤️ hand likes to the card
        createdAt: r.created_at,
        ownerId: r.user_id,             // who owns it (for hide/show on card)
      });
    });

    return out;
  },

  // ---------------- READ ONE ----------------
  async getRecipeById(id) {
    const { data: r, error } = await supabase
      .from('recipes')
      .select(`
        id, title, image_url, cooks_count, created_at, source_url,
        user_id, profiles!recipes_user_id_fkey ( username ),
        recipe_ingredients ( pos, text ),
        recipe_steps ( pos, text, seconds )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!r) return null;

    // creator’s lifetime medals
    let creatorMedals = 0;
    if (r.user_id) {
      const { data: s } = await supabase
        .from('user_stats')
        .select('medals_total')
        .eq('user_id', r.user_id)
        .maybeSingle();
      creatorMedals = s?.medals_total ?? 0;
    }

    const ings = (r.recipe_ingredients ?? [])
      .sort((a: any, b: any) => a.pos - b.pos)
      .map((x: any) => x.text);

    const steps = (r.recipe_steps ?? [])
      .sort((a: any, b: any) => a.pos - b.pos)
      .map((x: any) => ({ text: x.text, seconds: x.seconds ?? null }));

    return {
      id: r.id,
      title: r.title,
      image: r.image_url,
      creator: r.profiles?.username ?? 'someone',
      knives: creatorMedals,
      cooks: r.cooks_count ?? 0,
      createdAt: r.created_at,
      ingredients: ings,
      steps,
      sourceUrl: r.source_url ?? null,
    };
  },

  // ---------------- SAVE ----------------
  async toggleSave(recipeId) {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) throw new Error('Not signed in');

    const { error: insErr } = await supabase
      .from('recipe_saves')
      .insert({ recipe_id: recipeId, user_id: me.user.id });

    if (!insErr) return true;

    const { error: delErr } = await supabase
      .from('recipe_saves')
      .delete()
      .eq('recipe_id', recipeId)
      .eq('user_id', me.user.id);

    if (delErr) throw delErr;
    return false;
  },

  // ---------------- LIKE (with self-like guard) ----------------
  async toggleLike(recipeId) {
    const viewerId = await getViewerIdStrict();

    // 🚫 block liking your own recipe (belt + suspenders)
    await assertNotOwnerForLike(recipeId, viewerId);

    // try insert (like); if constraint hits, do delete (unlike)
    const { error: insErr } = await supabase
      .from('recipe_likes')
      .insert({ recipe_id: recipeId, user_id: viewerId });

    if (!insErr) {
      await supabase.rpc('bump_likes', { p_recipe: recipeId, p_delta: 1 }).catch(() => {});
      const { data: rec } = await supabase.from('recipes').select('likes_count').eq('id', recipeId).maybeSingle();
      return { liked: true, likesCount: rec?.likes_count ?? 0 };
    }

    const { error: delErr } = await supabase
      .from('recipe_likes')
      .delete()
      .eq('recipe_id', recipeId)
      .eq('user_id', viewerId);
    if (delErr) throw delErr;

    await supabase.rpc('bump_likes', { p_recipe: recipeId, p_delta: -1 }).catch(() => {});
    const { data: rec } = await supabase.from('recipes').select('likes_count').eq('id', recipeId).maybeSingle();
    return { liked: false, likesCount: rec?.likes_count ?? 0 };
  },

  // ---------------- COOKED (with self-cooked guard) ----------------
  async markCooked(recipeId) {
    const viewerId = await getViewerIdStrict();

    // 🚫 no self-cooked allowed
    await assertNotOwnerForCook(recipeId, viewerId);

    await supabase
      .from('recipe_cooks')
      .insert({ recipe_id: recipeId, user_id: viewerId })
      .catch(() => {}); // fine if unique constraint blocks duplicates
  },

  // ---------------- USER STATS ----------------
  async getUserStats(userId) {
    const { data, error } = await supabase
      .from('user_stats')
      .select('medals_total, cooks_total')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { medals_total: data.medals_total ?? 0, cooks_total: data.cooks_total ?? 0 };
  },

  // ---------------- OWNER HELPERS ----------------
  async getRecipeOwnerId(recipeId) {
    const { data, error } = await supabase.from('recipes').select('user_id').eq('id', recipeId).maybeSingle();
    if (error) return null;
    return data?.user_id ?? null;
  },

  async updateRecipe(recipeId, patch) {
    const cleaned: { title?: string; image_url?: string | null } = {};
    if (typeof patch.title === 'string') cleaned.title = patch.title.trim();
    if (patch.image_url !== undefined) {
      const v = (patch.image_url ?? '').toString().trim();
      cleaned.image_url = v.length ? v : null;
    }

    const { data, error } = await supabase
      .from('recipes')
      .update(cleaned)
      .eq('id', recipeId)
      .select('id, title, image_url, updated_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Recipe not found');
    return data as { id: string; title: string; image_url: string | null; updated_at: string };
  },

  // ---------------- DELETE ----------------
  async deleteRecipe(recipeId) {
    // clean storage for owner folder userId/recipeId/**
    const row = await supabase.from('recipes').select('user_id').eq('id', recipeId).maybeSingle();
    if (row.error) throw row.error;
    const ownerId = row.data?.user_id as string | undefined;
    if (ownerId) await deleteRecipeAssets(ownerId, recipeId).catch(() => {});

    const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
    if (error) throw error;
  },

  // ---------------- FULL EDIT ----------------
  async updateRecipeFull({ id, title, image_url, ingredients, steps }) {
    // LIKE I'M 5: we erase old rows, then write new rows in the right order.

    // 1) update main record
    await this.updateRecipe(id, { title, image_url });

    // 2) ingredients — wipe & insert
    const { error: delIngErr } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', id);
    if (delIngErr) throw delIngErr;

    if (ingredients.length) {
      const ingRows = ingredients.map((text, i) => ({ recipe_id: id, pos: i + 1, text: text.trim() }));
      const { error: insIngErr } = await supabase.from('recipe_ingredients').insert(ingRows);
      if (insIngErr) throw insIngErr;
    }

    // 3) steps — wipe & insert
    const { error: delStepErr } = await supabase.from('recipe_steps').delete().eq('recipe_id', id);
    if (delStepErr) throw delStepErr;

    if (steps.length) {
      const stepRows = steps.map((s, i) => ({ recipe_id: id, pos: i + 1, text: s.text.trim(), seconds: s.seconds ?? null }));
      const { error: insStepErr } = await supabase.from('recipe_steps').insert(stepRows);
      if (insStepErr) throw insStepErr;
    }
  },

  // ---------------- REPLACE IMAGE ----------------
  async replaceRecipeImage(recipeId, sourceUri) {
    return await replaceRecipeImageUpload(recipeId, sourceUri);
  },
};
