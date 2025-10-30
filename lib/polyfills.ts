// lib/polyfills.ts
// 👶 teach React Native how to handle URLs + random values (needed by Supabase)
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
// Provide WebCrypto (crypto.subtle) for PKCE code challenge on React Native
// Requires: yarn add react-native-webcrypto
try {
  // Dynamically load so the app still bundles if the package isn't installed yet
  require('react-native-webcrypto');
} catch {
  // Will fall back to PKCE "plain". Install `react-native-webcrypto` for SHA-256.
}
