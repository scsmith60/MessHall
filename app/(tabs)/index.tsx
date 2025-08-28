// HOME / SCUTTLEBUTT FEED
// THINK: A fast FlatList with pull-to-refresh + infinite scroll.
// DO: Insert sponsored items every few cards (already done in fake server).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, ListRenderItemInfo, RefreshControl, View } from 'react-native';
import { COLORS, SPACING } from '../../lib/theme';
import { fetchFeedPage, FeedItem } from '../../lib/feed';
import RecipeCard from '../../components/RecipeCard';
import SponsoredCard from '../../components/SponsoredCard';
import { success } from '../../lib/haptics';
import { recipeStore } from '../../lib/store';
import { router } from 'expo-router'; // 👈 NEW import for navigation

export default function HomeScreen() {
  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 10;

  const loadPage = useCallback(async (nextPage: number) => {
    if (loading) return;
    setLoading(true);

    const items = await fetchFeedPage(nextPage, PAGE_SIZE);

    // feed returns both 'recipe' and 'sponsored' items;
    // register only actual recipes so detail screen can find them by id.
    const recipesOnly = items.filter(it => it.type === 'recipe') as any[];
    recipeStore.upsertMany(
      recipesOnly.map(r => ({
        id: r.id,
        title: r.title,
        image: r.image,
        creator: r.creator,
        knives: r.knives,
        cooks: r.cooks,
        createdAt: r.createdAt,
      }))
    );

    setData(prev => (nextPage === 0 ? items : [...prev, ...items]));
    setPage(nextPage);
    setLoading(false);
  }, [loading]);

  useEffect(() => {
    loadPage(0);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPage(0);
    success(); // little buzz to say "all fresh!"
    setRefreshing(false);
  };

  const onEndReached = () => {
    // when you scroll near bottom, get the next page
    loadPage(page + 1);
  };

  const renderItem = ({ item }: ListRenderItemInfo<FeedItem>) => {
    if (item.type === 'sponsored') {
      return (
        <SponsoredCard
          brand={item.brand}
          title={item.title}
          image={item.image}
          cta={item.cta}
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
        createdAt={item.createdAt}
        // 👇 navigate to detail when opened
        onOpen={(id) => router.push(`/recipe/${id}`)}
        onSave={(id) => {}}
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
      refreshControl={
        <RefreshControl
          tintColor="#fff"
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      }
      ListFooterComponent={
        loading ? <ActivityIndicator style={{ marginVertical: 24 }} /> : null
      }
    />
  );
}
