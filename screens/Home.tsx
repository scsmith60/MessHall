// screens/Home.tsx
// MessHall — Home feed
// ✅ Loads current user's recipes (paginated, newest first)
// ✅ Pull-to-refresh + infinite scroll
// ✅ Local search filter by title/ingredient
// ✅ Tap → Recipe, FAB → Add, menu → Sign Out
// ✅ Light/Dark theming

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, Image, Pressable, TextInput, ActivityIndicator, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';

type RecipeRow = {
  id: string;
  user_id: string;
  title: string | null;
  source_url: string | null;
  thumb_url: string | null;
  ingredients: string[] | null;
  steps: string[] | null;
  created_at?: string | null;
};

const PAGE_SIZE = 20;

export default function Home() {
  const nav = useNavigation<any>();
  const { isDark } = useThemeController();

  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  const mountedRef = useRef(true);

  // ------- Auth bootstrap -------
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user;
      if (!me) {
        // Not signed in — kick to SignIn
        nav.reset({ index: 0, routes: [{ name: 'SignIn' as keyof RootStackParamList }] });
        return;
      }
      setUserId(me.id);
    })().finally(() => setLoading(false));
    return () => { mountedRef.current = false; };
  }, [nav]);

  // ------- Load page -------
  const fetchPage = useCallback(async (pageIndex: number) => {
    if (!userId) return { rows: [] as RecipeRow[], isEnd: true };
    const from = pageIndex * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error, count } = await supabase
      .from('recipes')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;
    const total = count ?? 0;
    const isEnd = to + 1 >= total;
    return { rows: (data as RecipeRow[]) || [], isEnd };
  }, [userId]);

  const loadInitial = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { rows: first, isEnd } = await fetchPage(0);
      if (!mountedRef.current) return;
      setRows(first);
      setReachedEnd(isEnd);
      setPage(0);
    } catch (e: any) {
      console.warn('[home:initial]', e?.message || e);
      Alert.alert('Load failed', 'Could not load your recipes.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchPage, userId]);

  useEffect(() => {
    if (userId) loadInitial();
  }, [userId, loadInitial]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadInitial();
    } finally {
      setRefreshing(false);
    }
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (loading || refreshing || reachedEnd) return;
    try {
      const next = page + 1;
      const { rows: more, isEnd } = await fetchPage(next);
      if (!mountedRef.current) return;
      setRows((prev) => prev.concat(more));
      setPage(next);
      setReachedEnd(isEnd);
    } catch (e) {
      // swallow
    }
  }, [fetchPage, loading, page, reachedEnd, refreshing]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const title = (r.title || '').toLowerCase();
      const ing = (r.ingredients || []).join(' ').toLowerCase();
      return title.includes(q) || ing.includes(q);
    });
  }, [rows, search]);

  // ------- Actions -------
  const onSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      // Kick to SignIn
      nav.reset({ index: 0, routes: [{ name: 'SignIn' }] });
    } catch {}
  }, [nav]);

  const openRecipe = useCallback((id: string) => {
    nav.navigate('Recipe', { id });
  }, [nav]);

  const openAdd = useCallback(() => {
    nav.navigate('Add');
  }, [nav]);

  // ------- Render -------
  const renderItem = useCallback(({ item }: { item: RecipeRow }) => {
    return (
      <Pressable onPress={() => openRecipe(item.id)} style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
        <View style={styles.thumbWrap}>
          {item.thumb_url ? (
            <Image source={{ uri: item.thumb_url }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]} />
          )}
        </View>
        <View style={styles.meta}>
          <Text style={[styles.title, { color: isDark ? '#F3F4F6' : '#111827' }]} numberOfLines={2}>
            {item.title || 'Untitled recipe'}
          </Text>
          {!!item.ingredients?.length && (
            <Text style={[styles.sub, { color: isDark ? '#9CA3AF' : '#6B7280' }]} numberOfLines={1}>
              {item.ingredients.slice(0, 3).join(' • ')}
            </Text>
          )}
        </View>
      </Pressable>
    );
  }, [isDark, openRecipe]);

  if (loading && !rows.length) {
    return (
      <View style={[styles.center, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
      {/* Top bar */}
      <View style={styles.topbar}>
        <Text style={[styles.brand, { color: isDark ? '#E5E7EB' : '#111827' }]}>MessHall</Text>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.topBtn} onPress={onSignOut}>
          <Text style={styles.topBtnText}>Sign out</Text>
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput
          style={[styles.search, isDark ? styles.inputDark : styles.inputLight]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search recipes or ingredients"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={isDark ? '#E5E7EB' : '#111827'} />
        }
        onEndReachedThreshold={0.3}
        onEndReached={loadMore}
        ListFooterComponent={
          !reachedEnd ? <View style={styles.footerLoad}><ActivityIndicator /></View> : <View style={{ height: 24 }} />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={[styles.emptyText, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>
              No recipes yet. Tap + to add your first one.
            </Text>
          </View>
        }
      />

      {/* FAB */}
      <Pressable style={styles.fab} onPress={openAdd}>
        <Text style={styles.fabPlus}>＋</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topbar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  brand: { fontSize: 20, fontWeight: '800' },
  topBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#374151', borderRadius: 8 },
  topBtnText: { color: '#F3F4F6', fontWeight: '700' },

  searchWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  search: {
    borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
  },
  inputDark: { backgroundColor: '#111827', borderColor: '#1F2937', color: '#E5E7EB' },
  inputLight: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', color: '#111827' },

  listContent: { padding: 12, paddingBottom: 80 },

  card: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: 'hidden',
  },
  cardDark: { backgroundColor: 'rgba(17,24,39,0.85)', borderColor: 'rgba(255,255,255,0.06)' },
  cardLight: { backgroundColor: '#FFFFFF', borderColor: 'rgba(0,0,0,0.05)' },

  thumbWrap: { width: 100, height: 82, backgroundColor: '#0F172A' },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { backgroundColor: '#111827' },

  meta: { flex: 1, padding: 10, justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sub: { fontSize: 12 },

  footerLoad: { paddingVertical: 16 },

  emptyWrap: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: 14, fontStyle: 'italic' },

  fab: {
    position: 'absolute', right: 16, bottom: 24,
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#4F46E5', shadowColor: '#000',
    shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPlus: { color: 'white', fontSize: 28, fontWeight: '900', lineHeight: 28 },
});
