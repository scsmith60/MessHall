// app/(tabs)/owner/create-slot.tsx
// 🧒 like I'm 5:
// Make a new ad slot. Pick picture, dates, link. When we save,
// we write BOTH sets of date columns so everything stays in sync:
//   starts_at + active_from, ends_at + active_to

import React, { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { COLORS, RADIUS, SPACING } from "../../../lib/theme";
import HapticButton from "../../../components/ui/HapticButton";
import PhotoPicker, { MaybeAsset } from "../../../components/PhotoPicker";
import { uploadAdImage } from "../../../lib/uploads";

export default function CreateSponsoredSlot() {
  // 🎨 small theme grab so it matches your app
  const C = useMemo(
    () => ({ bg: COLORS.bg, card: COLORS.card, text: COLORS.text, subtext: COLORS.subtext, accent: COLORS.accent }),
    []
  );

  // 📝 form state
  const [brand, setBrand] = useState("");
  const [title, setTitle] = useState("");
  const [image, setImage] = useState<MaybeAsset | undefined>(undefined);
  const [ctaUrl, setCtaUrl] = useState("https://brand.com/product");
  const [startsAt, setStartsAt] = useState<string>(""); // YYYY-MM-DD
  const [endsAt, setEndsAt] = useState<string>("");     // YYYY-MM-DD
  const [weight, setWeight] = useState<string>("5");
  const [busy, setBusy] = useState(false);

  // 📤 upload image if needed
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

      // ✅ write to BOTH column names for compatibility
      const payload = {
        brand: brand || null,
        title: title || null,
        image_url: image_url || null,
        cta_url: ctaUrl || null,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        active_from: startsAt || null,
        active_to: endsAt || null,
        weight: Number(weight) || 1,
        is_active: true,
      };

      const { error } = await supabase.from("sponsored_slots").insert(payload as any);
      if (error) throw error;

      router.replace("/(tabs)/owner/owner-slots");
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg }}>
          <Text style={{ color: C.text, fontSize: 22, fontWeight: "900", marginBottom: 12 }}>Create Sponsored Slot</Text>

          <Text style={{ color: C.subtext, marginBottom: 6 }}>Brand</Text>
          <TextInput value={brand} onChangeText={setBrand} placeholder="Acme Foods" placeholderTextColor={C.subtext}
            style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

          <Text style={{ color: C.subtext, marginBottom: 6 }}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="New Garlic Press!" placeholderTextColor={C.subtext}
            style={{ backgroundColor: C.card, color: C.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

          <Text style={{ color: C.subtext, marginBottom: 6 }}>Image</Text>
          <PhotoPicker uriOrAsset={image} onChange={setImage} />

          <Text style={{ color: C.subtext, marginTop: 8, marginBottom: 6 }}>CTA Link (full URL)</Text>
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
            {busy ? <ActivityIndicator /> : <>
              <Ionicons name="checkmark-circle" size={18} color="#001018" />
              <Text style={{ color: "#001018", fontWeight: "900" }}>Save Slot</Text>
            </>}
          </HapticButton>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
