// app/(tabs)/profile.tsx
//
// what this file does (like i'm 5 🧸):
// - shows your profile and your recipes count and medals (knives=medals)
// - lets you change your callsign (username)
// - lets you pick a picture for your face (avatar), makes it nice, and saves it
// - replaces the old avatar picture instead of making new ones every time
//
// run these once (safe to run again):
//   npx expo install expo-image-picker expo-image-manipulator
//
// db tables we touch:
//   public.profiles: id, email, username, bio, avatar_url, followers, following
//   public.recipes : id, user_id, title, image_url, cooks_count, likes_count
//
// storage we use:
//   bucket: avatars  (public read; authenticated users can write their own folder)

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
  FlatList,
  Dimensions,
  Modal,
  Pressable,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

// 🎨 colors
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

// 🧱 shapes
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
  id: string;
  user_id: string;
  title: string | null;
  image_url?: string | null;
  cooks_count?: number | null; // 🏅 medals
  likes_count?: number | null; // ❤️ likes
};

// 🧼 usernames
function normalizeUsername(s: string) {
  return s.trim().replace(/\s+/g, "_");
}

// 📐 grid for recipe cards
const SCREEN_PADDING = 24;
const GAP = 12;
const COLS = 2;
const CARD_W =
  (Dimensions.get("window").width - SCREEN_PADDING * 2 - GAP * (COLS - 1)) /
  COLS;

// 🧩 image picker enum (works old/new Expo)
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

  // 📝 profile fields
  const [email, setEmail] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [originalUsername, setOriginalUsername] = useState<string>("");
  const [bio, setBio] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // 📊 stats
  const [followers, setFollowers] = useState<number>(0);
  const [following, setFollowing] = useState<number>(0);
  const [recipeCount, setRecipeCount] = useState<number>(0);
  const [totalMedals, setTotalMedals] = useState<number>(0);

  // 🔁 flags
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // tabs
  const [tab, setTab] = useState<"recipes" | "remixes" | "cooked">("recipes");

  // recipes
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [recipesLoading, setRecipesLoading] = useState<boolean>(false);

  // ✏️ edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editAvatar, setEditAvatar] = useState(""); // local file uri or https url
  const [uploading, setUploading] = useState(false);

  // 1) load profile
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
    return () => {
      alive = false;
    };
  }, [userId]);

  // 2) username availability
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
    return () => {
      alive = false;
    };
  }, [username, originalUsername, userId]);

  // 3) can save username?
  const canSave = useMemo(() => {
    const u = normalizeUsername(username);
    const changed = u.toLowerCase() !== (originalUsername || "").toLowerCase();
    const goodLength = u.length >= 3;
    const noSpaces = !/\s/.test(u);
    return changed && goodLength && noSpaces && (available === true || available === null) && !saving && !!userId;
  }, [username, originalUsername, available, saving, userId]);

  // 4) save username
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

  // 5) sign out
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Error", error.message);
  }

  // 6) recipes + medals
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

  useEffect(() => {
    if (tab === "recipes") loadRecipes();
  }, [tab, loadRecipes]);

  // 7) pick image (with permission)
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
      if (!uri) {
        Alert.alert("Oops", "Could not read selected image.");
        return;
      }
      setEditAvatar(uri);
    } catch (e: any) {
      console.log("[ImagePicker] error:", e?.message || e);
      Alert.alert("Picker error", e?.message ?? String(e));
    }
  }

  // 8) make sure session valid
  async function requireSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) console.log("getSession error:", error.message);
    if (data?.session) return data.session;

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) console.log("getUser error:", userErr.message);
    return userData?.user ? (await supabase.auth.getSession()).data.session : null;
  }

  // 9) upload avatar (overwrite single file; JPEG; reliable upload)
  async function uploadAvatarIfNeeded(): Promise<string | null> {
    try {
      if (!editAvatar) return avatarUrl || null;
      if (editAvatar.startsWith("http://") || editAvatar.startsWith("https://")) {
        // already a URL (user pasted one) — keep it
        return editAvatar.trim();
      }

      const sess = await requireSession();
      if (!sess || !userId) {
        Alert.alert("Not logged in", "Please log in again to upload your avatar.");
        return null;
      }

      setUploading(true);

      // 9a) re-encode to a friendly JPEG (prevents all-black images on Android/HEIC weirdness)
      const manipulated = await ImageManipulator.manipulateAsync(
        editAvatar,
        [{ resize: { width: 1024 } }], // scale longest side to ~1024
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );

      // 9b) get the bytes (ArrayBuffer is the most cross-RN-safe for Supabase)
      const resp = await fetch(manipulated.uri);
      const ab = await resp.arrayBuffer();
      if (!ab || (ab as ArrayBuffer).byteLength === 0) {
        throw new Error("Empty image buffer.");
      }

      // 9c) one stable path per user — this REPLACES the file, not create new
      const path = `${userId}/avatar.jpg`;

      // 9d) upload and overwrite (upsert)
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, ab, {
          contentType: "image/jpeg",
          upsert: true,
          cacheControl: "3600",
        });

      if (upErr) {
        console.log("[upload] error:", upErr.message);
        throw upErr;
      }

      // 9e) public URL (stable). for instant refresh in UI, we’ll add a ?v= bust param in state
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = data.publicUrl;
      if (!publicUrl) throw new Error("Could not get public URL for uploaded avatar.");

      return publicUrl;
    } catch (e: any) {
      console.log("uploadAvatarIfNeeded error:", e?.message || e);
      Alert.alert("Upload failed", e?.message ?? String(e));
      return null;
    } finally {
      setUploading(false);
    }
  }

  // 10) save profile (bio + avatar)
  async function saveProfileFields() {
    try {
      if (!userId) return;

      const uploadedUrl = await uploadAvatarIfNeeded();
      if (uploadedUrl === null && editAvatar && !editAvatar.startsWith("http")) {
        // user picked a file but upload failed
        return;
      }

      // store the stable URL in DB
      const updates: any = {
        bio: editBio.trim(),
        avatar_url: uploadedUrl ?? avatarUrl ?? null,
      };

      const { error } = await supabase.from("profiles").update(updates).eq("id", userId);
      if (error) throw error;

      // show fresh image immediately by cache-busting in UI (not in DB)
      const bust = updates.avatar_url ? `${updates.avatar_url}?v=${Date.now()}` : null;
      setBio(updates.bio);
      setAvatarUrl(bust);

      setShowEdit(false);
      setEditAvatar(""); // clear local selection
      Alert.alert("Saved", "Profile updated.");
    } catch (e: any) {
      console.log("saveProfileFields error:", e?.message || e);
      Alert.alert("Could not save", e.message ?? String(e));
    }
  }

  // 🔹 small UI components
  function Avatar({ size = 72 }: { size?: number }) {
    const letter = (username || "U").slice(0, 1).toUpperCase();
    if (avatarUrl) {
      return (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.card }}
        />
      );
    }
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.card, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: COLORS.text, fontSize: size / 2, fontWeight: "800" }}>{letter}</Text>
      </View>
    );
  }

  function Stat({ label, value }: { label: string; value: number | string }) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16 }}>{String(value)}</Text>
        <Text style={{ color: COLORS.sub, fontSize: 12, marginTop: 2 }}>{label}</Text>
      </View>
    );
  }

  function TabButton({ name, active, onPress }: { name: string; active: boolean; onPress: () => void }) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={{
          flex: 1,
          paddingVertical: 12,
          borderRadius: 999,
          backgroundColor: active ? COLORS.accent : "transparent",
          borderWidth: 1,
          borderColor: COLORS.accent,
          alignItems: "center",
        }}
      >
        <Text style={{ color: active ? "#041016" : COLORS.text, fontWeight: "700" }}>{name}</Text>
      </TouchableOpacity>
    );
  }

  function RecipeCard({ item }: { item: RecipeRow }) {
    const title = item.title || "Untitled";
    const medals = Number(item.cooks_count ?? 0);
    const likes = Number(item.likes_count ?? 0);
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push(`/recipe/${item.id}`)}
        style={{ width: CARD_W, backgroundColor: COLORS.card, borderRadius: 14, overflow: "hidden" }}
      >
        <View style={{ width: "100%", height: CARD_W * 0.66, backgroundColor: COLORS.card2 }}>
          {item.image_url ? (
            <Image source={{ uri: item.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: COLORS.sub }}>No Image</Text>
            </View>
          )}
        </View>
        <View style={{ padding: 10 }}>
          <Text numberOfLines={1} style={{ color: COLORS.text, fontWeight: "700" }}>{title}</Text>
          <Text style={{ color: COLORS.sub, marginTop: 4, fontSize: 12 }}>🏅 {medals} · ❤️ {likes}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  // ⏳ loading
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: COLORS.sub, marginTop: 8 }}>Loading profile…</Text>
      </View>
    );
  }

  // 🖼️ screen
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: SCREEN_PADDING }}>
      {/* header: avatar + username + edit */}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Avatar size={72} />
        <View style={{ flex: 1, marginLeft: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "800" }}>{username || "Anonymous"}</Text>
            <TouchableOpacity
              onPress={() => {
                setEditBio(bio || "");
                setEditAvatar(avatarUrl || "");
                setShowEdit(true);
              }}
              style={{ backgroundColor: COLORS.accent, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 }}
            >
              <Text style={{ color: "#041016", fontWeight: "800" }}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ color: COLORS.sub }} numberOfLines={2}>
            {bio || "Cooking enthusiast sharing simple and delicious recipes."}
          </Text>
        </View>
      </View>

      {/* stats */}
      <View style={{ flexDirection: "row", marginTop: 16 }}>
        <View style={{ flex: 1, marginRight: 5 }}>
          <Stat label="Recipes" value={recipeCount} />
        </View>
        <View style={{ flex: 1, marginHorizontal: 5 }}>
          <Stat label="Medals" value={totalMedals} />
        </View>
        <View style={{ flex: 1, marginLeft: 5 }}>
          <Stat label="Followers" value={followers} />
        </View>
        <View style={{ flex: 1, marginLeft: 5 }}>
          <Stat label="Following" value={following} />
        </View>
      </View>

      {/* tabs */}
      <View style={{ flexDirection: "row", marginTop: 16 }}>
        <View style={{ flex: 1, marginRight: 6 }}>
          <TabButton name="Recipes" active={tab === "recipes"} onPress={() => setTab("recipes")} />
        </View>
        <View style={{ flex: 1, marginHorizontal: 6 }}>
          <TabButton name="Remixes" active={tab === "remixes"} onPress={() => setTab("remixes")} />
        </View>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <TabButton name="Cooked" active={tab === "cooked"} onPress={() => setTab("cooked")} />
        </View>
      </View>

      {/* tab content */}
      <View style={{ marginTop: 16 }}>
        {tab === "recipes" ? (
          <>
            {recipesLoading ? (
              <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 24 }}>
                <ActivityIndicator />
                <Text style={{ color: COLORS.sub, marginTop: 8 }}>Loading your recipes…</Text>
              </View>
            ) : recipes.length === 0 ? (
              <View style={{ backgroundColor: COLORS.card, padding: 16, borderRadius: 12 }}>
                <Text style={{ color: COLORS.text, fontWeight: "700" }}>No recipes yet</Text>
                <Text style={{ color: COLORS.sub, marginTop: 6 }}>
                  Create your first recipe from the Capture/Add screen.
                </Text>
              </View>
            ) : (
              <FlatList
                data={recipes}
                keyExtractor={(r) => r.id.toString()}
                numColumns={COLS}
                columnWrapperStyle={{ justifyContent: "space-between" }}
                ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
                renderItem={({ item }) => <RecipeCard item={item} />}
                scrollEnabled={false}
                contentContainerStyle={{ paddingBottom: 8 }}
              />
            )}
          </>
        ) : (
          <View style={{ backgroundColor: COLORS.card, padding: 16, borderRadius: 12 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>
              {tab === "remixes" ? "Remixes" : "Cooked"}
            </Text>
            <Text style={{ color: COLORS.sub, marginTop: 6 }}>
              {tab === "remixes"
                ? "This will show recipes that others remixed from yours."
                : "This will show recipes you cooked from the community."}
            </Text>
          </View>
        )}
      </View>

      {/* account settings */}
      <View style={{ backgroundColor: COLORS.card, padding: 16, borderRadius: 12, marginTop: 16 }}>
        <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: "800" }}>Account Settings</Text>

        {/* email (read-only) */}
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Email</Text>
          <TextInput value={email} editable={false} style={{ color: COLORS.text, paddingVertical: 6 }} />
          <Text style={{ color: COLORS.sub, marginTop: 6 }}>
            You can sign in with email or your callsign.
          </Text>
        </View>

        {/* callsign (username) */}
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Callsign (username)</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            placeholder="your_name"
            placeholderTextColor={COLORS.sub}
            style={{ backgroundColor: COLORS.card2, color: COLORS.text, padding: 12, borderRadius: 10 }}
          />

          {/* availability */}
          <View style={{ minHeight: 24, justifyContent: "center", marginTop: 8 }}>
            {checking ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <ActivityIndicator />
                <Text style={{ color: COLORS.sub, marginLeft: 8 }}>Checking…</Text>
              </View>
            ) : available === true ? (
              <Text style={{ color: COLORS.green, fontWeight: "700" }}>✓ Callsign is available</Text>
            ) : available === false ? (
              <Text style={{ color: COLORS.red, fontWeight: "700" }}>✗ Callsign is taken</Text>
            ) : (
              <Text style={{ color: COLORS.sub }}>Tip: 3+ characters. Spaces turn into underscores.</Text>
            )}
          </View>

          {/* save callsign */}
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            style={{ backgroundColor: canSave ? COLORS.button : COLORS.disabled, padding: 14, borderRadius: 12, alignItems: "center", marginTop: 10 }}
          >
            <Text style={{ color: "#0b0f19", fontWeight: "800" }}>{saving ? "Saving…" : "Save Callsign"}</Text>
          </TouchableOpacity>
        </View>

        {/* sign out */}
        <TouchableOpacity
          onPress={signOut}
          style={{ backgroundColor: COLORS.red, padding: 14, borderRadius: 12, alignItems: "center", marginTop: 12 }}
        >
          <Text style={{ color: "white", fontWeight: "800" }}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* edit profile modal */}
      <Modal visible={showEdit} transparent animationType="fade" onRequestClose={() => setShowEdit(false)}>
        <Pressable style={{ flex: 1, backgroundColor: COLORS.overlay }} onPress={() => setShowEdit(false)} />
        <View style={{ position: "absolute", left: 20, right: 20, top: "20%", backgroundColor: COLORS.card, borderRadius: 16, padding: 16 }}>
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "800" }}>Edit Profile</Text>

          {/* avatar preview */}
          <View style={{ alignItems: "center", marginTop: 12 }}>
            {editAvatar ? (
              <Image source={{ uri: editAvatar }} style={{ width: 96, height: 96, borderRadius: 48 }} />
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={{ width: 96, height: 96, borderRadius: 48 }} />
            ) : (
              <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.card2, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: COLORS.sub }}>No Avatar</Text>
              </View>
            )}
          </View>

          {/* pick / clear */}
          <View style={{ flexDirection: "row", marginTop: 12 }}>
            <TouchableOpacity
              onPress={pickImage}
              style={{ flex: 1, backgroundColor: COLORS.accent, padding: 12, borderRadius: 10, alignItems: "center", marginRight: 8 }}
            >
              <Text style={{ color: "#041016", fontWeight: "800" }}>{uploading ? "Uploading…" : "Pick Image"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setEditAvatar("")}
              style={{ flex: 1, backgroundColor: COLORS.disabled, padding: 12, borderRadius: 10, alignItems: "center", marginLeft: 8 }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "700" }}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* bio */}
          <Text style={{ color: COLORS.sub, marginTop: 12, marginBottom: 6 }}>Bio</Text>
          <TextInput
            value={editBio}
            onChangeText={setEditBio}
            multiline
            placeholder="I love easy, tasty meals!"
            placeholderTextColor={COLORS.sub}
            style={{ backgroundColor: COLORS.card2, color: COLORS.text, padding: 12, borderRadius: 10, minHeight: 80, textAlignVertical: "top" }}
          />

          {/* buttons */}
          <View style={{ flexDirection: "row", marginTop: 14 }}>
            <TouchableOpacity
              onPress={() => setShowEdit(false)}
              style={{ flex: 1, backgroundColor: COLORS.disabled, padding: 12, borderRadius: 10, alignItems: "center", marginRight: 8 }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "700" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={saveProfileFields}
              disabled={uploading}
              style={{ flex: 1, backgroundColor: uploading ? COLORS.disabled : COLORS.button, padding: 12, borderRadius: 10, alignItems: "center", marginLeft: 8 }}
            >
              <Text style={{ color: "#0b0f19", fontWeight: "800" }}>{uploading ? "Uploading…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
