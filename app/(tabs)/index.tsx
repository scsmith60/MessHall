// HOME / SCUTTLEBUTT FEED (now reading from Supabase via dataAPI)
// - Pull-to-refresh
// - Infinite scroll
// - Gently interleaved sponsored cards from DB
// - Registers recipes in the in-memory store so Detail/Cook can find them

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, ListRenderItemInfo, RefreshControl, View, Alert } from 'react-native';
import { COLORS, SPACING } from '../../lib/theme';
import { dataAPI } from '../../lib/data';
import RecipeCard from '../../components/RecipeCard';
import SponsoredCard from '../../components/SponsoredCard';
import { success } from '../../lib/haptics';
import { recipeStore } from '../../lib/store';
import { router } from 'expo-router';

type FeedItem =
  | { type: 'recipe'; id: string; title: string; image: string; creator: string; knives: number; cooks: number; createdAt: string }
  | { type: 'sponsored'; id: string; brand: string; title: string; image: string; cta: string };

export default function HomeScreen() {
  // STATE: list data + pagination flags
  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  // helper: load a page of data
  const loadPage = useCallback(async (nextPage: number) => {
    if (loading) return;
    setLoading(true);
    try {
      const items = await dataAPI.getFeedPage(nextPage, PAGE_SIZE);

      // register recipes in our tiny store so detail screen can find them by id
      const recipesOnly = items.filter(it => it.type === 'recipe') as Extract<FeedItem, { type: 'recipe' }>[];
      recipeStore.upsertMany(recipesOnly.map(r => ({
        id: r.id,
        title: r.title,
        image: r.image,
        creator: r.creator,
        knives: r.knives,
        cooks: r.cooks,
        createdAt: new Date(r.createdAt).getTime(),
      })));

      setData(prev => nextPage === 0 ? items : [...prev, ...items]);
      setPage(nextPage);
    } catch (err: any) {
      Alert.alert('Feed Problem', err?.message ?? 'Could not load feed.');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => { loadPage(0); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPage(0);
    await success();
    setRefreshing(false);
  };

  const onEndReached = () => {
    loadPage(page + 1);
  };

  const renderItem = ({ item }: ListRenderItemInfo<FeedItem>) => {
    if (item.type === 'sponsored') {
      return (
        <SponsoredCard
          brand={item.brand}
          title={item.title}
          image={item.image}
          cta={item.cta || 'Learn more'}
          onPress={() => {}}
        />
      );
    }
    return (
      <RecipeCard
        id={item.id}
        title={item.title}
        image={item.image}
        creator={item.creator}
        knives={item.knives}
        cooks={item.cooks}
        createdAt={new Date(item.createdAt).getTime()}
        onOpen={(id) => router.push(`/recipe/${id}`)}
        onSave={() => {}} // will use real API on Detail soon
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
    />
  );
}
