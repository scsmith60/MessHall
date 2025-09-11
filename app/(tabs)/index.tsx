// app/(tabs)/index.tsx
// HOME FEED WITH SLIDE-UP COMMENTS SHEET + SAVES (recipe_saves)
//
// like I'm 5:
// - We show recipe cards in a FlatList.
// - You can tap Save. We write to table recipe_saves (user_id, recipe_id).
// - We mark saved items right away (optimistic).
// - We also FIX "two children with the same key" by DE-DUPING feed items
//   whenever we merge a new page into the list.

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

import { COLORS, SPACING } from "../../lib/theme";
import { dataAPI } from "../../lib/data";
import RecipeCard from "../../components/RecipeCard";
import SponsoredCard from "../../components/SponsoredCard";
import { success, tap, warn } from "../../lib/haptics";
import { recipeStore } from "../../lib/store";
import { logAdEvent } from "../../lib/ads";
import SearchFab from "../../components/SearchFab";
import { useUserId } from "../../lib/auth";
import { supabase } from "../../lib/supabase";

// 🧠 tiny types
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

// 🧩 normalize truthy "private"
function isPrivateFlag(v: any): boolean {
  return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
}

// 🧼 DE-DUPE helper: merge lists but keep only one of each (type + id)
function mergeUniqueFeed(prev: FeedItem[], next: FeedItem[], replace: boolean): FeedItem[] {
  const merged = replace ? next : [...prev, ...next];
  const seen = new Set<string>();
  return merged.filter((it) => {
    const key = `${it.type}_${(it as any).id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function HomeScreen() {
  // 👤 who is looking?
  const { userId: viewerId } = useUserId(); // undefined when logged out

  // 📦 feed data + paging
  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  // 🧺 recipe ids saved by me (a set = fast lookups)
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());

  // 👀 alias to loosen types for the card
  const RecipeCardAny = RecipeCard as any;

  // 🔔 track ad impressions once per ad
  const seenAdsRef = useRef<Set<string>>(new Set());

  // 🚧 hide private recipes unless they’re mine
  const safetyFilter = useCallback(
    (items: FeedItem[]) =>
      items.filter((it) => {
        if (it.type !== "recipe") return true;
        if (!isPrivateFlag((it as any).is_private)) return true;
        return !!viewerId && it.ownerId === viewerId;
      }),
    [viewerId]
  );

  // 🆕 ask DB which ids (in the current page) I’ve saved
  async function updateSavedFlagsFor(ids: string[], replace: boolean) {
    try {
      if (!viewerId || ids.length === 0) {
        if (replace) setSavedSet(new Set()); // logged out → nothing saved
        return;
      }
      const uniqueIds = Array.from(new Set(ids));
      const { data: rows, error } = await supabase
        .from("recipe_saves")
        .select("recipe_id")
        .eq("user_id", viewerId)
        .in("recipe_id", uniqueIds);

      if (error) {
        console.log("[saved flags] error:", error.message);
        return;
      }

      const found = new Set<string>((rows ?? []).map((r: any) => String(r.recipe_id)));
      setSavedSet((prev) => {
        if (replace) return found; // fresh load → replace
        const next = new Set(prev);
        for (const id of found) next.add(id);
        return next;
      });
    } catch (e: any) {
      console.log("[saved flags] exception:", e?.message || e);
    }
  }

  // 🚚 get one page
  const loadPage = useCallback(
    async (nextPage: number, replace = false) => {
      if (loading) return;
      setLoading(true);
      try {
        // 1) fetch one page from your API
        const items: FeedItem[] = await (dataAPI as any).getFeedPage(nextPage, PAGE_SIZE);

        // 2) hide unsafe
        const visible = safetyFilter(items ?? []);

        // 3) cache some recipe bits
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

        // 4) update saved flags for just this batch (unique ids)
        updateSavedFlagsFor(recipesOnly.map((r) => r.id), replace);

        // 5) WRITE LIST with DE-DUPE (fixes "two children with same key")
        setData((prev) => mergeUniqueFeed(prev, visible, replace));
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

  // 🔁 when login flips, refresh (so private + saved marks are correct)
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
    await success();
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
  // 🗨️ COMMENTS SHEET
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

  // ──────────────────────────────────────────────
  // 💾 SAVE / UNSAVE (recipe_saves)
  // ──────────────────────────────────────────────
  const toggleSave = useCallback(
    async (recipeId: string) => {
      if (!viewerId) {
        await warn();
        Alert.alert("Sign in required", "Please sign in to save recipes.");
        return;
      }
      const hasIt = savedSet.has(recipeId);

      // optimistic UI: flip first
      setSavedSet((prev) => {
        const next = new Set(prev);
        if (hasIt) next.delete(recipeId);
        else next.add(recipeId);
        return next;
      });

      try {
        if (hasIt) {
          const { error } = await supabase
            .from("recipe_saves")
            .delete()
            .eq("user_id", viewerId)
            .eq("recipe_id", recipeId);
          if (error) throw error;
        } else {
          // upsert avoids duplicate errors if tapped twice fast
          const { error } = await supabase
            .from("recipe_saves")
            .upsert({ user_id: viewerId, recipe_id: recipeId }, { onConflict: "user_id,recipe_id" });
          if (error) throw error;
        }
        await tap();
      } catch (e: any) {
        // revert on failure
        setSavedSet((prev) => {
          const next = new Set(prev);
          if (hasIt) next.add(recipeId);
          else next.delete(recipeId);
          return next;
        });
        await warn();
        Alert.alert("Save failed", e?.message ?? "Please try again.");
      }
    },
    [viewerId, savedSet]
  );

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
          onOpenComments={(id: string) => openComments(id)}
          // SAVE wiring
          isSaved={savedSet.has(item.id)}
          onToggleSave={() => toggleSave(item.id)}
          // keep swipe-to-save too (RecipeCard calls onSave if provided)
          onSave={() => toggleSave(item.id)}
        />
      );
    },
    [openComments, savedSet, toggleSave]
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
        keyExtractor={(it) => `${it.type}_${(it as any).id}`}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.lg }} />}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={onRefresh} />}
        ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 24 }} /> : null}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        initialNumToRender={8}
        windowSize={11}
      />

      {/* SEARCH BUTTON */}
      <SearchFab onPress={() => router.push("/search")} bottomOffset={24} />

      {/* 🗨️ COMMENTS SHEET */}
      <Modal visible={commentsVisible} animationType="slide" transparent onRequestClose={closeComments}>
        {/* Dim behind the sheet */}
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
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
              <TouchableOpacity onPress={closeComments} style={{ position: "absolute", right: 0, top: -2, padding: 8 }} accessibilityLabel="Close comments">
                <Text style={{ color: "#fff", fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Title */}
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 8 }}>Comments</Text>

            {/* Comments list */}
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <View style={{ flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
                  {/* avatar bubble (first letter) */}
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
                    <Text style={{ color: "#fff", fontSize: 12 }}>{item.author?.username?.slice(0, 1)?.toUpperCase() ?? "?"}</Text>
                  </View>

                  {/* name + time + text */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontWeight: "600" }}>
                      {item.author?.username ?? "user"}
                      <Text style={{ color: "rgba(255,255,255,0.5)", fontWeight: "400" }}>
                        {"  "}•{" "}
                        {new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </Text>
                    </Text>
                    <Text style={{ color: "rgba(255,255,255,0.9)", marginTop: 2 }}>{item.text}</Text>
                  </View>
                </View>
              )}
              ListEmptyComponent={commentsLoading ? null : <Text style={{ color: "rgba(255,255,255,0.7)", paddingVertical: 24 }}>No comments yet. Be the first!</Text>}
              ListFooterComponent={commentsLoading ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null}
              refreshControl={<RefreshControl tintColor="#fff" refreshing={sheetRefreshing} onRefresh={refreshSheet} />}
              style={{ maxHeight: "70%" }}
            />

            {/* Write a comment */}
            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 8, paddingBottom: 12 }}>
              <TextInput
                value={newText}
                onChangeText={setNewText}
                placeholder="Add a comment…"
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, marginRight: 8 }}
              />
              <TouchableOpacity onPress={sendComment} style={{ backgroundColor: "rgba(0,200,120,0.9)", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 }}>
                <Text style={{ color: "#031b12", fontWeight: "700" }}>Send</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}
