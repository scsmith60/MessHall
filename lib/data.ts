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

export interface DataAPI {
  // feed cards
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
          knives: number;
          cooks: number;
          createdAt: string;
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
    knives: number;
    cooks: number;
    createdAt: string;
    ingredients: string[];
    steps: StepRow[];
    sourceUrl: string | null; // 🆕 original page URL (if any)
  } | null>;

  // saves/likes/cooked
  toggleSave(recipeId: string): Promise<boolean>;
  toggleLike(recipeId: string): Promise<{ liked: boolean; likesCount: number }>;
  markCooked(recipeId: string): Promise<void>;

  // 👑 owner helpers
  getRecipeOwnerId(recipeId: string): Promise<string | null>;
  updateRecipe(
    recipeId: string,
    patch: { title?: string; image_url?: string | null }
  ): Promise<{ id: string; title: string; image_url: string | null; updated_at: string }>;

  // 🗑️ delete recipe (now also cleans storage folder)
  deleteRecipe(recipeId: string): Promise<void>;

  // ✏️ full edit (replace ingredients + steps rows)
  updateRecipeFull(args: {
    id: string;
    title?: string;
    image_url?: string | null;
    ingredients: string[]; // whole list in order
    steps: { text: string; seconds: number | null }[]; // whole list in order
  }): Promise<void>;

  // 🖼️ replace image & delete the old file automatically
  replaceRecipeImage(recipeId: string, sourceUri: string): Promise<string>;
}

export const dataAPI: DataAPI = {
  // ---------------- FEED ----------------
  async getFeedPage(page, size) {
    const from = page * size;
    const to = from + size - 1;

    const { data: recipes, error } = await supabase
      .from('recipes')
      .select(`
        id, title, image_url, cooks_count, created_at,
        user_id, profiles!recipes_user_id_fkey ( username, knives )
      `)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const nowIso = new Date().toISOString();
    const { data: ads } = await supabase
      .from('sponsored_slots')
      .select('*')
      .lte('active_from', nowIso)
      .or(`active_to.is.null,active_to.gte.${nowIso}`);

    const out: any[] = [];
    let adIdx = 0;
    recipes?.forEach((r, i) => {
      if (ads && i > 0 && i % 6 === 4 && adIdx < ads.length) {
        const a = ads[adIdx++];
        out.push({
          type: 'sponsored',
          id: a.id,
          brand: a.brand,
          title: a.title,
          image: a.image_url,
          cta: a.cta_url,
        });
      }
      out.push({
        type: 'recipe',
        id: r.id,
        title: r.title,
        image: r.image_url,
        creator: r.profiles?.username ?? 'someone',
        knives: r.profiles?.knives ?? 0,
        cooks: r.cooks_count ?? 0,
        createdAt: r.created_at,
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
        user_id, profiles!recipes_user_id_fkey ( username, knives ),
        recipe_ingredients ( pos, text ),
        recipe_steps ( pos, text, seconds )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!r) return null;

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
      knives: r.profiles?.knives ?? 0,
      cooks: r.cooks_count ?? 0,
      createdAt: r.created_at,
      ingredients: ings,
      steps,
      sourceUrl: r.source_url ?? null, // 🆕 hand it to screens
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

  // ---------------- LIKE ----------------
  async toggleLike(recipeId) {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) throw new Error('Not signed in');

    const { error: insErr } = await supabase
      .from('recipe_likes')
      .insert({ recipe_id: recipeId, user_id: me.user.id });

    if (!insErr) {
      await supabase.rpc('bump_likes', { p_recipe: recipeId, p_delta: 1 }).catch(() => {});
      const { data: rec } = await supabase
        .from('recipes')
        .select('likes_count')
        .eq('id', recipeId)
        .maybeSingle();
      return { liked: true, likesCount: rec?.likes_count ?? 0 };
    }

    const { error: delErr } = await supabase
      .from('recipe_likes')
      .delete()
      .eq('recipe_id', recipeId)
      .eq('user_id', me.user.id);
    if (delErr) throw delErr;

    await supabase.rpc('bump_likes', { p_recipe: recipeId, p_delta: -1 }).catch(() => {});
    const { data: rec } = await supabase
      .from('recipes')
      .select('likes_count')
      .eq('id', recipeId)
      .maybeSingle();
    return { liked: false, likesCount: rec?.likes_count ?? 0 };
  },

  // ---------------- COOKED ----------------
  async markCooked(recipeId) {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) throw new Error('Not signed in');

    await supabase
      .from('recipe_cooks')
      .insert({ recipe_id: recipeId, user_id: me.user.id })
      .catch(() => {}); // ok if unique constraint stops duplicates
  },

  // ---------------- OWNER HELPERS ----------------
  async getRecipeOwnerId(recipeId) {
    const { data, error } = await supabase
      .from('recipes')
      .select('user_id')
      .eq('id', recipeId)
      .maybeSingle();

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

  // 🗑️ delete recipe + clean storage folder userId/recipeId/**
  async deleteRecipe(recipeId) {
    // get owner to target the right folder
    const row = await supabase
      .from('recipes')
      .select('user_id')
      .eq('id', recipeId)
      .maybeSingle();
    if (row.error) throw row.error;
    const ownerId = row.data?.user_id as string | undefined;

    // best-effort storage cleanup (won't throw if folder missing)
    if (ownerId) {
      await deleteRecipeAssets(ownerId, recipeId).catch(() => {});
    }

    // delete the DB row (RLS enforces owner-only)
    const { error } = await supabase.from('recipes').delete().eq('id', recipeId);
    if (error) throw error;
  },

  // ---------------- FULL EDIT (replace rows) ----------------
  async updateRecipeFull({ id, title, image_url, ingredients, steps }) {
    // LIKE I'M 5: we erase the old crayons (rows) and draw the new ones in order.
    // RLS must allow only the owner to do these deletes/inserts.

    // 1) update the main recipe card fields first
    await this.updateRecipe(id, { title, image_url });

    // 2) ingredients — wipe & reinsert in order
    const { error: delIngErr } = await supabase
      .from('recipe_ingredients')
      .delete()
      .eq('recipe_id', id);
    if (delIngErr) throw delIngErr;

    if (ingredients.length) {
      const ingRows = ingredients.map((text, i) => ({
        recipe_id: id,
        pos: i + 1, // start at 1 so it’s human friendly
        text: text.trim(),
      }));
      const { error: insIngErr } = await supabase
        .from('recipe_ingredients')
        .insert(ingRows);
      if (insIngErr) throw insIngErr;
    }

    // 3) steps — wipe & reinsert in order
    const { error: delStepErr } = await supabase
      .from('recipe_steps')
      .delete()
      .eq('recipe_id', id);
    if (delStepErr) throw delStepErr;

    if (steps.length) {
      const stepRows = steps.map((s, i) => ({
        recipe_id: id,
        pos: i + 1,
        text: s.text.trim(),
        seconds: s.seconds ?? null,
      }));
      const { error: insStepErr } = await supabase
        .from('recipe_steps')
        .insert(stepRows);
      if (insStepErr) throw insStepErr;
    }
  },

  // ---------------- REPLACE IMAGE (upload + swap + delete old) ----------------
  async replaceRecipeImage(recipeId, sourceUri) {
    // LIKE I'M 5: we put the new picture on the fridge, then throw the old one away.
    // This calls the shared upload helper so Capture + Edit use the same rules.
    return await replaceRecipeImageUpload(recipeId, sourceUri);
  },
};
