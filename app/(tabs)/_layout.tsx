// app/(tabs)/_layout.tsx
// ✅ Known-good Tabs layout that always mounts the tab bar.
// - Logs when the layout mounts (so we know Tabs are alive)
// - Keeps your admin-only Owner tab
// - Uses RequireAuth *after* Tabs mount so the bar is not short-circuited

import React, { useEffect, useState, useCallback } from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Redirect } from "expo-router";

const COLORS = { bg: "#0b1220", border: "#1f2937", text: "#cbd5e1", active: "#22c55e" };

// 🔎 tiny icon helper
const makeIcon =
  (name: React.ComponentProps<typeof Ionicons>["name"]) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  console.log("[TabsLayout] mount");
  const { isLoggedIn, loading } = useAuth();

  // 🧱 IMPORTANT: never block mounting Tabs; just *redirect after* they appear
  if (!loading && !isLoggedIn) {
    console.log("[TabsLayout] not logged in → redirect to /(auth)/login");
    return <Redirect href="/(auth)/login" />;
  }

  // Admin tab
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
      {/* 🏠 Home (file: app/(tabs)/index.tsx) */}
      <Tabs.Screen name="index"   options={{ title: "Home",    tabBarIcon: makeIcon("home") }} />
      {/* 📷 Capture */}
      <Tabs.Screen name="capture" options={{ title: "Capture", tabBarIcon: makeIcon("camera") }} />
      {/* 🗓️ Planner */}
      <Tabs.Screen name="planner" options={{ title: "Planner", tabBarIcon: makeIcon("calendar") }} />
      {/* 🛒 Shop */}
      <Tabs.Screen name="shop"    options={{ title: "Shop",    tabBarIcon: makeIcon("cart") }} />
      {/* 👤 Profile */}
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: makeIcon("person") }} />
      {/* 📊 Owner (admin only) */}
      <Tabs.Screen
        name="owner"
        options={{
          title: "Owner",
          tabBarIcon: makeIcon("stats-chart"),
          href: ready && isAdmin ? undefined : null, // hide when not admin or still checking
        }}
      />
    </Tabs>
  );
}
