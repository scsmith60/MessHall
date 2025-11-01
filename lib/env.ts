// /lib/env.ts
// LIKE I'M 5: this file grabs secret keys from .env so other files don't have to.
// We prefer EXPO_PUBLIC_ variable for Expo apps.

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
}