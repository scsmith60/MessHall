// lib/cart/providers.ts
// LIKE I'M 5: these are our "store helpers" (Walmart, Amazon, Kroger, H-E-B, Albertsons).
// - suggest(): shows brand/size choices (for now from our mini catalog)
// - addToCart(): calls our server function to do the real API magic safely
// - isConnected/connect(): reads/writes your store_links table

import { supabase } from "@/lib/supabase";
import { MINI_CATALOG, toStoreQuantity } from "./catalog";

export type ProviderId = "amazon" | "walmart" | "kroger" | "heb" | "albertsons";

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

export type ICartProvider = {
  id: ProviderId;
  label: string;
  isConnected: (userId: string) => Promise<boolean>;
  connect: (userId: string) => Promise<void>;
  suggest: (items: CartItem[], userId: string) => Promise<SuggestionSet[]>;
  addToCart: (selections: SuggestionCandidate[], userId: string) => Promise<void>;
};

// 🔎 which stores are connected for this user?
export async function getConnectedProviders(userId: string): Promise<ProviderId[]> {
  const { data } = await supabase
    .from("store_links")
    .select("provider")
    .eq("user_id", userId)
    .eq("is_connected", true);
  return (data || []).map((r: any) => r.provider as ProviderId);
}

// ⭐ set a default store (we zero out current default and upsert)
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

// make suggestion lists based on our tiny catalog (safe + local)
function makeSuggestionSetForProvider(pid: ProviderId, items: CartItem[]): SuggestionSet[] {
  // pick the right catalog key per store
  const pickKey: keyof (typeof MINI_CATALOG)[string][number] =
    pid === "amazon" ? "amazonAsin" :
    pid === "walmart" ? "walmartId" :
    pid === "kroger"  ? "krogerUpc"  :
    pid === "heb"     ? "hebSku"     : "albertsonsSku";

  const out: SuggestionSet[] = [];
  items.forEach((it, idx) => {
    const key = Object.keys(MINI_CATALOG).find(k => norm(it.name).includes(k));
    const catalogHits = key ? (MINI_CATALOG as any)[key] as any[] : [];

    const candidates: SuggestionCandidate[] = [];
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

    // fallback → simple "search" candidate (so you can still cycle + send)
    if (candidates.length === 0) {
      candidates.push({
        id: `${pid}-${idx}-0`,
        title: it.name,
        variant: it.category,
        storeProductId: norm(it.name),
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
  });
  return out;
}

// call our secure server function (Supabase Edge Function) to add things to a cart
async function serverAddToCart(provider: ProviderId, selections: SuggestionCandidate[]) {
  // LIKE I'M 5: we hand our picks to the server, the server talks to Walmart/Amazon/etc.
  // This keeps your secret keys secret. If you use Cloudflare Workers instead, see section 4.
  const { error } = await supabase.functions.invoke("cart-add", {
    body: { provider, selections },
  });
  if (error) throw error;
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
    suggest: async (items, _userId) => makeSuggestionSetForProvider(id, items),
    addToCart: async (selections, _userId) => {
      // 🔐 send to server (right now stubbed function will just log/echo)
      await serverAddToCart(id, selections);
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
};

// export a getter to avoid accidental mutation
export function getProviderRegistry() {
  return registry;
}
