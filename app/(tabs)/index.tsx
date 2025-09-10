// app/(tabs)/index.tsx
// HOME / SCUTTLEBUTT FEED
//
// like I'm 5:
// - This screen shows the big list of recipes (the feed).
// - We added a *safety* filter so PRIVATE recipes (is_private = true) never show here.
// - Even if the backend makes a boo-boo, our filter hides private stuff.
// - Sponsored cards still show normally.
//
// 🔒 What changed?
//   1) Added `is_private?: boolean` to the recipe item type.
//   2) After we load a page, we filter out any recipe where is_private is true (or 1, or "true").
//   3) Everything else works the same.

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

// 🧩 small helper type for sponsored items
type SponsoredSlot = {
  id: string;
  brand?: string;
  title?: string;
  image?: string;
  cta?: string;
};

// 🧩 the feed can show recipes or sponsored cards
// 👇 We added `is_private?: boolean` so we can hide private recipes on the client too.
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
      commentCount: number;   // <- bubble count for 💬 on the card
      createdAt: string;
      ownerId: string;
      is_private?: boolean;   // 🔒 NEW: used only to hide private recipes in the feed
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

// 🔎 Tiny helper: figure out if a recipe item is private no matter how it's encoded
// (boolean true, number 1, or string "true")
function isRecipePrivate(item: Extract<FeedItem, { type: 'recipe' }>): boolean {
  const v = (item as any)?.is_private;
  return v === true || v === 1 || v === 'true';
}

export default function HomeScreen() {
  // 📦 list data + paging/loading flags
  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  // 📝 remember which ads were already seen so we only log once
  const seenAdsRef = useRef<Set<string>>(new Set());

  // 🚚 load a page of feed data from our API
  const loadPage = useCallback(
    async (nextPage: number) => {
      if (loading) return;
      setLoading(true);
      try {
        // 1) Ask our API for a page of items
        const items = await dataAPI.getFeedPage(nextPage, PAGE_SIZE);

        // 2) SAFETY FILTER (important part):
        //    - keep sponsored items as-is
        //    - keep only recipe items that are NOT private
        const visibleItems: FeedItem[] = (items ?? []).filter((it: FeedItem) => {
          if (it.type !== 'recipe') return true;                // ads are fine
          return !isRecipePrivate(it);                          // hide private recipes
        });

        // 3) Put basic recipe info into in-memory store (used elsewhere in app)
        const recipesOnly = visibleItems.filter((it) => it.type === 'recipe') as Array<
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

        // 4) Put the (filtered) stuff into our list
        setData((prev) => (nextPage === 0 ? visibleItems : [...prev, ...visibleItems]));
        setPage(nextPage);
      } catch (err: any) {
        Alert.alert('Feed Problem', err?.message ?? 'Could not load feed.');
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  // 🚀 first load when the screen shows up
  useEffect(() => {
    loadPage(0);
  }, []);

  // 🔄 pull-to-refresh handler
  const onRefresh = async () => {
    setRefreshing(true);
    seenAdsRef.current.clear();
    await loadPage(0);
    await success(); // haptic tickle
    setRefreshing(false);
  };

  // ⬇️ infinite scroll handler
  const onEndReached = () => loadPage(page + 1);

  // 👀 track ad impressions once per ad
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

  // 🧱 how to draw each row
  const renderItem = ({ item }: ListRenderItemInfo<FeedItem>) => {
    if (item.type === 'sponsored') {
      const slot: SponsoredSlot =
        item.slot ??
        ({ id: item.id, brand: item.brand, title: item.title, image: item.image, cta: item.cta } as SponsoredSlot);
      return <SponsoredCard slot={slot as any} />;
    }

    // 📇 recipe cards (note: by now, private ones were filtered out)
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

  // 🧱 the list + floating search button
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
