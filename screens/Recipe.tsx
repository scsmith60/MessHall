// screens/Recipe.tsx
// MessHall — Recipe detail (normalized reads)
// - Loads base recipe + related rows
// - Resolves recipes.thumb_path (bucket path or URL) → signed URL for all images
//   (parity with Add/Edit/Home; no need to re-add a recipe)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Image, ScrollView, RefreshControl, StyleSheet, Pressable, Share, Platform, Modal,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';
import { resolveThumbUrl } from '../lib/thumb';     // ⟵ NEW
import ThumbImage from '../components/ThumbImage';  // ⟵ NEW

type RecipeRoute = RouteProp<RootStackParamList, 'Recipe'>;

type RecipeBaseRow = {
  id: string;
  user_id: string;
  title: string | null;
  source_url: string | null;
  thumb_path: string | null; // storage path or URL
};

type IngredientRow = { raw: string; pos: number | null };
type StepRow = { step_text: string; position: number | null };

type RecipeForUI = {
  id: string;
  user_id: string;
  title: string | null;
  source_url: string | null;
  thumb_path: string | null;
  ingredients: string[];
  steps: string[];
};

const dbg = (...a: any[]) => console.log('DBG[recipe]:', ...a); // DEBUG (comment later)

export default function Recipe() {
  const route = useRoute<RecipeRoute>();
  const nav = useNavigation<any>();
  const { isDark } = useThemeController();
  const insets = useSafeAreaInsets();

  const recipeId = route.params?.id;
  const [data, setData] = useState<RecipeForUI | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [coverModal, setCoverModal] = useState(false);

  // Signed URL for blurred hero background (we resolve once so we can blur it)
  const [heroUri, setHeroUri] = useState<string>('');

  const fetchRecipe = useCallback(async () => {
    if (!recipeId) return;
    setLoading(true);
    try {
      const { data: base, error: baseErr } = await supabase
        .from('recipes')
        .select('id, user_id, title, source_url, thumb_path')
        .eq('id', recipeId)
        .single<RecipeBaseRow>();
      if (baseErr) throw baseErr;

      const [{ data: ing, error: ingErr }, { data: stp, error: stpErr }] = await Promise.all([
        supabase
          .from('recipe_ingredients')
          .select('raw, pos')
          .eq('recipe_id', recipeId)
          .order('pos', { ascending: true }) as any,
        supabase
          .from('recipe_steps')
          .select('step_text, position')
          .eq('recipe_id', recipeId)
          .order('position', { ascending: true }) as any,
      ]);

      if (ingErr) throw ingErr;
      // stpErr can be ignored if table doesn’t exist

      const ingredients = (ing as IngredientRow[] | null | undefined)?.map(r => r.raw).filter(Boolean) ?? [];
      const steps = (stp as StepRow[] | null | undefined)?.map(r => r.step_text).filter(Boolean) ?? [];

      const ui: RecipeForUI = {
        id: base.id,
        user_id: base.user_id,
        title: base.title,
        source_url: base.source_url,
        thumb_path: base.thumb_path || null,
        ingredients,
        steps,
      };
      setData(ui);
      dbg('loaded thumb_path=', ui.thumb_path);
    } catch (e: any) {
      console.warn('[recipe:load]', e?.message || e);
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => { fetchRecipe(); }, [fetchRecipe]);

  // Resolve hero background whenever thumb_path changes
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = data?.thumb_path;
      if (!p) { if (alive) setHeroUri(''); return; }
      try {
        const url = await resolveThumbUrl(p);
        if (alive) setHeroUri(url);
        dbg('hero resolved →', url ? 'ok' : 'empty');
      } catch (e: any) {
        console.log('[recipe:hero:resolve]', e?.message || e);
        if (alive) setHeroUri('');
      }
    })();
    return () => { alive = false; };
  }, [data?.thumb_path]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await fetchRecipe(); } finally { setRefreshing(false); }
  }, [fetchRecipe]);

  const onShare = useCallback(async () => {
    if (!data) return;
    const msg = data.source_url || data.title || 'Recipe';
    try {
      await Share.share({ message: msg, url: data.source_url || undefined, title: data.title || 'Recipe' });
    } catch {}
  }, [data]);

  const heroTitle = useMemo(() => data?.title?.trim() || 'Recipe', [data]);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: isDark ? '#0B0F19' : '#FFFFFF' }]} edges={['top','left','right']}>
      {/* BG */}
      <View style={styles.heroWrap} pointerEvents="none">
        {heroUri ? (
          <Image source={{ uri: heroUri }} style={styles.heroImage} resizeMode="cover"
                 blurRadius={Platform.OS === 'android' ? 15 : 20}/>
        ) : (<View style={[styles.heroFallback, { backgroundColor: isDark ? '#0B0F19' : '#F3F4F6' }]} />)}
        <View style={styles.heroDim} />
        <View style={[styles.heroGradTop, { paddingTop: insets.top }]} />
        <View style={styles.heroGradBottom} />
      </View>

      {/* Foreground */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 16 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh}
                                       tintColor={isDark ? '#E5E7EB' : '#111827'} />}
      >
        <View style={[styles.headerRow, { marginTop: 4 }]}>
          <Pressable onPress={() => nav.goBack()} style={styles.smallBtn}>
            <Text style={styles.smallBtnText}>‹ Back</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          {recipeId ? (
            <Pressable onPress={() => nav.navigate('RecipeEdit' as never, { id: recipeId } as never)}
                       style={[styles.smallBtn, { marginLeft: 8 }]}>
              <Text style={styles.smallBtnText}>Edit</Text>
            </Pressable>
          ) : null}
          {data?.source_url ? (
            <Pressable onPress={onShare} style={[styles.smallBtn, { marginLeft: 8 }]}>
              <Text style={styles.smallBtnText}>Share</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.title, { color: isDark ? '#F3F4F6' : '#111827' }]} numberOfLines={2}>
          {heroTitle}
        </Text>

        {/* Cover image (resolves storage path → URL) */}
        {data?.thumb_path ? (
          <Pressable style={styles.coverCard} onPress={() => setCoverModal(true)}>
            <ThumbImage path={data.thumb_path} style={styles.cover} resizeMode="cover" debugKey="recipe-cover" />
          </Pressable>
        ) : null}

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

      {/* Full-screen cover */}
      <Modal visible={coverModal} transparent animationType="fade" onRequestClose={() => setCoverModal(false)}>
        <Pressable style={styles.coverBackdrop} onPress={() => setCoverModal(false)}>
          {data?.thumb_path ? (
            <ThumbImage path={data.thumb_path} style={styles.coverFullscreen} resizeMode="contain" debugKey="recipe-modal" />
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
  heroDim: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  heroGradTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 140, backgroundColor: 'transparent' },
  heroGradBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 200, backgroundColor: 'rgba(0,0,0,0.15)' },
  content: { padding: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10 },
  smallBtnText: { color: '#F3F4F6', fontWeight: '700' },
  title: { fontSize: 24, fontWeight: '800', marginTop: 8, marginBottom: 10 },
  coverCard: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  cover: { width: '100%', height: 200 },
  coverBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center', padding: 16 },
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
