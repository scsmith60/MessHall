// app/(tabs)/_layout.tsx
// We hide the top header (less empty space) and overlay a small floating bell.

import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import { COLORS } from "../../lib/theme";
import { supabase } from "../../lib/supabase";

const makeIcon =
  (name: React.ComponentProps<typeof Ionicons>["name"]) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  const { loading, isLoggedIn, user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if user is admin
  useEffect(() => {
    if (!isLoggedIn || !user?.id) {
      setIsAdmin(false);
      return;
    }

    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", user.id)
          .maybeSingle();

        if (!alive) return;

        if (error || !data) {
          setIsAdmin(false);
          return;
        }

        const isAdminFlag = Boolean(
          data.is_admin === true || data.is_admin === "true" || data.is_admin === "TRUE"
        );
        setIsAdmin(isAdminFlag);
      } catch (err) {
        if (alive) setIsAdmin(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isLoggedIn, user?.id]);

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
      <Tabs.Screen 
        name="owner" 
        options={isAdmin 
          ? { title: "Owner", tabBarIcon: makeIcon("stats-chart") }
          : { href: null }
        } 
      />
      <Tabs.Screen name="public-profile" options={{ href: null }} />
    </Tabs>
  );
}
