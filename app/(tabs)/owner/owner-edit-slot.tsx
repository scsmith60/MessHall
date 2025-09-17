// app/(tabs)/owner/owner-edit-slot.tsx
// 🧒 like I'm 5:
// Edit a slot. We READ dates using firstDefined(starts_at, active_from) etc,
// and on SAVE we WRITE both sets: starts_at + active_from, ends_at + active_to.
// This fixes your "active_to = NULL" problem.

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { COLORS, RADIUS, SPACING } from "../../../lib/theme";
import PhotoPicker, { MaybeAsset } from "../../../components/PhotoPicker";
import HapticButton from "../../../components/ui/HapticButton";
import { uploadAdImage } from "../../../lib/uploads";

const firstDefined = <T,>(...vals: (T | null | undefined)[]) =>
  vals.find(v => typeof v !== "undefined" && v !== null) as T | undefined;

export default function EditSlot() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const C = useMemo(
    () => ({ bg: COLORS.bg, card: COLORS.card, text: COLORS.text, subtext: COLORS.subtext, accent: COLORS.accent }),
    []
  );

  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState("");
  const [title, setTitle] = useState("");
  const [image, setImage] = useState<MaybeAsset | undefined>(undefined);
  const [ctaUrl, setCtaUrl] = useState("");
  const [startsAt, setStartsAt] = useState<string>("");
  const [endsAt, setEndsAt] = useState<string>("");
  const [weight, setWeight] = useState<string>("1");
  const [active, setActive] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("sponsored_slots").select("*").eq("id", id).single();
      if (error) {
        Alert.alert("Load failed", error.message);
        return;
      }
      setBrand(data?.brand ?? "");
      setTitle(data?.title ?? "");
      setImage(data?.image_url ?? undefined);
      setCtaUrl(data?.cta_url ?? "");
      setStartsAt(firstDefined<string>(data?.starts_at, data?.active_from) ?? "");
      setEndsAt(firstDefined<string>(data?.ends_at, data?.active_to) ?? "");
      setWeight(String(data?.weight ?? "1"));
      setActive(Boolean(data?.is_active ?? true));
    })();
  }, [id]);

  const uploadIfNeeded = async (): Promise<string | null> => {
    if (!image) return null;
    if (typeof image === "string") return image || null;
    if (!image.uri) return null;
    return await uploadAdImage(image.uri);
  };

  const save = async () => {
    try {
      setBusy(true);
      const image_url = await uploadIfNeeded();

      const payload = {
        brand: brand || null,
        title: title || null,
        image_url: image_url ?? (typeof image === "string" ? image : null),
        cta_url: ctaUrl || null,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        active_from: startsAt || null, // <-- keep both in sync
        active_to: endsAt || null,     // <--
        weight: Number(weight) || 1,
        is_active: !!active,
      };

      const { error } = await supabase.from("sponsored_slots").update(payload as any).eq("id", id);
      if (error) throw error;
      router.back();
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    Alert.alert("Delete slot?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("sponsored_slots").delete().eq("id", id);
          if (error) Alert.alert("Delete failed", error.message);
          else router.replace("/(tabs)/owner/owner-slots");
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg }}>
          <Text style={{ color: C.text, fontSize: 22, fontWeight: "900", marginBottom: 12 }}>Edit Slot</Text>

          <Text style={{ color: C.subtext, marginBottom: 6 }}>Brand</Text>
          <TextInput value={brand} onChangeText={setBrand} placeholder="Acme Foods" placeholderTextColor={C.subtext}
            style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

          <Text style={{ color: C.subtext, marginBottom: 6 }}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="New Garlic Press!" placeholderTextColor={C.subtext}
            style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

          <Text style={{ color: C.subtext, marginBottom: 6 }}>Image</Text>
          <PhotoPicker uriOrAsset={image} onChange={setImage} />

          <Text style={{ color: C.subtext, marginBottom: 6, marginTop: 8 }}>CTA Link (full URL)</Text>
          <TextInput value={ctaUrl} onChangeText={setCtaUrl} autoCapitalize="none" keyboardType="url" placeholder="https://brand.com/product" placeholderTextColor={C.subtext}
            style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

          <Text style={{ color: C.subtext, marginBottom: 6 }}>Start Date (YYYY-MM-DD)</Text>
          <TextInput value={startsAt} onChangeText={setStartsAt} placeholder="2025-09-16" placeholderTextColor={C.subtext}
            style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

          <Text style={{ color: C.subtext, marginBottom: 6 }}>End Date (YYYY-MM-DD)</Text>
          <TextInput value={endsAt} onChangeText={setEndsAt} placeholder="2025-09-18" placeholderTextColor={C.subtext}
            style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

          <Text style={{ color: C.subtext, marginBottom: 6 }}>Weight</Text>
          <TextInput value={weight} onChangeText={setWeight} keyboardType="number-pad" placeholder="5" placeholderTextColor={C.subtext}
            style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

          <HapticButton disabled={busy} onPress={save}
            style={{ backgroundColor: C.accent, padding: 14, borderRadius: RADIUS.lg, alignItems: "center", opacity: busy ? 0.6 : 1 }}>
            {busy ? <ActivityIndicator /> : <Text style={{ color: "#001018", fontWeight: "900" }}>Save Changes</Text>}
          </HapticButton>

          <HapticButton onPress={remove}
            style={{ backgroundColor: "rgba(239,68,68,0.15)", padding: 14, borderRadius: RADIUS.lg, alignItems: "center", marginTop: 12 }}>
            <Text style={{ color: "#ffd1d1", fontWeight: "900" }}>Delete Slot</Text>
          </HapticButton>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
