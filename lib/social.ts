// /lib/social.ts
// 🧸 ELI5: Tiny helpers for knives (likes) and comments.
// We talk to Supabase and keep screens tidy.

import { supabase } from './supabase';

// --- KNIVES (likes) ---------------------------------------------------------

export async function getKnifeStatus(recipeId: string) {
  // who am I?
  const { data: au } = await supabase.auth.getUser();
  const uid = au?.user?.id ?? null;

  // count knives
  const { count } = await supabase
    .from('recipe_knives')
    .select('*', { count: 'exact', head: true })
    .eq('recipe_id', recipeId);

  // if signed in, do I like it?
  let iLike = false;
  if (uid) {
    const { data } = await supabase
      .from('recipe_knives')
      .select('recipe_id')
      .eq('recipe_id', recipeId)
      .eq('user_id', uid)
      .limit(1);
    iLike = !!(data && data.length);
  }

  return { count: count ?? 0, iLike, uid };
}

export async function toggleKnife(recipeId: string) {
  const { data: au } = await supabase.auth.getUser();
  const uid = au?.user?.id;
  if (!uid) throw new Error('Please sign in');

  // check if exists
  const { data: existing } = await supabase
    .from('recipe_knives')
    .select('recipe_id')
    .eq('recipe_id', recipeId)
    .eq('user_id', uid)
    .limit(1);

  if (existing && existing.length) {
    // remove
    const { error } = await supabase
      .from('recipe_knives')
      .delete()
      .eq('recipe_id', recipeId)
      .eq('user_id', uid);
    if (error) throw error;
    return { iLike: false };
  } else {
    // add
    const { error } = await supabase
      .from('recipe_knives')
      .insert({ recipe_id: recipeId, user_id: uid });
    if (error) throw error;
    return { iLike: true };
  }
}

// --- COMMENTS ---------------------------------------------------------------

export type Comment = {
  id: string;
  body: string;
  created_at: string;
  user_id: string;
  // you can expand with username/avatar later via a view or second fetch
};

export async function fetchComments(recipeId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('recipe_comments')
    .select('id, body, created_at, user_id')
    .eq('recipe_id', recipeId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addComment(recipeId: string, body: string) {
  const { data: au } = await supabase.auth.getUser();
  const uid = au?.user?.id;
  if (!uid) throw new Error('Please sign in');
  const clean = (body ?? '').trim();
  if (!clean) throw new Error('Please type a comment');
  const { error } = await supabase
    .from('recipe_comments')
    .insert({ recipe_id: recipeId, user_id: uid, body: clean });
  if (error) throw error;
}

export async function deleteComment(id: string) {
  const { error } = await supabase
    .from('recipe_comments')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
