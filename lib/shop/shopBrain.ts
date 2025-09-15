// like I'm 5: one tiny brain decides what happens when user taps "Add to Cart" on a recipe.

import { SupabaseClient } from "@supabase/supabase-js";

export type StoreKey = "walmart" | "kroger" | "amazon" | "heb" | "albertsons";

export type UserPrefs = {
  walmart_enabled: boolean;
  kroger_enabled: boolean;
  amazon_enabled: boolean;
  heb_enabled: boolean;
  albertsons_enabled: boolean; // 👈 optional column for future use
  default_store: StoreKey | null;
};

export type IngredientLite = { id: string; name: string; quantity?: string };

export async function getEnabledStores(sb: SupabaseClient, userId: string): Promise<StoreKey[]> {
  const { data } = await sb
    .from("user_store_prefs")
    .select("walmart_enabled, kroger_enabled, amazon_enabled, heb_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return [];
  const picks: StoreKey[] = [];
  if (data.kroger_enabled) picks.push("kroger");
  if (data.walmart_enabled) picks.push("walmart");
  if (data.amazon_enabled) picks.push("amazon");
  if (data.heb_enabled) picks.push("heb");
  return picks;
}

// make (or find) user's current shopping list
export async function ensureShoppingList(sb: SupabaseClient, userId: string) {
  // find one
  let { data: list } = await sb
    .from("shopping_lists")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!list) {
    const { data: created } = await sb
      .from("shopping_lists")
      .insert({ user_id: userId, title: "My Shopping List" })
      .select("id")
      .single();
    list = created!;
  }
  return list.id as string;
}

export async function addItemsToShoppingList(
  sb: SupabaseClient,
  listId: string,
  items: IngredientLite[]
) {
  const rows = items.map((i) => ({
    list_id: listId,
    ingredient: i.name,
    quantity: i.quantity ?? null,
  }));
  await sb.from("shopping_list_items").insert(rows);
}

export type StoreRouter = {
  // send items straight to a store (kroger/walmart/amazon/heb)
  sendToStore: (store: StoreKey, userId: string, items: IngredientLite[]) => Promise<
    | { kind: "success"; message?: string }
    | { kind: "redirect"; url: string }
    | { kind: "needsAuth"; url: string }
    | { kind: "fallback" }
  >;
};

// core decision function called by UI
export async function decideAddToCartFlow(
  sb: SupabaseClient,
  userId: string,
  checkedItems: IngredientLite[],
  router: StoreRouter
): Promise<
  | { mode: "auto_shopping_list"; listId: string }                 // no stores → we stored
  | { mode: "needs_choice"; enabledStores: StoreKey[] }            // one+ stores → show chooser sheet
> {
  const enabled = await getEnabledStores(sb, userId);

  // no stores → always shopping list
  if (enabled.length === 0) {
    const listId = await ensureShoppingList(sb, userId);
    await addItemsToShoppingList(sb, listId, checkedItems);
    return { mode: "auto_shopping_list", listId };
  }

  // one store → user picks: that store OR shopping list
  // many stores → user picks from list + shopping list
  return { mode: "needs_choice", enabledStores: enabled };
}

export async function applyChoice(
  sb: SupabaseClient,
  choice: StoreKey | "shopping_list",
  userId: string,
  items: IngredientLite[],
  router: StoreRouter
) {
  if (choice === "shopping_list") {
    const listId = await ensureShoppingList(sb, userId);
    await addItemsToShoppingList(sb, listId, items);
    return { done: "list", listId } as const;
  }
  // try to send to store cart now
  const res = await router.sendToStore(choice, userId, items);
  return { done: "store", result: res, store: choice } as const;
}
