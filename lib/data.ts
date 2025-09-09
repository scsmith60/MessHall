// lib/data.ts
// PURPOSE: a friendly helper file that talks to the database for our screens.
// Like you're 5: Screens ask this file for stuff (like "give me the feed"),
// and this file asks the database nicely and returns clean objects.

import { supabase } from "./supabase";
import {
  replaceRecipeImage as replaceRecipeImageUpload,
  deleteRecipeAssets,
} from "./uploads";

/* ──────────────────────────────────────────────────────────
   Tiny helper types (labels so TypeScript is happy)
   ────────────────────────────────────────────────────────── */
type StepRow = { text: string; seconds: number | null };
type UserStats = { medals_total: number; cooks_total: number };

/* ──────────────────────────────────────────────────────────
   Public API (what screens import and use)
   ────────────────────────────────────────────────────────── */
export interface DataAPI {
  // FEED LIST
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
          knives: number; // creator lifetime medals (profiles.knives)
          cooks: number; // this recipe’s cooks count
          likes: number; // ❤️ count
          commentCount: number; // 💬 count (from recipes.comment_count)
          createdAt: string;
          ownerId: string;
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
    knives: number;        // 👈 from profiles.knives (author’s medals)
    cooks: number;
    createdAt: string;
    ingredients: string[];
    steps: StepRow[];
    is_private: boolean;
    monetization_eligible: boolean;
    sourceUrl: string | null;
    image_url?: string | null;
    commentCount?: number; // (optional) handy on details screens
  } | null>;

  // SAVE / LIKE / COOK
  toggleSave(recipeId: string): Promise<boolean>;
  toggleLike(recipeId: string): Promise<{ liked: boolean; likesCount: number }>;
  markCooked(recipeId: string): Promise<void>;

  // CREATOR STATS (for medal pill or profile)
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

  // SEARCH (advanced + simple)
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

  // 💬 COMMENTS (NEW) — we mutate the base table so DB triggers keep counts right
  hideComment(commentId: string): Promise<void>;
  unhideComment(commentId: string): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
  getRecipeCounts(
    recipeId: string
  ): Promise<{ likes: number; cooks: number; comments: number }>;
}

/* ──────────────────────────────────────────────────────────
   Private helpers
   ────────────────────────────────────────────────────────── */

// Who am I? (throws if not signed in)
async function getViewerIdStrict(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Not signed in");
  return data.user.id;
}

// Who owns a recipe?
async function getOwnerId(recipeId: string): Promise<string | null> {
  // Like I’m 5: look at the recipe row and read its user_id.
  const { data, error } = await supabase
    .from("recipes")
    .select("user_id")
    .eq("id", recipeId)
    .maybeSingle();
  if (error) return null;
  return data?.user_id ?? null;
}

// No liking your own recipe
async function assertNotOwnerForLike(recipeId: string, viewerId: string): Promise<void> {
  const ownerId = await getOwnerId(recipeId);
  if (ownerId && ownerId === viewerId) {
    throw new Error("You cannot like your own recipe");
  }
}

// No cooking your own recipe
async function assertNotOwnerForCook(recipeId: string, viewerId: string): Promise<void> {
  const ownerId = await getOwnerId(recipeId);
  if (ownerId && ownerId === viewerId) {
    throw new Error("You cannot mark your own recipe as cooked");
  }
}

/* ──────────────────────────────────────────────────────────
   Main Data API
   ────────────────────────────────────────────────────────── */
export const dataAPI: DataAPI = {
  /* FEED LIST
     Like you're 5: we grab a page of recipes.
     IMPORTANT: we select `comment_count` so the card shows the right 💬 number.
     SUPER IMPORTANT: we read the GREEN MEDAL from profiles.knives (author).
  */
  async getFeedPage(page, size) {
    const from = page * size;
    const to = from + size - 1;

    // Ask the DB for recipes + creator profile (username/avatar/KNIVES).
    // NOTE: No comments or emojis inside this string, only commas.
    const { data: recipes, error } = await supabase
      .from("recipes")
      .select(`
        id,
        title,
        image_url,
        cooks_count,
        likes_count,
        comment_count,
        created_at,
        minutes,
        diet_tags,
        main_ingredients,
        user_id,
        profiles!recipes_user_id_fkey (username, avatar_url, knives)
      `)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    // Optional: fetch sponsored slots to sprinkle into feed
    const nowIso = new Date().toISOString();
    const { data: ads } = await supabase
      .from("sponsored_slots")
      .select("*")
      .lte("active_from", nowIso)
      .or(`active_to.is.null,active_to.gte.${nowIso}`);

    // Build the feed list (recipes + sometimes an ad)
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
        }
      | { type: "sponsored"; id: string; brand: string; title: string; image: string | null; cta: string | null }
    > = [];

    let adIdx = 0;
    (recipes ?? []).forEach((r: any, i: number) => {
      // sprinkle ads
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

      // 👇 GREEN MEDAL comes from the AUTHOR profile (profiles.knives)
      out.push({
        type: "recipe",
        id: String(r.id),
        title: r.title ?? "",
        image: r.image_url ?? null,
        creator: r.profiles?.username ?? "someone",
        creatorAvatar: r.profiles?.avatar_url ?? null,
        knives: Number(r.profiles?.knives ?? 0),     // ✅ FIXED: author’s knives (not user_stats)
        cooks: Number(r.cooks_count ?? 0),
        likes: Number(r.likes_count ?? 0),
        commentCount: Number(r.comment_count ?? 0),
        createdAt: r.created_at,
        ownerId: r.user_id,
      });
    });

    return out;
  },

  /* ONE RECIPE DETAILS
     Like you're 5: we fetch one recipe + the author profile,
     and use profiles.knives for the green medal.
  */
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

    // pull ingredients/steps in order
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
      knives: Number(r.profiles?.knives ?? 0),      // ✅ FIXED: author’s knives
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

  /* SAVE / LIKE / COOK */
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

    // fresh count + my state
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

    // ignore duplicate unique error
    // @ts-ignore
    if (error && error.code !== "23505") throw error;
  },

  /* CREATOR STATS
     Like you're 5: medals = profiles.knives (truth now),
     cooks_total = sum of your recipes’ cooks_count (simple + fast).
  */
  async getUserStats(userId: string) {
    // medals from profile
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

  /* OWNER HELPERS */
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
    // best-effort: clean storage assets
    try {
      await deleteRecipeAssets(recipeId);
    } catch {
      // ignore
    }
  },

  /* FULL EDIT FLOW */
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

    // base fields
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

    // ingredients (replace all)
    const { error: delIngErr } = await supabase
      .from("recipe_ingredients")
      .delete()
      .eq("recipe_id", id);
    if (delIngErr) throw delIngErr;

    if (ingredients?.length) {
      const rows = ingredients.map((text, i) => ({ recipe_id: id, pos: i, text }));
      const { error: insIngErr } = await supabase
        .from("recipe_ingredients")
        .insert(rows);
      if (insIngErr) throw insIngErr;
    }

    // steps (replace all)
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
      const { error: insStepErr } = await supabase
        .from("recipe_steps")
        .insert(rows);
      if (insStepErr) throw insStepErr;
    }
  },

  /* IMAGE REPLACE */
  async replaceRecipeImage(recipeId: string, sourceUri: string) {
    const url = await replaceRecipeImageUpload(recipeId, sourceUri);
    const { error } = await supabase
      .from("recipes")
      .update({ image_url: url })
      .eq("id", recipeId);
    if (error) throw error;
    return url;
  },

  /* ADVANCED SEARCH */
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

  /* SIMPLE SEARCH */
  async searchRecipes(query: string) {
    const q = (query || "").trim();
    if (!q) return [];

    // (A) title match first
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
      .ilike("title", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (titleErr) throw titleErr;
    let rows = titleRows ?? [];

    // (B) if no title hits, try ingredient text matches
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

  /* 💬 COMMENTS (NEW) */
  // Like you're 5: these flip the "hidden" switch or delete the comment
  // on the BASE TABLE (public.recipe_comments), so your DB triggers
  // can add/subtract from recipes.comment_count automatically.

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
    const { error } = await supabase
      .from("recipe_comments")
      .delete()
      .eq("id", commentId);
    if (error) throw error;
  },

  // Quick way to refresh badges after any comment action
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

/* ──────────────────────────────────────────────────────────
   Social / follow helpers (named exports used elsewhere)
   ────────────────────────────────────────────────────────── */

// Who am I? (throws if not signed in) – duplicate on purpose for other modules
async function viewerIdStrict(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Not signed in");
  return data.user.id;
}

// Find a user's id from their callsign (username). Returns null if not found.
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

// People who follow TARGET (→ rows about the FOLLOWERS).
export async function listFollowers(targetUserId: string): Promise<
  Array<{ id: string; username: string | null; avatar_url: string | null; bio: string | null }>
> {
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

// People TARGET is following (→ rows about the FOLLOWING).
export async function listFollowing(targetUserId: string): Promise<
  Array<{ id: string; username: string | null; avatar_url: string | null; bio: string | null }>
> {
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

// Do *I* (viewer) follow `otherUserId`? Returns true/false.
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

// Follow/unfollow `otherUserId`. Returns the NEW state (true = following).
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
