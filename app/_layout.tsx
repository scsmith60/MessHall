// app/_layout.tsx
//
// 🧸 ELI5: This is the boss wrapper for MessHall.
// What we changed now:
// ✅ We made the Android status bar see-through (transparent + translucent)
//    so your screen color shows to the very top (no mystery green strip).
// We kept your startup guard, error boundary, push token, and share-intent logic.

import React, { useEffect, useMemo, useRef, useState } from "react";
// Polyfills needed by Supabase auth (URL, random values, WebCrypto)
import "../lib/polyfills";
import * as Linking from "expo-linking";
import { View, ActivityIndicator, Platform, Text, TouchableOpacity, Animated, Image } from "react-native";
import { AppState } from "react-native";
import { Slot, usePathname, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { supabase } from "../lib/supabase";
import { StripeProvider } from "@stripe/stripe-react-native";
import { STRIPE_PUBLISHABLE_KEY } from "../lib/env";

// your auth provider/hooks
import { AuthProvider, useAuth } from "../lib/auth";

// (optional) tutorial overlay; if missing, we render children directly
import * as TutorialOverlay from "../components/TutorialOverlay";
const Gate =
  ((TutorialOverlay as any).TutorialOverlayGate ??
    (TutorialOverlay as any).default ??
    (({ children }: any) => <>{children}</>)) as React.ComponentType<any>;

// 🎨 centralized colors
import { COLORS } from "../lib/theme";
import { logWarn } from "../lib/logger";

/* -----------------------------------------------------------
   🧸 helper: am I at an auth route?
----------------------------------------------------------- */
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
  handleNotification: async (notification) => {
    // Allow sounds for meal reminder notifications (they have data.slotId)
    const isMealReminder = notification.request.content.data?.slotId;
    return {
      shouldPlaySound: isMealReminder ?? false, // Play sound for meal reminders
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    } as any;
  },
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

    // 🧸 ELI5: we ask Expo "what's our project id?" so it can make a push token
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
   🆕 Share Intake via expo-share-intent (unchanged behavior)
----------------------------------------------------------- */
import { useShareIntent } from "expo-share-intent";

// find a link inside any text
function extractFirstUrl(s?: string | null): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

/* -----------------------------------------------------------
   🧯 Error Boundary so crashes don't look like "black screen"
----------------------------------------------------------- */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message?: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: undefined };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: err?.message ?? "Something went wrong." };
  }
  componentDidCatch(err: any) {
    logWarn("[RootErrorBoundary]", err);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: COLORS.bg,
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          gap: 12,
        }}
      >
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "800" }}>
          Oops, MessHall hiccuped
        </Text>
        <Text style={{ color: COLORS.subtext, textAlign: "center" }}>
          {this.state.message}
        </Text>
        <TouchableOpacity
          onPress={() => {
            this.setState({ hasError: false, message: undefined });
          }}
          style={{
            backgroundColor: COLORS.accent,
            borderRadius: 10,
            paddingHorizontal: 16,
            paddingVertical: 10,
            marginTop: 8,
          }}
        >
          <Text style={{ color: "#0b0f19", fontWeight: "800" }}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

/* -----------------------------------------------------------
   InnerApp: normal app shell + share-intent + push token
----------------------------------------------------------- */
function InnerApp() {
  const { loading, isLoggedIn } = useAuth();
  const router = useRouter();

  // 👉 read share intent state from native
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  // when a share arrives, route to Capture with the url
  useEffect(() => {
    try {
      if (!hasShareIntent || !shareIntent) return;

      // shareIntent.webUrl is already extracted when possible; otherwise check raw text
      const url =
        (shareIntent as any).webUrl ||
        extractFirstUrl((shareIntent as any).text) ||
        // as a fallback for rich shares, sometimes meta.title contains a url-like string
        extractFirstUrl((shareIntent as any)?.meta?.title as any);

      if (url) {
        // go to Capture and let that screen auto-import
        router.push({ pathname: "/(tabs)/capture", params: { sharedUrl: url } });
      }
    } finally {
      // VERY IMPORTANT: clear the intent so it doesn’t trigger again on re-render
      resetShareIntent?.();
    }
  }, [hasShareIntent, shareIntent, router, resetShareIntent]);

  // Handle OAuth deep link: exchange ?code=... for a session
  useEffect(() => {
    let active = true;
    async function handle(url?: string | null) {
      try {
        if (!url) return;
        const parsed = Linking.parse(url) as any;
        let code = parsed?.queryParams?.code as any;
        if (Array.isArray(code)) code = code[0];
        if (code && typeof code !== "string") code = String(code);
        if (code) {
          const { error } = await (supabase.auth as any).exchangeCodeForSession(code);
          if (error) logWarn("[oauth] exchange failed", error);
        }
      } catch (e) {
        logWarn("[oauth] deep link handler failed", e);
      }
    }

    (async () => {
      const initial = await Linking.getInitialURL();
      if (active) await handle(initial);
    })();
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const content = (
    <>
      {/* ⭐ NEW: Transparent & translucent status bar — removes the "green strip" */}
      <StatusBar
        style="light"                 // light icons
        translucent                   // content can go under the bar
        backgroundColor="transparent" // no solid color painted by Android
      />

      {/* Your routed screens */}
      <Slot />

      {/* ⏳ Overlay spinner while auth is loading (prevents half-ready UI) */}
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
            backgroundColor: "rgba(0,0,0,0.2)", // soft veil
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

/* -----------------------------------------------------------
   🎨 Enhanced Splash Screen Component
----------------------------------------------------------- */
function SplashScreen() {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Fade in and scale up animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse animation for the loading indicator
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <AuthProvider>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: COLORS.bg,
            // Subtle gradient effect using overlay
            position: "relative",
          }}
        >
          {/* Subtle gradient overlay for depth */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: COLORS.bg,
              opacity: 0.95,
            }}
          />
          
          <Animated.View
            style={{
              alignItems: "center",
              justifyContent: "center",
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            }}
          >
            {/* Brand Logo */}
            <View
              style={{
                marginBottom: 32,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Animated.View
                style={{
                  transform: [{ scale: pulseAnim }],
                }}
              >
                <View
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 20,
                    backgroundColor: COLORS.accent,
                    alignItems: "center",
                    justifyContent: "center",
                    shadowColor: COLORS.accent,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.3,
                    shadowRadius: 20,
                    elevation: 8,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 36,
                      fontWeight: "800",
                      color: COLORS.onAccent,
                      letterSpacing: -1,
                    }}
                  >
                    M
                  </Text>
                </View>
              </Animated.View>
            </View>

            {/* App Name */}
            <Text
              style={{
                color: COLORS.text,
                fontSize: 28,
                fontWeight: "700",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              MessHall
            </Text>

            {/* Loading Indicator */}
            <View style={{ marginTop: 24, alignItems: "center" }}>
              <ActivityIndicator size="small" color={COLORS.accent} />
              <Text
                style={{
                  color: COLORS.subtext,
                  fontSize: 14,
                  marginTop: 16,
                  letterSpacing: 0.3,
                }}
              >
                Warming up MessHall…
              </Text>
            </View>
          </Animated.View>

          {/* Subtle accent line at bottom */}
          <View
            style={{
              position: "absolute",
              bottom: 60,
              left: "20%",
              right: "20%",
              height: 2,
              backgroundColor: COLORS.accent,
              opacity: 0.3,
              borderRadius: 1,
            }}
          />
        </View>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

/* -----------------------------------------------------------
   RootLayout: first-boot guard + watchdog
----------------------------------------------------------- */
export default function RootLayout() {
  const router = useRouter();
  const inAuthFlow = useInAuthFlow();
  const segments = useSegments() as any;

  // ✅ We track if the first check finished
  const [checkedOnce, setCheckedOnce] = useState(false);

  // ⏱️ watchdog timer so we never hang forever
  const watchdogFiredRef = useRef(false);
  const pendingNavRef = useRef<null | (() => void)>(null);

  // if we queued a navigation before the router tree was ready, run it once segments exist
  useEffect(() => {
    const hasSegments = Array.isArray(segments) && segments.length > 0;
    if (hasSegments && pendingNavRef.current) {
      const run = pendingNavRef.current;
      pendingNavRef.current = null;
      requestAnimationFrame(run);
    }
  }, [segments]);

  // 3a) When app comes back to foreground after a long idle, re-check and nudge navigation
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      try {
        const { data } = await supabase.auth.getSession();
        const hasSession = !!data?.session;
        // ensure we never hang on warm screen after resume
        setCheckedOnce(true);

        const hasSegments = Array.isArray(segments) && segments.length > 0;
        const inAuthGroup = hasSegments && typeof segments[0] === "string" && String(segments[0]).startsWith("(auth)");

        const nav = () => {
          if (!hasSession) {
            if (!inAuthGroup) router.replace("/login");
          } else {
            if (inAuthGroup) router.replace("/");
          }
        };

        if (hasSegments) requestAnimationFrame(nav);
        else pendingNavRef.current = nav;
      } catch {
        // still unlock UI on errors
        setCheckedOnce(true);
      }
    });
    return () => sub.remove();
  }, [router, segments]);

  useEffect(() => {
    let alive = true;

    // 1) Start a watchdog: if first check takes too long, unlock UI.
    const watchdog = setTimeout(() => {
      if (!alive || checkedOnce) return;
      watchdogFiredRef.current = true;
      // Always end warm screen; only navigate if clearly off auth stack
      setCheckedOnce(true);
      if (!inAuthFlow) {
        try {
          router.replace("/login");
        } catch {}
      }
    }, 4000);

    // 2) Do the actual first check (with a short timeout so we never hang)
    (async () => {
      try {
        const withTimeout = <T,>(p: Promise<T>, ms: number) =>
          new Promise<T>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("getSession timeout")), ms);
            p.then((v) => {
              clearTimeout(t);
              resolve(v);
            }).catch((e) => {
              clearTimeout(t);
              reject(e);
            });
          });

        // Increase timeout to 15s for mobile devices - session should persist between app opens
        const { data } = await withTimeout(supabase.auth.getSession(), 15000) as any;
        const _hasSession = !!data?.session;
        // We no longer force navigation here to avoid flicker/race conditions
      } catch (e) {
        // If it errors, we still want to render something (not black screen)
        logWarn("[startup] getSession failed:", e);
      } finally {
        if (alive) setCheckedOnce(true);
      }
    })();

    return () => {
      alive = false;
      clearTimeout(watchdog);
    };
  }, [router, inAuthFlow, checkedOnce]);

  // 4) Listen for auth flips and navigate based on current stack group
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Ensure we stop the initial warm screen once any event fires
      setCheckedOnce(true);

      const hasSegments = Array.isArray(segments) && segments.length > 0;
      const inAuthGroup = hasSegments && typeof segments[0] === "string" && String(segments[0]).startsWith("(auth)");

      const nav = () => {
        if (event === "SIGNED_OUT") {
          if (!inAuthGroup) router.replace("/login");
        } else if (event === "SIGNED_IN") {
          if (inAuthGroup) router.replace("/");
        }
      };

      if (hasSegments) {
        requestAnimationFrame(nav);
      } else {
        // queue until router tree is ready to avoid lost navigations on Android
        pendingNavRef.current = nav;
      }
    });
    return () => data.subscription?.unsubscribe();
  }, [router, segments]);

  // ⛑️ First render while checking: show a polished splash screen with branding
  if (!checkedOnce) {
    return <SplashScreen />;
  }

  // ✅ Normal app once first check is done
  return (
    // IMPORTANT: This root background fills behind the transparent status bar
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
        <AuthProvider>
          <RootErrorBoundary>
            <InnerApp />
          </RootErrorBoundary>
        </AuthProvider>
      </StripeProvider>
    </GestureHandlerRootView>
  );
}
