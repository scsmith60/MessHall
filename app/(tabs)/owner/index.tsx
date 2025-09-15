// app/(tabs)/owner/index.tsx
// 🧒 what this does (like i'm 5):
// - checks if you're an admin
// - if not admin, sends you back to the tabs
// - shows Owner Dashboard with quick buttons
// - NOW INCLUDES: "Review Creator Requests" button to open our approvals screen

import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  useColorScheme,
  TouchableOpacity,
} from "react-native";
import { Redirect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";

type Profile = { is_admin: boolean } | null;

export default function OwnerScreen() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const scheme = useColorScheme();
  const COLORS = useMemo(() => {
    if (scheme === "dark") {
      return {
        bg: "#0b1220",
        surface: "#111827",
        border: "#1f2937",
        onBg: "#e5e7eb",
        onSurface: "#f8fafc",
        onSurfaceMuted: "#cbd5e1",
        accent: "#22c55e",
        text: "#f8fafc",
      };
    }
    return {
      bg: "#f8fafc",
      surface: "#ffffff",
      border: "#e5e7eb",
      onBg: "#0f172a",
      onSurface: "#0f172a",
      onSurfaceMuted: "#475569",
      accent: "#16a34a",
      text: "#0f172a",
    };
  }, [scheme]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        if (alive) setAllowed(false);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", uid)
        .single();

      if (error) {
        if (alive) setAllowed(false);
        return;
      }
      if (alive) setAllowed(!!data?.is_admin);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (allowed === null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: COLORS.bg,
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <ActivityIndicator />
        <Text style={{ color: COLORS.onBg }}>Checking admin…</Text>
      </View>
    );
  }

  if (!allowed) return <Redirect href="/(tabs)" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      {/* Title */}
      <Text
        style={{
          fontSize: 26,
          fontWeight: "800",
          color: COLORS.onBg,
          marginBottom: 4,
        }}
      >
        Owner Dashboard
      </Text>
      <Text style={{ color: COLORS.onSurfaceMuted, marginBottom: 12 }}>
        Only admins can see this. 🎯
      </Text>

      {/* NEW: Review Creator Requests button (goes to approvals screen) */}
      <TouchableOpacity
        onPress={() => router.push("/(tabs)/owner/creator-approvals")}
        activeOpacity={0.85}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: "#2563eb",
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 999,
          marginBottom: 12,
          gap: 6,
        }}
      >
        <Ionicons name="checkmark-done-circle" size={20} color="#ffffff" />
        <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 16 }}>
          Review Creator Requests
        </Text>
      </TouchableOpacity>

      {/* Existing: Manage Slots button */}
      <Text
        onPress={() => router.push("/(tabs)/owner/owner-slots")}
        style={{
          alignSelf: "flex-start",
          backgroundColor: "#1f2937",
          color: "#e5e7eb",
          fontWeight: "900",
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 999,
          marginBottom: 12,
        }}
      >
        Manage Slots
      </Text>

      {/* Existing: New Slot button */}
      <TouchableOpacity
        onPress={() => router.push("/(tabs)/owner/create-slot")}
        activeOpacity={0.85}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: COLORS.accent,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 999,
          marginBottom: 16,
          gap: 6,
        }}
      >
        <Ionicons name="add-circle" size={20} color="#001018" />
        <Text style={{ color: "#001018", fontWeight: "900", fontSize: 16 }}>
          New Sponsored Slot
        </Text>
      </TouchableOpacity>

      {/* CARD: Revenue */}
      <View
        style={{
          padding: 14,
          borderRadius: 14,
          backgroundColor: COLORS.surface,
          borderWidth: 1,
          borderColor: COLORS.border,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.onSurface }}>
          Revenue
        </Text>
        <Text style={{ color: COLORS.onSurfaceMuted }}>
          $0.00 today (wire up real data)
        </Text>
      </View>

      {/* CARD: Ad Slots */}
      <View
        style={{
          padding: 14,
          borderRadius: 14,
          backgroundColor: COLORS.surface,
          borderWidth: 1,
          borderColor: COLORS.border,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.onSurface }}>
          Ad Slots
        </Text>
        <Text style={{ color: COLORS.onSurfaceMuted }}>
          Edit rotations, CPMs, and sponsored recipes here.
        </Text>
      </View>

      {/* CARD: Payouts */}
      <View
        style={{
          padding: 14,
          borderRadius: 14,
          backgroundColor: COLORS.surface,
          borderWidth: 1,
          borderColor: COLORS.border,
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 3,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.onSurface }}>
          Payouts
        </Text>
        <Text style={{ color: COLORS.onSurfaceMuted }}>
          Approve creator payouts securely.
        </Text>
      </View>
    </ScrollView>
  );
}
