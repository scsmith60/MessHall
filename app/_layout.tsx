// app/_layout.tsx
//
// LIKE I'M 5:
// - This is the big box that wraps the whole app.
// - If the "login light" is waking up, we show a tiny spinner.
// - If you are logged in, we show the tutorial; if not, we just show screens.
// - NEW: if Supabase says "SIGNED_OUT", we jump to /logout right away.

import React from "react";
import { View, ActivityIndicator } from "react-native";
import { useEffect } from "react";
import { Slot, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { supabase } from "../lib/supabase";

// ✅ your auth provider/hooks at project root
import { AuthProvider, useAuth } from "../lib/auth";

// ✅ optional tutorial overlay; if missing, we no-op
import * as TutorialOverlay from "../components/TutorialOverlay";
const Gate =
  ((TutorialOverlay as any).TutorialOverlayGate ??
    (TutorialOverlay as any).default ??
    (({ children }: any) => <>{children}</>)) as React.ComponentType<any>;

// ✅ theme (try to use your constants; fallback keeps old green)
let THEME_GREEN = "#22c55e";
try {
  // if you have constants/theme.ts exporting { colors: { green: string } }
  // @ts-ignore
  const theme = require("../constants/theme");
  if (theme?.colors?.green) THEME_GREEN = theme.colors.green;
} catch {}

const COLORS = { bg: "#0b1220", green: THEME_GREEN };

function Inner() {
  // read auth state provided by <AuthProvider/>
  const { loading, isLoggedIn } = useAuth();

  // ⏳ show a tiny spinner while auth wakes up
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <StatusBar style="light" />
      </View>
    );
  }

  // ⬇️ tutorial gate only after login so it never covers the auth screens
  const content = (
    <>
      <StatusBar style="light" />
      <Slot />
    </>
  );

  return isLoggedIn ? <Gate>{content}</Gate> : content;
}

export default function RootLayout() {
  const router = useRouter();

  // 🚨 NEW: global auth watcher at the ROOT of the app.
  // If Supabase tells us "SIGNED_OUT", we immediately leave to /logout.
  // This runs above Tabs, so Tabs' spinner can’t trap us.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        // wait 1 frame so any closing animations start, then hard replace
        requestAnimationFrame(() => router.replace("/logout")); // NOTE: (auth) is a group; the route is /logout
      }
      // If you want to force-home after login, you can uncomment this:
      // if (event === "SIGNED_IN") requestAnimationFrame(() => router.replace("/"));
    });
    return () => data.subscription?.unsubscribe();
  }, [router]);

  return (
    // 👇 keeps gesture handlers happy app-wide
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <Inner />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
