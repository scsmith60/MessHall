// WHAT: one tiny door to talk to your Supabase database.
// HOW TO USE: put your keys in .env and call supabase.from('recipes')...

import 'react-native-url-polyfill/auto'; // helps fetch/URL in RN
import { createClient } from '@supabase/supabase-js';
import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ⚠️ put these in your app secrets, not hard-coded:
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    // 👶 These 3 make the app remember you
    storage: AsyncStorage,          // <— NEW: keep session in device storage
    persistSession: true,           // keep you logged in
    autoRefreshToken: true,         // refresh tokens automatically
    detectSessionInUrl: false       // RN apps don't use URL callbacks
  }
});
