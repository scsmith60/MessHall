// app/(tabs)/profile.tsx
//
// does: avatar + username + stats + tabs (Recipes / Remixes / Cooked)
// Followers/Following counters open their list screens.
// NEW: Account Settings moved into a modal opened by a little gear button.

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
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

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
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  followers?: number | null;
  following?: number | null;
};

type RecipeRow = {
  id: string | number;
  user_id: string;
  title: string | null;
  image_url?: string | null;
  cooks_count?: number | null; // 🏅 medals
  likes_count?: number | null; // ❤️ likes
};

// change spaces to underscores
function normalizeUsername(s: string) {
  return s.trim().replace(/\s+/g, "_");
}

// layout for grid
const SCREEN_PADDING = 24;
const GAP = 12;
const COLS = 2;
const CARD_W =
  (Dimensions.get("window").width - SCREEN_PADDING * 2 - GAP * (COLS - 1)) /
  COLS;

// image picker constant (works across SDK versions)
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

  // profile fields
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

  // state
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const [tab, setTab] = useState<"recipes" | "remixes" | "cooked">("recipes");

  // recipe lists
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [recipesLoading, setRecipesLoading] = useState<boolean>(false);
  const [remixRecipes, setRemixRecipes] = useState<RecipeRow[]>([]);
  const [remixesLoading, setRemixesLoading] = useState<boolean>(false);
  const [cookedRecipes, setCookedRecipes] = useState<RecipeRow[]>([]);
  const [cookedLoading, setCookedLoading] = useState<boolean>(false);

  // edit profile (bio/avatar) modal
  const [showEdit, setShowEdit] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [uploading, setUploading] = useState(false);

  // NEW: account settings modal (email + callsign + sign out)
  const [showSettings, setShowSettings] = useState(false);

  // load profile
  useEffect(() => {
    let alive = true;
    async function load() {
      if (!userId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, username, bio, avatar_url, followers, following")
        .eq("id", userId)
        .single();
      if (!alive) return;
      if (error) {
        console.log("profiles SELECT error:", error.message);
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
      setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [userId]);

  // username availability check
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
        console.log("username availability error:", error.message);
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

  // can we save callsign?
  const canSave = useMemo(() => {
    const u = normalizeUsername(username);
    const changed = u.toLowerCase() !== (originalUsername || "").toLowerCase();
    const goodLength = u.length >= 3;
    const noSpaces = !/\s/.test(u);
    return changed && goodLength && noSpaces && (available === true || available === null) && !saving && !!userId;
  }, [username, originalUsername, available, saving, userId]);

  // save callsign
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
      console.log("handleSave error:", e?.message || e);
      Alert.alert("Could not save", e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  // sign out
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Error", error.message);
  }

  // RECIPES (mine)
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
      console.log("recipes SELECT error:", error.message);
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

  // COOKED (recipes I cooked)
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
      console.log("loadCooked error:", error.message);
      setCookedRecipes([]);
    } else {
      const list = (data || []).map((row: any) => row.recipes as RecipeRow).filter(Boolean);
      setCookedRecipes(list);
    }
    setCookedLoading(false);
  }, [userId]);

  // REMIXES (recipes that remix my recipes)
  const loadRemixesOfMine = useCallback(async () => {
    if (!userId) return;
    setRemixesLoading(true);
    const { data: mine, error: mineErr } = await supabase
      .from("recipes")
      .select("id")
      .eq("user_id", userId)
      .limit(1000);
    if (mineErr) {
      console.log("loadRemixes mineErr:", mineErr.message);
      setRemixRecipes([]);
      setRemixesLoading(false);
      return;
    }
    const mineIds = (mine || []).map((r: any) => r.id);
    if (mineIds.length === 0) {
      setRemixRecipes([]);
      setRemixesLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("recipe_remixes")
      .select("created_at, remixes:remix_recipe_id(id, user_id, title, image_url, cooks_count, likes_count)")
      .in("parent_recipe_id", mineIds)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      console.log("loadRemixes error:", error.message);
      setRemixRecipes([]);
    } else {
      const list = (data || []).map((row: any) => row.remixes as RecipeRow).filter(Boolean);
      setRemixRecipes(list);
    }
    setRemixesLoading(false);
  }, [userId]);

  useEffect(() => {
    if (tab === "cooked") loadCookedByMe();
    if (tab === "remixes") loadRemixesOfMine();
  }, [tab, loadCookedByMe, loadRemixesOfMine]);

  // image picker
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
      console.log("[ImagePicker] error:", e?.message || e);
      Alert.alert("Picker error", e?.message ?? String(e));
    }
  }

  // auth session helper for uploads
  async function requireSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.log("getSession error:", error.message);
    if (data?.session) return data.session;
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) console.log("getUser error:", userErr.message);
    return userData?.user ? (await supabase.auth.getSession()).data.session : null;
  }

  // upload avatar to storage (upsert)
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

  // save bio + avatar from Edit Profile modal
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
      Alert.alert("Could not save", e.message ?? String(e));
    }
  }

  // avatar letter fallback
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

  // little stat tile
  function Stat({ label, value }: { label: string; value: number | string }) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.card2, borderRadius: 12, paddingVertical: 12, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: COLORS.text, fontWeight: "900" }}>{value}</Text>
        <Text style={{ color: COLORS.sub, fontWeight: "700", marginTop: 4 }}>{label}</Text>
      </View>
    );
  }

  // grid card
  function RecipeThumb({ r }: { r: RecipeRow }) {
    return (
      <View style={{ width: CARD_W, marginBottom: GAP }}>
        <View style={{ backgroundColor: COLORS.card, borderRadius: 14, overflow: "hidden" }}>
          {r.image_url ? (
            <Image source={{ uri: r.image_url }} style={{ width: "100%", height: CARD_W * 0.75 }} />
          ) : (
            <View style={{ width: "100%", height: CARD_W * 0.75, backgroundColor: COLORS.card2 }} />
          )}
          <View style={{ padding: 10 }}>
            <Text numberOfLines={1} style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>{r.title || "Untitled"}</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Text style={{ color: COLORS.sub }}>🏅 {r.cooks_count ?? 0}</Text>
              <Text style={{ color: COLORS.sub }}>❤️ {r.likes_count ?? 0}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={{ padding: SCREEN_PADDING, paddingBottom: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Avatar />

          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={{ color: COLORS.text, fontSize: 20, fontWeight: "900" }}>{username || "Anonymous"}</Text>
            <Text style={{ color: COLORS.sub, marginTop: 4 }}>
              {bio?.trim() ? bio : "Cooking enthusiast sharing simple and delicious recipes."}
            </Text>
          </View>

          {/* ⚙️ settings button (opens Account Settings modal) */}
          <TouchableOpacity
            onPress={() => setShowSettings(true)}
            style={{ backgroundColor: COLORS.card2, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999, marginLeft: 8 }}
            activeOpacity={0.8}
          >
            <Text style={{ color: COLORS.text, fontWeight: "900" }}>⚙️</Text>
          </TouchableOpacity>

          {/* Edit Profile (bio + avatar) */}
          <TouchableOpacity
            onPress={() => setShowEdit(true)}
            style={{ backgroundColor: COLORS.accent, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, marginLeft: 8 }}
          >
            <Text style={{ color: "#041016", fontWeight: "900" }}>Edit Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <View style={{ flex: 1 }}>
            <Stat label="Recipes" value={recipeCount} />
          </View>

          {/* Followers opens /u/:username/followers */}
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={0.8}
            onPress={() => username && router.push(`/u/${username}/followers`)}
          >
            <Stat label="Followers" value={followers} />
          </TouchableOpacity>

          {/* Following opens /u/:username/following */}
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={0.8}
            onPress={() => username && router.push(`/u/${username}/following`)}
          >
            <Stat label="Following" value={following} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Stat label="Medals" value={totalMedals} />
          </View>
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          {(["recipes", "remixes", "cooked"] as const).map((t) => {
            const active = tab === t;
            return (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 999,
                  backgroundColor: active ? COLORS.accent : "transparent",
                  borderWidth: 1,
                  borderColor: COLORS.accent,
                }}
              >
                <Text style={{ color: active ? "#041016" : COLORS.text, fontWeight: "900" }}>
                  {t === "recipes" ? "Recipes" : t === "remixes" ? "Remixes" : "Cooked"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Grid */}
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
      </View>

      {/* (Removed the old Account Settings card to keep the page sleek) */}

      {/* Edit Profile modal (bio + avatar) */}
      <Modal visible={showEdit} transparent animationType="fade" onRequestClose={() => setShowEdit(false)}>
        <Pressable onPress={() => setShowEdit(false)} style={{ flex: 1, backgroundColor: COLORS.overlay, alignItems: "center", justifyContent: "center" }}>
          <Pressable onPress={() => {}} style={{ width: "88%", backgroundColor: COLORS.card, borderRadius: 16, padding: 16 }}>
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

      {/* NEW: Account Settings modal (email + callsign + sign out) */}
      <Modal visible={showSettings} transparent animationType="fade" onRequestClose={() => setShowSettings(false)}>
        <Pressable onPress={() => setShowSettings(false)} style={{ flex: 1, backgroundColor: COLORS.overlay, alignItems: "center", justifyContent: "center" }}>
          <Pressable onPress={() => {}} style={{ width: "88%", backgroundColor: COLORS.card, borderRadius: 16, padding: 16 }}>
            <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 18, marginBottom: 12 }}>Account Settings</Text>

            {/* Email (read-only) */}
            <Text style={{ color: COLORS.sub, marginBottom: 4 }}>Email</Text>
            <Text style={{ color: COLORS.text, marginBottom: 12 }}>{email || "—"}</Text>

            {/* Callsign editor */}
            <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Callsign (username)</Text>
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
            />
            {!!checking && <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Checking availability…</Text>}
            <Text style={{ color: COLORS.sub, marginBottom: 10 }}>Tip: 3+ characters. Spaces turn into underscores.</Text>

            {/* Save callsign */}
            <TouchableOpacity
              disabled={!canSave}
              onPress={handleSave}
              style={{
                backgroundColor: canSave ? COLORS.button : COLORS.disabled,
                paddingVertical: 12,
                borderRadius: 12,
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <Text style={{ color: canSave ? "#062113" : "#93a3b8", fontWeight: "900" }}>Save Callsign</Text>
            </TouchableOpacity>

            {/* Sign out */}
            <TouchableOpacity
              onPress={signOut}
              style={{ backgroundColor: COLORS.red, paddingVertical: 12, borderRadius: 12, alignItems: "center", marginBottom: 6 }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>Sign Out</Text>
            </TouchableOpacity>

            {/* Close */}
            <TouchableOpacity
              onPress={() => setShowSettings(false)}
              style={{ backgroundColor: COLORS.card2, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "800" }}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
