// screens/Home.tsx
// MessHall — Home feed with avatar→Profile in header (long‑press avatar = Sign out)
// + SafeArea header spacing
// + Tap-to-enlarge recipe thumbnails
// + Uses ThumbImage (path → signed URL) for recipe thumbs

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, Image, Pressable, TextInput, ActivityIndicator, StyleSheet,
  RefreshControl, Alert, Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';
import ThumbImage from '../components/ThumbImage'; // ⟵ NEW

type RecipeRow = {
  id: string;
  user_id: string;
  title: string | null;
  source_url: string | null;
  thumb_path: string | null; // storage path or URL
  ingredients: string[] | null;
  steps: string[] | null;
  created_at?: string | null;
};

const PAGE_SIZE = 20;
const AVATAR_SIZE = 36;

export default function Home() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { isDark } = useThemeController();

  const [userId, setUserId] = useState<string | null>(null);

  // profile bits for avatar
  const [displayName, setDisplayName] = useState<string>('');
  const [avatarUri, setAvatarUri] = useState<string>('');

  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  // fullscreen thumb (stores the same path the DB has)
  const [selectedThumb, setSelectedThumb] = useState<string | null>(null);

  const mountedRef = useRef(true);

  // ------- Auth bootstrap -------
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user;
      if (!me) {
        nav.reset({ index: 0, routes: [{ name: 'SignIn' as keyof RootStackParamList }] });
        return;
      }
      setUserId(me.id);
    })().finally(() => setLoading(false));
    return () => { mountedRef.current = false; };
  }, [nav]);

  // ------- Profile / Avatar fetch -------
  useEffect(() => {
    if (!userId) return;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('display_name, full_name, avatar_url, avatar_path, handle')
          .eq('id', userId)
          .maybeSingle();

        if (error) throw error;

        const dn = (data?.display_name || data?.full_name || data?.handle || '').trim();
        if (dn) setDisplayName(dn);

        let uri = (data?.avatar_url as string) || '';
        if (!uri && data?.avatar_path) {
          const { data: signed, error: sErr } = await supabase
            .storage
            .from('avatars')
            .createSignedUrl(String(data.avatar_path), 60 * 60); // 1h
          if (!sErr && signed?.signedUrl) uri = signed.signedUrl;
        }

        if (mountedRef.current) setAvatarUri(uri || '');
      } catch (e) {
        console.warn('[home:avatar]', e);
      }
    })();
  }, [userId]);

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
    } catch {/* noop */}
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
      nav.reset({ index: 0, routes: [{ name: 'SignIn' }] });
    } catch {}
  }, [nav]);

  const openRecipe = useCallback((id: string) => {
    nav.navigate('Recipe', { id });
  }, [nav]);

  const openAdd = useCallback(() => {
    nav.navigate('Add');
  }, [nav]);

  const goProfile = useCallback(() => {
    nav.navigate('Profile');
  }, [nav]);

  // ------- Render -------
  const renderItem = useCallback(({ item }: { item: RecipeRow }) => {
    return (
      <View style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
        {/* Thumbnail: press to enlarge */}
        <Pressable
          style={styles.thumbWrap}
          onPress={() => item.thumb_path && setSelectedThumb(item.thumb_path)}
        >
          {item.thumb_path ? (
            <ThumbImage
              path={item.thumb_path}
              style={styles.thumb}
              debugKey={item.id} // DEBUG aid
            />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]} />
          )}
        </Pressable>

        {/* Meta: press to open recipe */}
        <Pressable style={styles.meta} onPress={() => openRecipe(item.id)}>
          <Text style={[styles.title, { color: isDark ? '#F3F4F6' : '#111827' }]} numberOfLines={2}>
            {item.title || 'Untitled recipe'}
          </Text>
          {!!item.ingredients?.length && (
            <Text style={[styles.sub, { color: isDark ? '#9CA3AF' : '#6B7280' }]} numberOfLines={1}>
              {item.ingredients.slice(0, 3).join(' • ')}
            </Text>
          )}
        </Pressable>
      </View>
    );
  }, [isDark, openRecipe]);

  // Header avatar (tap → Profile, long‑press → Sign out)
  const initials = (displayName || 'You').trim().split(/\s+/).map(s => s[0]?.toUpperCase()).slice(0,2).join('');
  const Avatar = (
    <Pressable
      onPress={goProfile}
      onLongPress={onSignOut}
      hitSlop={8}
      style={styles.avatarBtn}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
      ) : (
        <View style={[styles.avatarImg, styles.avatarFallback, { backgroundColor: isDark ? '#374151' : '#E5E7EB' }]}>
          <Text style={[styles.avatarInitials, { color: isDark ? '#E5E7EB' : '#111827' }]}>{initials}</Text>
        </View>
      )}
    </Pressable>
  );

  if (loading && !rows.length) {
    return (
      <View style={[styles.center, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]} edges={['top', 'right', 'left']}>
      {/* Top bar (respect safe area) */}
      <View style={[styles.topbar, { paddingTop: Math.max(insets.top, 8) }]}>
        <Text style={[styles.brand, { color: isDark ? '#E5E7EB' : '#111827' }]}>MessHall</Text>
        <View style={{ flex: 1 }} />
        {Avatar}
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

      {/* Fullscreen thumbnail modal */}
      <Modal visible={!!selectedThumb} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedThumb(null)}>
          {selectedThumb ? (
            <ThumbImage
              path={selectedThumb}
              style={styles.fullscreenImage}
              resizeMode="contain"
              debugKey="home-modal"
            />
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  brand: { fontSize: 20, fontWeight: '800' },

  avatarBtn: { paddingLeft: 8 },
  avatarImg: {
    width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 12, fontWeight: '800' },

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

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  fullscreenImage: {
    width: '100%',
    height: '80%',
    borderRadius: 12,
  },
});
