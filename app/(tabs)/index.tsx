// app/(tabs)/index.tsx
// HOME / SCUTTLEBUTT FEED
// like I'm 5:
// - We show a big list of recipe cards, with some sponsored (ad) cards sprinkled in.
// - We pull more when you scroll down (infinite), and you can pull-to-refresh.
// - We save recipes to a tiny in-memory store so other screens find them.
// - We track when a sponsored card is SEEN (>=50% visible) and log it ONE time.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  RefreshControl,
  View,
  Alert,
} from 'react-native';
import { COLORS, SPACING } from '../../lib/theme';
import { dataAPI } from '../../lib/data';
import RecipeCard from '../../components/RecipeCard';
import SponsoredCard from '../../components/SponsoredCard';
import { success } from '../../lib/haptics';
import { recipeStore } from '../../lib/store';
import { router } from 'expo-router';
import { logAdEvent } from '../../lib/ads';

// ===== Types =====
type SponsoredSlot = {
  id: string;         // required for tracking
  brand?: string;
  title?: string;
  image?: string;
  cta?: string;
};

// 👶 Feed items we render (recipes + ads)
// NEW: include ownerId + likes so RecipeCard can hide buttons and show ❤️ count.
type FeedItem =
  | {
      type: 'recipe';
      id: string;
      title: string;
      image: string;
      creator: string;
      knives: number;
      cooks: number;
      likes: number;       // ❤️ show this on the card
      createdAt: string;
      ownerId: string;     // who owns it (hides Like/Cooked when mine)
    }
  | {
      type: 'sponsored';
      // legacy fields (still coming from older feeds)
      id: string;
      brand: string;
      title: string;
      image: string;
      cta?: string;
      // preferred shape for ads:
      slot?: SponsoredSlot; // if not present, we’ll build a safe fallback below
    };

// ===== Screen =====
export default function HomeScreen() {
  // list state
  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  // remember which ads we saw so we don't double count impressions
  const seenAdsRef = useRef<Set<string>>(new Set());

  // load a page
  const loadPage = useCallback(
    async (nextPage: number) => {
      if (loading) return;
      setLoading(true);
      try {
        const items = await dataAPI.getFeedPage(nextPage, PAGE_SIZE);

        // register recipes in the tiny store for other screens
        const recipesOnly = items.filter(
          (it) => it.type === 'recipe'
        ) as Extract<FeedItem, { type: 'recipe' }>[];

        recipeStore.upsertMany(
          recipesOnly.map((r) => ({
            id: r.id,
            title: r.title,
            image: r.image,
            creator: r.creator,
            knives: r.knives,
            cooks: r.cooks,
            createdAt: new Date(r.createdAt).getTime(),
            // we could also store r.likes / r.ownerId if needed elsewhere
          }))
        );

        setData((prev) => (nextPage === 0 ? items : [...prev, ...items]));
        setPage(nextPage);
      } catch (err: any) {
        Alert.alert('Feed Problem', err?.message ?? 'Could not load feed.');
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  // first load
  useEffect(() => {
    loadPage(0);
  }, []);

  // pull-to-refresh
  const onRefresh = async () => {
    setRefreshing(true);
    seenAdsRef.current.clear(); // fresh session
    await loadPage(0);
    await success();
    setRefreshing(false);
  };

  // infinite scroll
  const onEndReached = () => {
    loadPage(page + 1);
  };

  // viewability: log ad impressions once per ad id
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    for (const v of viewableItems) {
      const item: FeedItem | undefined = v?.item;
      if (!item || item.type !== 'sponsored') continue;

      // prefer the slot id; fallback to legacy item id so we still log
      const candidateId = (item.slot && item.slot.id) || item.id;
      if (candidateId && !seenAdsRef.current.has(candidateId)) {
        seenAdsRef.current.add(candidateId);
        logAdEvent(candidateId, 'impression', { where: 'home_feed' });
      }
    }
  }).current;

  // render row
  const renderItem = ({ item }: ListRenderItemInfo<FeedItem>) => {
    if (item.type === 'sponsored') {
      const slot: SponsoredSlot =
        item.slot ??
        ({
          id: item.id,
          brand: item.brand,
          title: item.title,
          image: item.image,
          cta: item.cta,
        } as SponsoredSlot);

      return <SponsoredCard slot={slot as any} />;
    }

    // 🥘 recipe card — pass ownerId + likes so the card hides buttons and shows ❤️ count
    return (
      <RecipeCard
        id={item.id}
        title={item.title}
        image={item.image}
        creator={item.creator}
        knives={item.knives}
        cooks={item.cooks}
        likes={item.likes}
        createdAt={new Date(item.createdAt).getTime()}
        ownerId={item.ownerId}
        onOpen={(id) => router.push(`/recipe/${id}`)}
        onSave={() => {}}
      />
    );
  };

  // list UI
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}
      data={data}
      keyExtractor={(it, idx) => it.type + '_' + (it as any).id + '_' + idx}
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
    />
  );
}
