// app/(tabs)/owner/owner-slot-creatives.tsx
// 🧒 like I'm 5:
// This is the list of images/text that live inside one slot. You can add one,
// change its weight, and toggle on/off. SafeArea included.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { COLORS, RADIUS, SPACING } from "../../../lib/theme";
import HapticButton from "../../../components/ui/HapticButton";
import PhotoPicker, { MaybeAsset } from "../../../components/PhotoPicker";
import { uploadAdImage } from "../../../lib/uploads";

type Creative = {
  id: string;
  slot_id: string;
  title?: string | null;
  image_url?: string | null;
  cta?: string | null;
  cta_url?: string | null;
  weight?: number | null;
  is_active?: boolean | null;
  recipe_id?: string | null;
};

export default function SlotCreatives() {
  const { id: slotId } = useLocalSearchParams<{ id: string }>();

  const C = useMemo(
    () => ({
      bg: COLORS.bg,
      card: COLORS.card,
      text: COLORS.text,
      subtext: COLORS.subtext,
      accent: COLORS.accent,
      border: COLORS.border,
    }),
    []
  );

  const [rows, setRows] = useState<Creative[]>([]);
  const [loading, setLoading] = useState(true);

  // form to add a creative
  const [title, setTitle] = useState("");
  const [img, setImg] = useState<MaybeAsset | undefined>(undefined);
  const [ctaText, setCtaText] = useState("Shop");
  const [ctaUrl, setCtaUrl] = useState("https://example.com");
  const [weight, setWeight] = useState<string>("3");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sponsored_creatives")
        .select("*")
        .eq("slot_id", slotId)
        .order("weight", { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as any);
    } catch (e: any) {
      Alert.alert("Could not load creatives", e?.message ?? "Please try again.");
    } finally {
      setLoading(false);
    }
  }, [slotId]);

  useEffect(() => { load(); }, [load]);

  const bump = async (id: string, delta: number) => {
    const c = rows.find((r) => r.id === id);
    if (!c) return;
    const next = Math.max(1, Number(c.weight || 1) + delta);
    const { error } = await supabase.from("sponsored_creatives").update({ weight: next }).eq("id", id);
    if (!error) setRows((prev) => prev.map((r) => (r.id === id ? { ...r, weight: next } : r)));
  };

  const toggle = async (id: string, on: boolean) => {
    const { error } = await supabase.from("sponsored_creatives").update({ is_active: on }).eq("id", id);
    if (!error) setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_active: on } : r)));
  };

  const add = async () => {
    try {
      setBusy(true);
      let image_url: string | null = null;
      if (img) {
        if (typeof img === "string") image_url = img;
        else if (img.uri) {
          const me = (await supabase.auth.getUser()).data.user;
          if (!me?.id) throw new Error("Not signed in");
          image_url = await uploadAdImage(me.id, img);
        }
      }
      const { error } = await supabase.from("sponsored_creatives").insert({
        slot_id: slotId,
        title: title || null,
        image_url,
        cta: ctaText || null,
        cta_url: ctaUrl || null,
        weight: Number(weight) || 1,
        is_active: true,
      });
      if (error) throw error;

      setTitle("");
      setImg(undefined);
      setCtaText("Shop");
      setCtaUrl("https://example.com");
      setWeight("3");
      await load();
    } catch (e: any) {
      Alert.alert("Add failed", e?.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const renderRow = ({ item }: { item: Creative }) => (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: C.border,
        marginBottom: 12,
      }}
    >
      <Text style={{ color: C.text, fontWeight: "800" }}>{item.title || "Creative"}</Text>
      <Text style={{ color: C.subtext, marginTop: 2 }}>
        weight {item.weight ?? 1} {item.is_active ? "• active" : "• inactive"}
      </Text>
      {!!item.cta_url && <Text style={{ color: C.subtext, marginTop: 2 }}>Link: {item.cta_url}</Text>}

      <View style={{ flexDirection: "row", marginTop: 10, alignItems: "center" }}>
        {item.is_active ? (
          <TouchableOpacity onPress={() => toggle(item.id, false)}>
            <Text style={{ color: "#ef4444", fontWeight: "800" }}>Deactivate</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => toggle(item.id, true)}>
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
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
      <View style={{ padding: SPACING.lg, flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: "900", marginBottom: 12 }}>
          Slot Creatives
        </Text>

        {loading ? (
          <ActivityIndicator />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.id}
            renderItem={renderRow}
            ListFooterComponent={
              <View style={{ marginTop: 12 }}>
                <Text style={{ color: C.text, fontWeight: "800", marginBottom: 8 }}>
                  Add Creative
                </Text>

                <Text style={{ color: C.subtext, marginBottom: 6 }}>Title</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="New product"
                  placeholderTextColor={C.subtext}
                  style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}
                />

                <Text style={{ color: C.subtext, marginBottom: 6 }}>Image</Text>
                {/* ✅ picker works here too */}
                <PhotoPicker uriOrAsset={img} onChange={setImg} />

                <Text style={{ color: C.subtext, marginBottom: 6 }}>CTA Button Text</Text>
                <TextInput
                  value={ctaText}
                  onChangeText={setCtaText}
                  placeholder="Shop"
                  placeholderTextColor={C.subtext}
                  style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}
                />

                <Text style={{ color: C.subtext, marginBottom: 6 }}>CTA Link (full URL)</Text>
                <TextInput
                  value={ctaUrl}
                  onChangeText={setCtaUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                  placeholder="https://brand.com/product"
                  placeholderTextColor={C.subtext}
                  style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}
                />

                <Text style={{ color: C.subtext, marginBottom: 6 }}>Weight</Text>
                <TextInput
                  value={weight}
                  onChangeText={setWeight}
                  keyboardType="number-pad"
                  placeholder="3"
                  placeholderTextColor={C.subtext}
                  style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}
                />

                <HapticButton
                  disabled={busy}
                  onPress={add}
                  style={{ backgroundColor: C.accent, padding: 14, borderRadius: RADIUS.lg, alignItems: "center", opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <ActivityIndicator /> : <Text style={{ color: "#001018", fontWeight: "900" }}>Add Creative</Text>}
                </HapticButton>
              </View>
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
