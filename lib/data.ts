// lib/data.ts
// LIKE YOU'RE 5 🧸
// This file is our "helper brain" that talks to Supabase.
// Screens ask for stuff here, and we give them easy data back.
//
// NEW STUFF FOR YOU:
// - getRecipeComments(): fetches comments (with avatar/name when possible) and now ALSO returns authorId
// - addComment(): writes comments using your add_comment RPC
// - Feed still uses a safe view for comment counts (no double counting)

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

  // COMMENTS (existing admin-y helpers)
  hideComment(commentId: string): Promise<void>;
  unhideComment(commentId: string): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
  getRecipeCounts(
    recipeId: string
  ): Promise<{ likes: number; cooks: number; comments: number }>;

  // 🆕 COMMENTS (the two methods your Home modal calls)
  getRecipeComments(
    recipeId: string
  ): Promise<
    Array<{
      id: string;
      author: { username: string; avatar?: string | null };
      authorId?: string | null; // 👈 added this so the UI can block/mute/delete/report
      text: string;
      createdAt: string;
      parentId?: string | null;
    }>
  >;

  addComment(
    recipeId: string,
    text: string,
    parentId?: string | null
  ): Promise<void>;

  // 🆕 Smarter rail suggester used by Home rail when no sponsor slot is active
  getSmartSuggestionsForContext?(
    context: string
  ): Promise<Array<{ id: string; title: string; image: string | null }>>;

  // (kept) Simple suggester
  getSuggestedRecipesForContext?(
    context: string
  ): Promise<Array<{ id: string; title: string; image: string | null }>>;
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
     FEED LIST (unchanged except safer comment count)
     - We fetch recipes
     - We optionally sprinkle sponsored cards
     - We join comment counts from a small public view to avoid double-counting
  ------------------------------------------------------- */
  async getFeedPage(page, size) {
    // figure out which rows we want (page math)
    const from = page * size;
    const to = from + size - 1;

    // who is looking (used only to include their private recipes)
    const { data: auth } = await supabase.auth.getUser();
    const viewerId: string | null = auth?.user?.id ?? null;

    // 1) grab recipes for the feed
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

    if (viewerId) {
      // show all public + MY private
      q = q.or(`and(is_private.eq.false),and(is_private.eq.true,user_id.eq.${viewerId})`);
    } else {
      // signed out → only public
      q = q.eq("is_private", false);
    }

    q = q.range(from, to);

    const { data: recipes, error } = await q;
    if (error) throw error;

    // 2) Insert sponsored slots like you already do
    const nowIso = new Date().toISOString();
    const { data: ads } = await supabase
      .from("sponsored_slots")
      .select("*")
      .eq("is_active", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`);

    // 3) NEW: read accurate comment counts from our view (top-level only)
    const ids = (recipes ?? []).map((r: any) => r.id).filter(Boolean);
    let countMap = new Map<string, { top: number; total: number }>();
    if (ids.length) {
      const { data: counts } = await supabase
        .from("recipe_comment_counts_public")
        .select("recipe_id, top_level_comments, total_comments")
        .in("recipe_id", ids);
      (counts ?? []).forEach((c: any) => {
        countMap.set(String(c.recipe_id), {
          top: Number(c.top_level_comments || 0),
          total: Number(c.total_comments || 0),
        });
      });
    }

    // 4) build the feed array (recipes + occasional ads)
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
      // sprinkle ad
      if (ads && i > 0 && i % 6 === 4 && adIdx < (ads as any).length) {
        const a: any = (ads as any)[adIdx++];
        out.push({
          type: "sponsored",
          id: String(a.id),
          brand: a.brand ?? "",
          title: a.title ?? "",
          image: a.image_url ?? null,
          cta: a.cta_url ?? null,
        });
      }

      // pick the safe count:
      // - prefer our new "top_level" count
      // - otherwise fall back to recipes.comment_count (old column)
      const m = countMap.get(String(r.id));
      const safeCommentCount =
        typeof m?.top === "number" ? m.top : Number(r.comment_count ?? 0);

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
        commentCount: safeCommentCount,
        createdAt: r.created_at,
        ownerId: r.user_id,
        is_private: !!r.is_private,
      });
    });

    return out;
  },

  /* -------------------------------------------------------
     ONE RECIPE (unchanged)
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
     SAVE / LIKE / COOK (unchanged)
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
     CREATOR STATS (unchanged)
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
     OWNER HELPERS (unchanged)
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
     FULL EDIT FLOW (unchanged)
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
     IMAGE REPLACE (unchanged)
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
     ADVANCED SEARCH (unchanged)
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
     SIMPLE SEARCH (unchanged)
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
     COMMENTS — existing admin-y helpers (unchanged)
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

  /* -------------------------------------------------------
     🆕 COMMENTS — the two methods your Home modal expects
     - getRecipeComments() : reads "body" text; tries 3 sources (A,B,C)
     - addComment()        : calls your add_comment() RPC
     NOTE: we return authorId so UI can moderate (block/mute/delete/report)
  ------------------------------------------------------- */
  async getRecipeComments(recipeId: string) {
    // helper to run the same query on different sources
    async function readFrom(source: "A" | "B" | "C") {
      let q;
      if (source === "A") {
        // A) best: visibility + profiles (username, avatar)
        q = supabase
          .from("recipe_comments_visible_to_with_profiles")
          .select(
            "id, recipe_id, user_id, parent_id, body, created_at, is_hidden, is_flagged, username, avatar_url"
          );
      } else if (source === "B") {
        // B) profiles only (looser visibility)
        q = supabase
          .from("recipe_comments_with_profiles")
          .select(
            "id, recipe_id, user_id, parent_id, body, created_at, is_hidden, is_flagged, username, avatar_url"
          );
      } else {
        // C) raw table (no profile fields)
        q = supabase
          .from("recipe_comments")
          .select("id, recipe_id, user_id, parent_id, body, created_at, is_hidden, is_flagged");
      }
      const { data, error } = await q
        .eq("recipe_id", recipeId)
        .order("created_at", { ascending: false });
      return { data: (data ?? []) as any[], error };
    }

    // try A
    let { data, error } = await readFrom("A");
    if (!error && data.length) {
      return data
        .filter((r) => !r.is_hidden)
        .map((r) => ({
          id: String(r.id),
          author: { username: r.username ?? "someone", avatar: r.avatar_url ?? null },
          authorId: r.user_id as string, // 👈 added for moderation
          text: r.body ?? "",
          createdAt: r.created_at,
          parentId: r.parent_id ?? null,
        }));
    }

    // try B
    ({ data, error } = await readFrom("B"));
    if (!error && data.length) {
      return data
        .filter((r) => !r.is_hidden)
        .map((r) => ({
          id: String(r.id),
          author: { username: r.username ?? "someone", avatar: r.avatar_url ?? null },
          authorId: r.user_id as string, // 👈 added for moderation
          text: r.body ?? "",
          createdAt: r.created_at,
          parentId: r.parent_id ?? null,
        }));
    }

    // try C
    ({ data, error } = await readFrom("C"));
    if (!error && data.length) {
      return data
        .filter((r) => !r.is_hidden)
        .map((r) => ({
          id: String(r.id),
          author: { username: r.user_id?.slice?.(0, 6) ?? "user", avatar: undefined },
          authorId: r.user_id as string, // 👈 added for moderation
          text: r.body ?? "",
          createdAt: r.created_at,
          parentId: r.parent_id ?? null,
        }));
    }

    return []; // none found (or errors) → modal will say "No comments yet"
  },

  async addComment(recipeId: string, text: string, parentId: string | null = null) {
    const body = (text || "").trim();
    if (!body) return;

    // uses your Postgres function writing into recipe_comments.body
    await supabase.rpc("add_comment", {
      p_recipe_id: recipeId,          // required
      p_body: body,                   // required
      p_parent_id: parentId ?? null,  // optional (reply) or null (top-level)
    });

    if (error) throw error;
  },

  /* -------------------------------------------------------
     🆕 SMART SEASONAL PICKER for the rail (kept)
  ------------------------------------------------------- */
  async getSmartSuggestionsForContext(context: string) {
    const topic = (context || "").toLowerCase().trim();

    async function run(base: any) {
      const { data, error } = await base
        .eq("is_private", false)
        .order("created_at", { ascending: false })
        .limit(48);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: String(r.id),
        title: r.title ?? "Recipe",
        image: r.image_url ?? null,
      }));
    }

    // QUICK DINNERS → real dinners (≤35m)
    if (topic.includes("quick")) {
      const EX = [
        "cookie","brownie","cake","cupcake","pie","bar ","bars","cheesecake","pudding",
        "ice cream","fudge","donut","doughnut","muffin","scone","candy","frost","cinnamon roll",
        "macaron","macaroon","tart","crumble","cobbler","sweet ","smoothie","shake","latte","mocha",
        "coffee","tea ","soda","cocktail","mocktail","lemonade","punch","spritzer","margarita",
        "sangria","wine","beer"
      ];

      let qa = supabase
        .from("recipes")
        .select("id, title, image_url, minutes, created_at")
        .or("minutes.lte.35,minutes.is.null");

      EX.forEach((w) => { qa = qa.not("title", "ilike", `%${w}%`); });

      qa = qa.or(
        [
          "title.ilike.%skillet%",
          "title.ilike.%sheet pan%",
          "title.ilike.%sheet-pan%",
          "title.ilike.%one pan%",
          "title.ilike.%one-pan%",
          "title.ilike.%stir fry%",
          "title.ilike.%taco%",
          "title.ilike.%pasta%",
          "title.ilike.%bowl%",
          "title.ilike.%chicken%",
          "title.ilike.%beef%",
          "title.ilike.%pork%",
          "title.ilike.%shrimp%",
          "title.ilike.%salmon%",
          "title.ilike.%soup%",
          "title.ilike.%chili%",
          "title.ilike.%curry%",
          "title.ilike.%bake%",
          "title.ilike.%casserole%",
          "title.ilike.%quesadilla%",
          "title.ilike.%wrap%",
          "title.ilike.%burger%",
        ].join(",")
      );

      let phaseA = await run(qa);
      if (phaseA.length >= 12) return phaseA.slice(0, 24);

      let qb = supabase
        .from("recipes")
        .select("id, title, image_url, minutes, created_at")
        .or("minutes.lte.35,minutes.is.null");
      EX.forEach((w) => { qb = qb.not("title", "ilike", `%${w}%`); });

      const phaseB = await run(qb);
      return phaseB.slice(0, 24);
    }

    // GAMEDAY → appetizers/snacks
    if (topic.includes("gameday")) {
      let q = supabase
        .from("recipes")
        .select("id, title, image_url, created_at");

      q = q.or(
        [
          "title.ilike.%wing%",
          "title.ilike.%dip%",
          "title.ilike.%slider%",
          "title.ilike.%burger%",
          "title.ilike.%bacon%",
          "title.ilike.%nacho%",
          "title.ilike.%pizza%",
          "title.ilike.%flatbread%",
          "title.ilike.%queso%",
          "title.ilike.%pretzel%",
          "title.ilike.%sausage roll%",
          "title.ilike.%pigs in a blanket%",
          "title.ilike.%bite%",
          "title.ilike.%bites%",
          "title.ilike.%ball%",
          "title.ilike.%balls%",
          "title.ilike.%popper%",
          "title.ilike.%poppers%",
          "title.ilike.%taquito%",
          "title.ilike.%tender%",
          "title.ilike.%tenders%",
          "title.ilike.%chips%",
          "title.ilike.%salsa%",
          "title.ilike.%guacamole%",
          "title.ilike.%buffalo%",
          "title.ilike.%7 layer%",
          "title.ilike.%seven layer%",
          "title.ilike.%party%",
          "title.ilike.%appetizer%",
        ].join(",")
      );

      const AVOID_ENTREE = ["casserole","roast","steak","whole","sheet pan dinner","lasagna","salmon fillet"];
      AVOID_ENTREE.forEach((w) => { q = q.not("title", "ilike", `%${w}%`); });

      const picks = await run(q);
      return picks.slice(0, 24);
    }

    // GRILL
    if (topic.includes("grill")) {
      const q = supabase
        .from("recipes")
        .select("id, title, image_url, created_at")
        .or(
          [
            "title.ilike.%grill%",
            "title.ilike.%bbq%",
            "title.ilike.%barbecue%",
            "title.ilike.%smok%",
            "title.ilike.%brisket%",
            "title.ilike.%kebab%",
            "title.ilike.%skewer%",
            "title.ilike.%burger%",
            "title.ilike.%steak%",
            "title.ilike.%rib%",
            "title.ilike.%brat%",
            "title.ilike.%hot dog%",
          ].join(",")
        );
      return (await run(q)).slice(0, 24);
    }

    // THANKSGIVING
    if (topic.includes("thanksgiving")) {
      const q = supabase
        .from("recipes")
        .select("id, title, image_url, created_at")
        .or(
          [
            "title.ilike.%thanksgiving%",
            "title.ilike.%turkey%",
            "title.ilike.%stuffing%",
            "title.ilike.%dressing%",
            "title.ilike.%gravy%",
            "title.ilike.%mashed%",
            "title.ilike.%sweet potato%",
            "title.ilike.%green bean%",
            "title.ilike.%cranberry%",
            "title.ilike.%pumpkin%",
            "title.ilike.%pecan%",
            "title.ilike.%roll%",
          ].join(",")
        );
      return (await run(q)).slice(0, 24);
    }

    // CHRISTMAS / HOLIDAY
    if (topic.includes("christmas") || topic.includes("holiday")) {
      const q = supabase
        .from("recipes")
        .select("id, title, image_url, created_at")
        .or(
          [
            "title.ilike.%christmas%",
            "title.ilike.%holiday%",
            "title.ilike.%ham%",
            "title.ilike.%prime rib%",
            "title.ilike.%roast%",
            "title.ilike.%tenderloin%",
            "title.ilike.%potato%",
            "title.ilike.%green bean%",
            "title.ilike.%cranberry%",
            "title.ilike.%yule%",
          ].join(",")
        );
      return (await run(q)).slice(0, 24);
    }

    // default: newest public
    const base = supabase.from("recipes").select("id, title, image_url, created_at");
    return (await run(base)).slice(0, 24);
  },

  /* -------------------------------------------------------
     Simple suggester (kept)
  ------------------------------------------------------- */
  async getSuggestedRecipesForContext(context: string) {
    const topic = (context || "").trim() || "quick";
    let out: Array<{ id: string; title: string; image: string | null }> = [];

    const { data: rows } = await supabase
      .from("recipes")
      .select("id, title, image_url, is_private")
      .eq("is_private", false)
      .ilike("title", `%${topic}%`)
      .order("created_at", { ascending: false })
      .limit(24);

    (rows ?? []).forEach((r: any) => {
      out.push({ id: String(r.id), title: r.title ?? "Recipe", image: r.image_url ?? null });
    });

    if (!out.length) {
      const { data: rows2 } = await supabase
        .from("recipes")
        .select("id, title, image_url")
        .eq("is_private", false)
        .order("created_at", { ascending: false })
        .limit(24);
      (rows2 ?? []).forEach((r: any) => {
        out.push({ id: String(r.id), title: r.title ?? "Recipe", image: r.image_url ?? null });
      });
    }
    return out;
  },
};

/* -----------------------------------------------------------
   Social helpers (unchanged)
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
  // 🧸 If no target, give an empty list
  if (!targetUserId) return [];

  // 🧷 IMPORTANT PART:
  // profiles!follows_follower_id_fkey(...) disambiguates the join
  const { data, error } = await supabase
    .from("follows")
    .select(`
      follower_id,
      follower:profiles!follows_follower_id_fkey ( id, username, avatar_url, bio )
    `)
    .eq("following_id", targetUserId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // 🎁 Return just the profile bits, like before
  return (data ?? [])
    .map((r: any) => r.follower)
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
      following:profiles!follows_following_id_fkey ( id, username, avatar_url, bio )
    `)
    .eq("follower_id", targetUserId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? [])
    .map((r: any) => r.following)
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
  // @ts-ignore
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
// ===============================
// 🔔 NOTIFICATIONS HELPERS
// (DROP-IN: paste at bottom of data.ts)
// NOTE: Do NOT import supabase again here — data.ts already has it.
// ===============================

/**
 * getUnreadNotificationCount()
 * - Ask the DB: "how many are unread?"
 * - We use head:true so it returns only the count (fast).
 */
export async function getUnreadNotificationCount() {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false);

  if (error) throw error;
  return count ?? 0;
}

/**
 * listNotifications(limit, unreadOnly)
 * - Gets cards for the slide-up notifications sheet.
 * - Also pulls the actor's profile via the actor_id foreign key.
 * - The embed name 'profiles!notifications_actor_id_fkey' matches the FK
 *   we created in SQL Step 1 (fresh table build).
 */
export async function listNotifications(limit = 50, unreadOnly = false) {
  let q = supabase
    .from("notifications")
    .select(
      `
        id,
        type,             -- 'comment' | 'reply'
        recipe_id,
        comment_id,
        is_read,
        created_at,
        message,
        recipe_title,
        actor:profiles!notifications_actor_id_fkey ( id, username, avatar_url )
      `
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) q = q.eq("is_read", false);

  const { data, error } = await q;
  if (error) throw error;

  // 🧽 Make a friendly shape for UI
  return (data ?? []).map((n: any) => ({
    id: n.id,
    type: (n.type ?? "comment").toLowerCase() as "comment" | "reply",
    recipe_id: n.recipe_id,
    comment_id: n.comment_id,
    is_read: n.is_read,
    created_at: n.created_at,
    message: n.message ?? "",
    recipe_title: n.recipe_title ?? "",
    actor: n.actor
      ? {
          id: n.actor.id,
          username: n.actor.username ?? "Someone",
          avatar_url: n.actor.avatar_url ?? null,
        }
      : null,
  }));
}

/**
 * markNotificationRead(id)
 * - When you tap a card, we flip the "is_read" switch.
 */
export async function markNotificationRead(id: string) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * markAllNotificationsRead()
 * - Big "Mark all read" button at the top of the sheet.
 */
export async function markAllNotificationsRead() {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq("is_read", false);
  if (error) throw error;
}

/**
 * subscribeToNotifications(onNew)
 * - Realtime listener to bump the bell badge.
 * - Returns an unsubscribe function. Call it on unmount.
 */
export function subscribeToNotifications(onNew: (row: any) => void) {
  const channel = supabase
    .channel("notifications-stream")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      (payload) => onNew(payload.new)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
