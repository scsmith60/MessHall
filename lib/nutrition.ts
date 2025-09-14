// lib/nutrition.ts
// LIKE I'M 5:
//
// WHAT THIS FILE DOES:
// - First, we ask your SERVER helper (edge function `fdc_calculate`) to fill calories/macros.
//   -> It reads ingredients, talks to USDA with your secret key, saves kcal/grams/macros,
//      then a DB function updates the recipe totals. Fast & reliable.
// - If the server can't help (no key / offline), we FALL BACK to a tiny client calculator
//   that only computes calories when we already know grams for each ingredient.
// - We NEVER overwrite recipe totals with 0 if we couldn't compute anything.
// - We give you a hook `useRecipeCalories(recipeId)` that: read cached → try server → fallback client → show pill.
//
// TABLES WE TOUCH:
// - recipes: calories_total (number), calories_per_serving (number), servings (number?)
// - recipe_ingredients: food_name (text), grams (number), fdc_id (number), kcal (number), last_calculated_at (timestamptz)

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";

/* -----------------------------------------------------------
   ENV: find your USDA key in common places (any one works)
----------------------------------------------------------- */
function getFdcApiKey(): string | null {
  const fromEnv =
    process.env.EXPO_PUBLIC_USDA_FDC_API_KEY ||
    process.env.EXPO_PUBLIC_FDC_API_KEY ||
    process.env.FDC_API_KEY ||
    (Constants?.expoConfig as any)?.extra?.USDA_FDC_API_KEY ||
    (Constants as any)?.manifest?.extra?.USDA_FDC_API_KEY;
  return fromEnv || null;
}

/* -----------------------------------------------------------
   SERVER PATH: call your edge function `fdc_calculate`
   We pass { recipeId }, server fills rows + runs your RPC,
   and returns { ok: true } on success.
----------------------------------------------------------- */
export async function invokeServerNutrition(recipeId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke("fdc_calculate", {
      body: { recipeId },
    });
    if (error) {
      console.warn("[fdc_calculate] error", error.message || error);
      return false;
    }
    return !!(data as any)?.ok;
  } catch (e: any) {
    console.warn("[fdc_calculate] threw", e?.message || e);
    return false;
  }
}

/* -----------------------------------------------------------
   CLIENT FALLBACK: tiny USDA fetchers (kcal only)
   Only used when server couldn't help.
----------------------------------------------------------- */
const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const ENERGY_ID = 1008; // Energy (kcal)
const STALE_DAYS = 30;  // refresh after 30 days

function isStale(iso: string | null | undefined): boolean {
  if (!iso) return true;
  const then = new Date(iso).getTime();
  const ageDays = (Date.now() - then) / (1000 * 60 * 60 * 24);
  return ageDays > STALE_DAYS;
}

// pull kcal/100g from a FDC "food" object
function extractKcalPer100g(food: any): number | null {
  const nutrients: any[] = food?.foodNutrients || [];

  // prefer nutrient id 1008 "Energy" in kcal
  for (const n of nutrients) {
    const id = Number(n?.nutrient?.number || n?.nutrientId);
    const name = String(n?.nutrient?.name || "").trim().toLowerCase();
    const unit = String(n?.nutrient?.unitName || n?.unitName || "").toLowerCase();
    const amount = Number(n?.amount);
    if ((id === ENERGY_ID || name === "energy") && !Number.isNaN(amount)) {
      if (unit === "kcal" || unit === "cal" || unit === "kcalorie") return amount;
      if (unit === "kj") return amount / 4.184; // convert kJ → kcal
    }
  }

  // branded fallback: use labelNutrients + servingSize(g) → normalize per 100 g
  const ln = food?.labelNutrients;
  const ss = food?.servingSize;
  const su = String(food?.servingSizeUnit || "").toLowerCase();
  if (ln?.calories?.value && typeof ss === "number" && su.startsWith("g")) {
    const per100 = (Number(ln.calories.value) / ss) * 100;
    if (per100 > 0) return per100;
  }

  return null;
}

async function fetchKcalPer100g(fdcId: number, apiKey: string): Promise<number | null> {
  const url = `${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const food = await res.json();
  return extractKcalPer100g(food);
}

async function searchFdcIdByName(query: string, apiKey: string): Promise<number | null> {
  const url = `${FDC_BASE}/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(
    query
  )}&pageSize=5`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const foods: any[] = Array.isArray(data?.foods) ? data.foods : [];
  if (!foods.length) return null;

  // prefer non-branded (Foundation/SR/Survey)
  foods.sort((a, b) => {
    const p = (t: string) => (/(SR|Survey|Foundation)/i.test(t) ? 0 : 1);
    return p(a?.dataType || "") - p(b?.dataType || "");
  });

  return foods[0]?.fdcId ? Number(foods[0].fdcId) : null;
}

// compute kcal for ONE ingredient (only if grams is known)
async function ensureIngredientKcal(row: any, apiKey: string): Promise<number> {
  const grams = Number(row?.grams) || 0;
  if (grams <= 0) return 0; // we don't guess here; server does that

  // reuse fresh cache
  if (row?.kcal != null && !isNaN(Number(row.kcal)) && !isStale(row?.last_calculated_at)) {
    return Number(row.kcal);
  }

  // resolve fdc id
  let fdcId: number | null = row?.fdc_id ? Number(row.fdc_id) : null;
  if (!fdcId) {
    const name = String(row?.food_name || "").trim();
    if (!name) return 0;
    fdcId = await searchFdcIdByName(name, apiKey);
    if (!fdcId) return 0;
  }

  // kcal per 100 g → per row kcal
  const per100 = await fetchKcalPer100g(fdcId, apiKey);
  if (per100 == null || per100 <= 0) return 0;

  const kcal = Math.round((per100 * grams) / 100);

  // save back (so later is instant)
  await supabase
    .from("recipe_ingredients")
    .update({
      fdc_id: fdcId,
      kcal,
      last_calculated_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  return kcal;
}

/* -----------------------------------------------------------
   TOTALS: recompute and write to recipes (client fallback)
----------------------------------------------------------- */
export async function ensureRecipeCalories(recipeId: string): Promise<{ total: number; perServing: number | null }> {
  const apiKey = getFdcApiKey();
  if (!apiKey) {
    // no key — just return what's already saved
    const fallback = await readRecipeCalories(recipeId);
    return { total: fallback.total ?? 0, perServing: fallback.perServing };
  }

  // read servings (optional)
  const { data: recipe, error: recipeErr } = await supabase
    .from("recipes")
    .select("servings")
    .eq("id", recipeId)
    .maybeSingle();
  if (recipeErr) throw recipeErr;

  // read ingredient rows
  const { data: rows, error: rowsErr } = await supabase
    .from("recipe_ingredients")
    .select("id, food_name, grams, fdc_id, kcal, last_calculated_at")
    .eq("recipe_id", recipeId);
  if (rowsErr) throw rowsErr;

  // no rows → don't overwrite with zero
  if (!rows || rows.length === 0) {
    const cached = await readRecipeCalories(recipeId);
    return { total: cached.total ?? 0, perServing: cached.perServing };
  }

  // compute per row (only where grams > 0)
  let total = 0;
  let contributors = 0;
  for (const r of rows) {
    const v = await ensureIngredientKcal(r, apiKey);
    if (v > 0) contributors++;
    total += v;
  }

  // nothing computed → keep existing DB values
  if (contributors === 0) {
    const cached = await readRecipeCalories(recipeId);
    return { total: cached.total ?? 0, perServing: cached.perServing };
  }

  // per-serving only if servings > 0
  const servings = Number(recipe?.servings);
  const perServing = servings > 0 ? Math.round(total / servings) : null;

  // write back to recipe
  await supabase
    .from("recipes")
    .update({
      calories_total: Math.round(total),
      calories_per_serving: perServing,
    })
    .eq("id", recipeId);

  return { total: Math.round(total), perServing };
}

/* -----------------------------------------------------------
   READ: quick look at saved numbers
----------------------------------------------------------- */
export async function readRecipeCalories(
  recipeId: string
): Promise<{ total: number | null; perServing: number | null }> {
  const { data, error } = await supabase
    .from("recipes")
    .select("calories_total, calories_per_serving")
    .eq("id", recipeId)
    .maybeSingle();

  if (error || !data) return { total: null, perServing: null };
  return {
    total: data.calories_total != null ? Number(data.calories_total) : null,
    perServing: data.calories_per_serving != null ? Number(data.calories_per_serving) : null,
  };
}

/* -----------------------------------------------------------
   HOOK: read → server → fallback client → show
----------------------------------------------------------- */
export function useRecipeCalories(
  recipeId: string | undefined
): { loading: boolean; total: number | null; perServing: number | null } {
  const [loading, setLoading] = useState<boolean>(true);
  const [total, setTotal] = useState<number | null>(null);
  const [perServing, setPerServing] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!recipeId) return;

      setLoading(true);

      // 1) show what we have now
      const cached = await readRecipeCalories(recipeId);
      if (!cancelled) {
        setTotal(cached.total);
        setPerServing(cached.perServing);
      }

      // Are we missing / zero?
      const needsWork =
        (cached.total ?? 0) === 0 ||
        cached.total == null ||
        cached.perServing == null ||
        cached.perServing === 0;

      if (!needsWork) {
        if (!cancelled) setLoading(false);
        return;
      }

      // 2) ask the SERVER first (best source of truth)
      const ok = await invokeServerNutrition(recipeId);

      // Re-read after server attempt
      const afterServer = await readRecipeCalories(recipeId);
      if (!cancelled) {
        setTotal(afterServer.total);
        setPerServing(afterServer.perServing);
      }

      const stillZero =
        (afterServer.total ?? 0) === 0 ||
        afterServer.total == null ||
        afterServer.perServing === 0;

      // 3) if still missing/zero, FALL BACK to client USDA (when grams exist)
      if (stillZero) {
        try {
          const fresh = await ensureRecipeCalories(recipeId);
          if (!cancelled) {
            setTotal(fresh.total);
            setPerServing(fresh.perServing);
          }
        } catch (e) {
          // ignore; we already showed something
        }
      }

      if (!cancelled) setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  return { loading, total, perServing };
}

/* =====================================================================
   NEW SECTION — CHIP PERSISTENCE (calories / protein / fat / carbs)
   -----------------------------------------------------------------
   Like I'm 5: We keep your chip numbers safe on the phone so they come
   back after logout/app restart. We save by recipeId.

   ✔ Does NOT touch your existing server/USDA logic above.
   ✔ Lazy-loads AsyncStorage so builds won't break if it's not installed.
   ✔ If AsyncStorage isn't installed yet, we fall back to an in-memory box
     (works while the app is open; install AsyncStorage for true persistence).
===================================================================== */

// 1) Tiny type for the four chips
export type RecipeMacros = {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
};

// defaults when nothing saved yet
const EMPTY_MACROS: RecipeMacros = { calories: null, protein: null, fat: null, carbs: null };

// 2) "Storage-like" shape so we can swap real AsyncStorage or a memory fallback
type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

// simple in-memory fallback (only lasts until app is killed)
const __mem__: Record<string, string> = {};
const MemoryStorage: StorageLike = {
  async getItem(key) {
    return key in __mem__ ? __mem__[key] : null;
  },
  async setItem(key, value) {
    __mem__[key] = value;
  },
  async removeItem(key) {
    delete __mem__[key];
  },
};

// 3) Lazy loader for AsyncStorage so importing this file never crashes
async function getStorage(): Promise<StorageLike> {
  try {
    // This import only runs when you call the macros functions.
    const mod = await import("@react-native-async-storage/async-storage");
    const as = (mod as any)?.default;
    if (as && typeof as.getItem === "function") return as as StorageLike;
  } catch {
    // ignore; we'll just use memory
  }
  return MemoryStorage;
}

// 4) Key helper — one saved record per recipe
function macrosKey(recipeId: string) {
  return `mh:nutrition:macros:${recipeId}`;
}

// 5) Read / Save / Clear helpers
export async function readRecipeMacros(recipeId: string): Promise<RecipeMacros> {
  const storage = await getStorage();
  const raw = await storage.getItem(macrosKey(recipeId));
  if (!raw) return { ...EMPTY_MACROS };
  try {
    const parsed = JSON.parse(raw);
    return { ...EMPTY_MACROS, ...parsed };
  } catch {
    return { ...EMPTY_MACROS };
  }
}

export async function saveRecipeMacros(recipeId: string, macros: RecipeMacros): Promise<void> {
  const storage = await getStorage();
  await storage.setItem(macrosKey(recipeId), JSON.stringify(macros));
}

export async function clearRecipeMacros(recipeId: string): Promise<void> {
  const storage = await getStorage();
  await storage.removeItem(macrosKey(recipeId));
}

// 6) Hook for screens to use the chips easily
export function useRecipeMacros(recipeId: string | undefined) {
  const [macros, setMacros] = useState<RecipeMacros>(EMPTY_MACROS);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!recipeId) return;
        const data = await readRecipeMacros(recipeId);
        if (alive) setMacros(data);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [recipeId]);

  const save = async (next: RecipeMacros) => {
    setMacros(next);
    if (!recipeId) return;
    await saveRecipeMacros(recipeId, next);
  };

  const clear = async () => {
    setMacros(EMPTY_MACROS);
    if (!recipeId) return;
    await clearRecipeMacros(recipeId);
  };

  return { macros, setMacros, save, clear, loading } as const;
}

/* ========================== HOW TO USE (ELI5) ==========================
1) In your Add/Edit Recipe screen:
   import { useRecipeMacros } from "@/lib/nutrition";
   const { macros, setMacros, save: saveMacros } = useRecipeMacros(recipeId);

   // When user edits a chip:
   setMacros({ ...macros, calories: 420 }); // or protein/fat/carbs

   // In your Save button (AFTER saving the recipe to DB):
   await saveMacros(macros); // makes chips stick across logout/restart

2) For true persistence across restarts, install AsyncStorage once:
   npm i @react-native-async-storage/async-storage
   (If you skip this, it still works while the app is open using memory.)
======================================================================== */
