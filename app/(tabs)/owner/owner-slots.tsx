// app/(tabs)/owner/owner-slots.tsx
// 🧒 like I'm 5:
// Slots list. Status + date row now shows the FIRST of (starts_at, active_from)
// and (ends_at, active_to), so it always matches what the feed uses.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { COLORS, SPACING } from "../../../lib/theme";

type Slot = {
  id: string;
  brand?: string | null;
  title?: string | null;
  image_url?: string | null;
  cta_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  active_from?: string | null;
  active_to?: string | null;
  is_active?: boolean | null;
  weight?: number | null;
};

const firstDefined = <T,>(...vals: (T | null | undefined)[]) =>
  vals.find(v => typeof v !== "undefined" && v !== null) as T | undefined;

function statusFor(now: Date, s: Slot) {
  const active = s.is_active ?? true;
  const startStr = firstDefined<string>(s.starts_at, s.active_from);
  const endStr   = firstDefined<string>(s.ends_at, s.active_to);
  const start = startStr ? new Date(startStr) : undefined;
  const end = endStr ? new Date(endStr) : undefined;
  if (!active) return "INACTIVE";
  if (start && now < start) return "SCHEDULED";
  if (end && now > end) return "EXPIRED";
  return "ACTIVE";
}

export default function OwnerSlots() {
  const C = useMemo(
    () => ({ bg: COLORS.bg, card: COLORS.card, text: COLORS.text, subtext: COLORS.subtext, border: COLORS.border }),
    []
  );

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("sponsored_slots").select("*").limit(200);
      if (error) throw error;
      setSlots((data ?? []) as any);
    } catch (e: any) {
      Alert.alert("Could not load slots", e?.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const now = new Date();

  const bump = async (id: string, delta: number) => {
    try {
      const slot = slots.find((x) => x.id === id);
      if (!slot) return;
      const next = Math.max(1, Number(slot.weight || 1) + delta);
      const { error } = await supabase.from("sponsored_slots").update({ weight: next }).eq("id", id);
      if (error) throw error;
      setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, weight: next } : s)));
    } catch (e: any) {
      Alert.alert("Update failed", e?.message ?? "Please try again.");
    }
  };

  const toggleActive = async (id: string, on: boolean) => {
    try {
      const { error } = await supabase.from("sponsored_slots").update({ is_active: on }).eq("id", id);
      if (error) throw error;
      setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, is_active: on } : s)));
    } catch (e: any) {
      Alert.alert("Update failed", e?.message ?? "Please try again.");
    }
  };

  const renderItem = ({ item }: { item: Slot }) => {
    const st = statusFor(now, item);
    const startStr = firstDefined<string>(item.starts_at, item.active_from) || "—";
    const endStr   = firstDefined<string>(item.ends_at, item.active_to) || "—";

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => router.push({ pathname: "/(tabs)/owner/owner-slot-creatives", params: { id: item.id } })}
        style={{ backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: st === "ACTIVE" ? "#22c55e" : st === "SCHEDULED" ? "#f59e0b" : st === "EXPIRED" ? "#ef4444" : "#64748b", marginRight: 8 }} />
          <Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{item.brand || "—"} — {item.title || "Untitled"}</Text>
          <View style={{ backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
            <Text style={{ color: C.text, fontWeight: "800", fontSize: 12 }}>{st}</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/(tabs)/owner/owner-edit-slot", params: { id: item.id } })}
            style={{ marginLeft: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" }}
          >
            <Text style={{ color: C.text, fontWeight: "800", fontSize: 12 }}>Edit</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: C.subtext, marginBottom: 6 }}>{startStr} → {endStr} · weight {item.weight ?? 1}</Text>
        {!!item.cta_url && <Text style={{ color: C.subtext }}>Link: {item.cta_url}</Text>}

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
          {item.is_active ? (
            <TouchableOpacity onPress={() => toggleActive(item.id, false)}>
              <Text style={{ color: "#ef4444", fontWeight: "800" }}>Deactivate</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => toggleActive(item.id, true)}>
              <Text style={{ color: "#22c55e", fontWeight: "800" }}>Activate</Text>
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => bump(item.id, -1)} style={{ paddingHorizontal: 8 }}>
            <Text style={{ color: C.text, fontWeight: "900" }}>−1</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => bump(item.id, +1)} style={{ paddingHorizontal: 8 }}>
            <Text style={{ color: C.text, fontWeight: "900" }}>+1</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
      <View style={{ padding: SPACING.lg, flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: "900", marginBottom: 12 }}>Sponsored Slots</Text>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <FlatList
            data={slots}
            keyExtractor={(it) => it.id}
            renderItem={renderItem}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
