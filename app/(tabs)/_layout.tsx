// app/(tabs)/_layout.tsx
// We hide the top header (less empty space) and overlay a small floating bell.

import React from "react";
import { View, ActivityIndicator } from "react-native";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import FloatingBell from "@/components/FloatingBell";
import { COLORS } from "../../lib/theme";

const makeIcon =
  (name: React.ComponentProps<typeof Ionicons>["name"]) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  const { loading, isLoggedIn } = useAuth();

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

  if (!isLoggedIn) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false, // 👈 hide header to remove the empty bar
          tabBarActiveTintColor: COLORS.accent,
          tabBarInactiveTintColor: COLORS.subtext,
          tabBarStyle: { backgroundColor: COLORS.bg, borderTopColor: COLORS.border },
        }}
      >
        <Tabs.Screen name="index"   options={{ title: "Scuttlebutt", tabBarIcon: makeIcon("home") }} />
        <Tabs.Screen name="capture" options={{ title: "Capture",     tabBarIcon: makeIcon("camera") }} />
        <Tabs.Screen name="planner" options={{ title: "Planner",     tabBarIcon: makeIcon("calendar") }} />
        <Tabs.Screen name="shop"    options={{ title: "Commissary",  tabBarIcon: makeIcon("cart") }} />
        <Tabs.Screen name="enlisted-club" options={{ title: "Enlisted", tabBarIcon: makeIcon("videocam") }} />
        <Tabs.Screen name="profile" options={{ title: "Profile",     tabBarIcon: makeIcon("person") }} />
        <Tabs.Screen name="owner"   options={{ title: "Owner",       tabBarIcon: makeIcon("stats-chart") }} />
        <Tabs.Screen name="public-profile" options={{ href: null }} />
      </Tabs>

      {/* Floating bell shows on top of everything */}
      <FloatingBell />
    </View>
  );
}
