// app/(tabs)/index.tsx
// HOME / SCUTTLEBUTT FEED
// like I'm 5:
// - this shows the feed list
// - we pass the real commentCount number into RecipeCard

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  RefreshControl,
  View,
  Alert,
} from 'react-native';
import { router } from 'expo-router';

import { COLORS, SPACING } from '../../lib/theme';
import { dataAPI } from '../../lib/data';
import RecipeCard from '../../components/RecipeCard';
import SponsoredCard from '../../components/SponsoredCard';
import { success } from '../../lib/haptics';
import { recipeStore } from '../../lib/store';
import { logAdEvent } from '../../lib/ads';
import SearchFab from '../../components/SearchFab';

// small helper type for sponsored items
type SponsoredSlot = {
  id: string;
  brand?: string;
  title?: string;
  image?: string;
  cta?: string;
};

// the feed can show recipes or sponsored cards
type FeedItem =
  | {
      type: 'recipe';
      id: string;
      title: string;
      image: string | null;
      creator: string;
      creatorAvatar?: string | null;
      knives: number;
      cooks: number;
      likes: number;
      commentCount: number;   // <- the number we need to show 💬 on the card
      createdAt: string;
      ownerId: string;
    }
  | {
      type: 'sponsored';
      id: string;
      brand: string;
      title: string;
      image: string | null;
      cta?: string;
      slot?: SponsoredSlot;
    };

export default function HomeScreen() {
  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  // remember which ads were already seen
  const seenAdsRef = useRef<Set<string>>(new Set());

  // load a page of feed data
  const loadPage = useCallback(
    async (nextPage: number) => {
      if (loading) return;
      setLoading(true);
      try {
        const items = await dataAPI.getFeedPage(nextPage, PAGE_SIZE);

        // put basic recipe info into your in-memory store (used elsewhere)
        const recipesOnly = items.filter((it) => it.type === 'recipe') as Array<
          Extract<FeedItem, { type: 'recipe' }>
        >;
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
    seenAdsRef.current.clear();
    await loadPage(0);
    await success();
    setRefreshing(false);
  };

  // infinite scroll
  const onEndReached = () => loadPage(page + 1);

  // track ad impressions once
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

  // how to draw each row
  const renderItem = ({ item }: ListRenderItemInfo<FeedItem>) => {
    if (item.type === 'sponsored') {
      const slot: SponsoredSlot =
        item.slot ??
        ({ id: item.id, brand: item.brand, title: item.title, image: item.image, cta: item.cta } as SponsoredSlot);
      return <SponsoredCard slot={slot as any} />;
    }

    // IMPORTANT: we pass commentCount to the card here
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
        onOpen={(id) => router.push(`/recipe/${id}`)}
        onSave={() => {}}
        onOpenCreator={(username: string) => router.push(`/u/${username}`)}
        onEdit={(id) => {
          console.log('[go-edit] pushing /recipe/edit/[id] with id=', id);
          router.push({ pathname: '/recipe/edit/[id]', params: { id } });
        }}
      />
    );
  };

  // list + floating search button
  return (
    <View style={{ flex: 1 }}>
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
      <SearchFab onPress={() => router.push('/search')} bottomOffset={24} />
    </View>
  );
}
