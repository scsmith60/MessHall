// app/(tabs)/index.tsx
// HOME FEED WITH SLIDE-UP COMMENTS SHEET
//
// talk-like-I'm-5:
// - We show a list of recipe cards.
// - When you tap "View comments", a little drawer slides up.
// - You can read and add comments without leaving the feed.
// - Close the drawer to keep scrolling where you were.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ListRenderItemInfo,
  RefreshControl,
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";

// 🔧 your app helpers (these should already exist in your project)
import { COLORS, SPACING } from "../../lib/theme";
import { dataAPI } from "../../lib/data";
import RecipeCard from "../../components/RecipeCard";
import SponsoredCard from "../../components/SponsoredCard";
import { success } from "../../lib/haptics";
import { recipeStore } from "../../lib/store";
import { logAdEvent } from "../../lib/ads";
import SearchFab from "../../components/SearchFab";
import { useUserId } from "../../lib/auth";

// 🧠 tiny types to keep TS happy
type SponsoredSlot = {
  id: string;
  brand?: string;
  title?: string;
  image?: string | null;
  cta?: string | null;
};

type FeedItem =
  | {
      type: "recipe";
      id: string;
      title: string;
      image: string | null;
      creator: string;
      creatorAvatar?: string | null;
      knives: number;
      cooks: number;
      likes: number;
      commentCount: number;
      createdAt: string;
      ownerId: string;
      is_private?: boolean;
    }
  | {
      type: "sponsored";
      id: string;
      brand: string;
      title: string;
      image: string | null;
      cta?: string | null;
      slot?: SponsoredSlot;
    };

type Comment = {
  id: string;
  author: { username: string; avatar?: string | null };
  text: string;
  createdAt: string; // ISO date
};

// 🧩 helper: normalize truthy "private" values
function isPrivateFlag(v: any): boolean {
  return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
}

export default function HomeScreen() {
  // 👤 who is looking?
  const { userId: viewerId } = useUserId(); // may be undefined when logged out

  // 📦 feed data + paging
  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  // 👀 make an alias so we can render RecipeCard with relaxed props
  const RecipeCardAny = RecipeCard as any;

  // 🔔 track ad impressions once per ad
  const seenAdsRef = useRef<Set<string>>(new Set());

  // 🚧 filter: show all sponsors; show public recipes; show private only if owner
  const safetyFilter = useCallback(
    (items: FeedItem[]) =>
      items.filter((it) => {
        if (it.type !== "recipe") return true;
        if (!isPrivateFlag((it as any).is_private)) return true;
        return !!viewerId && it.ownerId === viewerId;
      }),
    [viewerId]
  );

  // 🚚 get one page
  const loadPage = useCallback(
    async (nextPage: number, replace = false) => {
      if (loading) return;
      setLoading(true);
      try {
        const items: FeedItem[] = await (dataAPI as any).getFeedPage(nextPage, PAGE_SIZE);
        const visible = safetyFilter(items ?? []);

        // 🧠 cache some recipe bits for other screens
        const recipesOnly = visible.filter((it) => it.type === "recipe") as Extract<
          FeedItem,
          { type: "recipe" }
        >[];
        recipeStore.upsertMany(
          recipesOnly.map((r) => ({
            id: r.id,
            title: r.title,
            image: r.image ?? null,
            creator: r.creator,
            knives: r.knives,
            cooks: r.cooks,
            createdAt: new Date(r.createdAt).getTime(),
          }))
        );

        setData((prev) => (replace ? visible : [...prev, ...visible]));
        setPage(nextPage);
      } catch (err: any) {
        Alert.alert("Feed Problem", err?.message ?? "Could not load feed.");
      } finally {
        setLoading(false);
      }
    },
    [loading, safetyFilter]
  );

  // 🚀 first load
  useEffect(() => {
    loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🔁 when login state flips, refresh (so private items behave)
  const lastViewerRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastViewerRef.current === (viewerId ?? null)) return;
    lastViewerRef.current = viewerId ?? null;
    loadPage(0, true);
  }, [viewerId, loadPage]);

  // 🔄 pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    seenAdsRef.current.clear();
    await loadPage(0, true);
    await success(); // haptic tick
    setRefreshing(false);
  }, [loadPage]);

  // ⬇️ infinite scroll
  const onEndReached = useCallback(() => {
    if (!loading) loadPage(page + 1, false);
  }, [page, loading, loadPage]);

  // 📊 log sponsor impressions
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    for (const v of viewableItems) {
      const item: FeedItem | undefined = v?.item;
      if (!item || item.type !== "sponsored") continue;
      const id = item.id || item.slot?.id;
      if (id && !seenAdsRef.current.has(id)) {
        seenAdsRef.current.add(id);
        logAdEvent(id, "impression", { where: "home_feed" });
      }
    }
  }).current;

  // 🔑 stable keys
  const keyExtractor = useCallback((it: FeedItem) => `${it.type}_${(it as any).id}`, []);

  // ──────────────────────────────────────────────
  // 🗨️ COMMENTS SHEET STATE + LOGIC
  // ──────────────────────────────────────────────
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [sheetRefreshing, setSheetRefreshing] = useState(false);

  const fetchComments = useCallback(async (recipeId: string) => {
    setCommentsLoading(true);
    try {
      const rows: Comment[] = await (dataAPI as any).getRecipeComments?.(recipeId);
      setComments(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      Alert.alert("Comments Problem", err?.message ?? "Could not load comments.");
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  const openComments = useCallback(
    async (recipeId: string) => {
      setActiveRecipeId(recipeId);
      await fetchComments(recipeId);
      setCommentsVisible(true);
    },
    [fetchComments]
  );

  const closeComments = useCallback(() => {
    setCommentsVisible(false);
    setNewText("");
  }, []);

  const refreshSheet = useCallback(async () => {
    if (!activeRecipeId) return;
    setSheetRefreshing(true);
    await fetchComments(activeRecipeId);
    setSheetRefreshing(false);
  }, [activeRecipeId, fetchComments]);

  const sendComment = useCallback(async () => {
    const message = newText.trim();
    if (!message || !activeRecipeId) return;
    try {
      await (dataAPI as any).addComment?.(activeRecipeId, message);
      setNewText("");
      await fetchComments(activeRecipeId);
    } catch (err: any) {
      Alert.alert("Could not send", err?.message ?? "Please try again.");
    }
  }, [newText, activeRecipeId, fetchComments]);

  // 🎨 render one FEED item
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FeedItem>) => {
      if (item.type === "sponsored") {
        const slot: SponsoredSlot = item.slot ?? {
          id: item.id,
          brand: item.brand,
          title: item.title,
          image: item.image,
          cta: item.cta,
        };
        return <SponsoredCard slot={slot as any} />;
      }

      return (
        <RecipeCardAny
          id={item.id}
          title={item.title}
          image={item.image ?? null}
          creator={item.creator}
          creatorAvatar={item.creatorAvatar || undefined}
          knives={item.knives}
          cooks={item.cooks}
          likes={item.likes}
          commentCount={item.commentCount ?? 0}
          createdAt={new Date(item.createdAt).getTime()}
          ownerId={item.ownerId}
          isPrivate={isPrivateFlag(item.is_private)}
          onOpen={(id: string) => router.push(`/recipe/${id}`)}
          onOpenCreator={(username: string) => router.push(`/u/${username}`)}
          onEdit={(id: string) => router.push({ pathname: "/recipe/edit/[id]", params: { id } })}
          // 👇 NEW: open comments without leaving the feed
          onOpenComments={(id: string) => openComments(id)}
        />
      );
    },
    [openComments]
  );

  // ──────────────────────────────────────────────
  // 🧱 UI
  // ──────────────────────────────────────────────
  return (
    <View style={{ flex: 1 }}>
      {/* FEED LIST */}
      <FlatList
        style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.lg }} />}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        refreshControl={
          <RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 24 }} /> : null}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        initialNumToRender={8}
        windowSize={11}
      />

      {/* SEARCH BUTTON */}
      <SearchFab onPress={() => router.push("/search")} bottomOffset={24} />

      {/* 🗨️ COMMENTS SHEET */}
      <Modal
        visible={commentsVisible}
        animationType="slide"
        transparent
        onRequestClose={closeComments}
      >
        {/* Dim behind the sheet */}
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "flex-end",
          }}
        >
          {/* The sheet box */}
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{
              backgroundColor: COLORS.bg,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingTop: 12,
              paddingBottom: 8,
              paddingHorizontal: 16,
              maxHeight: "80%",
            }}
          >
            {/* Little grab bar + close */}
            <View style={{ alignItems: "center", justifyContent: "center", paddingBottom: 8 }}>
              <View
                style={{
                  width: 40,
                  height: 4,
                  backgroundColor: "rgba(255,255,255,0.2)",
                  borderRadius: 2,
                  marginBottom: 8,
                }}
              />
              <TouchableOpacity
                onPress={closeComments}
                style={{ position: "absolute", right: 0, top: -2, padding: 8 }}
                accessibilityLabel="Close comments"
              >
                <Text style={{ color: "#fff", fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Title */}
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 8 }}>
              Comments
            </Text>

            {/* Comments list */}
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <View
                  style={{
                    flexDirection: "row",
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: "rgba(255,255,255,0.06)",
                  }}
                >
                  {/* Simple circle avatar with first letter */}
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: "rgba(255,255,255,0.15)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 12 }}>
                      {item.author?.username?.slice(0, 1)?.toUpperCase() ?? "?"}
                    </Text>
                  </View>

                  {/* Name + time + text */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontWeight: "600" }}>
                      {item.author?.username ?? "user"}
                      <Text style={{ color: "rgba(255,255,255,0.5)", fontWeight: "400" }}>
                        {"  "}•{" "}
                        {new Date(item.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </Text>
                    </Text>
                    <Text style={{ color: "rgba(255,255,255,0.9)", marginTop: 2 }}>{item.text}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                commentsLoading ? null : (
                  <Text style={{ color: "rgba(255,255,255,0.7)", paddingVertical: 24 }}>
                    No comments yet. Be the first!
                  </Text>
                )
              }
              ListFooterComponent={
                commentsLoading ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null
              }
              refreshControl={
                <RefreshControl tintColor="#fff" refreshing={sheetRefreshing} onRefresh={refreshSheet} />
              }
              style={{ maxHeight: "70%" }}
            />

            {/* Write a comment */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingTop: 8,
                paddingBottom: 12,
              }}
            >
              <TextInput
                value={newText}
                onChangeText={setNewText}
                placeholder="Add a comment…"
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={{
                  flex: 1,
                  backgroundColor: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  marginRight: 8,
                }}
              />
              <TouchableOpacity
                onPress={sendComment}
                style={{
                  backgroundColor: "rgba(0,200,120,0.9)",
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 12,
                }}
              >
                <Text style={{ color: "#031b12", fontWeight: "700" }}>Send</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}
