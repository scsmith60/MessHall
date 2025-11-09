// /lib/env.ts
// LIKE I'M 5: this file grabs secret keys from .env so other files don't have to.
// We prefer EXPO_PUBLIC_ variable for Expo apps.

import type { ProviderId } from "./cart/providers";

export const USDA_API_KEY =
  process.env.EXPO_PUBLIC_USDA_FDC_API_KEY ||
  process.env.USDA_FDC_API_KEY || // fallback if you used a different name
  "";

// Friendly console hint so you notice if it's missing.
if (!USDA_API_KEY) {
  console.warn(
    "[nutrition] USDA API key is missing. Add EXPO_PUBLIC_USDA_FDC_API_KEY to your .env"
  );
}

// Stripe publishable key for React Native Stripe SDK
export const STRIPE_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

if (!STRIPE_PUBLISHABLE_KEY) {
  console.warn(
    "[stripe] Stripe publishable key is missing. Add EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY to your .env"
  );
} else if (STRIPE_PUBLISHABLE_KEY.startsWith("sk_")) {
  console.error(
    "[stripe] ERROR: You are using a SECRET key instead of a PUBLISHABLE key!\n" +
      "Secret keys start with 'sk_' and should NEVER be used in client-side code.\n" +
      "Publishable keys start with 'pk_' and are safe for client-side use.\n" +
      "Get your publishable key from: https://dashboard.stripe.com/apikeys\n" +
      "Update EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY in your .env file."
  );
  // Clear the invalid key to prevent it from being used
  throw new Error(
    "Invalid Stripe key: Secret key detected. Use a publishable key (pk_...) instead."
  );
} else if (!STRIPE_PUBLISHABLE_KEY.startsWith("pk_")) {
  console.warn(
    "[stripe] Warning: Stripe key doesn't start with 'pk_'. Make sure you're using a publishable key from https://dashboard.stripe.com/apikeys"
  );
}

// Store connect flags (per retailer)
const toBool = (value?: string | null) => {
  if (!value) return false;
  if (value === "1") return true;
  return value.toLowerCase() === "true";
};

export const STORE_CONNECT_READY: Record<ProviderId, boolean> = {
  amazon: toBool(process.env.EXPO_PUBLIC_STORE_CONNECT_AMAZON_READY),
  walmart: toBool(process.env.EXPO_PUBLIC_STORE_CONNECT_WALMART_READY),
  kroger: toBool(process.env.EXPO_PUBLIC_STORE_CONNECT_KROGER_READY),
  heb: toBool(process.env.EXPO_PUBLIC_STORE_CONNECT_HEB_READY),
  albertsons: toBool(process.env.EXPO_PUBLIC_STORE_CONNECT_ALBERTSONS_READY),
} as const;

const lockedStores = Object.entries(STORE_CONNECT_READY)
  .filter(([, ready]) => !ready)
  .map(([store]) => store);

if (lockedStores.length === Object.keys(STORE_CONNECT_READY).length) {
  console.warn(
    "[cart] Store connect is disabled until you set EXPO_PUBLIC_STORE_CONNECT_<STORE>_READY=1 for at least one store."
  );
} else if (lockedStores.length > 0) {
  console.warn(
    `[cart] Locked stores: ${lockedStores.join(
      ", "
    )}. Flip EXPO_PUBLIC_STORE_CONNECT_<STORE>_READY=1 when each API key is installed.`
  );
}

// Cloudflare Stream (server-side only - used in edge functions)
// Note: These should be in Supabase secrets, not client .env
// Added here for reference but won't be available in client
