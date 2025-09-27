// app/_layout.tsx
//
// 🧸 ELI5: This is the boss wrapper for MessHall.
// - Watches login status
// - Shows your app screens
// - 🆕 Listens for "shared stuff" from other apps (TikTok, Safari, etc.).
//   When someone shares a link to MessHall, we open the Capture tab with that link.
//
// We use expo-share-intent's hook so the native share extension/intents talk to JS.
// Docs say: add the plugin in config, then read shareIntent in your top component. :contentReference[oaicite:5]{index=5}

import React, { useEffect, useMemo, useState } from "react";
import { View, ActivityIndicator, Platform } from "react-native";
import { Slot, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { supabase } from "../lib/supabase";

// your auth provider/hooks
import { AuthProvider, useAuth } from "../lib/auth";

// (optional) tutorial overlay; if missing, we render children directly
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

/* -----------------------------------------------------------
   🛎️ Push notifications (unchanged)
----------------------------------------------------------- */
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

async function registerForPushToken(): Promise<string | null> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      (Constants as any).expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId ??
      null;

    if (!projectId) return null;

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenResp?.data ?? null;
  } catch {
    return null;
  }
}

/* -----------------------------------------------------------
   🆕 Share Intake via expo-share-intent
   ELI5:
   - We ask the hook if someone just shared something to us.
   - If yes, we grab the first http(s) link.
   - We jump to Capture with ?sharedUrl=thatLink.
   - Then we "reset" so it won't repeat.
   Note: works in dev client / real builds (not Expo Go). :contentReference[oaicite:6]{index=6}
----------------------------------------------------------- */
import { useShareIntent } from "expo-share-intent";

// find a link inside any text
function extractFirstUrl(s?: string | null): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

function InnerApp() {
  const { loading, isLoggedIn } = useAuth();
  const router = useRouter();

  // 👉 read share intent state from native
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntent();

  // when a share arrives, route to Capture with the url
  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;

    // shareIntent.webUrl is already extracted when possible; otherwise check raw text
    const url =
      shareIntent.webUrl ||
      extractFirstUrl(shareIntent.text) ||
      // as a fallback for rich shares, sometimes meta.title contains an url-like string
      extractFirstUrl(shareIntent?.meta?.title as any);

    if (url) {
      // go to Capture and let that screen auto-import
      router.push({ pathname: "/(tabs)/capture", params: { sharedUrl: url } });
    }

    // VERY IMPORTANT: clear the intent so it doesn’t trigger again on re-render
    resetShareIntent();
  }, [hasShareIntent, shareIntent, router, resetShareIntent]);

  const content = (
    <>
      <StatusBar style="light" />
      <Slot />
      {loading && (
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

  const wrapped = isLoggedIn ? <Gate>{content}</Gate> : content;

  // save push token once, after login (unchanged)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isLoggedIn) return;
      const token = await registerForPushToken();
      if (!token || cancelled) return;
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id;
        if (uid) {
          await supabase.from("profiles").update({ push_token: token }).eq("id", uid);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  return wrapped;
}

export default function RootLayout() {
  const router = useRouter();
  const inAuthFlow = useInAuthFlow();
  const [checkedOnce, setCheckedOnce] = useState(false);

  // initial session check (unchanged)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const hasSession = !!data?.session;
        if (!hasSession && !inAuthFlow) {
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

  // auth state changes (unchanged)
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        requestAnimationFrame(() => router.replace("/logout"));
      }
      if (event === "SIGNED_IN") {
        if (inAuthFlow) {
          requestAnimationFrame(() => router.replace("/(tabs)"));
        }
      }
    });
    return () => data.subscription?.unsubscribe();
  }, [router, inAuthFlow]);

  if (!checkedOnce) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <AuthProvider>
          <View style={{ flex: 1 }} />
        </AuthProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <InnerApp />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
