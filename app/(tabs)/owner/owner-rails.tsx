// app/(tabs)/owner/owner-rails.tsx
// ELI5: This is a simple list of your "Shelves" (the horizontal rail).
// You can make a new shelf or tap one to edit.

import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { COLORS, SPACING } from "../../../lib/theme";

type Shelf = {
  id: string;
  title: string;
  is_active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  weight?: number | null;
  sponsor_brand?: string | null;
};

export default function OwnerRails() {
  const [rows, setRows] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("rail_shelves")
      .select("id, title, is_active, starts_at, ends_at, weight, sponsor_brand")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error) setRows((data ?? []).map((r: any) => ({ ...r, id: String(r.id) })));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22, flex: 1 }}>Shelves</Text>
        <TouchableOpacity
          onPress={() => router.push("/(tabs)/owner/create-rail")}
          style={{ backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 }}
        >
          <Text style={{ color: "#001018", fontWeight: "900" }}>New Shelf</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(x) => x.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push({ pathname: "/(tabs)/owner/create-rail", params: { id: item.id } })}
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                borderColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderRadius: 14,
                padding: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16, flex: 1 }}>{item.title}</Text>
                <Text
                  style={{
                    color: item.is_active ? COLORS.accent : "rgba(255,255,255,0.6)",
                    fontWeight: "800",
                    backgroundColor: item.is_active ? "rgba(0,200,120,0.15)" : "rgba(255,255,255,0.08)",
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                  }}
                >
                  {item.is_active ? "Active" : "Paused"}
                </Text>
              </View>
              <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 6 }}>
                Weight {item.weight ?? 1} {item.sponsor_brand ? `• Sponsor: ${item.sponsor_brand}` : ""}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}
