// app/u/[username].tsx
// LIKE I'M 5 🧸
// – We read the person's name (username) and secret id (uid) from the URL.
// – We find the person in public.profiles.
// – We show their picture, their KNIVES (medals) from profiles.knives,
//   plus Followers and Following (if your table exists).
// – We show ALL of their recipes from public.recipes.
// – We use SafeArea so nothing hides under the clock/battery notch.
// – We try many common column names so it "just works" in your schema.

// -----------------------------------------
// IMPORTS
// -----------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";

// -----------------------------------------
// COLORS (match your app)
// -----------------------------------------
const COLORS = {
  bg: "#0f172a",     // slate-900
  card: "#1f2937",   // gray-800
  card2: "#111827",  // gray-900
  text: "#e5e7eb",   // gray-200
  sub: "#9ca3af",    // gray-400
  accent: "#38bdf8", // sky-400
};

// -----------------------------------------
// TYPES (simple)
// -----------------------------------------
type Profile = {
  id: string;                 // profiles.id (uuid)
  username: string | null;    // handle (e.g., "Beta")
  avatar_url: string | null;  // picture url
  bio?: string | null;        // little about me
  knives?: number | null;     // 🟩 medals → THIS is what you asked ("knives")
};

type RecipeRow = Record<string, any>; // keep loose so any schema works

// -----------------------------------------
// LAYOUT: grid math (2 columns)
// -----------------------------------------
const SCREEN_PADDING = 24;
const GAP = 12;
const COLS = 2;
const CARD_W =
  (Dimensions.get("window").width - SCREEN_PADDING * 2 - GAP * (COLS - 1)) /
  COLS;

// -----------------------------------------
// HELPER: pick the best image field found on the row
// -----------------------------------------
function pickImage(r: RecipeRow): string {
  return (
    r.image_url ||
    r.image ||
    r.photo ||
    r.cover_url ||
    r.thumbnail_url ||
    ""
  );
}

// -----------------------------------------
// SMALL: one recipe tile (touch to open)
// -----------------------------------------
function GridCard({ item, onPress }: { item: RecipeRow; onPress: () => void }) {
  const img = pickImage(item);
  const title = item.title || "Untitled";
  const medals = Number(item.cooks_count ?? 0);
  const likes = Number(item.likes_count ?? 0);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={{
        width: CARD_W,
        backgroundColor: COLORS.card,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: "100%",
          height: CARD_W * 0.66,
          backgroundColor: COLORS.card2,
        }}
      >
        {img ? (
          <Image source={{ uri: img }} style={{ width: "100%", height: "100%" }} />
        ) : (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: COLORS.sub }}>No image</Text>
          </View>
        )}
      </View>

      <View style={{ padding: 10 }}>
        <Text numberOfLines={1} style={{ color: COLORS.text, fontWeight: "800" }}>
          {title}
        </Text>
        <Text style={{ color: COLORS.sub, marginTop: 4, fontSize: 12 }}>
          🏅 {medals} · ❤️ {likes}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// -----------------------------------------
// MAIN SCREEN
// -----------------------------------------
export default function PublicProfile() {
  // 1) Read /u/[username]?uid=xxxx
  const { username, uid } = useLocalSearchParams<{
    username?: string;
    uid?: string;
  }>();

  // 2) Safe area padding (so UI won't hide under status bar)
  const insets = useSafeAreaInsets();

  // 3) Screen state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [followers, setFollowers] = useState<number>(0);
  const [following, setFollowing] = useState<number>(0);

  // ---------------------------------------
  // DATA: load profile (UID first, then username case-insensitive)
  // ---------------------------------------
  const loadProfile = useCallback(async (): Promise<Profile | null> => {
    // A) by uid (bulletproof if provided)
    if (uid) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, bio, knives")
        .eq("id", String(uid))
        .maybeSingle();
      if (error) throw error;
      if (data) return data as Profile;
    }

    // B) by username (equal but ignore BIG/small letters)
    if (username) {
      const uname = String(username).trim();
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, bio, knives")
        .ilike("username", uname)
        .limit(1);
      if (error) throw error;
      if (data && data[0]) return data[0] as Profile;
    }

    return null;
  }, [uid, username]);

  // ---------------------------------------
  // DATA: load recipes robustly from public.recipes
  // tries a bunch of common owner columns until one works
  // ---------------------------------------
  const loadRecipes = useCallback(async (ownerId: string, ownerUsername?: string | null) => {
    // helper that tries a single column, returns [] if error/no rows
    const tryBy = async (column: string, value: string) => {
      try {
        const q = supabase.from("recipes").select("*").eq(column, value);
        // try to order by created_at if it exists;
        // if DB errors on order, we just ignore and use unordered rows.
        const { data, error } = await q.order?.("created_at", { ascending: false }) ?? (await q);
        if (error) {
          // retry without order (in case created_at is named differently)
          const r = await supabase.from("recipes").select("*").eq(column, value);
          if (r.error) return [];
          return r.data ?? [];
        }
        return data ?? [];
      } catch {
        return [];
      }
    };

    // try id-based columns first (most reliable)
    const candidates: Array<[string, string]> = [
      ["owner_id", ownerId],
      ["user_id", ownerId],
      ["profile_id", ownerId],
      ["created_by", ownerId],
      ["creator_id", ownerId],
    ];

    // if nothing by id, try username-based columns
    if (ownerUsername) {
      candidates.push(
        ["owner_username", ownerUsername],
        ["creator_username", ownerUsername],
        ["username", ownerUsername],
        ["author", ownerUsername]
      );
    }

    for (const [col, val] of candidates) {
      const rows = await tryBy(col, val);
      if (rows.length > 0) {
        setRecipes(rows);
        return;
      }
    }

    // if we get here: nothing matched → just empty list
    setRecipes([]);
  }, []);

  // ---------------------------------------
  // DATA: follower/following counters with fallbacks
  // tries common tables/columns: follows(follower_id, following_id) or user_follows(follower_id, followee_id)
  // ---------------------------------------
  const loadFollowCounts = useCallback(async (profileId: string) => {
    async function tryCount(table: string, col: string, value: string) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq(col, value);
        if (error) return null;
        return count ?? 0;
      } catch {
        return null;
      }
    }

    // Followers = people who follow THIS user (who follows ME)
    // Following = people THIS user follows (who I follow)
    // Try common shapes in order:
    const followersTry =
      (await tryCount("follows", "following_id", profileId)) ??
      (await tryCount("user_follows", "followee_id", profileId)) ??
      (await tryCount("user_followers", "user_id", profileId)) ??
      0;

    const followingTry =
      (await tryCount("follows", "follower_id", profileId)) ??
      (await tryCount("user_follows", "follower_id", profileId)) ??
      (await tryCount("user_following", "user_id", profileId)) ??
      0;

    setFollowers(followersTry);
    setFollowing(followingTry);
  }, []);

  // ---------------------------------------
  // GLUE: load everything
  // ---------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prof = await loadProfile();
      setProfile(prof);

      if (prof) {
        await Promise.all([
          loadRecipes(prof.id, prof.username ?? undefined),
          loadFollowCounts(prof.id),
        ]);
      } else {
        setRecipes([]);
        setFollowers(0);
        setFollowing(0);
      }
    } catch (e) {
      console.log("[PublicProfile] load error:", e);
      setProfile(null);
      setRecipes([]);
      setFollowers(0);
      setFollowing(0);
    } finally {
      setLoading(false);
    }
  }, [loadProfile, loadRecipes, loadFollowCounts]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // easy stats
  const recipesCount = recipes.length;
  const knivesCount = Number(profile?.knives ?? 0); // 🟩 medals live on profiles.knives

  // ---------------------------------------
  // LOADING + NOT FOUND
  // ---------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View
          style={{
            flex: 1,
            paddingTop: insets.top,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator />
          <Text style={{ color: COLORS.sub, marginTop: 8 }}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View
          style={{
            flex: 1,
            paddingTop: insets.top,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "800", textAlign: "center" }}>
            User not found
          </Text>
          <Text style={{ color: COLORS.sub, marginTop: 6, textAlign: "center" }}>
            (Tip: RecipeCard should send both ?uid=profiles.id and username.)
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------
  // REAL SCREEN
  // ---------------------------------------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.text}
          />
        }
      >
        {/* 🔒 keep below notch */}
        <View style={{ paddingTop: insets.top, paddingHorizontal: SCREEN_PADDING }}>
          {/* HEADER: avatar + name + bio */}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {profile.avatar_url ? (
              <Image
                source={{ uri: profile.avatar_url }}
                style={{ width: 72, height: 72, borderRadius: 36 }}
              />
            ) : (
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: COLORS.card,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: 28, fontWeight: "800" }}>
                  {(profile.username || "U").slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}

            <View style={{ marginLeft: 14, flex: 1 }}>
              <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900" }}>
                {profile.username || "Anonymous"}
              </Text>
              <Text style={{ color: COLORS.sub }} numberOfLines={2}>
                {profile.bio || "Cooking enthusiast sharing simple and delicious recipes."}
              </Text>
            </View>
          </View>

          {/* STATS ROW: Recipes | Followers | Following | Medals (Knives) */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <StatCard label="Recipes" value={recipesCount} />
            <StatCard label="Followers" value={followers} />
            <StatCard label="Following" value={following} />
            <StatCard label="Medals" value={knivesCount} />
          </View>

          {/* SECTION TITLE */}
          <Text
            style={{
              color: COLORS.text,
              fontWeight: "900",
              marginTop: 18,
              marginBottom: 8,
            }}
          >
            {profile.username}'s recipes
          </Text>

          {/* GRID OF RECIPES */}
          {recipes.length === 0 ? (
            <View
              style={{ backgroundColor: COLORS.card, padding: 16, borderRadius: 12 }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "700" }}>
                No recipes yet
              </Text>
            </View>
          ) : (
            <FlatList
              data={recipes}
              keyExtractor={(r) => String(r.id)}
              numColumns={COLS}
              columnWrapperStyle={{ justifyContent: "space-between" }}
              ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
              renderItem={({ item }) => (
                <GridCard
                  item={item}
                  onPress={() =>
                    router.push({
                      pathname: "/recipe/[id]",
                      params: { id: String(item.id) },
                    })
                  }
                />
              )}
              scrollEnabled={false} // let the big ScrollView scroll everything
              contentContainerStyle={{ paddingBottom: 8 }}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// -----------------------------------------
// tiny stat card box (used in header)
// -----------------------------------------
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.card,
        paddingVertical: 10,
        borderRadius: 12,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#233142",
      }}
    >
      <Text style={{ color: COLORS.text, fontWeight: "900" }}>{value}</Text>
      <Text style={{ color: COLORS.sub, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
