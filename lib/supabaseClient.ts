// lib/supabaseClient.ts
// MessHall — Supabase initialization for Expo/React Native

import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Prefer secure runtime config via app config (EAS secrets → extra)
const extra = (Constants.expoConfig?.extra || Constants.manifest?.extra || {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

// Fallback to process.env if you’ve configured babel plugin or Expo env
const SUPABASE_URL = extra.supabaseUrl || (process.env.EXPO_PUBLIC_SUPABASE_URL as string) || '';
const SUPABASE_ANON_KEY = extra.supabaseAnonKey || (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string) || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] Missing URL or anon key. Set extra.supabaseUrl / extra.supabaseAnonKey in app.json or EXPO_PUBLIC_* env vars.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // handled via deep links, not URL fragments
  },
});

// Optional convenience: expose storage base URL for manual public URL fallback
// @ts-ignore augmenting instance for convenience in RN code paths that need it
(supabase as any).storageUrl = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public` : '';

export type SupabaseClientType = typeof supabase;
