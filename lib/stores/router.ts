// like I'm 5: this box knows how to talk to each store.
// later we will plug real APIs (Kroger OAuth, Walmart deep links, etc.)

import type { StoreKey } from "../shop/shopBrain";
import type { IngredientLite } from "../shop/shopBrain";

export function makeStoreRouter() {
  return {
    async sendToStore(
      store: StoreKey,
      userId: string,
      items: IngredientLite[]
    ) {
      // V1 demo logic:
      // - if store === "kroger": pretend we need auth the first time
      // - if store === "walmart": pretend we return a redirect URL to a deep link
      // - others: fallback for now

      if (store === "kroger") {
        // later: check supabase store_tokens and call our backend → Kroger Cart API
        const needsAuth = true; // pretend
        if (needsAuth) return { kind: "needsAuth", url: "https://your.api/oauth/kroger/start" } as const;
        return { kind: "success", message: "Kroger cart updated!" } as const;
      }

      if (store === "albertsons") {
        return { kind: "fallback" } as const; // add real deep link later
      }

      if (store === "walmart") {
        // later: build an affiliate Add-To-Cart link with SKUs
        return { kind: "redirect", url: "https://your.api/walmart/atc?items=demo" } as const;
      }

      // amazon/heb → fallback until we implement
      return { kind: "fallback" } as const;
    },
  };
}
