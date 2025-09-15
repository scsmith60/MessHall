// app/(tabs)/_layout.tsx
// Like I'm 5: This file draws the bottom tab bar.
// We list ONLY the tabs we want. For any extra screens that live in (tabs)
// (like public-profile), we add them with href:null so they stay usable
// in navigation BUT do NOT show up as a tab button.

import React, { useEffect, useState, useCallback } from "react";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

const COLORS = { bg: "#0b1220", border: "#1f2937", text: "#cbd5e1", active: "#22c55e" };

// tiny helper to draw icons
const makeIcon =
  (name: React.ComponentProps<typeof Ionicons>["name"]) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  console.log("[TabsLayout] mount");
  const { isLoggedIn, loading } = useAuth();

  // If not logged in, gently redirect away after Tabs tries to mount
  if (!loading && !isLoggedIn) {
    console.log("[TabsLayout] not logged in → redirect to /(auth)/login");
    return <Redirect href="/(auth)/login" />;
  }

  // Check if user is admin (for the Owner tab)
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  const loadIsAdmin = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) { setIsAdmin(false); setReady(true); return; }
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", uid)
        .single();
      setIsAdmin(!error && !!data?.is_admin);
    } catch {
      setIsAdmin(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    loadIsAdmin();
    const { data } = supabase.auth.onAuthStateChange(() => loadIsAdmin());
    return () => data.subscription?.unsubscribe();
  }, [loadIsAdmin]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.active,
        tabBarInactiveTintColor: COLORS.text,
        tabBarStyle: { backgroundColor: COLORS.bg, borderTopColor: COLORS.border },
      }}
    >
      {/* ✅ ONLY the tabs we want visible */}
      <Tabs.Screen name="index"   options={{ title: "Scuttlebut",    tabBarIcon: makeIcon("home") }} />
      <Tabs.Screen name="capture" options={{ title: "Capture", tabBarIcon: makeIcon("camera") }} />
      <Tabs.Screen name="planner" options={{ title: "Planner", tabBarIcon: makeIcon("calendar") }} />
      <Tabs.Screen name="shop"    options={{ title: "Commissary",    tabBarIcon: makeIcon("cart") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: makeIcon("person") }} />

      {/* 👑 Owner tab (shows only if admin; hidden for everyone else) */}
      <Tabs.Screen
        name="owner"
        options={{
          title: "Owner",
          tabBarIcon: makeIcon("stats-chart"),
          href: ready && isAdmin ? undefined : null, // hide until we know, or if not admin
        }}
      />

      {/* 🫥 HIDE any public-profile routes that accidentally live in (tabs) */}
      {/* If these routes exist, they'll be usable via router.push(), but NOT shown as a tab. */}
      <Tabs.Screen name="public-profile" options={{ href: null }} />
      {/* Add more here if your filenames differ (tell me the exact name and I’ll add it) */}
    </Tabs>
  );
}
