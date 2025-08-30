// app/(tabs)/capture.tsx
// CAPTURE (ELI5):
// 1) Make a new recipe row in the "recipes" table (title, time, servings, etc.)
// 2) Upload the picture into the "recipe-images" storage bucket and store its link on the recipe
// 3) Add each ingredient line into "recipe_ingredients" (one row per line)
// 4) Add each step line into "recipe_steps" (one row per line)

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";

import { fetchOgForUrl } from "@/lib/og";
import { uploadFromUri } from "@/lib/uploads"; // <- now exists and we use the real storage bucket name
import IngredientRow from "@/components/IngredientRow"; // adjust path if needed

import { isTikTokUrl, tiktokOEmbedThumbnail, TikTokSnap } from "@/lib/tiktok";

// simple colors
const COLORS = {
  bg: "#0B1120",
  card: "#111827",
  sunken: "#1F2937",
  text: "#E5E7EB",
  sub: "#9CA3AF",
  accent: "#60A5FA",
  green: "#49B265",
  red: "#EF4444",
  border: "#243042",
};

type ImageSourceState =
  | { kind: "none" }
  | { kind: "url-og"; url: string; resolvedImageUrl: string }
  | { kind: "picker"; localUri: string }
  | { kind: "camera"; localUri: string };

// 1) find first http(s) URL in any pasted text
function extractFirstUrl(s: string): string | null {
  if (!s) return null;
  const match = s.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

// 2) small timeout helper (used for TikTok oEmbed quick try)
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

export default function CaptureScreen() {
  // basic fields
  const [pastedUrl, setPastedUrl] = useState("");
  const [title, setTitle] = useState("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState<string[]>([""]);
  const [steps, setSteps] = useState<string[]>([""]);

  // image state
  const [img, setImg] = useState<ImageSourceState>({ kind: "none" });
  const [loadingOg, setLoadingOg] = useState(false);
  const [saving, setSaving] = useState(false);

  // TikTok snap modal
  const [snapVisible, setSnapVisible] = useState(false);
  const [snapUrl, setSnapUrl] = useState("");
  const [snapReloadKey, setSnapReloadKey] = useState(0);

  const lastResolvedUrlRef = useRef<string>("");

  // ==== IMPORT / PREVIEW =====================================================
  const resolveOg = useCallback(
    async (raw: string) => {
      const url = extractFirstUrl(raw?.trim() || "");
      if (!url) {
        setImg({ kind: "none" });
        Alert.alert("Link error", "Please paste a full link that starts with http(s)://");
        return;
      }

      if (isTikTokUrl(url)) {
        try {
          const thumb = await withTimeout(tiktokOEmbedThumbnail(url), 1200).catch(() => null);
          if (thumb) {
            setImg({ kind: "url-og", url, resolvedImageUrl: thumb });
            lastResolvedUrlRef.current = url;
            return;
          }
        } catch {}
        // fallback: open snap modal to screenshot
        setImg({ kind: "none" });
        setSnapUrl(url);
        setSnapReloadKey((k) => k + 1);
        setSnapVisible(true);
        return;
      }

      try {
        const out = await fetchOgForUrl(url);
        if (out?.image) {
          setImg({ kind: "url-og", url, resolvedImageUrl: out.image });
          lastResolvedUrlRef.current = url;
          if (out?.title && !title.trim()) setTitle(out.title);
        } else {
          setImg({ kind: "none" });
          Alert.alert("No image found on that page", out?.error || "Try a different link or add a photo.");
        }
      } catch (e: any) {
        setImg({ kind: "none" });
        Alert.alert("Link error", e?.message || "Could not read that webpage.");
      }
    },
    [title]
  );

  const onPick = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission needed to pick a photo.");
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.92,
    });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    setPastedUrl("");
    setImg({ kind: "picker", localUri: r.assets[0].uri });
    Haptics.selectionAsync();
  }, []);

  const onCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return Alert.alert("Permission needed to use camera.");
    const r = await ImagePicker.launchCameraAsync({ quality: 0.92 });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    setPastedUrl("");
    setImg({ kind: "camera", localUri: r.assets[0].uri });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const onPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;
    setPastedUrl(text.trim());
    Haptics.selectionAsync();
  }, []);

  const onImport = useCallback(() => {
    if (!pastedUrl || pastedUrl.trim().length < 5) {
      Alert.alert("Paste a link first.");
      return;
    }
    Haptics.selectionAsync();
    setLoadingOg(true);
    lastResolvedUrlRef.current = "";
    setImg({ kind: "none" });
    setSnapVisible(false);
    Promise.resolve()
      .then(() => resolveOg(pastedUrl.trim()))
      .finally(() => setLoadingOg(false));
  }, [pastedUrl, resolveOg]);

  const previewUri = useMemo(() => {
    switch (img.kind) {
      case "url-og":
        return img.resolvedImageUrl;
      case "picker":
      case "camera":
        return img.localUri;
      default:
        return "";
    }
  }, [img]);

  // ==== SAVE ================================================================
  const onSave = useCallback(async () => {
    try {
      Haptics.selectionAsync();

      // require login
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        Alert.alert("Please sign in first.");
        return;
      }

      // light validation
      if (!title.trim() && !previewUri) {
        Alert.alert("Need something to save", "Add a title or a photo.");
        return;
      }

      setSaving(true);

      // 1) insert base recipe (NO ingredients / steps columns here)
      const { data: insertData, error: insertErr } = await supabase
        .from("recipes")
        .insert({
          user_id: user.id,
          source_url: pastedUrl || null,
          title: title || null,
          minutes: timeMinutes ? Number(timeMinutes) : null,
          servings: servings ? Number(servings) : null,
          image_url: null, // we’ll fill this after upload
        })
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      const recipeId = insertData.id as string;

      // 2) upload image to STORAGE bucket "recipe-images" and patch recipes.image_url
      if (previewUri) {
        const storedImageUrl = await uploadFromUri({
          uri: previewUri,
          storageBucket: "recipe-images", // ✅ storage bucket (NOT the table name)
          path: `${user.id}/${recipeId}/images/${Date.now()}.jpg`,
          contentType: "image/jpeg",
        });
        const { error: updateErr } = await supabase
          .from("recipes")
          .update({ image_url: storedImageUrl })
          .eq("id", recipeId);
        if (updateErr) throw updateErr;
      }

      // 3) insert ingredients into recipe_ingredients (one row per line)
      // we’ll assume columns: recipe_id (uuid), line_no (int), text (text)
      const ingRows = ingredients
  .map((t, i) => t.trim())
  .filter(Boolean)
  .map((t, i) => ({
    recipe_id: recipeId,  // link back to recipe
    pos: i + 1,           // use pos column for ordering
    text: t,              // the ingredient text
  }));
      if (ingRows.length > 0) {
        const { error: ingErr } = await supabase.from("recipe_ingredients").insert(ingRows);
        if (ingErr) {
          // don’t kill the whole save; just warn
          console.warn("ingredients insert failed", ingErr);
        }
      }

      // 4) insert steps into recipe_steps (one row per line)
      // we’ll assume columns: recipe_id (uuid), step_no (int), text (text)
      const stepLines = steps
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t, idx) => ({ recipe_id: recipeId, step_no: idx + 1, text: t }));
      if (stepLines.length > 0) {
        const { error: stepErr } = await supabase.from("recipe_steps").insert(stepLines);
        if (stepErr) {
          console.warn("steps insert failed", stepErr);
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved!", "Your recipe is in the cloud.");

      // 5) reset the form
      setPastedUrl("");
      setTitle("");
      setTimeMinutes("");
      setServings("");
      setIngredients([""]);
      setSteps([""]);
      setImg({ kind: "none" });
      lastResolvedUrlRef.current = "";
    } catch (e: any) {
      console.error("Save failed:", e);
      Alert.alert("Save failed", e?.message || "Unknown error");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  }, [pastedUrl, title, timeMinutes, servings, ingredients, steps, previewUri]);

  // list helpers
  const setIngredient = (i: number, v: string) =>
    setIngredients((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  const addIngredient = () => {
    setIngredients((arr) => [...arr, ""]);
    Haptics.selectionAsync();
  };
  const delIngredient = (i: number) => {
    setIngredients((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : [""]));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const setStep = (i: number, v: string) => setSteps((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  const addStep = () => {
    setSteps((arr) => [...arr, ""]);
    Haptics.selectionAsync();
  };
  const delStep = (i: number) => {
    setSteps((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : [""]));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // ==== UI ==================================================================
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "700", marginBottom: 8 }}>
          Capture
        </Text>

        {/* URL + actions */}
        <View
          style={{
            backgroundColor: COLORS.card,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Paste YouTube/TikTok/blog URL</Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TextInput
              value={pastedUrl}
              onChangeText={setPastedUrl}
              placeholder="https://…"
              placeholderTextColor={COLORS.sub}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                flex: 1,
                color: COLORS.text,
                backgroundColor: COLORS.sunken,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 10,
                marginRight: 8,
              }}
              editable={!saving}
            />
            <TouchableOpacity
              onPress={onPaste}
              disabled={saving || loadingOg}
              style={{
                backgroundColor: COLORS.sunken,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                marginRight: 8,
                opacity: saving || loadingOg ? 0.6 : 1,
              }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "600" }}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onImport()}
              disabled={saving || loadingOg}
              style={{
                backgroundColor: COLORS.accent,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                opacity: saving || loadingOg ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#0B1120", fontWeight: "700" }}>
                {loadingOg ? "Importing…" : "Import"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Photo preview */}
        <View
          style={{
            backgroundColor: COLORS.card,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Photo</Text>
          {previewUri ? (
            <Image
              source={{ uri: previewUri }}
              style={{ width: "100%", height: 220, borderRadius: 12 }}
              contentFit="cover"
              cachePolicy="none"
            />
          ) : (
            <View
              style={{
                height: 220,
                borderRadius: 12,
                backgroundColor: COLORS.sunken,
                borderWidth: 1,
                borderColor: COLORS.border,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="image-outline" size={44} color={COLORS.sub} />
              <Text style={{ color: COLORS.sub, marginTop: 6 }}>No photo yet</Text>
            </View>
          )}
          <View style={{ flexDirection: "row", marginTop: 10 }}>
            <TouchableOpacity
              onPress={onPick}
              disabled={saving}
              style={{
                backgroundColor: COLORS.sunken,
                padding: 12,
                borderRadius: 10,
                flex: 1,
                marginRight: 10,
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Text style={{ color: COLORS.text, textAlign: "center", fontWeight: "600" }}>
                Pick from Library
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onCamera}
              disabled={saving}
              style={{
                backgroundColor: COLORS.accent,
                padding: 12,
                borderRadius: 10,
                flex: 1,
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#0B1120", textAlign: "center", fontWeight: "700" }}>
                Take Photo
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Basics */}
        <View
          style={{
            backgroundColor: COLORS.card,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g., Creamy Garlic Pasta"
            placeholderTextColor={COLORS.sub}
            style={{
              color: COLORS.text,
              backgroundColor: COLORS.sunken,
              paddingHorizontal: 12,
              paddingVertical: 12,
              borderRadius: 10,
              marginBottom: 12,
            }}
            editable={!saving}
          />
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Time (minutes)</Text>
              <TextInput
                value={timeMinutes}
                onChangeText={setTimeMinutes}
                placeholder="e.g., 25"
                keyboardType="numeric"
                placeholderTextColor={COLORS.sub}
                style={{
                  color: COLORS.text,
                  backgroundColor: COLORS.sunken,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderRadius: 10,
                }}
                editable={!saving}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Servings</Text>
              <TextInput
                value={servings}
                onChangeText={setServings}
                placeholder="e.g., 4"
                keyboardType="numeric"
                placeholderTextColor={COLORS.sub}
                style={{
                  color: COLORS.text,
                  backgroundColor: COLORS.sunken,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderRadius: 10,
                }}
                editable={!saving}
              />
            </View>
          </View>
        </View>

        {/* Ingredients */}
        <View
          style={{
            backgroundColor: COLORS.card,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "700", marginBottom: 8 }}>Ingredients</Text>
          {ingredients.map((line, i) => (
  <IngredientRow
    key={`ing-${i}`}
    value={line}
    onChange={(t) => setIngredient(i, t)}
    onRemove={() => delIngredient(i)}
  />
))}

          <TouchableOpacity
            onPress={addIngredient}
            disabled={saving}
            style={{
              backgroundColor: COLORS.sunken,
              padding: 12,
              borderRadius: 10,
              alignItems: "center",
              marginTop: 4,
              opacity: saving ? 0.6 : 1,
            }}
          >
            <Text style={{ color: COLORS.text, fontWeight: "600" }}>+ Add Ingredient</Text>
          </TouchableOpacity>
        </View>

        {/* Steps */}
        <View
          style={{
            backgroundColor: COLORS.card,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "700", marginBottom: 8 }}>Steps</Text>
          {steps.map((line, i) => (
            <View
              key={`step-${i}`}
              style={{
                backgroundColor: COLORS.sunken,
                borderRadius: 10,
                padding: 10,
                marginBottom: 8,
                borderWidth: 1,
                borderColor: COLORS.border,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={{ color: COLORS.text, fontWeight: "700" }}>{i + 1}.</Text>
                <TouchableOpacity onPress={() => delStep(i)} disabled={saving}>
                  <Text style={{ color: "#FCA5A5", fontWeight: "700", opacity: saving ? 0.6 : 1 }}>
                    Remove
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={line}
                onChangeText={(v) => setStep(i, v)}
                placeholder="Type what to do in this step…"
                placeholderTextColor={COLORS.sub}
                multiline
                style={{ color: COLORS.text, minHeight: 60, textAlignVertical: "top" }}
                editable={!saving}
              />
            </View>
          ))}
          <TouchableOpacity
            onPress={addStep}
            disabled={saving}
            style={{
              backgroundColor: COLORS.sunken,
              padding: 12,
              borderRadius: 10,
              alignItems: "center",
              marginTop: 4,
              opacity: saving ? 0.6 : 1,
            }}
          >
            <Text style={{ color: COLORS.text, fontWeight: "600" }}>+ Add Step</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Save bar */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: 12,
          backgroundColor: COLORS.bg,
          borderTopWidth: 1,
          borderColor: COLORS.border,
        }}
      >
        <TouchableOpacity
          onPress={onSave}
          disabled={saving}
          style={{
            backgroundColor: COLORS.green,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            gap: 8,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving && <ActivityIndicator size="small" color="#fff" />}
          <Text style={{ color: "#fff", fontWeight: "800" }}>
            {saving ? "Saving…" : "Save to Cloud"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* TikTok snap modal (only when needed) */}
      <TikTokSnap
        url={snapUrl}
        visible={snapVisible}
        reloadKey={snapReloadKey}
        zoom={1.75}
        focusY={0.4}
        onCancel={() => setSnapVisible(false)}
        onFound={(uriOrUrl) => {
          setSnapVisible(false);
          if (uriOrUrl.startsWith("http")) {
            setImg({ kind: "url-og", url: snapUrl, resolvedImageUrl: uriOrUrl });
          } else {
            setImg({ kind: "picker", localUri: uriOrUrl }); // screenshot fallback
          }
          lastResolvedUrlRef.current = snapUrl;
        }}
      />
    </KeyboardAvoidingView>
  );
}
