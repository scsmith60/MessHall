// app/(tabs)/index.tsx
// HOME / SCUTTLEBUTT FEED
// like I'm 5:
// - We show a big list of recipe cards, with some sponsored cards sprinkled in.
// - Pull down to refresh; scroll down to load more.
// - NEW: we pass creatorAvatar and onOpenCreator so the card can show a face you can tap.

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
  id: string;
  brand?: string;
  title?: string;
  image?: string;
  cta?: string;
};

// 👶 Feed items we render (recipes + ads)
type FeedItem =
  | {
      type: 'recipe';
      id: string;
      title: string;
      image: string;
      creator: string;                 // callsign
      creatorAvatar?: string | null;   // 👶 face picture URL
      knives: number;
      cooks: number;
      likes: number;
      createdAt: string;
      ownerId: string;
    }
  | {
      type: 'sponsored';
      id: string;
      brand: string;
      title: string;
      image: string;
      cta?: string;
      slot?: SponsoredSlot;
    };

// ===== Screen =====
export default function HomeScreen() {
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

      const candidateId = (item.slot && item.slot.id) || item.id;
      if (candidateId && !seenAdsRef.current.has(candidateId)) {
        seenAdsRef.current.add(candidateId);
        logAdEvent(candidateId, 'impression', { where: 'home_feed' });
      }
    }
  }).current;

  // row
  const renderItem = ({ item }: ListRenderItemInfo<FeedItem>) => {
    if (item.type === 'sponsored') {
      const slot: SponsoredSlot =
        item.slot ??
        ({ id: item.id, brand: item.brand, title: item.title, image: item.image, cta: item.cta } as SponsoredSlot);

      return <SponsoredCard slot={slot as any} />;
    }

    // 🥘 recipe card — pass avatar + tap handlers
    return (
      <RecipeCard
        id={item.id}
        title={item.title}
        image={item.image}
        creator={item.creator}
        creatorAvatar={item.creatorAvatar || undefined} // 👶 NEW
        knives={item.knives}
        cooks={item.cooks}
        likes={item.likes}
        createdAt={new Date(item.createdAt).getTime()}
        ownerId={item.ownerId}
        onOpen={(id) => router.push(`/recipe/${id}`)}
        onSave={() => {}}
        // name/avatar tap → open profile
        onOpenCreator={(username: string) => router.push(`/u/${username}`)}
      />
    );
  };

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}
      data={data}
      keyExtractor={(it, idx) => it.type + '_' + (it as any).id + '_' + idx}
      renderItem={renderItem}
      ItemSeparatorComponent={() => <View style={{ height: SPACING.lg }} />}
      onEndReachedThreshold={0.4}
      onEndReached={onEndReached}
      refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={onRefresh} />}
      ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 24 }} /> : null}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
    />
  );
}
