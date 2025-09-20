// lib/data.ts
// LIKE YOU'RE 5 🧸
// - This file talks to Supabase and gives screens clean data.
// - NEW (smarter): getSmartSuggestionsForContext()
//     * "Quick Dinners": real mains, ≤35 min, no cookies/drinks.
//     * "Game Day": appetizers/snacks (wings, dips, sliders, nachos, bites...).
//     * Grill / Thanksgiving / Christmas: themed keywords.
// - Everything else stays the same.

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

  // COMMENTS
  hideComment(commentId: string): Promise<void>;
  unhideComment(commentId: string): Promise<void>;
  deleteComment(commentId: string): Promise<void>;
  getRecipeCounts(
    recipeId: string
  ): Promise<{ likes: number; cooks: number; comments: number }>;

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
     FEED LIST (unchanged)
  ------------------------------------------------------- */
  async getFeedPage(page, size) {
    const from = page * size;
    const to = from + size - 1;

    const { data: auth } = await supabase.auth.getUser();
    const viewerId: string | null = auth?.user?.id ?? null;

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
      q = q.or(`and(is_private.eq.false),and(is_private.eq.true,user_id.eq.${viewerId})`);
    } else {
      q = q.eq("is_private", false);
    }

    q = q.range(from, to);

    const { data: recipes, error } = await q;
    if (error) throw error;

    const nowIso = new Date().toISOString();
    const { data: ads } = await supabase
      .from("sponsored_slots")
      .select("*")
      .eq("is_active", true)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gte.${nowIso}`);


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
     COMMENTS (unchanged)
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
     🆕 SMART SEASONAL PICKER for the rail
     * Quick Dinners: mains (≤35m), exclude sweets/drinks.
     * Game Day: appetizers/snacks keywords.
     * Others: themed keywords.
     * Two-phase for Quick Dinners so we never fall back to random sweets.
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

    // QUICK DINNERS → real dinners (mains), not cookies/drinks.
    if (topic.includes("quick")) {
      // words to exclude
      const EX = [
        "cookie","brownie","cake","cupcake","pie","bar ","bars","cheesecake","pudding",
        "ice cream","fudge","donut","doughnut","muffin","scone","candy","frost","cinnamon roll",
        "macaron","macaroon","tart","crumble","cobbler","sweet ","smoothie","shake","latte","mocha",
        "coffee","tea ","soda","cocktail","mocktail","lemonade","punch","spritzer","margarita",
        "sangria","wine","beer"
      ];

      // Phase A: minutes + excludes + MUST match a "quick meal shape"
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

      // Phase B: minutes + excludes only (broader, but still no sweets/drinks)
      let qb = supabase
        .from("recipes")
        .select("id, title, image_url, minutes, created_at")
        .or("minutes.lte.35,minutes.is.null");
      EX.forEach((w) => { qb = qb.not("title", "ilike", `%${w}%`); });

      const phaseB = await run(qb);
      return phaseB.slice(0, 24);
    }

    // GAMEDAY → appetizers/snacks (not big entrées)
    if (topic.includes("gameday")) {
      let q = supabase
        .from("recipes")
        .select("id, title, image_url, created_at");

      // include classic game-day snack words
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

      // gently avoid obvious entrées
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
