// lib/cart/providers.ts
// LIKE I'M 5:
// - "Providers" are stores (Amazon, Walmart, …).
// - We ask each provider for suggestions (brands/sizes).
// - We can later "addToCart" (stub for now).

import { supabase } from "@/lib/supabase";
import { MINI_CATALOG, toStoreQuantity } from "./catalog";

export type ProviderId = "amazon" | "walmart" | "kroger" | "heb";

export type CartItem = {
  name: string;
  quantity?: string;
  category?: string;
};

export type SuggestionCandidate = {
  id: string;             // for UI list
  title: string;          // "Large Eggs"
  variant?: string;       // "12 count"
  storeProductId: string; // ASIN/SKU/UPC/etc.
  quantity?: string;      // converted qty (e.g., "5 lb bag")
  source: "catalog" | "search";
};

export type SuggestionSet = {
  itemName: string;       // "eggs"
  quantity?: string;      // "4" → or "5 lb bag"
  candidates: SuggestionCandidate[];
  selectedIndex: number;  // which candidate we picked first
};

export type ICartProvider = {
  id: ProviderId;
  label: string;
  isConnected: (userId: string) => Promise<boolean>;
  connect: (userId: string) => Promise<void>;
  suggest: (items: CartItem[], userId: string) => Promise<SuggestionSet[]>;
  addToCart: (selections: SuggestionCandidate[], userId: string) => Promise<void>;
};

// who is connected?
export async function getConnectedProviders(userId: string): Promise<ProviderId[]> {
  const { data } = await supabase
    .from("store_links")
    .select("provider")
    .eq("user_id", userId)
    .eq("is_connected", true);
  return (data || []).map((r: any) => r.provider as ProviderId);
}
export async function setDefaultProvider(userId: string, provider: ProviderId) {
  await supabase.from("store_links").update({ is_default: false }).eq("user_id", userId);
  await supabase.from("store_links").upsert(
    { user_id: userId, provider, is_connected: true, is_default: true } as any,
    { onConflict: "user_id,provider" }
  );
}

function norm(s: string) { return (s || "").toLowerCase().trim(); }

function makeSuggestionSetForProvider(pid: ProviderId, items: CartItem[]): SuggestionSet[] {
  const pickKey: keyof (typeof MINI_CATALOG)[string][number] =
    pid === "amazon" ? "amazonAsin" :
    pid === "walmart" ? "walmartId" :
    pid === "kroger"  ? "krogerUpc"  : "hebSku";

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

    // fallback → simple "search" candidate (still cycles if more later)
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
      selectedIndex: 0, // default pick is first one
    });
  });
  return out;
}

function stubProvider(id: ProviderId, label: string): ICartProvider {
  return {
    id, label,
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
      // Real API call goes here per store.
      console.log(`[${label}] addToCart`, selections);
      await new Promise(r => setTimeout(r, 400));
    },
  };
}

const registry: Record<ProviderId, ICartProvider> = {
  amazon: stubProvider("amazon", "Amazon"),
  walmart: stubProvider("walmart", "Walmart"),
  kroger:  stubProvider("kroger",  "Kroger"),
  heb:     stubProvider("heb",     "H-E-B"),
};
export function getProviderRegistry() { return registry; }
