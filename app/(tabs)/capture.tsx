// app/(tabs)/capture.tsx
// like i'm 5: paste a link → we fetch smart stuff (title/image/ingredients/steps).
// we now keep title simple: try meta/og; if it's weak on TikTok, open TitleSnap to read the live H1.
// (ingredients/steps/image logic unchanged)

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
import { supabase } from "@/lib/supabase";

// OG (OpenGraph) helper + upload helper
import { fetchOgForUrl } from "@/lib/og";
import { uploadFromUri } from "@/lib/uploads";

// unified smart importer (title + image + ingredients + steps)
import { fetchMeta } from "@/lib/fetch_meta";

// ingredients come back messy → make them neat one-liners
import { normalizeIngredientLines } from "@/lib/ingredients";

// last-ditch caption splitter if needed
import { captionToIngredientLines } from "@/lib/caption_to_ingredients";

// TikTok tools: quick thumbnail + screenshot modal (for IMAGE only, unchanged)
import { tiktokOEmbedThumbnail, TikTokSnap } from "@/lib/tiktok";

// ⬇️ NEW: tiny modal that reads the live DOM title (you said this file already exists)
import TitleSnap from "@/lib/TitleSnap";

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

/* ----------------------------- tiny helpers ----------------------------- */

// find the first http(s) link inside whatever the user pasted
function extractFirstUrl(s: string): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

// small promise timeout (so UI doesn't wait forever)
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

// is the link TikTok? (works for video AND photo posts)
function isTikTokLike(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "www.tiktok.com" || host.endsWith(".tiktok.com") || host === "tiktok.com";
  } catch {
    return /tiktok\.com/i.test(url);
  }
}

// is the title empty/generic/junky? (we'll use TitleSnap if so)
function isWeakTitle(t?: string | null) {
  const s = (t || "").trim();
  if (!s) return true;
  if (/^tiktok$/i.test(s)) return true;
  if (/tiktok/i.test(s) && /make your day/i.test(s)) return true;
  if (/^\d{6,}$/.test(s)) return true; // avoid big numeric IDs
  if (s.length < 4) return true;
  return false;
}

// where our preview image comes from
type ImageSourceState =
  | { kind: "none" }
  | { kind: "url-og"; url: string; resolvedImageUrl: string }
  | { kind: "picker"; localUri: string }
  | { kind: "camera"; localUri: string };

export default function CaptureScreen() {
  // main fields
  const [pastedUrl, setPastedUrl] = useState("");
  const [title, setTitle] = useState("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState<string[]>([""]);
  const [steps, setSteps] = useState<string[]>([""]);

  // import / image state
  const [img, setImg] = useState<ImageSourceState>({ kind: "none" });
  const [loadingOg, setLoadingOg] = useState(false);
  const [saving, setSaving] = useState(false);

  // TikTok screenshot fallback (IMAGE poster), unchanged
  const [snapVisible, setSnapVisible] = useState(false);
  const [snapUrl, setSnapUrl] = useState("");
  const [snapReloadKey, setSnapReloadKey] = useState(0);

  // ⬇️ NEW: TitleSnap (TITLE only)
  const [titleSnapVisible, setTitleSnapVisible] = useState(false);
  const [titleSnapUrl, setTitleSnapUrl] = useState("");

  const lastResolvedUrlRef = useRef<string>("");

  /* ---------------------------- main import flow ---------------------------- */
  const resolveOg = useCallback(
    async (raw: string) => {
      const url = extractFirstUrl(raw?.trim() || "");
      if (!url) {
        setImg({ kind: "none" });
        Alert.alert("Link error", "Please paste a full link that starts with http(s)://");
        return;
      }

      setLoadingOg(true);

      try {
        // do smart meta + OG in parallel
        const [metaRes, ogRes] = await Promise.allSettled([fetchMeta(url), fetchOgForUrl(url)]);
        const meta = metaRes.status === "fulfilled" ? metaRes.value : null;
        const og = ogRes.status === "fulfilled" ? ogRes.value : null;

        /* ------------------------------- TITLE ------------------------------- */
        // kid-simple: try meta → then og; if that still looks weak on TikTok, open TitleSnap
        const current = (title || "").trim();
        const candidate = (meta?.title || og?.title || "").trim();

        // only replace if current is empty/weak (don’t overwrite user-edited titles)
        if (isWeakTitle(current) && candidate) {
          setTitle(candidate);
        }

        // if it's a TikTok link and our best title is still weak → use live DOM snap
        const bestSoFar = isWeakTitle(current) ? candidate : current;
        if (isTikTokLike(url) && isWeakTitle(bestSoFar)) {
          setTitleSnapUrl(url);
          setTitleSnapVisible(true);
        }

        /* ---------------------------- INGREDIENTS ---------------------------- */
        if (meta?.ingredients?.length) {
          const parsed = normalizeIngredientLines(meta.ingredients);
          const canon = parsed.map((p) => p.canonical).filter(Boolean);
          if (canon.length) setIngredients(canon);
        }

        /* -------------------------------- STEPS ------------------------------ */
        if (meta?.steps?.length) {
          setSteps(meta.steps.filter((s) => s && s.trim().length));
        }

        /* -------------------------------- IMAGE ------------------------------ */
        let usedImage = false;
        if (meta?.image) {
          setImg({ kind: "url-og", url, resolvedImageUrl: meta.image });
          usedImage = true;
          lastResolvedUrlRef.current = url;
        } else if (og?.image) {
          setImg({ kind: "url-og", url, resolvedImageUrl: og.image });
          usedImage = true;
          lastResolvedUrlRef.current = url;
        }

        // if TikTok and still no ingredients, try tiny caption split from OG description
        const needIngredients = !(meta?.ingredients?.length) && isTikTokLike(url) && !!og?.description;
        if (needIngredients) {
          const guessed = captionToIngredientLines(og!.description!.trim());
          if (guessed.length) {
            const parsed = normalizeIngredientLines(guessed);
            const canon = parsed.map((p) => p.canonical).filter(Boolean);
            if (canon.length) setIngredients(canon);
          }
        }

        // TikTok quick thumbnail (IMAGE), unchanged
        if (isTikTokLike(url) && !usedImage) {
          try {
            const thumb = await withTimeout(tiktokOEmbedThumbnail(url), 1200).catch(() => null);
            if (thumb) {
              setImg({ kind: "url-og", url, resolvedImageUrl: thumb });
              usedImage = true;
              lastResolvedUrlRef.current = url;
            }
          } catch {}
        }

        // final TikTok fallback → screenshot snapper (IMAGE), unchanged
        if (isTikTokLike(url) && !usedImage) {
          setImg({ kind: "none" });
          setSnapUrl(url);
          setSnapReloadKey((k) => k + 1);
          setSnapVisible(true);
        }
      } catch (e: any) {
        setImg({ kind: "none" });
        Alert.alert("Import error", e?.message || "Could not read that webpage.");
      } finally {
        setLoadingOg(false);
      }
    },
    [title]
  );

  /* ------------------------------- ui helpers ------------------------------ */

  const onPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;
    setPastedUrl(text.trim());
  }, []);

  const pickOrCamera = useCallback(async () => {
    Alert.alert(
      "Add Photo",
      "Choose where to get your picture",
      [
        {
          text: "Camera",
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== "granted") return Alert.alert("Camera permission is required.");
            const r = await ImagePicker.launchCameraAsync({ quality: 0.92, allowsEditing: true, aspect: [4, 3] });
            if (!r.canceled && r.assets?.[0]?.uri) setImg({ kind: "camera", localUri: r.assets[0].uri });
          },
        },
        {
          text: "Gallery",
          onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== "granted") return Alert.alert("Photo permission is required.");
            const r = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.92,
              allowsEditing: true,
              aspect: [4, 3],
            });
            if (!r.canceled && r.assets?.[0]?.uri) setImg({ kind: "picker", localUri: r.assets[0].uri });
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true }
    );
  }, []);

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

  /* --------------------------------- SAVE --------------------------------- */

  const onSave = useCallback(async () => {
    if (!title.trim()) return Alert.alert("Please add a title");

    setSaving(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const { data: me } = await supabase.auth.getUser();
      const uid = me?.user?.id;
      if (!uid) throw new Error("Not signed in");

      const { data: created, error: createErr } = await supabase
        .from("recipes")
        .insert({
          user_id: uid,
          title: title.trim(),
          minutes: timeMinutes ? Number(timeMinutes) : null,
          servings: servings ? Number(servings) : null,
          source_url: lastResolvedUrlRef.current || null,
        })
        .select("id")
        .single();

      if (createErr) throw createErr;
      const recipeId = created?.id as string;

      // upload image if we have one
      const uri =
        img.kind === "url-og"
          ? img.resolvedImageUrl
          : img.kind === "picker" || img.kind === "camera"
          ? img.localUri
          : "";

      if (uri) {
        const path = `${uid}/${recipeId}/images/${Date.now()}.jpg`;
        const publicUrl = await uploadFromUri({
          uri,
          storageBucket: "recipe-images",
          path,
          contentType: "image/jpeg",
        });
        await supabase.from("recipes").update({ image_url: publicUrl }).eq("id", recipeId);
      }

      // ingredients
      const ingLines = ingredients.map((s) => (s || "").trim()).filter(Boolean);
      if (ingLines.length) {
        await supabase.from("recipe_ingredients").insert(
          ingLines.map((text, i) => ({
            recipe_id: recipeId,
            pos: i + 1,
            text,
          }))
        );
      }

      // steps
      const stepLines = steps.map((s) => (s || "").trim()).filter(Boolean);
      if (stepLines.length) {
        await supabase.from("recipe_steps").insert(
          stepLines.map((text, i) => ({
            recipe_id: recipeId,
            pos: i + 1,
            text,
            seconds: null,
          }))
        );
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved!");
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Save failed", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [title, timeMinutes, servings, ingredients, steps, img]);

  /* --------------------------------- UI ---------------------------------- */

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900", marginBottom: 16 }}>
          Add Recipe
        </Text>

        {/* Title */}
        <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="My Tasty Pizza"
          placeholderTextColor="#64748b"
          style={{
            color: "white",
            backgroundColor: COLORS.sunken,
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
          }}
        />

        {/* Import URL */}
        <View
          style={{
            backgroundColor: COLORS.card,
            borderRadius: 14,
            borderColor: COLORS.border,
            borderWidth: 1,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.sub, marginBottom: 6 }}>
            Import from a link (YouTube/TikTok/blog)…
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <TextInput
              value={pastedUrl}
              onChangeText={setPastedUrl}
              placeholder="Paste page URL…"
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
            />
            <TouchableOpacity
              onPress={onPaste}
              style={{
                backgroundColor: COLORS.sunken,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                marginRight: 8,
              }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "600" }}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => resolveOg(pastedUrl)}
              disabled={loadingOg}
              style={{
                backgroundColor: COLORS.accent,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                opacity: loadingOg ? 0.6 : 1,
              }}
            >
              <Text style={{ color: "#0B1120", fontWeight: "700" }}>
                {loadingOg ? "Importing…" : "Import"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Preview */}
          <View style={{ marginTop: 10 }}>
            {previewUri ? (
              <Image
                source={{ uri: previewUri }}
                style={{ width: "100%", height: 220, borderRadius: 12 }}
                contentFit="cover"
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
                <Text style={{ color: COLORS.sub }}>No imported image yet</Text>
              </View>
            )}
          </View>
        </View>

        {/* Photo button (camera or gallery) */}
        <TouchableOpacity
          onPress={pickOrCamera}
          style={{
            backgroundColor: COLORS.card,
            padding: 12,
            borderRadius: 12,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "800" }}>Add/Choose Photo…</Text>
        </TouchableOpacity>

        {/* Ingredients */}
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>
          Ingredients
        </Text>
        {ingredients.map((ing, i) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <TextInput
              value={ing}
              onChangeText={(v) =>
                setIngredients((arr) => arr.map((x, idx) => (idx === i ? v : x)))
              }
              placeholder="2 cups flour…"
              placeholderTextColor="#64748b"
              style={{ color: "white", backgroundColor: COLORS.sunken, borderRadius: 10, padding: 10 }}
            />
            <TouchableOpacity
              onPress={() => setIngredients((arr) => arr.filter((_, idx) => idx !== i))}
              style={{
                marginTop: 6,
                alignSelf: "flex-end",
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: "#7f1d1d",
              }}
            >
              <Text style={{ color: "white", fontWeight: "800" }}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          onPress={() => setIngredients((arr) => [...arr, ""])}
          style={{
            marginTop: 6,
            backgroundColor: COLORS.card,
            paddingVertical: 12,
            borderRadius: 12,
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Ingredient</Text>
        </TouchableOpacity>

        {/* Steps */}
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>
          Steps
        </Text>
        {steps.map((st, i) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <TextInput
              value={st}
              onChangeText={(t) => setSteps((arr) => arr.map((x, idx) => (idx === i ? t : x)))}
              placeholder="Mix everything…"
              placeholderTextColor="#64748b"
              multiline
              style={{
                color: "white",
                backgroundColor: COLORS.sunken,
                borderRadius: 10,
                padding: 10,
                minHeight: 60,
              }}
            />
            <TouchableOpacity
              onPress={() => setSteps((arr) => arr.filter((_, idx) => idx !== i))}
              style={{
                marginTop: 6,
                alignSelf: "flex-end",
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: "#7f1d1d",
              }}
            >
              <Text style={{ color: "white", fontWeight: "800" }}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity
          onPress={() => setSteps((arr) => [...arr, ""])}
          style={{
            marginTop: 6,
            backgroundColor: COLORS.card,
            paddingVertical: 12,
            borderRadius: 12,
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Step</Text>
        </TouchableOpacity>
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
            backgroundColor: saving ? "#475569" : "#22c55e",
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
            {saving ? "Saving…" : "Save"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* TikTok snap modal (IMAGE poster) */}
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
            setImg({ kind: "picker", localUri: uriOrUrl }); // screenshot -> local file
          }
          lastResolvedUrlRef.current = snapUrl;
        }}
      />

      {/* ⬇️ TitleSnap (TITLE only). Opens when meta/og title looks weak on TikTok */}
      <TitleSnap
        visible={titleSnapVisible}
        url={titleSnapUrl}
        onFound={(good) => setTitle(good)}
        onClose={() => setTitleSnapVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}
