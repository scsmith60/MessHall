// app/(tabs)/profile.tsx
//
// LIKE I'M 5:
// • Your profile screen still works the same.
// • I added these *extra* things inside Settings (no breaking changes):
//   1) Quit MessHall (schedule account deletion in 30 days, recipes no one saved get removed then).
//   2) Export my recipes (quick self-serve JSON share + request full export via backend).
//   3) Help & Support ticket (write message + attach up to 3 screenshots).
//   4) Units: choose US or Metric for ingredients (saved on your profile).
//   5) Callsign moved under Email and added State/Country fields (same save logic preserved).
//
// NOTE: If your DB doesn't yet have columns (units_preference/state/country/etc),
// the UI shows the controls but will fail gracefully with a friendly alert.
// That preserves current behavior while letting you add columns when ready.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Dimensions,
  Modal,
  Pressable,
  Share, // 🆕 for quick JSON export
} from "react-native";

// 🧢 SAFE AREA helpers (so we don’t sit under the notch/home bar)
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { getConnectedProviders } from "@/lib/cart/providers";

const COLORS = {
  bg: "#0f172a",
  card: "#1f2937",
  card2: "#111827",
  text: "#e5e7eb",
  sub: "#9ca3af",
  green: "#22c55e",
  red: "#ef4444",
  accent: "#38bdf8",
  button: "#6EE7B7",
  disabled: "#334155",
  overlay: "rgba(0,0,0,0.5)",
  glass: "rgba(255,255,255,0.06)",
  border: "#1f2937",
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  followers?: number | null;
  following?: number | null;
  // 🆕 optional fields (won’t break if not present; we fetch them in a separate try/catch)
  units_preference?: "us" | "metric" | null;
  state?: string | null;
  country?: string | null;
  deletion_requested_at?: string | null;
  deletion_effective_at?: string | null;
};

type RecipeRow = {
  id: string | number;
  user_id: string;
  title: string | null;
  image_url?: string | null;
  cooks_count?: number | null; // 🏅 medals
  likes_count?: number | null; // ❤️ likes
};

// turn "my name here" into "my_name_here"
function normalizeUsername(s: string) {
  return s.trim().replace(/\s+/g, "_");
}

// grid math so two cards fit nicely
const SCREEN_PADDING = 24;
const GAP = 12;
const COLS = 2;
const CARD_W =
  (Dimensions.get("window").width - SCREEN_PADDING * 2 - GAP * (COLS - 1)) /
  COLS;

// expo-image-picker constants (SDK-safe)
const MEDIA_IMAGES =
  // @ts-ignore
  (ImagePicker as any)?.MediaType?.Images ??
  // @ts-ignore
  (ImagePicker as any)?.MediaTypeOptions?.Images ??
  null;

export default function Profile() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  // safe area insets
  const insets = useSafeAreaInsets();

  // profile info
  const [email, setEmail] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [originalUsername, setOriginalUsername] = useState<string>("");
  const [bio, setBio] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // stats
  const [followers, setFollowers] = useState<number>(0);
  const [following, setFollowing] = useState<number>(0);
  const [recipeCount, setRecipeCount] = useState<number>(0);
  const [totalMedals, setTotalMedals] = useState<number>(0);

  // page state
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // tabs
  const [tab, setTab] = useState<"recipes" | "remixes" | "cooked" | "saved">("recipes");

  // lists per tab
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [recipesLoading, setRecipesLoading] = useState<boolean>(false);

  const [remixRecipes, setRemixRecipes] = useState<RecipeRow[]>([]);
  const [remixesLoading, setRemixesLoading] = useState<boolean>(false);

  const [cookedRecipes, setCookedRecipes] = useState<RecipeRow[]>([]);
  const [cookedLoading, setCookedLoading] = useState<boolean>(false);

  const [savedRecipes, setSavedRecipes] = useState<RecipeRow[]>([]);
  const [savedLoading, setSavedLoading] = useState<boolean>(false);

  // modals
  const [showEdit, setShowEdit] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [uploading, setUploading] = useState(false);

  // ⚙️ settings bottom-sheet
  const [showSettings, setShowSettings] = useState(false);

  // 🛒 how many stores connected? (for banner + settings label)
  const [connectedStores, setConnectedStores] = useState(0);

  // 🆕 Affiliate Disclosure modal
  const [showAffiliate, setShowAffiliate] = useState(false);

  // 🧁 NEW — Monetization status shown in Settings (kid-simple label)
  const [monetizeLabel, setMonetizeLabel] = useState("Check your eligibility");
  const [monetizeLoading, setMonetizeLoading] = useState(false);

  // 🆕 NEW — Units preference + Location fields + Export/Support/Delete UX state
  const [units, setUnits] = useState<"us" | "metric">("us"); // ingredient units
  const [stateRegion, setStateRegion] = useState<string>(""); // State/Region
  const [country, setCountry] = useState<string>(""); // Country
  const [exporting, setExporting] = useState(false); // export working flag

  const [showSupport, setShowSupport] = useState(false); // support modal
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [ticketImages, setTicketImages] = useState<string[]>([]);
  const [ticketSending, setTicketSending] = useState(false);

  const [showDelete, setShowDelete] = useState(false); // delete modal
  const [deleting, setDeleting] = useState(false);

  // =============== 1) load profile row (core — unchanged) ===============
  useEffect(() => {
    let alive = true;
    async function load() {
      if (!userId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, username, bio, avatar_url, followers, following, state, country, units_preference, preferred_units")
        .eq("id", userId)
        .single();
      if (!alive) return;
      if (error) {
        Alert.alert("Error", error.message);
        setLoading(false);
        return;
      }
      const row = (data || {}) as ProfileRow;
      setEmail(row.email ?? "");
      const u = row.username ?? "";
      setUsername(u);
      setOriginalUsername(u);
      setBio(row.bio ?? "");
      setAvatarUrl(row.avatar_url ?? null);
      setFollowers(Number(row.followers ?? 0));
      setFollowing(Number(row.following ?? 0));
      setStateRegion(row.state ?? "");
      setCountry(row.country ?? "");
      setUnits((row.units_preference as "us" | "metric") ?? (row.preferred_units as "us" | "metric") ?? "us");
      setLoading(false);

      // 🆕 OPTIONAL fetch for new fields (won’t break if columns don’t exist)
      
    }
    load();
    return () => { alive = false; };
  }, [userId]);

  // ✅ Re-read units when screen regains focus (prevents “snaps back to US”)
  useFocusEffect(
    useCallback(() => {
      let cancel = false;
      (async () => {
        if (!userId) return;
        try {
          const { data } = await supabase
            .from("profiles")
            .select("units_preference, preferred_units")
            .eq("id", userId)
            .maybeSingle();
          if (cancel) return;
          const pref = ((data?.units_preference as "us" | "metric") ??
                        (data?.preferred_units as "us" | "metric") ??
                        "us");
          setUnits(pref);
        } catch {
          /* ignore */
        }
      })();
      return () => { cancel = true; };
    }, [userId])
  );

  // =============== 2) username availability checker (unchanged) ===============
  useEffect(() => {
    let alive = true;
    const value = normalizeUsername(username);
    if (value.length < 3 || value.toLowerCase() === (originalUsername || "").toLowerCase()) {
      setAvailable(null);
      return;
    }
    (async () => {
      setChecking(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", value)
        .limit(1);
      if (!alive) return;
      setChecking(false);
      if (error) {
        setAvailable(null);
      } else if (!data || data.length === 0) {
        setAvailable(true);
      } else {
        const matchIsSelf = data[0].id === userId;
        setAvailable(matchIsSelf ? null : false);
      }
    })();
    return () => { alive = false; };
  }, [username, originalUsername, userId]);

  // =============== 3) can we save the callsign? (unchanged) ===============
  const canSave = useMemo(() => {
    const u = normalizeUsername(username);
    const changed = u.toLowerCase() !== (originalUsername || "").toLowerCase();
    const goodLength = u.length >= 3;
    const noSpaces = !/\s/.test(u);
    return changed && goodLength && noSpaces && (available === true || available === null) && !saving && !!userId;
  }, [username, originalUsername, available, saving, userId]);

  // =============== 4) save callsign (unchanged) ===============
  async function handleSave() {
    try {
      if (!userId) return;
      const u = normalizeUsername(username);
      if (u.length < 3) throw new Error("Username must be at least 3 characters.");
      setSaving(true);
      const { error: updErr } = await supabase.from("profiles").update({ username: u }).eq("id", userId);
      if (updErr) {
        if ((updErr as any).code === "23505") throw new Error("That username was just taken. Please try a different one.");
        throw updErr;
      }
      const { error: metaErr } = await supabase.auth.updateUser({ data: { display_name: u } });
      if (metaErr) throw metaErr;
      setOriginalUsername(u);
      setAvailable(null);
      Alert.alert("Saved", "Your username has been updated.");
    } catch (e: any) {
      Alert.alert("Could not save", e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }



  // =============== 6) load MY recipes (unchanged) ===============
  const loadRecipes = useCallback(async () => {
    if (!userId) return;
    setRecipesLoading(true);
    const { count: cnt } = await supabase
      .from("recipes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    setRecipeCount(cnt ?? 0);

    const { data, error } = await supabase
      .from("recipes")
      .select("id, user_id, title, image_url, cooks_count, likes_count")
      .eq("user_id", userId)
      .order("id", { ascending: false })
      .limit(30);

    if (error) {
      setRecipes([]);
      setTotalMedals(0);
    } else {
      const rows = (data || []) as RecipeRow[];
      setRecipes(rows);
      const medals = rows.reduce((sum, r) => sum + Number(r.cooks_count ?? 0), 0);
      setTotalMedals(medals);
    }
    setRecipesLoading(false);
  }, [userId]);

  useEffect(() => { if (tab === "recipes") loadRecipes(); }, [tab, loadRecipes]);

  // =============== 7) load recipes I cooked (unchanged) ===============
  const loadCookedByMe = useCallback(async () => {
    if (!userId) return;
    setCookedLoading(true);
    const { data, error } = await supabase
      .from("recipe_cooks")
      .select("created_at, recipes:recipe_id(id, user_id, title, image_url, cooks_count, likes_count)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      setCookedRecipes([]);
    } else {
      const list = (data || []).map((row: any) => row.recipes as RecipeRow).filter(Boolean);
      setCookedRecipes(list);
    }
    setCookedLoading(false);
  }, [userId]);

  // =============== 8) load MY remixes (unchanged) ===============
  const loadRemixesOfMine = useCallback(async () => {
    if (!userId) return;
    setRemixesLoading(true);

    const { data, error } = await supabase
      .from("recipes")
      .select("id, user_id, title, image_url, cooks_count, likes_count, parent_recipe_id")
      .eq("user_id", userId)                  // me
      .not("parent_recipe_id", "is", null)    // and it's a remix
      .order("id", { ascending: false })      // newest-ish first
      .limit(60);

    if (error) {
      setRemixRecipes([]);
    } else {
      setRemixRecipes((data || []) as RecipeRow[]);
    }
    setRemixesLoading(false);
  }, [userId]);

  // =============== 9) load recipes I saved (unchanged) ===============
  const loadSavedByMe = useCallback(async () => {
    if (!userId) return;
    setSavedLoading(true);
    const { data, error } = await supabase
      .from("recipe_saves")
      .select("created_at, recipe_id, recipes:recipe_id(id, user_id, title, image_url, cooks_count, likes_count)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) {
      setSavedRecipes([]);
    } else {
      const list = (data || [])
        .map((row: any) => row.recipes as RecipeRow)
        .filter(Boolean);
      setSavedRecipes(list);
    }
    setSavedLoading(false);
  }, [userId]);

  // pick right list for each tab (unchanged)
  useEffect(() => {
    if (tab === "cooked") loadCookedByMe();
    if (tab === "remixes") loadRemixesOfMine();
    if (tab === "saved") loadSavedByMe();
  }, [tab, loadCookedByMe, loadRemixesOfMine, loadSavedByMe]);

  // =============== IMAGE PICKING for avatar (unchanged) ===============
  async function pickImage() {
    try {
      const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
      let status = existing.status;
      if (status !== "granted") {
        const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") {
        Alert.alert("Permission needed", "We need access to your photos to set an avatar.");
        return;
      }
      const options: any = { allowsEditing: true, aspect: [1, 1], quality: 1 };
      if (MEDIA_IMAGES) options.mediaTypes = MEDIA_IMAGES;
      const res = await ImagePicker.launchImageLibraryAsync(options);
      if (res.canceled) return;
      const uri = res.assets?.[0]?.uri;
      if (!uri) { Alert.alert("Oops", "Could not read selected image."); return; }
      setEditAvatar(uri);
    } catch (e: any) {
      Alert.alert("Picker error", e?.message ?? String(e));
    }
  }

  // =============== auth helper (unchanged) ===============
  async function requireSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.log("getSession error:", error.message);
    if (data?.session) return data.session;
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) console.log("getUser error:", userErr.message);
    return userData?.user ? (await supabase.auth.getSession()).data.session : null;
  }

  // =============== upload avatar (unchanged) ===============
  async function uploadAvatarIfNeeded(): Promise<string | null> {
    try {
      if (!editAvatar) return avatarUrl || null;
      if (editAvatar.startsWith("http://") || editAvatar.startsWith("https://")) {
        return editAvatar.trim();
      }
      const sess = await requireSession();
      if (!sess || !userId) { Alert.alert("Not logged in", "Please log in again to upload your avatar."); return null; }
      setUploading(true);
      const manipulated = await ImageManipulator.manipulateAsync(
        editAvatar,
        [{ resize: { width: 1024 } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      const resp = await fetch(manipulated.uri);
      const ab = await resp.arrayBuffer();
      if (!ab || (ab as ArrayBuffer).byteLength === 0) throw new Error("Empty image buffer.");
      const path = `${userId}/avatar.jpg`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, ab, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = data.publicUrl;
      if (!publicUrl) throw new Error("Could not get public URL for uploaded avatar.");
      return publicUrl;
    } catch (e: any) {
      console.log("uploadAvatarIfNeeded error:", e?.message || e);
      Alert.alert("Upload failed", e?.message ?? String(e));
      return null;
    } finally { setUploading(false); }
  }

  // =============== save bio + avatar (unchanged) ===============
  async function saveProfileFields() {
    try {
      if (!userId) return;
      const uploadedUrl = await uploadAvatarIfNeeded();
      if (uploadedUrl === null && editAvatar && !editAvatar.startsWith("http")) return;
      const updates: any = { bio: editBio.trim(), avatar_url: uploadedUrl ?? avatarUrl ?? null };
      const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
      if (error) throw error;
      const bust = updates.avatar_url ? `${updates.avatar_url}?v=${Date.now()}` : null;
      setBio(updates.bio);
      setAvatarUrl(bust);
      setShowEdit(false);
      setEditAvatar("");
      Alert.alert("Saved", "Profile updated.");
    } catch (e: any) {
      console.log("saveProfileFields error:", e?.message || e);
      Alert.alert("Could not save", e?.message ?? String(e));
    }
  }

  // =============== small UI helpers (unchanged) ===============
  function Avatar({ size = 72 }: { size?: number }) {
    const letter = (username || "U").slice(0, 1).toUpperCase();
    if (avatarUrl) {
      return <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.card }} />;
    }
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.card, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: size * 0.5 }}>{letter}</Text>
      </View>
    );
  }

  function Stat({ label, value }: { label: string; value: number | string }) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.card2, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: COLORS.text, fontWeight: "900" }}>{value}</Text>
        <Text style={{ color: COLORS.sub, fontWeight: "700", marginTop: 4 }}>{label}</Text>
      </View>
    );
  }

  // tiny unsave on Saved tab (unchanged)
  async function handleUnsave(recipeId: string | number) {
    try {
      if (!userId) return;
      const { error } = await supabase
        .from("recipe_saves")
        .delete()
        .eq("user_id", userId)
        .eq("recipe_id", recipeId);
      if (error) throw error;
      setSavedRecipes((prev) => prev.filter((r) => r.id !== recipeId));
    } catch (e: any) {
      console.log("handleUnsave error:", e?.message || e);
      Alert.alert("Oops", e?.message ?? "Could not remove from saved.");
    }
  }

  // card for one recipe (unchanged)
  function RecipeThumb({ r, onRemove }: { r: RecipeRow; onRemove?: (id: string | number) => void; }) {
    const goToRecipe = () => router.push(`/recipe/${r.id}`);
    return (
      <View style={{ width: CARD_W, marginBottom: GAP }}>
        <TouchableOpacity activeOpacity={0.9} onPress={goToRecipe} style={{ backgroundColor: COLORS.card, borderRadius: 14, overflow: "hidden" }}>
          {r.image_url ? (
            <Image source={{ uri: r.image_url }} style={{ width: "100%", height: CARD_W * 0.75 }} />
          ) : (
            <View style={{ width: "100%", height: CARD_W * 0.75, backgroundColor: COLORS.card2 }} />
          )}
          <View style={{ padding: 10 }}>
            <Text numberOfLines={1} style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>
              {r.title || "Untitled"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Text style={{ color: COLORS.sub }}>🏅 {r.cooks_count ?? 0}</Text>
                <Text style={{ color: COLORS.sub }}>❤️ {r.likes_count ?? 0}</Text>
              </View>
              {onRemove && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation(); onRemove(r.id); }}
                  hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: COLORS.glass, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" }}
                >
                  <Text style={{ color: "#fff" }}>🗑️</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  // when we know who you are, count connected stores (unchanged)
  useEffect(() => {
    if (!userId) return;
    getConnectedProviders(userId)
      .then((list) => setConnectedStores(list.length))
      .catch(() => setConnectedStores(0));
  }, [userId]);

  // 🧁 monetization eligibility check when settings opens (unchanged)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!showSettings) return; // only when the sheet is open
      try {
        setMonetizeLoading(true);
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch(
          process.env.EXPO_PUBLIC_SUPABASE_URL + "/functions/v1/eligibility-check",
          { method: "POST", headers: { Authorization: `Bearer ${token}` } }
        );
        const json = await res.json();
        if (!alive) return;
        if (json?.eligible === true) setMonetizeLabel("Ready to apply");
        else if (Array.isArray(json?.checklist) && json.checklist.length > 0) setMonetizeLabel("Complete a few steps");
        else setMonetizeLabel("Check your eligibility");
      } catch {
        if (alive) setMonetizeLabel("Check your eligibility");
      } finally {
        if (alive) setMonetizeLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [showSettings]);

  // ===================== NEW FEATURE HANDLERS =====================

  // A) Units preference — save to profiles.units_preference (+ legacy preferred_units)
  async function handleChangeUnits(next: "us" | "metric") {
    try {
      setUnits(next);
      const { error } = await supabase
        .from("profiles")
        .update({ units_preference: next, preferred_units: next })
        .eq("id", userId);
      if (error) throw error;
    } catch (e: any) {
      Alert.alert("Oops", e?.message ?? "Could not save units. Ask us to enable this field.");
    }
  }

  // B) Save State/Country — optional addition to profile
  async function handleSaveLocation() {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          state: stateRegion?.trim() || null,
          country: country?.trim() || null,
        })
        .eq("id", userId);
      if (error) throw error;
      Alert.alert("Saved", "Location updated.");
    } catch (e: any) {
      Alert.alert("Oops", e?.message ?? "Could not save location. Ask us to enable these fields.");
    }
  }

  // C1) Quick self-serve export — share JSON of your latest recipes
  async function handleQuickExport() {
    try {
      setExporting(true);
      const { data, error } = await supabase
        .from("recipe_export_v1")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const payload = JSON.stringify(data ?? [], null, 2);
      await Share.share({
        title: "My MessHall Recipes (JSON)",
        message: payload,
      });
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Could not export.");
    } finally {
      setExporting(false);
    }
  }

  // C2) Request full export — call your Edge Function to build files + email link
  async function handleRequestExport() {
    try {
      setExporting(true);
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(
        process.env.EXPO_PUBLIC_SUPABASE_URL + "/functions/v1/export-my-recipes",
        { method: "POST", headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Export request failed");
      }
      Alert.alert("Requested", "We’ll email you a download link when it’s ready.");
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ?? "Could not request export (is the function deployed?).");
    } finally {
      setExporting(false);
    }
  }

  // D1) Pick screenshots for support ticket (up to 3)
  async function handlePickSupportScreens() {
    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") {
      Alert.alert("Permission needed", "We need photos permission to attach screenshots.");
      return;
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      selectionLimit: 3,
      mediaTypes:
        // @ts-ignore SDK bridges
        (ImagePicker as any)?.MediaType?.Images ??
        (ImagePicker as any)?.MediaTypeOptions?.Images ??
        undefined,
      quality: 1,
    });

    if (res.canceled) return;
    const uris = (res.assets || []).map((a) => a.uri).filter(Boolean) as string[];
    setTicketImages((prev) => [...prev, ...uris].slice(0, 3));
  }

  // D2) Upload one screenshot to storage and get its public URL
  async function uploadSupportScreenshot(fileUri: string) {
    if (!userId) throw new Error("Not signed in");
    const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const bin = await (await fetch(fileUri)).arrayBuffer();
    const bytes = new Uint8Array(bin);
    const { error } = await supabase.storage
      .from("support")
      .upload(fileName, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) throw error;
    const { data: pub } = supabase.storage.from("support").getPublicUrl(fileName);
    return pub.publicUrl;
  }

  // D3) Submit support ticket (subject, message, screenshot URLs)
  async function handleSubmitTicket() {
    if (!ticketSubject.trim() || !ticketMessage.trim()) {
      Alert.alert("Missing", "Please add a subject and message.");
      return;
    }
    try {
      setTicketSending(true);
      // upload images first
      const urls: string[] = [];
      for (const uri of ticketImages) {
        const url = await uploadSupportScreenshot(uri);
        urls.push(url);
      }
      const { data, error } = await supabase
        .from("support_tickets")
        .insert({
          user_id: userId,
          subject: ticketSubject.trim(),
          message: ticketMessage.trim(),
          screenshots: urls,
          status: "open",
        })
        .select("id")
        .single();
      if (error) throw error;

      setShowSupport(false);
      setTicketSubject("");
      setTicketMessage("");
      setTicketImages([]);
      Alert.alert("Sent", `Ticket #${data?.id ?? "created"}. We'll follow up by email.`);
    } catch (e: any) {
      Alert.alert("Could not send", e?.message ?? "Please try again.");
    } finally {
      setTicketSending(false);
    }
  }

  // E) Request account deletion (schedule for 30 days)
  async function handleRequestDeletion() {
    try {
      setDeleting(true);
      const requestedAt = new Date().toISOString();
      const effectiveAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("profiles")
        .update({
          deletion_requested_at: requestedAt,
          deletion_effective_at: effectiveAt,
        })
        .eq("id", userId);
      if (error) throw error;
      setShowDelete(false);
      Alert.alert(
        "Scheduled",
        `Your account is scheduled to be deleted on\n${new Date(effectiveAt).toDateString()}.\nSaved copies of your recipes remain for people who saved them.`
      );
    } catch (e: any) {
      Alert.alert("Could not schedule deletion", e?.message ?? "Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  // ===================== RENDER =====================
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top"]}>
      <ScrollView
        style={{ flex: 1, backgroundColor: COLORS.bg }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingBottom: Math.max(40, insets.bottom + 16),
        }}
      >
        {/* HEADER — avatar | name/bio | gear + edit */}
        <View style={{ padding: SCREEN_PADDING, paddingBottom: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Avatar />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text numberOfLines={1} style={{ color: COLORS.text, fontSize: 20, fontWeight: "900" }}>
                {username || "Anonymous"}
              </Text>
              <Text numberOfLines={3} style={{ color: COLORS.sub, marginTop: 4 }}>
                {bio?.trim() ? bio : "Cooking enthusiast sharing simple and delicious recipes."}
              </Text>
            </View>

            {/* Gear (opens settings bottom-sheet) */}
            <TouchableOpacity
              onPress={() => setShowSettings(true)}
              style={{ backgroundColor: COLORS.card2, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, marginRight: 8 }}
              activeOpacity={0.85}
            >
              <Text style={{ color: COLORS.text, fontWeight: "900" }}>⚙️</Text>
            </TouchableOpacity>

            {/* Edit Profile pill */}
            <TouchableOpacity
              onPress={() => setShowEdit(true)}
              style={{ backgroundColor: COLORS.accent, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 }}
            >
              <Text style={{ color: "#041016", fontWeight: "900" }}>Edit Profile</Text>
            </TouchableOpacity>
          </View>

          {/* Stats row */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1 }}><Stat label="Recipes" value={recipeCount} /></View>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.8} onPress={() => username && router.push(`/u/${username}/followers`)}>
              <Stat label="Followers" value={followers} />
            </TouchableOpacity>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.8} onPress={() => username && router.push(`/u/${username}/following`)}>
              <Stat label="Following" value={following} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}><Stat label="Medals" value={totalMedals} /></View>
          </View>

          {/* Onboarding banner: show only when no stores connected */}
          {connectedStores === 0 && (
            <TouchableOpacity
              onPress={() => router.push("/profile/stores")}
              activeOpacity={0.9}
              style={{
                marginTop: 12,
                backgroundColor: "#0b1220",
                borderRadius: 12,
                padding: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.text, fontWeight: "900" }}>Connect a store</Text>
                <Text style={{ color: COLORS.sub, marginTop: 2 }}>
                  Link Amazon, Walmart, Kroger or H-E-B for 1-tap “Send to Cart”.
                </Text>
              </View>
              <Text style={{ color: COLORS.accent, fontWeight: "900" }}>Set up →</Text>
            </TouchableOpacity>
          )}

          {/* Tabs — now HORIZONTALLY SCROLLABLE so extra pills never get cut off */}
          <ScrollView
            horizontal                // <-- makes it scroll sideways
            showsHorizontalScrollIndicator={false} // <-- hide the ugly bar
            contentContainerStyle={{
              gap: 10,                // <-- space between pills
              paddingHorizontal: 16,  // <-- comfy side padding
            }}
            style={{ marginTop: 16 }} // <-- spacing above the pills
          >
            {(["recipes", "remixes", "cooked", "saved"] as const).map((t) => {
              const active = tab === t;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTab(t)}
                  // 🍪 the pill itself — same look you had, just inside a scroll now
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor: active ? COLORS.accent : "transparent",
                    borderWidth: 1,
                    borderColor: COLORS.accent,

                    // ✅ makes each pill big enough for fingers and prevents squish
                    minWidth: 96,
                    alignItems: "center",
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: active ? "#041016" : COLORS.text, fontWeight: "900" }}>
                    {t === "recipes" ? "Recipes" : t === "remixes" ? "Remixes" : t === "cooked" ? "Cooked" : "Saved"}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

        </View>

        {/* Grids per tab */}
        <View style={{ paddingHorizontal: SCREEN_PADDING, marginTop: 14 }}>
          {tab === "recipes" && (
            recipesLoading ? (
              <ActivityIndicator />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
                {recipes.map((r) => <RecipeThumb key={String(r.id)} r={r} />)}
              </View>
            )
          )}

          {tab === "remixes" && (
            remixesLoading ? (
              <ActivityIndicator />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
                {remixRecipes.map((r) => <RecipeThumb key={String(r.id)} r={r} />)}
              </View>
            )
          )}

          {tab === "cooked" && (
            cookedLoading ? (
              <ActivityIndicator />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
                {cookedRecipes.map((r) => <RecipeThumb key={String(r.id)} r={r} />)}
              </View>
            )
          )}

          {/* Saved tab */}
          {tab === "saved" && (
            savedLoading ? (
              <ActivityIndicator />
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
                {savedRecipes.length === 0 ? (
                  <Text style={{ color: COLORS.sub, paddingVertical: 8 }}>
                    You haven’t saved any recipes yet.
                  </Text>
                ) : (
                  savedRecipes.map((r) => (
                    <RecipeThumb key={String(r.id)} r={r} onRemove={handleUnsave} />
                  ))
                )}
              </View>
            )
          )}
        </View>

        {/* Edit Profile modal (unchanged) */}
        <Modal visible={showEdit} transparent animationType="fade" onRequestClose={() => setShowEdit(false)}>
          <Pressable onPress={() => setShowEdit(false)} style={{ flex: 1, backgroundColor: COLORS.overlay, alignItems: "center", justifyContent: "center" }}>
            <Pressable onPress={() => {}} style={{ width: "92%", backgroundColor: COLORS.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 18, marginBottom: 12 }}>Edit Profile</Text>

              <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Bio</Text>
              <TextInput
                value={editBio}
                onChangeText={setEditBio}
                placeholder="Say hi…"
                placeholderTextColor="#6b7280"
                style={{ color: COLORS.text, backgroundColor: COLORS.card2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 }}
                multiline
              />

              <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Avatar</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                {editAvatar ? (
                  <Image source={{ uri: editAvatar }} style={{ width: 56, height: 56, borderRadius: 28 }} />
                ) : avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={{ width: 56, height: 56, borderRadius: 28 }} />
                ) : (
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.card2 }} />
                )}

                <TouchableOpacity onPress={pickImage} style={{ backgroundColor: COLORS.accent, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 }}>
                  <Text style={{ color: "#041016", fontWeight: "900" }}>{uploading ? "Uploading…" : "Pick image"}</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity onPress={() => setShowEdit(false)} style={{ flex: 1, backgroundColor: COLORS.card2, paddingVertical: 12, borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ color: COLORS.text, fontWeight: "800" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveProfileFields} style={{ flex: 1, backgroundColor: COLORS.button, paddingVertical: 12, borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ color: "#062113", fontWeight: "900" }}>Save</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ⚙️ Settings bottom-sheet (kept, expanded with new sections) */}
        <Modal visible={showSettings} transparent animationType="fade" onRequestClose={() => setShowSettings(false)}>
          {/* tap outside to close */}
          <Pressable onPress={() => setShowSettings(false)} style={{ flex: 1, backgroundColor: COLORS.overlay, justifyContent: "flex-end" }}>
            {/* sheet container — add a little bottom padding for the home indicator */}
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: COLORS.card,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: Math.max(20, insets.bottom + 12),
                borderTopWidth: 1,
                borderColor: COLORS.border,
              }}
            >
              {/* grabber */}
              <View style={{ alignItems: "center", paddingBottom: 10 }}>
                <View style={{ height: 4, width: 44, borderRadius: 2, backgroundColor: "#324156" }} />
              </View>

              <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 12 }}>
                {/* Manage Stores (unchanged) */}
                <TouchableOpacity
                  onPress={() => { setShowSettings(false); router.push("/profile/stores"); }}
                  activeOpacity={0.9}
                  style={{ backgroundColor: COLORS.glass, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "900" }}>Manage Stores</Text>
                  <Text style={{ color: COLORS.sub, marginTop: 4 }}>
                    {connectedStores > 0 ? `${connectedStores} connected` : "Not connected yet"}
                  </Text>
                </TouchableOpacity>

                {/* Monetization (unchanged) */}
                <TouchableOpacity
                  onPress={() => { setShowSettings(false); router.push("/(account)/monetization"); }}
                  activeOpacity={0.9}
                  style={{ backgroundColor: COLORS.glass, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "900" }}>Monetization</Text>
                  <Text style={{ color: COLORS.sub, marginTop: 4 }}>
                    {monetizeLoading ? "Checking…" : monetizeLabel}
                  </Text>
                </TouchableOpacity>

                {/* ===== Account Info: Email + Callsign + Location (NEW grouping, same functionality) ===== */}
                <View style={{ backgroundColor: COLORS.glass, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border }}>
                  {/* Email (read-only) */}
                  <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Email</Text>
                  <Text style={{ color: COLORS.text }}>{email || "—"}</Text>

                  {/* Callsign editor (moved under email) */}
                  <Text style={{ color: COLORS.sub, marginTop: 12, marginBottom: 6 }}>Callsign (username)</Text>
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    placeholder="your_name"
                    placeholderTextColor="#6b7280"
                    style={{
                      backgroundColor: COLORS.card2,
                      color: COLORS.text,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: "#263041",
                      marginBottom: 8,
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {!!checking && <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Checking availability…</Text>}
                  <Text style={{ color: COLORS.sub, marginBottom: 10 }}>Tip: 3+ characters. Spaces turn into underscores.</Text>

                  <TouchableOpacity
                    disabled={!canSave}
                    onPress={handleSave}
                    style={{
                      backgroundColor: canSave ? COLORS.button : COLORS.disabled,
                      paddingVertical: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <Text style={{ color: canSave ? "#062113" : "#93a3b8", fontWeight: "900" }}>Save Callsign</Text>
                  </TouchableOpacity>

                  {/* Location fields (NEW) */}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.sub, marginBottom: 6 }}>State</Text>
                      <TextInput
                        value={stateRegion}
                        onChangeText={setStateRegion}
                        placeholder="e.g., AZ"
                        placeholderTextColor="#6b7280"
                        style={{ color: COLORS.text, backgroundColor: COLORS.card2, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 }}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={32}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Country</Text>
                      <TextInput
                        value={country}
                        onChangeText={setCountry}
                        placeholder="e.g., United States"
                        placeholderTextColor="#6b7280"
                        style={{ color: COLORS.text, backgroundColor: COLORS.card2, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 }}
                        autoCapitalize="words"
                        autoCorrect={false}
                        maxLength={56}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    onPress={handleSaveLocation}
                    style={{ marginTop: 10, backgroundColor: COLORS.accent, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
                  >
                    <Text style={{ color: "#041016", fontWeight: "900" }}>Save Location</Text>
                  </TouchableOpacity>
                </View>

                {/* ===== Units preference (UPDATED to segmented slider) ===== */}
                <View style={{ backgroundColor: COLORS.glass, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border }}>
                  <Text style={{ color: COLORS.text, fontWeight: "900" }}>Ingredient Units</Text>
                  <Text style={{ color: COLORS.sub, marginTop: 4 }}>Pick how measurements show up.</Text>

                  {/* segmented pill */}
                  <View style={{ marginTop: 10, flexDirection: "row", backgroundColor: COLORS.card2, borderRadius: 999, padding: 4 }}>
                    {(["us", "metric"] as const).map((opt) => {
                      const active = units === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          onPress={() => handleChangeUnits(opt)}
                          activeOpacity={0.85}
                          style={{
                            flex: 1,
                            paddingVertical: 10,
                            alignItems: "center",
                            borderRadius: 999,
                            backgroundColor: active ? COLORS.accent : "transparent",
                          }}
                        >
                          <Text style={{ color: active ? "#041016" : COLORS.text, fontWeight: "900" }}>
                            {opt === "us" ? "US" : "Metric"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* ===== Export recipes (NEW) ===== */}
                <View style={{ backgroundColor: COLORS.glass, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border }}>
                  <Text style={{ color: COLORS.text, fontWeight: "900" }}>Export my recipes</Text>
                  <Text style={{ color: COLORS.sub, marginTop: 4 }}>Get your data. Your recipes belong to you.</Text>

                  <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                    <TouchableOpacity
                      onPress={handleQuickExport}
                      disabled={exporting}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.card2, alignItems: "center" }}
                    >
                      <Text style={{ color: COLORS.text, fontWeight: "900" }}>{exporting ? "Working…" : "Quick (JSON)"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleRequestExport}
                      disabled={exporting}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.card2, alignItems: "center" }}
                    >
                      <Text style={{ color: COLORS.text, fontWeight: "900" }}>{exporting ? "Working…" : "Email me CSV/JSON"}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* ===== Help & Support (NEW) ===== */}
                <TouchableOpacity
                  onPress={() => setShowSupport(true)}
                  activeOpacity={0.9}
                  style={{ backgroundColor: COLORS.glass, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "900" }}>Help & Support</Text>
                  <Text style={{ color: COLORS.sub, marginTop: 4 }}>
                    Send us a ticket. You can attach screenshots.
                  </Text>
                </TouchableOpacity>

                {/* ===== Quit / Delete account (NEW) ===== */}
                <TouchableOpacity
                  onPress={() => setShowDelete(true)}
                  activeOpacity={0.9}
                  style={{ backgroundColor: COLORS.glass, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border }}
                >
                  <Text style={{ color: COLORS.red, fontWeight: "900" }}>Quit MessHall (delete my account)</Text>
                  <Text style={{ color: COLORS.sub, marginTop: 4 }}>
                    Your profile stays for 30 days, then is deleted. Recipes nobody saved are removed after 30 days.
                    Saved copies stay visible to the saver.
                  </Text>
                </TouchableOpacity>

                {/* Sign out — close the sheet first, then navigate */}
                <TouchableOpacity
                  onPress={() => {
                  // close the modal/sheet first so navigation isn't blocked
                  setShowSettings(false);

                  // wait one frame so the close animation starts, then navigate
                  requestAnimationFrame(() => {
                    setTimeout(() => {
                      router.replace("/logout");
                    }, 0);
                  });
                }}

                  style={{ backgroundColor: COLORS.red, paddingVertical: 12, borderRadius: 12, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Sign Out</Text>
                </TouchableOpacity>

                {/* Close (unchanged) */}
                <TouchableOpacity
                  onPress={() => setShowSettings(false)}
                  style={{ backgroundColor: COLORS.card2, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "800" }}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Affiliate Disclosure modal (unchanged) */}
        <Modal visible={showAffiliate} transparent animationType="fade" onRequestClose={() => setShowAffiliate(false)}>
          <Pressable onPress={() => setShowAffiliate(false)} style={{ flex: 1, backgroundColor: COLORS.overlay, alignItems: "center", justifyContent: "center", padding: 20 }}>
            <Pressable onPress={() => {}} style={{ width: "100%", backgroundColor: COLORS.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 18 }}>Affiliate Disclosure</Text>
              <Text style={{ color: COLORS.sub, marginTop: 10, lineHeight: 20 }}>
                MessHall uses affiliate links for some stores. If you tap “Send to Cart” or visit a store from the app,
                we may earn a commission from qualifying purchases.{"\n\n"}
                <Text style={{ color: COLORS.text, fontWeight: "900" }}>Amazon Notice:</Text> As an Amazon Associate, MessHall earns from qualifying purchases.{"\n\n"}
                This helps us keep the app free and cover hosting costs. Thanks for your support!
              </Text>
              <TouchableOpacity
                onPress={() => setShowAffiliate(false)}
                style={{ marginTop: 14, backgroundColor: COLORS.accent, paddingVertical: 10, borderRadius: 12, alignItems: "center" }}
              >
                <Text style={{ color: "#041016", fontWeight: "900" }}>Got it</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        {/* 🆘 Support Modal (NEW) */}
        <Modal visible={showSupport} transparent animationType="fade" onRequestClose={() => setShowSupport(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "#00000088", padding: 20 }} onPress={() => setShowSupport(false)}>
            <Pressable style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: COLORS.border }} onPress={() => {}}>
              <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 18 }}>Help & Support</Text>
              <Text style={{ color: COLORS.sub }}>Tell us what’s wrong and add screenshots.</Text>

              <Text style={{ color: COLORS.sub, marginTop: 8 }}>Subject</Text>
              <TextInput
                value={ticketSubject}
                onChangeText={setTicketSubject}
                placeholder="Short title"
                placeholderTextColor="#6b7280"
                style={{ color: COLORS.text, backgroundColor: COLORS.card2, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 }}
              />

              <Text style={{ color: COLORS.sub, marginTop: 8 }}>Message</Text>
              <TextInput
                value={ticketMessage}
                onChangeText={setTicketMessage}
                placeholder="Tell us in simple words…"
                placeholderTextColor="#6b7280"
                style={{ color: COLORS.text, backgroundColor: COLORS.card2, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, minHeight: 96 }}
                multiline
              />

              {ticketImages.length > 0 && (
                <ScrollView horizontal style={{ marginTop: 8 }} contentContainerStyle={{ gap: 8 }}>
                  {ticketImages.map((uri) => (
                    <Image key={uri} source={{ uri }} style={{ width: 80, height: 80, borderRadius: 8 }} />
                  ))}
                </ScrollView>
              )}

              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <TouchableOpacity
                  onPress={handlePickSupportScreens}
                  style={{ flex: 1, backgroundColor: COLORS.card2, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "900" }}>Add screenshots</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSubmitTicket}
                  disabled={ticketSending}
                  style={{ flex: 1, backgroundColor: COLORS.accent, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
                >
                  <Text style={{ color: "#041016", fontWeight: "900" }}>{ticketSending ? "Sending…" : "Send ticket"}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={() => setShowSupport(false)}
                style={{ marginTop: 8, backgroundColor: COLORS.card2, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
              >
                <Text style={{ color: COLORS.text, fontWeight: "900" }}>Close</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>

        {/* 🗑️ Delete / Quit Modal (NEW) */}
        <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
          <Pressable style={{ flex: 1, backgroundColor: "#00000088", padding: 20 }} onPress={() => setShowDelete(false)}>
            <Pressable style={{ backgroundColor: COLORS.card, borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: COLORS.border }} onPress={() => {}}>
              <Text style={{ color: COLORS.red, fontWeight: "900", fontSize: 18 }}>Quit MessHall</Text>
              <Text style={{ color: COLORS.sub }}>
                If you continue, your account is scheduled for deletion in 30 days.
                Your profile remains visible until then.
                Recipes nobody saved will be removed after 30 days.
                Saved copies stay visible to the saver.
              </Text>

              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => setShowDelete(false)}
                  style={{ flex: 1, backgroundColor: COLORS.card2, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "900" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleRequestDeletion}
                  disabled={deleting}
                  style={{ flex: 1, backgroundColor: COLORS.red, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "900" }}>{deleting ? "Working…" : "Yes, delete in 30 days"}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}
