// screens/Recipe.tsx
// MessHall — Recipe detail
// ✅ Loads by route param { id }
// ✅ Hero image as blurred, dimmed background with gradient overlay
// ✅ Foreground content stays readable; supports light/dark theme
// ✅ Pull-to-refresh, share link, defensive fallbacks
// ✅ SafeArea padding + tap-to-enlarge cover image

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Image, ScrollView, RefreshControl, StyleSheet, Pressable, Share, Platform, Modal,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';

type RecipeRoute = RouteProp<RootStackParamList, 'Recipe'>;

type RecipeRow = {
  id: string;
  user_id: string;
  title: string | null;
  source_url: string | null;
  thumb_url: string | null;
  ingredients: string[] | null;
  steps: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export default function Recipe() {
  const route = useRoute<RecipeRoute>();
  const nav = useNavigation();
  const { isDark } = useThemeController();
  const insets = useSafeAreaInsets();

  const recipeId = route.params?.id;
  const [data, setData] = useState<RecipeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // full-screen cover viewer
  const [coverModal, setCoverModal] = useState(false);

  const bgImage = data?.thumb_url || undefined;

  const fetchRecipe = useCallback(async () => {
    if (!recipeId) return;
    setLoading(true);
    try {
      const { data: rows, error } = await supabase
        .from('recipes')
        .select('*')
        .eq('id', recipeId)
        .limit(1)
        .maybeSingle<RecipeRow>();
      if (error) throw error;
      setData(rows || null);
    } catch (e) {
      console.warn('[recipe:load]', e);
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => {
    fetchRecipe();
  }, [fetchRecipe]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchRecipe();
    } finally {
      setRefreshing(false);
    }
  }, [fetchRecipe]);

  const onShare = useCallback(async () => {
    if (!data) return;
    const msg = data.source_url || data.title || 'Recipe';
    try {
      await Share.share({ message: msg, url: data.source_url || undefined, title: data.title || 'Recipe' });
    } catch {}
  }, [data]);

  const heroTitle = useMemo(() => data?.title?.trim() || 'Recipe', [data]);

  // ---------- UI ----------
  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: isDark ? '#0B0F19' : '#FFFFFF' }]}
      edges={['top', 'left', 'right']}
    >
      {/* Hero background (blur + dim) */}
      <View style={styles.heroWrap} pointerEvents="none">
        {bgImage ? (
          <Image
            source={{ uri: bgImage }}
            style={styles.heroImage}
            resizeMode="cover"
            blurRadius={Platform.OS === 'android' ? 15 : 20}
          />
        ) : (
          <View style={[styles.heroFallback, { backgroundColor: isDark ? '#0B0F19' : '#F3F4F6' }]} />
        )}
        {/* Dim + gradient overlay for readability */}
        <View style={styles.heroDim} />
        <View style={[styles.heroGradTop, { paddingTop: insets.top }]} />
        <View style={[styles.heroGradBottom]} />
      </View>

      {/* Foreground */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 16 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={isDark ? '#E5E7EB' : '#111827'}
          />
        }
      >
        {/* Header row */}
        <View style={[styles.headerRow, { marginTop: 4 }]}>
          <Pressable onPress={() => nav.goBack()} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>‹ Back</Text>
          </Pressable>

          <View style={{ flex: 1 }} />

          {/* Edit */}
          {recipeId ? (
            <Pressable
              onPress={() => nav.navigate('RecipeEdit' as never, { id: recipeId } as never)}
              style={[styles.smallBtn, { marginLeft: 8 }]}
            >
              <Text style={styles.smallBtnText}>Edit</Text>
            </Pressable>
          ) : null}

          {/* Share */}
          {data?.source_url ? (
            <Pressable onPress={onShare} style={[styles.smallBtn, { marginLeft: 8 }]}>
              <Text style={styles.smallBtnText}>Share</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Title + (optional) cover card */}
        <Text style={[styles.title, { color: isDark ? '#F3F4F6' : '#111827' }]} numberOfLines={2}>
          {heroTitle}
        </Text>

        {data?.thumb_url ? (
          <Pressable style={styles.coverCard} onPress={() => setCoverModal(true)}>
            <Image source={{ uri: data.thumb_url }} style={styles.cover} resizeMode="cover" />
          </Pressable>
        ) : null}

        {/* Source link */}
        {data?.source_url ? (
          <Text style={[styles.source, { color: isDark ? '#93C5FD' : '#1D4ED8' }]} numberOfLines={1}>
            {data.source_url}
          </Text>
        ) : null}

        {/* Ingredients */}
        <Text style={[styles.sectionH, { color: isDark ? '#E5E7EB' : '#111827' }]}>Ingredients</Text>
        <View style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
          {(data?.ingredients?.length ? data.ingredients : []).map((line, i) => (
            <Text key={`ing-${i}`} style={[styles.li, { color: isDark ? '#E5E7EB' : '#111827' }]}>• {line}</Text>
          ))}
          {!loading && !data?.ingredients?.length ? (
            <Text style={[styles.empty, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>No ingredients saved.</Text>
          ) : null}
        </View>

        {/* Steps */}
        <Text style={[styles.sectionH, { color: isDark ? '#E5E7EB' : '#111827' }]}>Steps</Text>
        <View style={[styles.card, isDark ? styles.cardDark : styles.cardLight]}>
          {(data?.steps?.length ? data.steps : []).map((line, i) => (
            <Text key={`step-${i}`} style={[styles.step, { color: isDark ? '#E5E7EB' : '#111827' }]}>{i + 1}. {line}</Text>
          ))}
          {!loading && !data?.steps?.length ? (
            <Text style={[styles.empty, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>No steps saved.</Text>
          ) : null}
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* Full-screen cover modal */}
      <Modal visible={coverModal} transparent animationType="fade" onRequestClose={() => setCoverModal(false)}>
        <Pressable style={styles.coverBackdrop} onPress={() => setCoverModal(false)}>
          {data?.thumb_url ? (
            <Image source={{ uri: data.thumb_url }} style={styles.coverFullscreen} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heroWrap: { position: 'absolute', inset: 0 },
  heroImage: { width: '100%', height: '100%' },
  heroFallback: { width: '100%', height: '100%' },

  // Dim entire bg
  heroDim: {
    position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)',
  },
  // Soft top gradient (paddingTop is set with safe-area insets)
  heroGradTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 140,
    backgroundColor: 'transparent',
  },
  // Soft bottom gradient (for long lists)
  heroGradBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 200,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },

  content: { padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10 },
  smallBtnText: { color: '#F3F4F6', fontWeight: '700' },

  title: { fontSize: 24, fontWeight: '800', marginTop: 8, marginBottom: 10 },
  coverCard: {
    borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 10,
  },
  cover: { width: '100%', height: 200 },

  // Full-screen viewer
  coverBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  coverFullscreen: { width: '100%', height: '80%', borderRadius: 12 },

  source: { marginBottom: 14, fontSize: 13 },

  sectionH: { fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 6 },

  card: { borderRadius: 14, padding: 12, borderWidth: 1 },
  cardDark: { backgroundColor: 'rgba(17,24,39,0.85)', borderColor: 'rgba(255,255,255,0.06)' },
  cardLight: { backgroundColor: 'rgba(255,255,255,0.65)', borderColor: 'rgba(0,0,0,0.05)' },

  li: { fontSize: 15, marginBottom: 6, lineHeight: 20 },
  step: { fontSize: 15, marginBottom: 10, lineHeight: 22 },
  empty: { fontSize: 14, fontStyle: 'italic' },
});
