// app/(tabs)/_layout.tsx
// 👶 kid version:
// - builds the bottom tabs
// - checks "am I admin?"
// - if no admin → HIDE Owner tab (href: null)
// - uses Ionicons with VALID names so no more "X" boxes

import React, { useEffect, useState, useCallback } from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons"; // ✅ correct import
import { supabase } from "../../lib/supabase";

// 🎨 colors (tweak if you like)
const COLORS = {
  bg: "#0b1220",
  border: "#1f2937",
  text: "#cbd5e1",
  active: "#22c55e", // MessHall green-ish
};

export default function TabsLayout() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  // 🔎 check profiles.is_admin
  const loadIsAdmin = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        setIsAdmin(false);
        setReady(true);
        return;
      }

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

  // 🧩 helper to avoid repeating icon code
  const makeIcon =
    (name: React.ComponentProps<typeof Ionicons>["name"]) =>
    ({ color, size }: { color: string; size: number }) =>
      <Ionicons name={name} color={color} size={size} />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.active,
        tabBarInactiveTintColor: COLORS.text,
        tabBarStyle: { backgroundColor: COLORS.bg, borderTopColor: COLORS.border },
      }}
    >
      {/* 🏠 Home -> file must be app/(tabs)/index.tsx */}
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: makeIcon("home") }}
      />

      {/* 📷 Capture -> file: app/(tabs)/capture.tsx */}
      <Tabs.Screen
        name="capture"
        options={{ title: "Capture", tabBarIcon: makeIcon("camera") }}
      />

      {/* 🗓️ Planner -> file: app/(tabs)/planner.tsx */}
      <Tabs.Screen
        name="planner"
        options={{ title: "Planner", tabBarIcon: makeIcon("calendar") }}
      />

      {/* 🛒 Shop -> file: app/(tabs)/shop.tsx */}
      <Tabs.Screen
        name="shop"
        options={{ title: "Shop", tabBarIcon: makeIcon("cart") }}
      />

      {/* 👤 Profile -> file: app/(tabs)/profile.tsx */}
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: makeIcon("person") }}
      />

      {/* 📊 Owner (admin only) -> file: app/(tabs)/owner.tsx */}
      <Tabs.Screen
        name="owner"
        options={{
          title: "Owner",
          tabBarIcon: makeIcon("stats-chart"), // ✅ valid Ionicon
          // 🪄 hide route completely if not admin (or still checking)
          href: ready && isAdmin ? undefined : null,
        }}
      />
    </Tabs>
  );
}
