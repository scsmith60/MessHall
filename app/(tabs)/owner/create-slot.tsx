// app/(tabs)/owner/owner-create-slot.tsx   <-- or create-slot.tsx, either is fine
// 🧸 ELI5: Admin creates a Sponsored Slot (brand, title, image, link, dates, weight).
// Save = upload image + insert row in "sponsored_slots".

import React, { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

// ✅ CORRECT RELATIVE PATHS (we are 3 levels deep from project root):
import { supabase } from "../../../lib/supabase";
import { COLORS, RADIUS, SPACING } from "../../../lib/theme";
import PhotoPicker from "../../../components/PhotoPicker";
import { uploadAdImage } from "../../../lib/uploads";
import HapticButton from "../../../components/ui/HapticButton";

type MaybeAsset =
  | string
  | { uri?: string | null; mimeType?: string | null; fileName?: string | null };

function need(v: string, min = 1) {
  return (v ?? "").trim().length >= min;
}
function isISODate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((v ?? "").trim());
}
function isUrl(v: string) {
  try {
    new URL((v ?? "").trim());
    return true;
  } catch {
    return false;
  }
}

export default function OwnerCreateSlot() {
  const [brand, setBrand] = useState("");
  const [title, setTitle] = useState("");
  const [ctaText, setCtaText] = useState("Learn more");
  const [ctaUrl, setCtaUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [weight, setWeight] = useState("5");
  const [image, setImage] = useState<MaybeAsset | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const weightNum = useMemo(() => {
    const n = parseInt(weight, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [weight]);

  const save = async () => {
    // must be admin
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      Alert.alert("Sign in required", "Please sign in as an admin.");
      return;
    }
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", uid)
      .maybeSingle();
    if (!prof?.is_admin) {
      Alert.alert("Not allowed", "Only admins can create slots.");
      return;
    }

    // form checks
    if (!need(brand, 2) || !need(title, 2)) {
      Alert.alert("Missing info", "Please enter Brand and Title.");
      return;
    }
    if (!image) {
      Alert.alert("Missing image", "Please pick a sponsor image.");
      return;
    }
    if (!isUrl(ctaUrl)) {
      Alert.alert("Link looks wrong", "Please paste a full URL like https://brand.com");
      return;
    }
    if (!isISODate(startsAt) || !isISODate(endsAt)) {
      Alert.alert("Date format", "Use YYYY-MM-DD, like 2025-09-01");
      return;
    }

    setBusy(true);
    try {
      // upload the image to the bucket at `${uid}/...` (RLS rule)
      const imageUrl = await uploadAdImage(uid, image);

      // insert slot
      const { error } = await supabase.from("sponsored_slots").insert({
        brand: brand.trim(),
        title: title.trim(),
        image_url: imageUrl,
        cta: ctaText.trim(),
        cta_url: ctaUrl.trim(),
        starts_at: new Date(startsAt + "T00:00:00Z").toISOString(),
        ends_at: new Date(endsAt + "T23:59:59Z").toISOString(),
        weight: weightNum,
        is_active: true,
      });

      if (error) throw error;

      Alert.alert("Saved!", "Your sponsored slot is ready (or will start on the start date).");
      router.back();
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.select({ ios: 64, android: 0 })}
    >
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 40 }}>
        {/* header with back */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: COLORS.card,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="chevron-back" size={20} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900" }}>
            Create Sponsored Slot
          </Text>
        </View>

        {/* Brand */}
        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Brand</Text>
        <TextInput
          value={brand}
          onChangeText={setBrand}
          placeholder="Acme Foods"
          placeholderTextColor={COLORS.subtext}
          style={{
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 12,
          }}
        />

        {/* Title */}
        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="New Garlic Press!"
          placeholderTextColor={COLORS.subtext}
          style={{
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 12,
          }}
        />

        {/* Image */}
        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Image</Text>
        <PhotoPicker uriOrAsset={image} onChange={setImage} />

        {/* CTA text + link */}
        <Text style={{ color: COLORS.subtext, marginBottom: 6, marginTop: 12 }}>
          CTA Button Text
        </Text>
        <TextInput
          value={ctaText}
          onChangeText={setCtaText}
          placeholder="Learn more"
          placeholderTextColor={COLORS.subtext}
          style={{
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 12,
          }}
        />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>CTA Link (full URL)</Text>
        <TextInput
          value={ctaUrl}
          onChangeText={setCtaUrl}
          placeholder="https://brand.com/product"
          autoCapitalize="none"
          keyboardType="url"
          placeholderTextColor={COLORS.subtext}
          style={{
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 12,
          }}
        />

        {/* Dates */}
        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>
          Start Date (YYYY-MM-DD)
        </Text>
        <TextInput
          value={startsAt}
          onChangeText={setStartsAt}
          placeholder="2025-09-01"
          placeholderTextColor={COLORS.subtext}
          style={{
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 12,
          }}
        />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>
          End Date (YYYY-MM-DD)
        </Text>
        <TextInput
          value={endsAt}
          onChangeText={setEndsAt}
          placeholder="2025-10-01"
          placeholderTextColor={COLORS.subtext}
          style={{
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 12,
          }}
        />

        {/* Weight */}
        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>
          Weight (how often it shows)
        </Text>
        <TextInput
          value={weight}
          onChangeText={setWeight}
          placeholder="5"
          keyboardType="number-pad"
          placeholderTextColor={COLORS.subtext}
          style={{
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 16,
          }}
        />

        {/* Save */}
        <HapticButton
          onPress={save}
          style={{
            backgroundColor: COLORS.accent,
            padding: 14,
            borderRadius: RADIUS.lg,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            gap: 8,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? (
            <ActivityIndicator />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#001018" />
              <Text style={{ color: "#001018", fontWeight: "900" }}>Save Slot</Text>
            </>
          )}
        </HapticButton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
