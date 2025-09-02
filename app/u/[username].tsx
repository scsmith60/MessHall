// app/u/[username].tsx
// PUBLIC PROFILE (like I'm 5 🧸):
// - we look up a person by their callsign (username in the URL)
// - we show their face (avatar), words (bio), and numbers (followers, etc.)
// - you can press Follow to be their friend; Unfollow to stop
// - three pages (tabs): their Recipes, their Remixes, and what they Cooked
// UPDATE: Followers/Following stat chips are now tappable to open lists.

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, Text, TouchableOpacity, View, Dimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  getUserIdByUsername,
  getPublicProfile,
  getFollowState,
  toggleFollow,
  listUserRecipes,
  listUserCooked,
  listUserRemixes,
} from "@/lib/data";
import { useAuth } from "@/lib/auth";

const COLORS = {
  bg: "#0f172a",
  card: "#1f2937",
  card2: "#111827",
  text: "#e5e7eb",
  sub: "#9ca3af",
  accent: "#38bdf8",
  green: "#22c55e",
  red: "#ef4444",
};

type RecipeRow = {
  id: string | number;
  user_id: string;
  title: string | null;
  image_url?: string | null;
  cooks_count?: number | null;
  likes_count?: number | null;
};

const SCREEN_PADDING = 24;
const GAP = 12;
const COLS = 2;
const CARD_W =
  (Dimensions.get("window").width - SCREEN_PADDING * 2 - GAP * (COLS - 1)) / COLS;

// lil counter box
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16 }}>{String(value)}</Text>
      <Text style={{ color: COLORS.sub, fontSize: 12, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

// grid card for recipes/remixes/cooked
function RecipeCard({ item, onPress }: { item: RecipeRow; onPress: () => void }) {
  const title = item.title || "Untitled";
  const medals = Number(item.cooks_count ?? 0);
  const likes = Number(item.likes_count ?? 0);
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ width: CARD_W, backgroundColor: COLORS.card, borderRadius: 14, overflow: "hidden" }}>
      <View style={{ width: "100%", height: CARD_W * 0.66, backgroundColor: COLORS.card2 }}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={{ width: "100%", height: "100%" }} />
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

export default function PublicProfile() {
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();
  const { session } = useAuth();
  const viewerId = session?.user?.id ?? null;

  // which user is this page about?
  const [targetId, setTargetId] = useState<string | null>(null);

  // profile header bits
  const [loading, setLoading] = useState(true);
  const [p, setP] = useState<{
    id: string;
    username: string | null;
    bio: string | null;
    avatar_url: string | null;
    followers: number;
    following: number;
    recipes_count: number;
    medals_total: number;
  } | null>(null);

  // follow state
  const [followed, setFollowed] = useState<boolean>(false);
  const [savingFollow, setSavingFollow] = useState(false);

  // tabs
  const [tab, setTab] = useState<"recipes" | "remixes" | "cooked">("recipes");
  const [list, setList] = useState<RecipeRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const isSelf = !!viewerId && !!targetId && viewerId === targetId;

  // 1) resolve username → user id + header
  useEffect(() => {
    let alive = true;
    (async () => {
      const uid = await getUserIdByUsername(String(username || "").trim());
      if (!alive) return;
      setTargetId(uid);
      if (!uid) {
        setP(null);
        setLoading(false);
        return;
      }
      const profile = await getPublicProfile(uid);
      if (!alive) return;
      setP(profile);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [username]);

  // 2) follow state (if signed in and not myself)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!viewerId || !targetId || viewerId === targetId) { setFollowed(false); return; }
      const f = await getFollowState(targetId);
      if (!alive) return;
      setFollowed(f);
    })();
    return () => { alive = false; };
  }, [viewerId, targetId]);

  // 3) load tab lists
  const loadTab = useCallback(async () => {
    if (!targetId) return;
    setLoadingList(true);
    try {
      let rows: RecipeRow[] = [];
      if (tab === "recipes") rows = await listUserRecipes(targetId);
      else if (tab === "remixes") rows = await listUserRemixes(targetId);
      else rows = await listUserCooked(targetId);
      setList(rows);
    } catch (e: any) {
      console.log("[public profile] list error:", e?.message || e);
      setList([]);
    } finally { setLoadingList(false); }
  }, [targetId, tab]);

  useEffect(() => { loadTab(); }, [loadTab]);

  // follow/unfollow
  const onToggleFollow = async () => {
    if (!viewerId) { Alert.alert("Sign in", "Please sign in to follow people."); return; }
    if (!targetId) return;
    if (isSelf) return;

    try {
      setSavingFollow(true);
      const isNowFollowed = await toggleFollow(targetId);
      setFollowed(isNowFollowed);
      // optimistic bump on header
      setP(prev => prev ? {
        ...prev, followers: Math.max(0, prev.followers + (isNowFollowed ? 1 : -1))
      } : prev);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not update follow.");
    } finally {
      setSavingFollow(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: COLORS.sub, marginTop: 8 }}>Loading…</Text>
      </View>
    );
  }
  if (!p) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: COLORS.text, fontWeight: "800", textAlign: "center" }}>User not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: 24 }}>
      {/* header */}
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {p.avatar_url ? (
          <Image source={{ uri: p.avatar_url }} style={{ width: 72, height: 72, borderRadius: 36 }} />
        ) : (
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.card, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: COLORS.text, fontSize: 28, fontWeight: "800" }}>{(p.username || "U").slice(0,1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "800" }}>{p.username || "Anonymous"}</Text>

            {!isSelf && (
              <TouchableOpacity
                onPress={onToggleFollow}
                disabled={savingFollow}
                style={{
                  backgroundColor: followed ? COLORS.card : COLORS.accent,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: COLORS.accent,
                }}
              >
                <Text style={{ color: followed ? COLORS.text : "#041016", fontWeight: "800" }}>
                  {savingFollow ? "…" : followed ? "Unfollow" : "Follow"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={{ color: COLORS.sub }} numberOfLines={2}>
            {p.bio || "Cooking enthusiast sharing simple and delicious recipes."}
          </Text>
        </View>
      </View>

      {/* stats (Followers/Following are now tappable) */}
      <View style={{ flexDirection: "row", marginTop: 16 }}>
        <View style={{ flex: 1, marginRight: 5 }}>
          <Stat label="Recipes" value={p.recipes_count} />
        </View>

        <View style={{ flex: 1, marginHorizontal: 5 }}>
          <Stat label="Medals" value={p.medals_total} />
        </View>

        {/* Followers → list */}
        <View style={{ flex: 1, marginLeft: 5 }}>
          <TouchableOpacity
            onPress={() => router.push(`/u/${p.username}/followers`)}
            activeOpacity={0.7}
            style={{ borderRadius: 12 }}
          >
            <Stat label="Followers" value={p.followers} />
          </TouchableOpacity>
        </View>

        {/* Following → list */}
        <View style={{ flex: 1, marginLeft: 5 }}>
          <TouchableOpacity
            onPress={() => router.push(`/u/${p.username}/following`)}
            activeOpacity={0.7}
            style={{ borderRadius: 12 }}
          >
            <Stat label="Following" value={p.following} />
          </TouchableOpacity>
        </View>
      </View>

      {/* tabs */}
      <View style={{ flexDirection: "row", marginTop: 16 }}>
        {(["recipes","remixes","cooked"] as const).map(name => {
          const active = tab === name;
          return (
            <View key={name} style={{ flex: 1, marginHorizontal: 6 }}>
              <TouchableOpacity
                onPress={() => setTab(name)}
                style={{
                  paddingVertical: 12,
                  borderRadius: 999,
                  backgroundColor: active ? COLORS.accent : "transparent",
                  borderWidth: 1,
                  borderColor: COLORS.accent,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: active ? "#041016" : COLORS.text, fontWeight: "700" }}>
                  {name[0].toUpperCase() + name.slice(1)}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* grid */}
      <View style={{ marginTop: 16 }}>
        {loadingList ? (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 24 }}>
            <ActivityIndicator />
            <Text style={{ color: COLORS.sub, marginTop: 8 }}>Loading…</Text>
          </View>
        ) : list.length === 0 ? (
          <View style={{ backgroundColor: COLORS.card, padding: 16, borderRadius: 12 }}>
            <Text style={{ color: COLORS.text, fontWeight: "700" }}>
              {tab === "recipes" ? "No recipes yet" : tab === "remixes" ? "No remixes yet" : "Nothing cooked yet"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={list}
            keyExtractor={(r) => String(r.id)}
            numColumns={COLS}
            columnWrapperStyle={{ justifyContent: "space-between" }}
            ItemSeparatorComponent={() => <View style={{ height: GAP }} />}
            renderItem={({ item }) => <RecipeCard item={item} onPress={() => router.push(`/recipe/${item.id}`)} />}
            scrollEnabled={false}
            contentContainerStyle={{ paddingBottom: 8 }}
          />
        )}
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
