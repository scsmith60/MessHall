// PURPOSE: one friendly place to read/write data, so screens don't care about SQL.
// NOTE: all functions assume you're signed in (we'll add auth UI later).

import { supabase } from './supabase';

export interface DataAPI {
  getFeedPage(page: number, size: number): Promise<Array<
    | { type: 'recipe'; id: string; title: string; image: string; creator: string; knives: number; cooks: number; createdAt: string }
    | { type: 'sponsored'; id: string; brand: string; title: string; image: string; cta: string }
  >>;

  getRecipeById(id: string): Promise<{
    id: string; title: string; image: string; creator: string; knives: number; cooks: number; createdAt: string;
    // expand later with ingredients/steps
  } | null>;

  toggleSave(recipeId: string): Promise<boolean>;
  toggleLike(recipeId: string): Promise<{ liked: boolean; likesCount: number }>;
}

export const dataAPI: DataAPI = {
  async getFeedPage(page, size) {
    // 1) get fresh recipes, newest first
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

    // 2) get active sponsored slots (simple)
    const { data: ads } = await supabase
      .from('sponsored_slots')
      .select('*')
      .gte('active_from', new Date('2000-01-01').toISOString())  // wide net
      .or('active_to.is.null,active_to.gte.' + new Date().toISOString());

    // 3) interleave ads gently every ~6 items
    const out: any[] = [];
    let adIdx = 0;
    recipes?.forEach((r, i) => {
      if (ads && i > 0 && i % 6 === 4 && adIdx < ads.length) {
        const a = ads[adIdx++];
        out.push({ type: 'sponsored', id: a.id, brand: a.brand, title: a.title, image: a.image_url, cta: a.cta_url });
      }
      out.push({
        type: 'recipe',
        id: r.id,
        title: r.title,
        image: r.image_url,
        creator: r.profiles?.username ?? 'someone',
        knives: r.profiles?.knives ?? 0,
        cooks: r.cooks_count ?? 0,
        createdAt: r.created_at
      });
    });

    return out;
  },

  async getRecipeById(id) {
  const { data: r, error } = await supabase
    .from('recipes')
    .select(`
      id, title, image_url, cooks_count, created_at,
      user_id, profiles!recipes_user_id_fkey ( username, knives ),
      recipe_ingredients ( pos, text ),
      recipe_steps ( pos, text, seconds )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!r) return null;

  // sort children by pos (just in case)
  const ings = (r.recipe_ingredients ?? []).sort((a: any, b: any) => a.pos - b.pos).map((x: any) => x.text);
  const steps = (r.recipe_steps ?? []).sort((a: any, b: any) => a.pos - b.pos).map((x: any) => ({ text: x.text, seconds: x.seconds ?? null }));

  return {
    id: r.id,
    title: r.title,
    image: r.image_url,
    creator: r.profiles?.username ?? 'someone',
    knives: r.profiles?.knives ?? 0,
    cooks: r.cooks_count ?? 0,
    createdAt: r.created_at,
    ingredients: ings,
    steps
  };
},

  async toggleSave(recipeId) {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) throw new Error('Not signed in');

    // try insert; if conflict, delete
    const { error: insErr } = await supabase.from('recipe_saves').insert({ recipe_id: recipeId, user_id: me.user.id });
    if (!insErr) return true;

    const { error: delErr } = await supabase.from('recipe_saves').delete().eq('recipe_id', recipeId).eq('user_id', me.user.id);
    if (delErr) throw delErr;
    return false;
  },

  async toggleLike(recipeId) {
    const { data: me } = await supabase.auth.getUser();
    if (!me?.user) throw new Error('Not signed in');

    const { error: insErr } = await supabase.from('recipe_likes').insert({ recipe_id: recipeId, user_id: me.user.id });
    if (!insErr) {
      // bump counter softly (optional: do this with a trigger/server function)
      await supabase.rpc('bump_likes', { p_recipe: recipeId, p_delta: 1 }).catch(() => {});
      // get fresh count
      const { data: rec } = await supabase.from('recipes').select('likes_count').eq('id', recipeId).maybeSingle();
      return { liked: true, likesCount: rec?.likes_count ?? 0 };
    }

    const { error: delErr } = await supabase.from('recipe_likes').delete().eq('recipe_id', recipeId).eq('user_id', me.user.id);
    if (delErr) throw delErr;
    await supabase.rpc('bump_likes', { p_recipe: recipeId, p_delta: -1 }).catch(() => {});
    const { data: rec } = await supabase.from('recipes').select('likes_count').eq('id', recipeId).maybeSingle();
    return { liked: false, likesCount: rec?.likes_count ?? 0 };
  }
};
