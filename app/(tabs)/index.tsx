// app/(tabs)/index.tsx
// HOME / FEED
//
// like I'm 5:
// - Show recipes + maybe ads.
// - Public recipes: everyone sees.
// - Private recipes: only the OWNER sees.
// - We avoid clearing the list mid-load (no white flash).
// - Keys are stable so rows don't "blink".

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ListRenderItemInfo,
  RefreshControl,
  View,
} from "react-native";
import { router } from "expo-router";

import { COLORS, SPACING } from "../../lib/theme";
import { dataAPI } from "../../lib/data";
import RecipeCard from "../../components/RecipeCard";
import SponsoredCard from "../../components/SponsoredCard";
import { success } from "../../lib/haptics";
import { recipeStore } from "../../lib/store";
import { logAdEvent } from "../../lib/ads";
import SearchFab from "../../components/SearchFab";
import { useUserId } from "../../lib/auth";

// 🧩 sponsored items
type SponsoredSlot = {
  id: string;
  brand?: string;
  title?: string;
  image?: string | null;
  cta?: string | null;
};

// 🧩 feed can show recipes or sponsored
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

// 🔒 normalize private flag
function isPrivateFlag(v: any): boolean {
  return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
}

export default function HomeScreen() {
  // 👤 who is looking?
  const { userId: viewerId } = useUserId(); // might be null when logged out

  // 📦 list data + paging
  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  // log ad impressions once per ad
  const seenAdsRef = useRef<Set<string>>(new Set());

  // build a safety filter that keeps:
  // - all sponsors
  // - public recipes
  // - private recipes only if I am the owner
  const safetyFilter = useCallback(
    (items: FeedItem[]) =>
      items.filter((it) => {
        if (it.type !== "recipe") return true;
        if (!isPrivateFlag((it as any).is_private)) return true;
        return !!viewerId && it.ownerId === viewerId;
      }),
    [viewerId]
  );

  // 🚚 load a page; replace mode avoids pre-clear flash
  const loadPage = useCallback(
    async (nextPage: number, replace = false) => {
      if (loading) return;
      setLoading(true);
      try {
        const items = await dataAPI.getFeedPage(nextPage, PAGE_SIZE);
        const visible = safetyFilter(items ?? []);

        // cache basic recipe info elsewhere if needed
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

  // 🚀 initial load
  useEffect(() => {
    loadPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🪄 when login state changes (null → uid or uid → null), refresh WITHOUT clearing first
  const lastViewerRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastViewerRef.current === viewerId) return;
    lastViewerRef.current = viewerId ?? null;
    // fetch and REPLACE after the data arrives (no white blank in between)
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

  // 👀 log sponsor impressions
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

  // 🔑 stable keys (do NOT include index)
  const keyExtractor = useCallback((it: FeedItem) => `${it.type}_${(it as any).id}`, []);

  // 🎨 each row
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
        <RecipeCard
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
          onOpen={(id) => router.push(`/recipe/${id}`)}
          onOpenCreator={(username: string) => router.push(`/u/${username}`)}
          onEdit={(id) => router.push({ pathname: "/recipe/edit/[id]", params: { id } })}
        />
      );
    },
    []
  );

  return (
    <View style={{ flex: 1 }}>
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
        // 👇 if Android still "flashes", try uncommenting the next line to disable clipping
        // removeClippedSubviews={false}
        initialNumToRender={8}
        windowSize={11}
      />
      <SearchFab onPress={() => router.push("/search")} bottomOffset={24} />
    </View>
  );
}
