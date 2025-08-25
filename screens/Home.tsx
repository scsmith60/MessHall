// screens/Home.tsx
// MessHall — Home feed with avatar→Profile in header (long‑press avatar = Sign out)
// + SafeArea header spacing
// + Tap-to-enlarge recipe thumbnails
// + FIX: no hooks inside renderItem; SignedThumb component resolves storage paths to signed URLs
// + NEW: swipe left/right to Delete with confirmation (and deep cleanup)

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

// Gesture-handler swipe row
import { Swipeable, RectButton } from 'react-native-gesture-handler';

type RecipeRow = {
  id: string;
  user_id: string;
  title: string | null;
  source_url: string | null;
  thumb_path: string | null;
  ingredients: string[] | null;
  steps: string[] | null;
  created_at?: string | null;
};

const PAGE_SIZE = 20;
const AVATAR_SIZE = 36;

// Storage helpers
const BUCKET = 'recipe-thumbs';
const PREVIEW_TTL = 60 * 60; // 1h
const isHttp = (s?: string) => !!s && /^https?:\/\//i.test(s!);
const isStoragePath = (p?: string | null) => !!p && !/^https?:\/\//i.test(p || '');

async function toDisplayUrl(pathOrUrl?: string | null): Promise<string> {
  if (!pathOrUrl) return '';
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const clean = pathOrUrl.replace(new RegExp(`^${BUCKET}/?`, 'i'), '');
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(clean, PREVIEW_TTL);
  if (error) {
    return supabase.storage.from(BUCKET).getPublicUrl(clean).data?.publicUrl || '';
  }
  return data?.signedUrl || '';
}

// Child component to avoid hooks-in-renderItem
function SignedThumb({
  pathOrUrl,
  style,
  onPress,
  onError,
}: {
  pathOrUrl?: string | null;
  style: any;
  onPress?: () => void;
  onError?: (e: any) => void;
}) {
  const [url, setUrl] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await toDisplayUrl(pathOrUrl || '');
      if (!cancelled) setUrl(u);
    })();
    return () => { cancelled = true; };
  }, [pathOrUrl]);

  return (
    <Pressable style={style} onPress={onPress} disabled={!onPress}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          onError={onError}
        />
      ) : (
        <View style={{ width: '100%', height: '100%', backgroundColor: '#111827' }} />
      )}
    </Pressable>
  );
}

// Row with Swipeable (kept hook-free in renderItem by splitting out)
function RecipeRowItem({
  item,
  isDark,
  onOpen,
  onEnlarge,
  onDeletePress,
}: {
  item: RecipeRow;
  isDark: boolean;
  onOpen: (id: string) => void;
  onEnlarge: (path: string) => void;
  onDeletePress: (item: RecipeRow) => void;
}) {
  const renderRightActions = () => (
    <RectButton
      onPress={() => onDeletePress(item)}
      style={[styles.swipeAction, { backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'flex-end' }]}
    >
      <Text style={styles.swipeText}>Delete</Text>
    </RectButton>
  );
  const renderLeftActions = () => (
    <RectButton
      onPress={() => onDeletePress(item)}
      style={[styles.swipeAction, { backgroundColor: '#ef4444', justifyContent: 'center' }]}
    >
      <Text style={styles.swipeText}>Delete</Text>
    </RectButton>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} renderLeftActions={renderLeftActions} overshootLeft={false} overshootRight={false}>
      <View style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
        {/* Thumbnail: press to enlarge */}
        <SignedThumb
          pathOrUrl={item.thumb_path}
          style={styles.thumbWrap}
          onPress={() => item.thumb_path && onEnlarge(item.thumb_path)}
          onError={(e) => {
            console.warn('[home:thumb:error]', item.id, e?.nativeEvent?.error);
          }}
        />

        {/* Meta: press to open recipe */}
        <Pressable style={styles.meta} onPress={() => onOpen(item.id)}>
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
    </Swipeable>
  );
}

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

  // fullscreen thumb
  const [selectedThumbPath, setSelectedThumbPath] = useState<string | null>(null);
  const [selectedThumbUrl, setSelectedThumbUrl] = useState<string>('');

  const mountedRef = useRef(true);

  // Resolve modal image (handles storage path → signed URL)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedThumbPath) { setSelectedThumbUrl(''); return; }
      const u = await toDisplayUrl(selectedThumbPath);
      if (!cancelled) setSelectedThumbUrl(u);
    })();
    return () => { cancelled = true; };
  }, [selectedThumbPath]);

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

  // Deep delete + storage cleanup
  const actuallyDelete = useCallback(async (r: RecipeRow) => {
    try {
      // delete children first
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', r.id);
      await supabase.from('recipe_steps').delete().eq('recipe_id', r.id);

      // delete recipe row
      await supabase.from('recipes').delete().eq('id', r.id);

      // delete storage object if it's a bucket path
      if (isStoragePath(r.thumb_path)) {
        const clean = String(r.thumb_path).replace(new RegExp(`^${BUCKET}/?`, 'i'), '');
        await supabase.storage.from(BUCKET).remove([clean]);
      }

      // update UI
      setRows((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e: any) {
      Alert.alert('Delete failed', e?.message || 'Please try again.');
    }
  }, []);

  const confirmDelete = useCallback((r: RecipeRow) => {
    Alert.alert(
      'Delete recipe?',
      `This will permanently delete “${r.title || 'Untitled'}”.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => actuallyDelete(r) },
      ]
    );
  }, [actuallyDelete]);

  // ------- Render -------
  const renderItem = useCallback(({ item }: { item: RecipeRow }) => {
    return (
      <RecipeRowItem
        item={item}
        isDark={isDark}
        onOpen={openRecipe}
        onEnlarge={(p) => setSelectedThumbPath(p)}
        onDeletePress={confirmDelete}
      />
    );
  }, [confirmDelete, isDark, openRecipe]);

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
      <Modal visible={!!selectedThumbPath} transparent animationType="fade" onRequestClose={() => setSelectedThumbPath(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedThumbPath(null)}>
          {selectedThumbUrl ? (
            <Image
              source={{ uri: selectedThumbUrl }}
              style={styles.fullscreenImage}
              resizeMode="contain"
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

  // Swipe actions
  swipeAction: {
    width: 96,
    height: '100%',
    paddingHorizontal: 12,
  },
  swipeText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    paddingHorizontal: 8,
  },
});
