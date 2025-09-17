// app/(tabs)/owner/index.tsx
// 🧒 what this screen does (like I'm 5):
// - gives owners big, easy buttons
// - makes sure stuff isn't hiding under the phone's clock/battery
// - "Ad Slots" card now opens your slot manager
// - buttons are all the same cute pill style

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";

/* ----------------------------- Tiny theme ----------------------------- */
// We pick colors for light/dark so the screen matches the rest of the app.
function useTheme() {
  const scheme = useColorScheme();
  if (scheme === "dark") {
    return {
      bg: "#0b1220",
      card: "#111827",
      border: "#1f2937",
      text: "#F8FAFC",
      textMuted: "#93A3B8",
      accent: "#22c55e", // green we use around the app
      primary: "#3b82f6", // nice blue for the top action
      pillBg: "rgba(255,255,255,0.08)",
      pillBorder: "rgba(255,255,255,0.12)",
      pillText: "#E5E7EB",
    };
  }
  // light
  return {
    bg: "#F8FAFC",
    card: "#FFFFFF",
    border: "#E5E7EB",
    text: "#0F172A",
    textMuted: "#475569",
    accent: "#16a34a",
    primary: "#2563eb",
    pillBg: "#1f2937",
    pillBorder: "#111827",
    pillText: "#E5E7EB",
  };
}

/* ----------------------------- Pill Button ---------------------------- */
// One button style so everything looks consistent.
type PillProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  variant?: "primary" | "neutral" | "success";
};
function PillButton({ icon, label, onPress, variant = "neutral" }: PillProps) {
  const C = useTheme();

  // colors for each style
  const bg =
    variant === "primary"
      ? C.primary
      : variant === "success"
      ? C.accent
      : C.pillBg;

  const text = variant === "primary" || variant === "success" ? "#001018" : C.pillText;
  const iconColor = text;

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        paddingVertical: 11,
        paddingHorizontal: 16,
        borderRadius: 999,
        backgroundColor: bg,
        // subtle border for the neutral pill to match the app's glass look
        borderWidth: variant === "neutral" ? 1 : 0,
        borderColor: variant === "neutral" ? C.pillBorder : "transparent",
        gap: 8,
      }}
    >
      <Ionicons name={icon} size={18} color={iconColor} />
      <Text style={{ color: text, fontWeight: "900", fontSize: 16 }}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ------------------------------ Screen -------------------------------- */
export default function OwnerScreen() {
  const C = useTheme();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  // Check if user is an admin (same behavior as before)
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
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <ActivityIndicator />
          <Text style={{ color: C.textMuted }}>Checking admin…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!allowed) return <Redirect href="/(tabs)" />;

  return (
    // ✅ SafeArea so the title never hides under clock/battery
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {/* Title */}
        <Text style={{ fontSize: 26, fontWeight: "900", color: C.text, marginBottom: 4 }}>
          Owner Dashboard
        </Text>
        <Text style={{ color: C.textMuted, marginBottom: 16 }}>Only admins can see this. 🎯</Text>

        {/* Row of top actions */}
        <View style={{ gap: 10, marginBottom: 16 }}>
          {/* Review Creator Requests (blue) */}
          <PillButton
            icon="checkmark-done-circle"
            label="Review Creator Requests"
            variant="primary"
            onPress={() => router.push("/(tabs)/owner/creator-approvals")}
          />

          {/* Manage Shelves (neutral) */}
          <PillButton
            icon="albums"
            label="Manage Shelves"
            onPress={() => router.push("/(tabs)/owner/owner-rails")}
          />

          {/* Manage Slots (neutral) */}
          <PillButton
            icon="settings"
            label="Manage Slots"
            onPress={() => router.push("/(tabs)/owner/owner-slots")}
          />

          {/* New Sponsored Slot (green) */}
          <PillButton
            icon="add-circle"
            label="New Sponsored Slot"
            variant="success"
            onPress={() => router.push("/(tabs)/owner/create-slot")}
          />
        </View>

        {/* Cards */}
        <View style={{ gap: 12 }}>
          {/* Revenue */}
          <View
            style={{
              padding: 14,
              borderRadius: 16,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.border,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.text }}>Revenue</Text>
            <Text style={{ color: C.textMuted }}>$0.00 today (wire up real data)</Text>
          </View>

          {/* Ad Slots — now clickable to open slot manager */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push("/(tabs)/owner/owner-slots")}
            style={{
              padding: 14,
              borderRadius: 16,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.border,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: C.text, flex: 1 }}>Ad Slots</Text>
              <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
            </View>
            <Text style={{ color: C.textMuted, marginTop: 2 }}>
              Edit rotations, CPMs, and sponsored recipes here.
            </Text>
          </TouchableOpacity>

          {/* Payouts */}
          <View
            style={{
              padding: 14,
              borderRadius: 16,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.border,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.text }}>Payouts</Text>
            <Text style={{ color: C.textMuted }}>Approve creator payouts securely.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
