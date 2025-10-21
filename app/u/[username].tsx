// app/u/[username].tsx
// LIKE I'M 5 🧸
// – We read the person's name (username) and secret id (uid) from the URL.
// – We find the person in public.profiles (RLS-aware).
// – If blocked either way, we show “M.I.A (missing in action)”.
// – If YOU blocked them (and we have ?uid=their-id), you can Unblock right here.
// – We show their recipes below. Everything else stays the same.

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
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";

// 👇 blocking helpers you already have
import { isBlocked, blockUser, unblockUser } from "@/lib/blocking";

// -----------------------------------------
// COLORS (match your app theme)
// -----------------------------------------
const COLORS = {
  bg: "#0f172a",     // slate-900
  card: "#1f2937",   // gray-800
  card2: "#111827",  // gray-900
  text: "#e5e7eb",   // gray-200
  sub: "#9ca3af",    // gray-400
  subtext: "#9ca3af",
  accent: "#38bdf8", // sky-400
};

// -----------------------------------------
// TYPES (simple)
// -----------------------------------------
type Profile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio?: string | null;
  knives?: number | null;
};

type RecipeRow = Record<string, any>; // keep loose so any schema works

// -----------------------------------------
// LAYOUT math for a 2-col grid
// -----------------------------------------
const SCREEN_PADDING = 24;
const GAP = 12;
const COLS = 2;
const CARD_W =
  (Dimensions.get("window").width - SCREEN_PADDING * 2 - GAP * (COLS - 1)) /
  COLS;

// -----------------------------------------
// Pick best image field from a recipe row
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
// Helper: are these two users blocked either way?
// (Me blocked them OR they blocked me)
// -----------------------------------------
async function isBlockedEitherWay(me: string | null, otherId: string | null) {
  if (!me || !otherId) return false;
  const { data, error } = await supabase
    .from("user_blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${me},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${me})`
    )
    .limit(1);
  if (error) return false; // don’t crash UI on client
  return !!(data && data.length);
}

// -----------------------------------------
// A tiny recipe tile (touch to open)
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
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: COLORS.subtext }}>No image</Text>
          </View>
        )}
      </View>

      <View style={{ padding: 10 }}>
        <Text numberOfLines={1} style={{ color: COLORS.text, fontWeight: "800" }}>
          {title}
        </Text>
        <Text style={{ color: COLORS.subtext, marginTop: 4, fontSize: 12 }}>
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
  const { username, uid } = useLocalSearchParams<{ username?: string; uid?: string }>();

  // 2) Safe area padding
  const insets = useSafeAreaInsets();

  // 3) Screen state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [followers, setFollowers] = useState<number>(0);
  const [following, setFollowing] = useState<number>(0);

  // who am I, and did I block them?
  const [meId, setMeId] = useState<string | null>(null);
  const [blockedByMe, setBlockedByMe] = useState<boolean>(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  // ---------------------------------------
  // Load profile (RLS-aware)
  // ---------------------------------------
  const loadProfile = useCallback(async (): Promise<Profile | null> => {
    // A) by uid (exact id, best)
    if (uid) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, bio, knives")
        .eq("id", String(uid))
        .maybeSingle();
      if (error) throw error;
      return (data as Profile) ?? null;
    }
    // B) by username (case-insensitive)
    if (username) {
      const uname = String(username).trim();
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, avatar_url, bio, knives")
        .ilike("username", uname)
        .limit(1);
      if (error) throw error;
      return data && data[0] ? (data[0] as Profile) : null;
    }
    return null;
  }, [uid, username]);

  // ---------------------------------------
  // Load recipes robustly from public.recipes
  // (tries a bunch of common owner columns until one works)
  // ---------------------------------------
  const loadRecipes = useCallback(
    async (ownerId: string, ownerUsername?: string | null) => {
      // ⛔ stop if blocked in either direction
      if (await isBlockedEitherWay(meId, ownerId)) {
        setRecipes([]);
        return;
      }

      const tryBy = async (column: string, value: string) => {
        try {
          const q = supabase.from("recipes").select("*").eq(column, value);
          const { data, error } =
            (await q.order?.("created_at", { ascending: false })) ?? (await q);
          if (error) {
            const r = await supabase.from("recipes").select("*").eq(column, value);
            if (r.error) return [];
            return r.data ?? [];
          }
          return data ?? [];
        } catch {
          return [];
        }
      };

      const candidates: Array<[string, string]> = [
        ["owner_id", ownerId],
        ["user_id", ownerId],
        ["profile_id", ownerId],
        ["created_by", ownerId],
        ["creator_id", ownerId],
      ];

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

      setRecipes([]);
    },
    [meId]
  );

  // ---------------------------------------
  // Follower/following counters with fallbacks
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
  // GLUE: load everything + detect blocked state
  // (THIS is where our awaits belong)
// ---------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prof = await loadProfile();
      setProfile(prof);

      // If no profile (RLS hide) but we have ?uid, check if *I* blocked them → show Unblock button
      if (!prof && uid) {
        const mine = await isBlocked(String(uid));
        setBlockedByMe(mine);
      } else if (prof) {
        // If visible, still check if I blocked (should be false, but just in case)
        const mine = await isBlocked(prof.id);
        setBlockedByMe(mine);

        // ⛔ client gate — if blocked in either direction, treat as M.I.A
        if (await isBlockedEitherWay(meId, prof.id)) {
          setProfile(null);
          setRecipes([]);
          setFollowers(0);
          setFollowing(0);
          setBlockedByMe(true); // so Unblock can show if I initiated it
          return;               // stop; don't load recipes
        }
      } else {
        setBlockedByMe(false);
      }

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
      if (uid) {
        const mine = await isBlocked(String(uid));
        setBlockedByMe(mine);
      }
    } finally {
      setLoading(false);
    }
  }, [loadProfile, loadRecipes, loadFollowCounts, uid, meId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // quick derived stats (unchanged)
  const knivesCount = Number(profile?.knives ?? 0);

  // ---------------------------------------
  // ACTIONS: Block / Unblock buttons
  // ---------------------------------------
  const doBlock = useCallback(async () => {
    if (!profile?.id) return;
    const ok = await blockUser(profile.id);
    if (ok) {
      Alert.alert("Done", "This user is now blocked.");
      // simulate RLS hiding them immediately
      setProfile(null);
      setRecipes([]);
      setBlockedByMe(true);
    } else {
      Alert.alert("Sorry", "We couldn't block. Try again.");
    }
  }, [profile?.id]);

  const doUnblock = useCallback(async () => {
    // Try visible profile id first; else fall back to uid param
    const target = profile?.id || (uid ? String(uid) : null);
    if (!target) return;
    const ok = await unblockUser(target);
    if (ok) {
      setBlockedByMe(false);
      await load(); // reload now that RLS may allow it
    } else {
      Alert.alert("Sorry", "We couldn't unblock. Try again.");
    }
  }, [profile?.id, uid, load]);

  // ---------------------------------------
  // LOADING STATE
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
          <Text style={{ color: COLORS.subtext, marginTop: 8 }}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------
  // M.I.A (blocked or not found)
// ---------------------------------------
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
          <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 18 }}>
            M.I.A (missing in action)
          </Text>

          {/* If *you* blocked them and you passed a uid, show UNBLOCK for convenience */}
          {blockedByMe && uid ? (
            <TouchableOpacity
              onPress={doUnblock}
              style={{
                marginTop: 12,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#2c3a4d",
              }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "800" }}>Unblock user</Text>
            </TouchableOpacity>
          ) : null}
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
        {/* keep below notch */}
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
              <Text style={{ color: COLORS.subtext }} numberOfLines={2}>
                {profile.bio || "Cooking enthusiast sharing simple and delicious recipes."}
              </Text>
            </View>

            {/* Block/Unblock actions (hidden on your own profile) */}
            {meId && meId !== profile.id ? (
              blockedByMe ? (
                <TouchableOpacity
                  onPress={doUnblock}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#2c3a4d",
                  }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "800" }}>Unblock</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={doBlock}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#2c3a4d",
                  }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "800" }}>Block</Text>
                </TouchableOpacity>
              )
            ) : null}
          </View>

          {/* STATS ROW */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <StatCard label="Recipes" value={recipes.length} />
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
            <View style={{ backgroundColor: COLORS.card, padding: 16, borderRadius: 12 }}>
              <Text style={{ color: COLORS.text, fontWeight: "700" }}>No recipes yet</Text>
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
      <Text style={{ color: COLORS.subtext, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
