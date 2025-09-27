// app/(tabs)/_layout.tsx
//
// LIKE I'M 5:
// This is the "Tabs Boss". It decides if we show tabs.
// Problem before: Boss got scared too fast and yelled "LOGOUT!" while we were still
// figuring out if you're logged in. That pushed you to Mission Complete 🤦.
// Fix: If we're still checking (loading), we DO NOTHING (just a tiny spinner).
// Only after checking is done, if you're not logged in, THEN we go to /logout.
// When you ARE logged in, we show the tabs and your home goes to /(tabs)/index.

import React from "react";
import { View, ActivityIndicator } from "react-native";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth"; // must provide { loading, isLoggedIn }

const COLORS = {
  bg: "#0b1220",
  border: "#1f2937",
  text: "#cbd5e1",
  active: "#22c55e",
};

const makeIcon =
  (name: React.ComponentProps<typeof Ionicons>["name"]) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  // 🔌 We read 2 lights:
  // - loading: Are we still checking Supabase?
  // - isLoggedIn: Are we in (yes/no)?
  const { loading, isLoggedIn } = useAuth();

  // 🧸 IMPORTANT RULE:
  // While loading is true, DO NOT redirect anywhere.
  // Just show a tiny centered spinner so the user sees we’re thinking.
  if (loading) {
    return (
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
    );
  }

  // ⛔️ Only after loading is done, if not logged in -> go to /logout.
  if (!isLoggedIn) {
    return <Redirect href="/logout" />;
  }

  // ✅ Logged in → show your tabs. The default tab is "(tabs)/index".
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: COLORS.active,
          tabBarInactiveTintColor: COLORS.text,
          tabBarStyle: { backgroundColor: COLORS.bg, borderTopColor: COLORS.border },
        }}
      >
        {/* HOME FEED (default landing after login) */}
        <Tabs.Screen
          name="index"
          options={{ title: "Scuttlebutt", tabBarIcon: makeIcon("home") }}
        />

        {/* Keep the rest of your screens the same names you already use */}
        <Tabs.Screen name="capture" options={{ title: "Capture", tabBarIcon: makeIcon("camera") }} />
        <Tabs.Screen name="planner" options={{ title: "Planner", tabBarIcon: makeIcon("calendar") }} />
        <Tabs.Screen name="shop"    options={{ title: "Commissary", tabBarIcon: makeIcon("cart") }} />
        <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: makeIcon("person") }} />

        {/* Owner/Admin (if you gate it, keep your logic in the screen itself) */}
        <Tabs.Screen name="owner" options={{ title: "Owner", tabBarIcon: makeIcon("stats-chart") }} />

        {/* If you keep a "public-profile" route that shouldn't appear in tabs */}
        <Tabs.Screen name="public-profile" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
