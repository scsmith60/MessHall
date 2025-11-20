// lib/cart/providers.ts
// LIKE I'M 5: these are our "store helpers" (Walmart, Amazon, Kroger, H-E-B, Albertsons, Instacart, DoorDash).
// - suggest(): shows brand/size choices (from our mini catalog)
// - addToCart(): talks to our server function (cart-add). Server may give us a link to open.
// - isConnected/connect(): reads/writes your store_links table

import { supabase } from "@/lib/supabase";
import { MINI_CATALOG, toStoreQuantity } from "./catalog";

export type ProviderId = "amazon" | "walmart" | "kroger" | "heb" | "albertsons" | "instacart" | "doordash";

export type CartItem = {
  name: string;
  quantity?: string;
  category?: string;
};

export type SuggestionCandidate = {
  id: string;             // little ID for UI
  title: string;          // "Large Eggs"
  variant?: string;       // "12 count"
  storeProductId: string; // ASIN/SKU/UPC/etc.
  quantity?: string;      // converted qty (like "5 lb bag")
  source: "catalog" | "search";
};

export type SuggestionSet = {
  itemName: string;       // "eggs"
  quantity?: string;      // "4" or "5 lb bag"
  candidates: SuggestionCandidate[];
  selectedIndex: number;  // which we picked first
};

// Server may also return a link to open after add-to-cart
export type AddToCartResult = {
  ok: boolean;
  redirectUrl?: string;
};

export type ICartProvider = {
  id: ProviderId;
  label: string;
  isConnected: (userId: string) => Promise<boolean>;
  connect: (userId: string) => Promise<void>;
  suggest: (items: CartItem[], userId: string) => Promise<SuggestionSet[]>;
  // Returns AddToCartResult so caller can open redirectUrl if present
  addToCart: (selections: SuggestionCandidate[], userId: string) => Promise<AddToCartResult>;
};

// Which stores are connected for this user?
export async function getConnectedProviders(userId: string): Promise<ProviderId[]> {
  const { data } = await supabase
    .from("store_links")
    .select("provider")
    .eq("user_id", userId)
    .eq("is_connected", true);
  return (data || []).map((r: any) => r.provider as ProviderId);
}

// Set a default store (we zero out current default and upsert)
export async function setDefaultProvider(userId: string, provider: ProviderId) {
  await supabase.from("store_links").update({ is_default: false }).eq("user_id", userId);
  await supabase.from("store_links").upsert(
    { user_id: userId, provider, is_connected: true, is_default: true } as any,
    { onConflict: "user_id,provider" }
  );
}

// tiny helper to normalize text
function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

// Query database for product suggestions (owner-managed)
async function getSuggestionsFromDB(ingredientName: string, store: ProviderId): Promise<SuggestionCandidate[]> {
  try {
    const normalized = norm(ingredientName);
    
    // Query database for suggestions, ordered by priority and default status
    const { data, error } = await supabase
      .from("product_suggestions")
      .select("*")
      .eq("ingredient_name", normalized)
      .eq("store", store)
      .order("is_default", { ascending: false })
      .order("priority", { ascending: false })
      .limit(5);

    if (error || !data || data.length === 0) {
      return [];
    }

    // Convert database rows to SuggestionCandidate format
    return data.map((row, idx) => ({
      id: `${store}-${normalized}-${idx}`,
      title: row.product_title,
      variant: row.variant || undefined,
      storeProductId: row.product_id,
      quantity: undefined, // Will be set by toStoreQuantity later
      source: "catalog" as const,
    }));
  } catch (error) {
    console.warn("[getSuggestionsFromDB] Error:", error);
    return [];
  }
}

// make suggestion lists based on database (with fallback to hardcoded catalog)
async function makeSuggestionSetForProvider(pid: ProviderId, items: CartItem[]): Promise<SuggestionSet[]> {
  const out: SuggestionSet[] = [];
  
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const normalizedName = norm(it.name);
    
    // Try database first (owner-managed suggestions)
    let candidates: SuggestionCandidate[] = await getSuggestionsFromDB(normalizedName, pid);
    
    // Fallback to hardcoded catalog if database has no results
    if (candidates.length === 0) {
      const pickKey: keyof (typeof MINI_CATALOG)[string][number] =
        pid === "amazon" ? "amazonAsin" :
        pid === "walmart" ? "walmartId" :
        pid === "kroger"  ? "krogerUpc"  :
        pid === "heb"     ? "hebSku"     :
        pid === "albertsons" ? "albertsonsSku" :
        pid === "instacart" ? "instacartId" :
        pid === "doordash" ? "doordashId" :
        "amazonAsin"; // fallback

      const key = Object.keys(MINI_CATALOG).find(k => normalizedName.includes(k));
      const catalogHits = key ? (MINI_CATALOG as any)[key] as any[] : [];

      for (const hit of catalogHits) {
        const storeId = hit[pickKey];
        if (!storeId) continue;
        candidates.push({
          id: `${pid}-${idx}-${candidates.length}`,
          title: hit.title,
          variant: hit.variant,
          storeProductId: String(storeId),
          quantity: toStoreQuantity(it.quantity, it.name),
          source: "catalog",
        });
      }
    } else {
      // Apply quantity conversion to database suggestions
      candidates = candidates.map(c => ({
        ...c,
        quantity: toStoreQuantity(it.quantity, it.name),
      }));
    }

    // Final fallback -> simple "search" candidate (so you can still cycle + send)
    if (candidates.length === 0) {
      candidates.push({
        id: `${pid}-${idx}-0`,
        title: it.name,
        variant: it.category,
        storeProductId: normalizedName,
        quantity: toStoreQuantity(it.quantity, it.name),
        source: "search",
      });
    }

    out.push({
      itemName: it.name,
      quantity: toStoreQuantity(it.quantity, it.name),
      candidates,
      selectedIndex: 0,
    });
  }
  
  return out;
}

// Call our secure server function (Supabase Edge Function) to add things to a cart
async function serverAddToCart(provider: ProviderId, selections: SuggestionCandidate[]): Promise<AddToCartResult> {
  // LIKE I'M 5: we hand our picks to the server, the server talks to Walmart/Amazon/etc.
  // This keeps your secret keys secret.
  const { data, error } = await supabase.functions.invoke("cart-add", {
    body: { provider, selections },
  });
  if (error) throw error;
  // ensure a consistent shape
  return { ok: !!data?.ok, redirectUrl: data?.redirectUrl };
}

function stubProvider(id: ProviderId, label: string): ICartProvider {
  return {
    id,
    label,
    isConnected: async (userId) => {
      const { data } = await supabase
        .from("store_links")
        .select("is_connected")
        .eq("user_id", userId)
        .eq("provider", id)
        .maybeSingle();
      return !!data?.is_connected;
    },
    connect: async (userId) => {
      await supabase.from("store_links").upsert(
        { user_id: userId, provider: id, is_connected: true } as any,
        { onConflict: "user_id,provider" }
      );
    },
    suggest: async (items, _userId) => await makeSuggestionSetForProvider(id, items),
    addToCart: async (selections, _userId) => {
      // Send to server and bubble the server response back to the caller (UI)
      return await serverAddToCart(id, selections);
    },
  };
}

// our "phone book" of providers
const registry: Record<ProviderId, ICartProvider> = {
  amazon:     stubProvider("amazon", "Amazon"),
  walmart:    stubProvider("walmart", "Walmart"),
  kroger:     stubProvider("kroger",  "Kroger"),
  heb:        stubProvider("heb",     "H-E-B"),
  albertsons: stubProvider("albertsons", "Albertsons"),
  instacart:  stubProvider("instacart", "Instacart"),
  doordash:   stubProvider("doordash", "DoorDash"),
};

// export a getter to avoid accidental mutation
export function getProviderRegistry() {
  return registry;
}
