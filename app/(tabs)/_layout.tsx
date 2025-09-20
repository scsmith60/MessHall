// app/(tabs)/_layout.tsx
import React, { useEffect, useState, useCallback } from "react";
import { View, ActivityIndicator } from "react-native";
import { Tabs, Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

const COLORS = { bg: "#0b1220", border: "#1f2937", text: "#cbd5e1", active: "#22c55e" };

const makeIcon =
  (name: React.ComponentProps<typeof Ionicons>["name"]) =>
  ({ color, size }: { color: string; size: number }) =>
    <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  // Auth lights
  const { loading, isLoggedIn } = useAuth();

  // Admin tab visibility
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminReady, setAdminReady] = useState(false);

  const loadIsAdmin = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) { setIsAdmin(false); setAdminReady(true); return; }
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", uid)
        .single();
      setIsAdmin(!error && !!data?.is_admin);
    } catch {
      setIsAdmin(false);
    } finally {
      setAdminReady(true);
    }
  }, []);

  useEffect(() => {
    let t = setTimeout(loadIsAdmin, 60);
    const { data } = supabase.auth.onAuthStateChange(() => {
      clearTimeout(t);
      t = setTimeout(loadIsAdmin, 60);
    });
    return () => {
      clearTimeout(t);
      data.subscription?.unsubscribe();
    };
  }, [loadIsAdmin]);

  // ===== Decide what to show =====

  // 🚪 1) if you're NOT logged in, do not render Tabs or any spinner.
//         leave immediately to the logout flow.
if (!isLoggedIn) {
  return <Redirect href="/logout" />;
}

// ⏳ 2) only show a spinner while warming up an already-logged-in session.
if (loading && isLoggedIn) {
  return (
    <View style={{ flex: 1, backgroundColor: "#0b1220", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}



  // ✅ Logged in and ready → render tabs
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
        <Tabs.Screen name="index"   options={{ title: "Scuttlebut", tabBarIcon: makeIcon("home") }} />
        <Tabs.Screen name="capture" options={{ title: "Capture",    tabBarIcon: makeIcon("camera") }} />
        <Tabs.Screen name="planner" options={{ title: "Planner",    tabBarIcon: makeIcon("calendar") }} />
        <Tabs.Screen name="shop"    options={{ title: "Commissary", tabBarIcon: makeIcon("cart") }} />
        <Tabs.Screen name="profile" options={{ title: "Profile",    tabBarIcon: makeIcon("person") }} />
        <Tabs.Screen
          name="owner"
          options={{
            title: "Owner",
            tabBarIcon: makeIcon("stats-chart"),
            href: adminReady && isAdmin ? undefined : null,
          }}
        />
        <Tabs.Screen name="public-profile" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
