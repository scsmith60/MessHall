// lib/data.ts
// LIKE YOU'RE 5 🧸
// - This file talks to the database (Supabase) and gives screens clean data.
// - It hides other people’s private recipes.
// - It still shows *your* private recipes to *you* (so your feed & profile look right).

import { supabase } from "./supabase";
import {
  replaceRecipeImage as replaceRecipeImageUpload,
  deleteRecipeAssets,
} from "./uploads";

/* -----------------------------------------------------------
   Tiny types to make TypeScript happy
----------------------------------------------------------- */
type StepRow = { text: string; seconds: number | null };
type UserStats = { medals_total: number; cooks_total: number };

/* -----------------------------------------------------------
   Public API (what screens import)
----------------------------------------------------------- */
export interface DataAPI {
  // FEED LIST (home)
  getFeedPage(
    page: number,
    size: number
  ): Promise<
    Array<
      | {
          type: "recipe";
          id: string;
          title: string;
          image: string | null;
          creator: string;
          creatorAvatar?: string | null;
          knives: number;        // creator lifetime medals (profiles.knives)
          cooks: number;         // this recipe’s cooks_count
          likes: number;         // this recipe’s likes_count
          commentCount: number;  // this recipe’s comment_count
          createdAt: string;
          ownerId: string;
          is_private?: boolean;  // 🔒 for the lock chip on the card
        }
      | {
          type: "sponsored";
          id: string;
          brand: string;
          title: string;
          image: string | null;
          cta: string | null;
        }
    >
  >;

  // ONE RECIPE DETAILS
  getRecipeById(id: string): Promise<{
    id: string;
    title: string;
    image: string | null;
    creator: string;
    creatorAvatar?: string | null;
    knives: number;
    cooks: number;
    createdAt: string;
    ingredients: string[];
    steps: StepRow[];
    is_private: boolean;
    monetization_eligible: boolean;
    sourceUrl: string | null;
    image_url?: string | null;
    commentCount?: number;
  } | null>;

  // SAVE / LIKE / COOK
  toggleSave(recipeId: string): Promise<boolean>;
  toggleLike(recipeId: string): Promise<{ liked: boolean; likesCount: number }>;
  markCooked(recipeId: string): Promise<void>;

  // CREATOR STATS (for profile)
  getUserStats(userId: string): Promise<UserStats | null>;

  // OWNER HELPERS
  getRecipeOwnerId(recipeId: string): Promise<string | null>;
  updateRecipe(
    recipeId: string,
    patch: { title?: string; image_url?: string | null; minutes?: number | null }
  ): Promise<{ id: string; title: string; image_url: string | null; updated_at: string }>;
  deleteRecipe(recipeId: string): Promise<void>;

  // FULL EDIT FLOW
  updateRecipeFull(args: {
    id: string;
    title?: string;
    image_url?: string | null;
    ingredients: string[];
    steps: { text: string; seconds: number | null }[];
    is_private?: boolean;
    monetization_eligible?: boolean;
    source_url?: string | null;
    minutes?: number | null;
  }): Promise<void>;

  // IMAGE REPLACE
  replaceRecipeImage(recipeId: string, sourceUri: string): Promise<string>;

  // SEARCH
  searchRecipesAdvanced(args: {
    text?: string;
    maxMinutes?: number;
    diet?: Array<"vegan" | "gluten_free" | "dairy_free">;
    includeIngredients?: string[];
    excludeIngredients?: string[];
    limit?: number;
  }): Promise<Array<{ id: string; title: string; image: string | null; creator: string }>>;
  searchRecipes(query: string): Promise<
    Array<{ id: string; title: string; image: string | null; creator: string }>
  >;

  // COMMENTS
  hideComment(commentId: string): Promise<void>;
  unhideComment(commentId: string): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
  getRecipeCounts(
    recipeId: string
  ): Promise<{ likes: number; cooks: number; comments: number }>;
}

/* -----------------------------------------------------------
   Private helpers
----------------------------------------------------------- */

// who am i (throws if not signed in)
async function getViewerIdStrict(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Not signed in");
  return data.user.id;
}

// who owns a recipe
async function getOwnerId(recipeId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("recipes")
    .select("user_id")
    .eq("id", recipeId)
    .maybeSingle();
  if (error) return null;
  return data?.user_id ?? null;
}

// no liking your own recipe
async function assertNotOwnerForLike(recipeId: string, viewerId: string): Promise<void> {
  const ownerId = await getOwnerId(recipeId);
  if (ownerId && ownerId === viewerId) {
    throw new Error("You cannot like your own recipe");
  }
}

// no cooking your own recipe
async function assertNotOwnerForCook(recipeId: string, viewerId: string): Promise<void> {
  const ownerId = await getOwnerId(recipeId);
  if (ownerId && ownerId === viewerId) {
    throw new Error("You cannot mark your own recipe as cooked");
  }
}

/* -----------------------------------------------------------
   Main Data API
----------------------------------------------------------- */
export const dataAPI: DataAPI = {
  /* -------------------------------------------------------
     FEED LIST
     Like I'm 5:
     - If signed in → show PUBLIC recipes OR (PRIVATE & mine)
     - If logged out → show only PUBLIC
     - We apply pagination AFTER the filter
  ------------------------------------------------------- */
  async getFeedPage(page, size) {
    // what slice of the list do we want?
    const from = page * size;
    const to = from + size - 1;

    // who is looking?
    const { data: auth } = await supabase.auth.getUser();
    const viewerId: string | null = auth?.user?.id ?? null;

    // base select
    let q = supabase
      .from("recipes")
      .select(`
        id,
        title,
        image_url,
        cooks_count,
        likes_count,
        comment_count,
        created_at,
        user_id,
        is_private,
        profiles!recipes_user_id_fkey (username, avatar_url, knives)
      `)
      .order("created_at", { ascending: false });

    // IMPORTANT: filter FIRST
    if (viewerId) {
      // public OR (private AND mine)
      q = q.or(
        `and(is_private.eq.false),and(is_private.eq.true,user_id.eq.${viewerId})`
      );
    } else {
      q = q.eq("is_private", false);
    }

    // THEN paginate
    q = q.range(from, to);

    const { data: recipes, error } = await q;
    if (error) throw error;

    // optional: ads we may sprinkle in
    const nowIso = new Date().toISOString();
    const { data: ads } = await supabase
      .from("sponsored_slots")
      .select("*")
      .lte("active_from", nowIso)
      .or(`active_to.is.null,active_to.gte.${nowIso}`);

    // shape rows for the UI
    const out: Array<
      | {
          type: "recipe";
          id: string;
          title: string;
          image: string | null;
          creator: string;
          creatorAvatar?: string | null;
          knives: number;
          cooks: number;
          likes: number;
          commentCount: number;
          createdAt: string;
          ownerId: string;
          is_private?: boolean;
        }
      | {
          type: "sponsored";
          id: string;
          brand: string;
          title: string;
          image: string | null;
          cta: string | null;
        }
    > = [];

    let adIdx = 0;
    (recipes ?? []).forEach((r: any, i: number) => {
      // sprinkle an ad every ~6 cards (optional)
      if (ads && i > 0 && i % 6 === 4 && adIdx < ads.length) {
        const a = ads[adIdx++];
        out.push({
          type: "sponsored",
          id: String(a.id),
          brand: a.brand ?? "",
          title: a.title ?? "",
          image: a.image_url ?? null,
          cta: a.cta_url ?? null,
        });
      }

      out.push({
        type: "recipe",
        id: String(r.id),
        title: r.title ?? "",
        image: r.image_url ?? null,
        creator: r.profiles?.username ?? "someone",
        creatorAvatar: r.profiles?.avatar_url ?? null,
        knives: Number(r.profiles?.knives ?? 0),
        cooks: Number(r.cooks_count ?? 0),
        likes: Number(r.likes_count ?? 0),
        commentCount: Number(r.comment_count ?? 0),
        createdAt: r.created_at,
        ownerId: r.user_id,
        is_private: !!r.is_private, // 🔒 card uses this for the lock
      });
    });

    // NOTE: do NOT filter the list again here.
    // The DB filter already did the right thing (includes your own privates).
    return out;
  },

  /* -------------------------------------------------------
     ONE RECIPE DETAILS
  ------------------------------------------------------- */
  async getRecipeById(id) {
    const { data: r, error } = await supabase
      .from("recipes")
      .select(`
        id,
        title,
        image_url,
        cooks_count,
        likes_count,
        comment_count,
        created_at,
        source_url,
        minutes,
        is_private,
        monetization_eligible,
        user_id,
        profiles!recipes_user_id_fkey (username, avatar_url, knives),
        recipe_ingredients (pos, text),
        recipe_steps (pos, text, seconds)
      `)
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!r) return null;

    const ings = (r.recipe_ingredients || [])
      .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((x: any) => x.text ?? "")
      .filter(Boolean);

    const steps = (r.recipe_steps || [])
      .sort((a: any, b: any) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((x: any) => ({ text: x.text ?? "", seconds: x.seconds ?? null }));

    return {
      id: String(r.id),
      title: r.title ?? "",
      image: r.image_url ?? null,
      creator: r.profiles?.username ?? "someone",
      creatorAvatar: r.profiles?.avatar_url ?? null,
      knives: Number(r.profiles?.knives ?? 0),
      cooks: Number(r.cooks_count ?? 0),
      createdAt: r.created_at,
      ingredients: ings,
      steps,
      is_private: !!r.is_private,
      monetization_eligible: !!r.monetization_eligible,
      sourceUrl: r.source_url ?? null,
      image_url: r.image_url ?? null,
      commentCount: Number(r.comment_count ?? 0),
    };
  },

  /* -------------------------------------------------------
     SAVE / LIKE / COOK
  ------------------------------------------------------- */
  async toggleSave(recipeId: string) {
    const userId = await getViewerIdStrict();

    const { data: existing } = await supabase
      .from("recipe_saves")
      .select("user_id")
      .eq("user_id", userId)
      .eq("recipe_id", recipeId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("recipe_saves")
        .delete()
        .eq("user_id", userId)
        .eq("recipe_id", recipeId);
      if (error) throw error;
      return false;
    } else {
      const { error } = await supabase
        .from("recipe_saves")
        .insert({ user_id: userId, recipe_id: recipeId });
      if (error) throw error;
      return true;
    }
  },

  async toggleLike(recipeId: string) {
    const userId = await getViewerIdStrict();
    await assertNotOwnerForLike(recipeId, userId);

    const { data: existing } = await supabase
      .from("recipe_likes")
      .select("user_id")
      .eq("user_id", userId)
      .eq("recipe_id", recipeId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("recipe_likes")
        .delete()
        .eq("user_id", userId)
        .eq("recipe_id", recipeId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("recipe_likes")
        .insert({ user_id: userId, recipe_id: recipeId });
      // ignore duplicate insert race
      // @ts-ignore
      if (error && error.code !== "23505") throw error;
    }

    const [{ count }, { data: mine }] = await Promise.all([
      supabase
        .from("recipe_likes")
        .select("user_id", { count: "exact", head: true })
        .eq("recipe_id", recipeId),
      supabase
        .from("recipe_likes")
        .select("user_id")
        .eq("recipe_id", recipeId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    return { liked: !!mine, likesCount: count ?? 0 };
  },

  async markCooked(recipeId: string) {
    const userId = await getViewerIdStrict();
    await assertNotOwnerForCook(recipeId, userId);

    const { error } = await supabase
      .from("recipe_cooks")
      .insert({ user_id: userId, recipe_id: recipeId });

    // ignore "already cooked" unique error
    // @ts-ignore
    if (error && error.code !== "23505") throw error;
  },

  /* -------------------------------------------------------
     CREATOR STATS
  ------------------------------------------------------- */
  async getUserStats(userId: string) {
    const [{ data: prof }, { data: cookRows, error: cookErr }] = await Promise.all([
      supabase.from("profiles").select("knives").eq("id", userId).maybeSingle(),
      supabase.from("recipes").select("cooks_count").eq("user_id", userId).limit(5000),
    ]);
    if (cookErr) return null;

    const cooks_total = (cookRows ?? []).reduce(
      (sum: number, r: any) => sum + Number(r?.cooks_count ?? 0),
      0
    );

    return {
      medals_total: Number(prof?.knives ?? 0),
      cooks_total,
    };
  },

  /* -------------------------------------------------------
     OWNER HELPERS
  ------------------------------------------------------- */
  async getRecipeOwnerId(recipeId: string) {
    return await getOwnerId(recipeId);
  },

  async updateRecipe(recipeId, patch) {
    const { data, error } = await supabase
      .from("recipes")
      .update({ ...patch })
      .eq("id", recipeId)
      .select("id, title, image_url, updated_at")
      .maybeSingle();
    if (error) throw error;
    return data!;
  },

  async deleteRecipe(recipeId: string) {
    const { error } = await supabase.from("recipes").delete().eq("id", recipeId);
    if (error) throw error;
    try {
      await deleteRecipeAssets(recipeId);
    } catch {
      // ignore clean-up errors
    }
  },

  /* -------------------------------------------------------
     FULL EDIT FLOW
  ------------------------------------------------------- */
  async updateRecipeFull(args) {
    const {
      id,
      title,
      image_url,
      ingredients,
      steps,
      is_private,
      monetization_eligible,
      source_url,
      minutes,
    } = args;

    const { error: baseErr } = await supabase
      .from("recipes")
      .update({
        ...(title !== undefined ? { title } : {}),
        ...(image_url !== undefined ? { image_url } : {}),
        ...(is_private !== undefined ? { is_private } : {}),
        ...(monetization_eligible !== undefined ? { monetization_eligible } : {}),
        ...(source_url !== undefined ? { source_url } : {}),
        ...(minutes !== undefined ? { minutes } : {}),
      })
      .eq("id", id);
    if (baseErr) throw baseErr;

    const { error: delIngErr } = await supabase
      .from("recipe_ingredients")
      .delete()
      .eq("recipe_id", id);
    if (delIngErr) throw delIngErr;

    if (ingredients?.length) {
      const rows = ingredients.map((text, i) => ({ recipe_id: id, pos: i, text }));
      const { error: insIngErr } = await supabase.from("recipe_ingredients").insert(rows);
      if (insIngErr) throw insIngErr;
    }

    const { error: delStepErr } = await supabase
      .from("recipe_steps")
      .delete()
      .eq("recipe_id", id);
    if (delStepErr) throw delStepErr;

    if (steps?.length) {
      const rows = steps.map((s, i) => ({
        recipe_id: id,
        pos: i,
        text: s.text,
        seconds: s.seconds,
      }));
      const { error: insStepErr } = await supabase.from("recipe_steps").insert(rows);
      if (insStepErr) throw insStepErr;
    }
  },

  /* -------------------------------------------------------
     IMAGE REPLACE
  ------------------------------------------------------- */
  async replaceRecipeImage(recipeId: string, sourceUri: string) {
    const url = await replaceRecipeImageUpload(recipeId, sourceUri);
    const { error } = await supabase
      .from("recipes")
      .update({ image_url: url })
      .eq("id", recipeId);
    if (error) throw error;
    return url;
  },

  /* -------------------------------------------------------
     ADVANCED SEARCH (PUBLIC ONLY)
  ------------------------------------------------------- */
  async searchRecipesAdvanced({
    text,
    maxMinutes,
    diet = [],
    includeIngredients = [],
    excludeIngredients = [],
    limit = 50,
  }) {
    let q = supabase
      .from("recipes")
      .select(
        `
        id,
        title,
        image_url,
        minutes,
        diet_tags,
        main_ingredients,
        profiles!recipes_user_id_fkey (username)
      `
      )
      .eq("is_private", false)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (text && text.trim()) q = q.ilike("title", `%${text.trim()}%`);
    if (typeof maxMinutes === "number") q = q.lte("minutes", maxMinutes);
    if (diet.length) q = q.overlaps("diet_tags", diet);
    if (includeIngredients.length)
      q = q.overlaps("main_ingredients", includeIngredients.map((x) => x.toLowerCase()));
    if (excludeIngredients.length)
      q = q.not("main_ingredients", "overlaps", excludeIngredients.map((x) => x.toLowerCase()));

    const { data, error } = await q;
    if (error) throw error;

    return (data ?? []).map((r: any) => ({
      id: String(r.id),
      title: r.title ?? "",
      image: r.image_url ?? null,
      creator: r.profiles?.username ?? "someone",
    }));
  },

  /* -------------------------------------------------------
     SIMPLE SEARCH (PUBLIC ONLY)
  ------------------------------------------------------- */
  async searchRecipes(query: string) {
    const q = (query || "").trim();
    if (!q) return [];

    const { data: titleRows, error: titleErr } = await supabase
      .from("recipes")
      .select(
        `
        id,
        title,
        image_url,
        user_id,
        profiles!recipes_user_id_fkey (username)
      `
      )
      .eq("is_private", false)
      .ilike("title", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (titleErr) throw titleErr;
    let rows = titleRows ?? [];

    if (!rows.length) {
      const { data: ingMatches } = await supabase
        .from("recipe_ingredients")
        .select("recipe_id")
        .ilike("text", `%${q}%`)
        .limit(50);

      const ids = Array.from(new Set((ingMatches ?? []).map((r: any) => r.recipe_id))).filter(
        Boolean
      );

      if (ids.length) {
        const { data: byIng } = await supabase
          .from("recipes")
          .select(
            `
            id,
            title,
            image_url,
            user_id,
            profiles!recipes_user_id_fkey (username)
          `
          )
          .in("id", ids)
          .eq("is_private", false)
          .order("created_at", { ascending: false })
          .limit(50);
        rows = byIng ?? [];
      }
    }

    return (rows ?? []).map((r: any) => ({
      id: String(r.id),
      title: r.title ?? "",
      image: r.image_url ?? null,
      creator: r.profiles?.username ?? "someone",
    }));
  },

  /* -------------------------------------------------------
     COMMENTS
  ------------------------------------------------------- */
  async hideComment(commentId: string) {
    const { error } = await supabase
      .from("recipe_comments")
      .update({ is_hidden: true })
      .eq("id", commentId);
    if (error) throw error;
  },

  async unhideComment(commentId: string) {
    const { error } = await supabase
      .from("recipe_comments")
      .update({ is_hidden: false })
      .eq("id", commentId);
    if (error) throw error;
  },

  async deleteComment(commentId: string) {
    const { error } = await supabase.from("recipe_comments").delete().eq("id", commentId);
    if (error) throw error;
  },

  async getRecipeCounts(recipeId: string) {
    const { data, error } = await supabase
      .from("recipes")
      .select("likes_count, cooks_count, comment_count")
      .eq("id", recipeId)
      .maybeSingle();
    if (error) throw error;
    return {
      likes: Number(data?.likes_count ?? 0),
      cooks: Number(data?.cooks_count ?? 0),
      comments: Number(data?.comment_count ?? 0),
    };
  },
};

/* -----------------------------------------------------------
   Social / follow helpers (named exports used elsewhere)
----------------------------------------------------------- */
async function viewerIdStrict(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Not signed in");
  return data.user.id;
}

export async function getUserIdByUsername(username: string): Promise<string | null> {
  const clean = (username || "").trim();
  if (!clean) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", clean)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function listFollowers(targetUserId: string) {
  if (!targetUserId) return [];
  const { data, error } = await supabase
    .from("follows")
    .select(`
      follower_id,
      profiles:follower_id ( id, username, avatar_url, bio )
    `)
    .eq("following_id", targetUserId)
    .order("created_at", { ascending: false });
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

export async function listFollowing(targetUserId: string) {
  if (!targetUserId) return [];
  const { data, error } = await supabase
    .from("follows")
    .select(`
      following_id,
      profiles:following_id ( id, username, avatar_url, bio )
    `)
    .eq("follower_id", targetUserId)
    .order("created_at", { ascending: false });
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

export async function getFollowState(otherUserId: string): Promise<boolean> {
  const me = await viewerIdStrict();
  if (!otherUserId || otherUserId === me) return false;

  const { data, error } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", me)
    .eq("following_id", otherUserId)
    .maybeSingle();
  // @ts-ignore (ignore "no rows" code)
  if (error && error.code !== "PGRST116") throw error;

  return !!data;
}

export async function toggleFollow(otherUserId: string): Promise<boolean> {
  const me = await viewerIdStrict();
  if (!otherUserId || otherUserId === me) throw new Error("Cannot follow yourself");

  const { data: existing, error: chkErr } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", me)
    .eq("following_id", otherUserId)
    .maybeSingle();
  // @ts-ignore
  if (chkErr && chkErr.code !== "PGRST116") throw chkErr;

  if (existing) {
    const { error } = await supabase
      .from("follows")
      .delete()
      .eq("follower_id", me)
      .eq("following_id", otherUserId);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: me, following_id: otherUserId });
  // @ts-ignore
  if (error && error.code !== "23505") throw error;

  return true;
}
