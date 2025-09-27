// app/_layout.tsx
//
// LIKE I'M 5:
// This is the boss wrapper. It watches the "login light" from Supabase.
// We do 3 baby-simple rules:
//   A) When the app wakes up, if there is NO session -> go to /login
//   B) If Supabase yells "SIGNED_OUT" -> go to /logout
//   C) If Supabase yells "SIGNED_IN" and we're on auth screens -> go to /(tabs)
//
// SUPER IMPORTANT CHANGE:
// - We do NOT cover the whole app with a big spinner anymore.
// - We always render <Slot/> so children can redirect right away.
// - If we are loading, we show a tiny spinner *overlay* instead.

import React, { useEffect, useMemo, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Slot, usePathname, useRouter } from "expo-router";
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

// 🎨 quick colors
const COLORS = { bg: "#0b1220" };

// 🧸 helper: am I at an auth route?
function useInAuthFlow() {
  const pathname = usePathname() || "";
  return useMemo(
    () =>
      pathname.startsWith("/login") ||
      pathname.startsWith("/sign-in") ||
      pathname.startsWith("/signup") ||
      pathname.startsWith("/(auth)") ||
      pathname === "/logout" ||
      pathname === "/logout-complete",
    [pathname]
  );
}

function InnerApp() {
  // 🔌 read global auth lights
  const { loading, isLoggedIn } = useAuth();

  // ✅ ALWAYS render the app tree so children can redirect.
  //    (We only add a tiny spinner overlay if loading.)
  const content = (
    <>
      <StatusBar style="light" />
      <Slot />
      {loading && (
        // 🌟 teeny overlay spinner so you see "thinking", but it doesn't block navigation
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator />
        </View>
      )}
    </>
  );

  // 🧱 Only show the tutorial gate AFTER login so it never covers auth screens
  return isLoggedIn ? <Gate>{content}</Gate> : content;
}

export default function RootLayout() {
  const router = useRouter();
  const inAuthFlow = useInAuthFlow();
  const [checkedOnce, setCheckedOnce] = useState(false);

  // 🚀 On first mount, peek session.
  // If there is NO session and we are NOT already on an auth screen -> go to /login
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const hasSession = !!data?.session;
        if (!hasSession && !inAuthFlow) {
          // go straight to login so we don't sit on any spinners
          router.replace("/login");
        }
      } finally {
        if (alive) setCheckedOnce(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, inAuthFlow]);

  // 📡 Watch live auth state changes.
  // - SIGNED_OUT  -> go to /logout (cleans up + then /logout-complete)
  // - SIGNED_IN   -> if you’re staring at auth screens, push you into the app
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        requestAnimationFrame(() => router.replace("/logout"));
      }
      if (event === "SIGNED_IN") {
        // if we are on login/signup screens, hop into the app
        if (inAuthFlow) {
          requestAnimationFrame(() => router.replace("/(tabs)"));
        }
      }
    });
    return () => data.subscription?.unsubscribe();
  }, [router, inAuthFlow]);

  // 🧯 Safety valve:
  // If we haven't done our first check yet, show a very small neutral shell.
  // (This renders only for a blink; we still don't block redirects.)
  if (!checkedOnce) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <AuthProvider>
          <View style={{ flex: 1 }} />
        </AuthProvider>
      </GestureHandlerRootView>
    );
  }

  // ✅ Normal path
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <InnerApp />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
