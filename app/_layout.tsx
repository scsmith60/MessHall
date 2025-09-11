// app/_layout.tsx
// like I'm 5: this file is the "doorman" for your whole app.
// - It sets up the app (gestures, colors, safe space at the top).
// - It also checks "Are you signed in?"
//    - If YES: you can go to tabs OR any extra rooms like /recipe/123.
//    - If NO: go to the sign-in screen (/(auth)/sign-in).
// Before: it pushed you back to tabs even when you wanted /recipe/123.
// After: it lets you go to non-tab screens when signed in. 🎉

import "../lib/polyfills";

// 🧰 React pieces we need
import React, { useEffect, useState } from "react";

// 🚪 Expo Router: helps us move between screen groups like (auth) and (tabs)
import { Slot, useRouter, useSegments } from "expo-router";

// 👉 Gestures and basic phone UI bits
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  ActivityIndicator, // a little spinner while we check login
  SafeAreaView,
  StatusBar,
  View,
} from "react-native";

// 🎨 Your theme colors
import { COLORS } from "../lib/theme";

// 🔐 Your AuthProvider wrapper
import { AuthProvider } from "../lib/auth";

// 🧭 Supabase client to check the session (logged in or not)
import { supabase } from "../lib/supabase";

/* ---------------------------
   A tiny helper: useAuthGate()
   ---------------------------
   like I'm 5:
   - We peek at where we are (segments): "(auth)/..." or "(tabs)/..." or maybe "recipe/..."
   - We ask Supabase: "Do we have a session?" (Are we signed in?)
   - If NOT signed in and NOT in (auth), we send you to sign-in.
   - If signed in and stuck in (auth) OR at the empty root, we send you into the app tabs.
   - Otherwise, we do nothing so routes like /recipe/[id] can load normally.
*/
function useAuthGate() {
  const router = useRouter();
  const segments = useSegments(); // e.g., ["(tabs)", "index"] or ["recipe", "123"] or ["(auth)", "sign-in"]

  const [ready, setReady] = useState(false); // did we finish checking?
  const [signedIn, setSignedIn] = useState<boolean | null>(null); // are we signed in?

  // Step 1: on start, ask Supabase for the current session
  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSignedIn(!!data.session);
      setReady(true);
    });

    // Step 2: keep watching for login/logout changes while app is open
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Step 3: when we know signedIn + where we are, decide where to go
  useEffect(() => {
    if (!ready || signedIn === null) return;

    const first = segments[0]; // "(auth)" or "(tabs)" or "recipe" or undefined (root)
    const inAuth = first === "(auth)";
    const inTabs = first === "(tabs)";
    const atRoot = first === undefined; // no group yet (e.g., app just opened at "/")

    if (!signedIn) {
      // Not signed in → always go to sign-in (unless already in (auth))
      if (!inAuth) {
        router.replace("/(auth)/sign-in");
      }
      return;
    }

    // Signed in:
    // - If they're in (auth) → push them into the app tabs.
    // - If they're at root (no group) → push them into the app tabs.
    // - Otherwise, LET THEM BE (so /recipe/[id], /public-profile/[id], etc. work).
    if (inAuth || atRoot) {
      router.replace("/(tabs)");
    }
    // Note: we do NOT redirect when !inTabs anymore — that was the bug.
  }, [ready, signedIn, segments, router]);

  return { ready, signedIn };
}

export default function RootLayout() {
  // 🛎️ Turn on the doorman
  const { ready } = useAuthGate();

  // ⏳ While we check "are you signed in?" show a tiny spinner (no screen flash)
  if (!ready) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={{ flex: 1 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: COLORS.bg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator />
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    );
  }

  // ✅ All good: render the rest of the app. The "gate" above decides which group is visible.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <AuthProvider>
          <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
            {/* Slot = "show the right page here" */}
            <Slot />
          </View>
        </AuthProvider>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
