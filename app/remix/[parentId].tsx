// app/remix/[parentId].tsx
// LIKE I'M 5:
// - You can KEEP the parent's image or PICK/TAKE a new picture.
// - No typing URLs (those break). We upload the photo to Supabase storage for you.
// - Ingredients/steps come from recipe_ingredients/recipe_steps (no recipes.ingredients).
// - Save = create new recipe (parent_recipe_id set), then clone child rows.

import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  Image as RNImage,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import HapticButton from "@/components/ui/HapticButton";
import { COLORS, RADIUS, SPACING } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { tap, success, warn } from "@/lib/haptics";

// tiny helper to make an id
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

type StepRow = { text: string; seconds?: number | null };
type IngredientRow = { text: string };

export default function RemixEditor() {
  const { parentId } = useLocalSearchParams<{ parentId: string }>();
  const router = useRouter();

  // form state
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // title + image
  const [title, setTitle] = useState("");
  const [parentImageUrl, setParentImageUrl] = useState<string>("");  // original's image
  const [newImageUri, setNewImageUri] = useState<string | null>(null); // local device photo user picked
  const [uploading, setUploading] = useState(false);

  // lines
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);

  function showError(m: string) {
    setErr(m);
    setTimeout(() => setErr((e) => (e === m ? null : e)), 5000);
  }

  /* 1) Load parent + children */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!parentId) { showError("Missing parent id."); return; }

        // parent recipe: only fields we need
        const { data: parent, error: pErr } = await supabase
          .from("recipes")
          .select("id,title,image_url")
          .eq("id", parentId)
          .maybeSingle();
        if (pErr || !parent) { showError("We couldn't find that recipe to remix."); return; }

        if (!alive) return;

        setTitle(`Remix: ${parent.title ?? "Untitled"}`);
        setParentImageUrl(parent.image_url ?? "");

        // ingredients
        const { data: ingRows } = await supabase
          .from("recipe_ingredients")
          .select("pos,text")
          .eq("recipe_id", parentId)
          .order("pos", { ascending: true, nullsFirst: true });
        if (Array.isArray(ingRows)) {
          setIngredients(ingRows.map((r: any) => ({ text: r?.text ?? "" })).filter(r => r.text));
        }

        // steps
        const { data: stepRows } = await supabase
          .from("recipe_steps")
          .select("pos,text,seconds")
          .eq("recipe_id", parentId)
          .order("pos", { ascending: true, nullsFirst: true });
        if (Array.isArray(stepRows)) {
          setSteps(stepRows.map((r: any) => ({
            text: r?.text ?? "",
            seconds: typeof r?.seconds === "number" ? r.seconds : null,
          })).filter(r => r.text));
        }
      } catch (e: any) { showError(e?.message ?? "Something went wrong."); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [parentId]);

  /* 2) Photo picking (library + camera) */
  async function pickFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { showError("Permission needed to open your photos."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.9,
    });
    if (!res.canceled && res.assets?.[0]?.uri) setNewImageUri(res.assets[0].uri);
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { showError("Permission needed to use the camera."); return; }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.85,
    });
    if (!res.canceled && res.assets?.[0]?.uri) setNewImageUri(res.assets[0].uri);
  }

  // upload to Supabase Storage (bucket: recipe-images). returns the storage path.
  async function uploadImageToStorage(localUri: string, userId: string) {
    setUploading(true);
    try {
      const fileResp = await fetch(localUri);
      const blob = await fileResp.blob();
      const ext = (blob.type?.split("/")[1] ?? "jpg").replace(/[^a-z0-9]/gi, "");
      const path = `${userId}/${uid()}.${ext}`; // e.g., "user/abc123.jpg"

      const { error } = await supabase
        .storage
        .from("recipe-images")
        .upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });

      if (error) throw error;
      return path; // we store this in recipes.image_url
    } finally {
      setUploading(false);
    }
  }

  /* 3) Save Remix */
  async function saveRemix() {
    try {
      await tap();
      setErr(null);

      const trimmed = title.trim();
      if (!trimmed) { showError("Please add a title."); return; }

      // who am I
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user;
      if (!me) { await warn(); showError("Please sign in to post a Remix."); return; }

      // If user picked a new photo, upload it first
      let imagePath: string | null = parentImageUrl || null;
      if (newImageUri) {
        imagePath = await uploadImageToStorage(newImageUri, me.id);
      }

      // create NEW recipe row (credit link)
      const { data: r, error: insErr } = await supabase
        .from("recipes")
        .insert([{
          title: trimmed,
          image_url: imagePath,     // either parent image or our new upload path
          user_id: me.id,
          parent_recipe_id: parentId,
          is_private: false,        // privacy/monetization stay on the Edit page, not here
        }])
        .select("id")
        .single();

      if (insErr || !r?.id) { showError(insErr?.message ?? "Could not create recipe."); return; }
      const newId: string = r.id;

      // clone ingredients (pos + text)
      const ingPayload = ingredients.map((row, i) => ({
        recipe_id: newId,
        pos: i + 1,
        text: (row.text ?? "").trim(),
      })).filter(r => r.text.length > 0);

      if (ingPayload.length) {
        const { error } = await supabase.from("recipe_ingredients").insert(ingPayload);
        if (error) { showError(error.message ?? "Could not copy ingredients."); return; }
      }

      // clone steps (pos + text + optional seconds)
      const stepPayload = steps.map((row, i) => ({
        recipe_id: newId,
        pos: i + 1,
        text: (row.text ?? "").trim(),
        ...(typeof row.seconds === "number" && row.seconds >= 0 ? { seconds: row.seconds } : {}),
      })).filter(r => r.text.length > 0);

      if (stepPayload.length) {
        const { error } = await supabase.from("recipe_steps").insert(stepPayload);
        if (error) { showError(error.message ?? "Could not copy steps."); return; }
      }

      await success();
      router.replace(`/recipe/${newId}`);
    } catch (e: any) {
      await warn();
      showError(e?.message ?? "Save failed.");
    }
  }

  /* 4) UI */
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* tiny dark error banner (on-brand) */}
      {err ? (
        <View style={{
          backgroundColor: "#3b0f0f", borderColor: "#7f1d1d", borderWidth: 1,
          paddingVertical: 10, paddingHorizontal: 12, margin: 12, borderRadius: 12,
          flexDirection: "row", alignItems: "center", gap: 8,
        }}>
          <Ionicons name="alert-circle" size={16} color="#fecaca" />
          <Text style={{ color: "#fecaca", fontWeight: "800", flex: 1 }}>{err}</Text>
          <TouchableOpacity onPress={() => setErr(null)} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
            <Ionicons name="close" size={16} color="#fecaca" />
          </TouchableOpacity>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900", marginBottom: 10 }}>
            {loading ? "Loading Remix…" : "Make your Remix"}
          </Text>

          {/* Title */}
          <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="My yummy version"
            placeholderTextColor="#64748b"
            style={{ color: "white", backgroundColor: "#1e293b", borderRadius: 12, padding: 12, marginBottom: 12 }}
          />

          {/* Images: Current vs New (no URL typing) */}
          <Text style={{ color: COLORS.text, marginBottom: 6 }}>Images</Text>
          <View style={{ flexDirection: "row", gap: 12, marginBottom: 8 }}>
            {/* Current */}
            <View style={{ flex: 1, backgroundColor: "#0b1220", borderRadius: 12, borderColor: "#2c3a4d", borderWidth: 1, padding: 8 }}>
              <Text style={{ color: "#94a3b8", fontWeight: "800", marginBottom: 6 }}>Current</Text>
              {parentImageUrl ? (
                <RNImage source={{ uri: parentImageUrl }} style={{ width: "100%", height: 140, borderRadius: 10 }} />
              ) : (
                <View style={{ height: 140, borderRadius: 10, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="image-outline" size={20} color="#64748b" />
                  <Text style={{ color: "#64748b", marginTop: 6, fontSize: 12 }}>No image on parent</Text>
                </View>
              )}
            </View>

            {/* New (tap to use) */}
            <View style={{ flex: 1, backgroundColor: "#0b1220", borderRadius: 12, borderColor: "#2c3a4d", borderWidth: 1, padding: 8 }}>
              <Text style={{ color: "#94a3b8", fontWeight: "800", marginBottom: 6 }}>New (tap to use)</Text>
              <TouchableOpacity onPress={pickFromLibrary} activeOpacity={0.85}>
                {newImageUri ? (
                  <RNImage source={{ uri: newImageUri }} style={{ width: "100%", height: 140, borderRadius: 10 }} />
                ) : (
                  <View style={{ height: 140, borderRadius: 10, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="images-outline" size={20} color="#64748b" />
                    <Text style={{ color: "#64748b", marginTop: 6, fontSize: 12 }}>Tap to pick photo</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Photo actions */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
            <HapticButton onPress={pickFromLibrary} style={{ backgroundColor: COLORS.card, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#2c3a4d", flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Ionicons name="images-outline" size={16} color={COLORS.text} />
              <Text style={{ color: COLORS.text, fontWeight: "800" }}>Photo Library</Text>
            </HapticButton>
            <HapticButton onPress={takePhoto} style={{ backgroundColor: COLORS.card, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: "#2c3a4d", flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Ionicons name="camera-outline" size={16} color={COLORS.text} />
              <Text style={{ color: COLORS.text, fontWeight: "800" }}>Take Photo</Text>
            </HapticButton>
            {uploading ? (
              <View style={{ justifyContent: "center" }}>
                <Text style={{ color: "#94a3b8" }}>Uploading…</Text>
              </View>
            ) : null}
          </View>

          {/* Ingredients */}
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>
            Ingredients
          </Text>
          {ingredients.map((ing, i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 }}>
              <TextInput
                value={ing.text}
                onChangeText={(t) => setIngredients((a) => a.map((v, idx) => (idx === i ? { text: t } : v)))}
                placeholder={`Ingredient ${i + 1}`}
                placeholderTextColor="#64748b"
                style={{ flex: 1, color: "white", backgroundColor: "#1e293b", borderRadius: 10, padding: 10 }}
              />
              <HapticButton onPress={() => setIngredients((a) => a.filter((_, idx) => idx !== i))} style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "#7f1d1d", borderRadius: 10 }}>
                <Text style={{ color: "white", fontWeight: "800" }}>X</Text>
              </HapticButton>
            </View>
          ))}
          <HapticButton onPress={() => setIngredients((a) => [...a, { text: "" }])} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: "center" }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Ingredient</Text>
          </HapticButton>

          {/* Steps */}
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>
              Steps
            </Text>
            {steps.map((st, i) => (
              <View key={i} style={{ marginBottom: 10, gap: 6 }}>
                <TextInput
                  value={st.text}
                  onChangeText={(t) => setSteps((a) => a.map((v, idx) => (idx === i ? { ...v, text: t } : v)))}
                  placeholder="Write what to do…"
                  placeholderTextColor="#64748b"
                  multiline
                  style={{ color: "white", backgroundColor: "#1e293b", borderRadius: 10, padding: 10, minHeight: 60 }}
                />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: "#94a3b8" }}>Seconds (optional)</Text>
                  <TextInput
                    value={typeof st.seconds === "number" && st.seconds >= 0 ? String(st.seconds) : ""}
                    onChangeText={(t) => setSteps((a) => a.map((v, idx) => (idx === i ? { ...v, seconds: t.trim() === "" || Number.isNaN(+t) ? null : Math.max(0, Math.floor(+t)) } : v)))}
                    keyboardType="number-pad"
                    placeholder="e.g., 90"
                    placeholderTextColor="#64748b"
                    style={{ flex: 1, color: "white", backgroundColor: "#0f172a", borderRadius: 10, padding: 10 }}
                  />
                </View>
              </View>
            ))}
            <HapticButton onPress={() => setSteps((a) => [...a, { text: "", seconds: null }])} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: "center" }}>
              <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Step</Text>
            </HapticButton>
          </View>

          {/* Save */}
          <View style={{ marginTop: 22, flexDirection: "row", justifyContent: "flex-end" }}>
            <HapticButton onPress={saveRemix} style={{
              backgroundColor: "#183B2B",
              borderWidth: 1, borderColor: "#2BAA6B",
              paddingVertical: 12, paddingHorizontal: 16,
              borderRadius: RADIUS.lg, flexDirection: "row", alignItems: "center", gap: 8,
            }}>
              <Ionicons name="save-outline" size={16} color="#CFF8D6" />
              <Text style={{ color: "#CFF8D6", fontWeight: "900" }}>Save Remix</Text>
            </HapticButton>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
