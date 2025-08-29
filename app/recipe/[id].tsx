// RECIPE DETAIL (now uses dataAPI for fetching + like/save)
// - If not logged in yet, like/save will show a friendly prompt (Auth comes later)

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { recipeStore } from '../../lib/store';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import Badge from '../../components/ui/Badge';
import StatPill from '../../components/ui/StatPill';
import HapticButton from '../../components/ui/HapticButton';
import { compactNumber, timeAgo } from '../../lib/utils';
import { success, tap, warn } from '../../lib/haptics';
import { dataAPI } from '../../lib/data';

// --- fake content generators (same as before so page looks full) ---
function fakeIngredients(title: string) { return ['2 tbsp olive oil','2 cloves garlic, minced','1 tsp salt','½ tsp black pepper',`Main thing for: ${title}`]; }
function fakeSteps(title: string) { return [`Preheat pan for ${title}.`,'Add oil and garlic; stir 1–2 min.','Add main ingredients; cook until done.','Season, plate, enjoy!']; }

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // piece 1: load from API; fallback to store if not found yet
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<{
    id: string; title: string; image: string; creator: string; knives: number; cooks: number; createdAt: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!id) return;
        const r = await dataAPI.getRecipeById(id);
        if (alive) {
          if (r) {
            setModel({
              id: r.id, title: r.title, image: r.image,
              creator: r.creator, knives: r.knives, cooks: r.cooks,
              createdAt: new Date(r.createdAt).getTime()
            });
          } else {
            // fallback to store, e.g. if we opened from a locally seeded feed item
            const s = recipeStore.get(id);
            setModel(s ? {
              id: s.id, title: s.title, image: s.image, creator: s.creator,
              knives: s.knives, cooks: s.cooks, createdAt: s.createdAt
            } : null);
          }
        }
      } catch {
        const s = id ? recipeStore.get(id) : undefined;
        if (alive) setModel(s ? { ...s } as any : null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // liked/saved local UI state (will sync with API)
  const [saved, setSaved] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(420);

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: COLORS.text }}>Loading…</Text>
    </View>;
  }
  if (!model) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>Hmm, couldn’t find that recipe.</Text>
        <HapticButton onPress={() => router.back()} style={{ marginTop: 16, backgroundColor: COLORS.card, padding: 12, borderRadius: RADIUS.lg }}>
          <Text style={{ color: COLORS.accent, fontWeight: '800' }}>Go Back</Text>
        </HapticButton>
      </View>
    );
  }

  const shareIt = async () => {
    await success();
    await Share.share({ message: `${model.title} on MessHall — messhall://recipe/${model.id}` });
  };

  const toggleSave = async () => {
    try {
      const state = await dataAPI.toggleSave(model.id);
      setSaved(state);
      await tap();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to save recipes.');
    }
  };

  const toggleLike = async () => {
    try {
      const { liked, likesCount } = await dataAPI.toggleLike(model.id);
      setLiked(liked);
      setLikesCount(likesCount || 0);
      await tap();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to like recipes.');
    }
  };

  const startCookMode = async () => {
    await success();
    router.push(`/cook/${model.id}`);
  };

  // dummy content (until we fetch real ingredients/steps)
  const ings = (model as any).ingredients?.length ? (model as any).ingredients : [
  '2 tbsp olive oil','2 cloves garlic, minced','1 tsp salt','½ tsp black pepper',`Main thing for: ${model.title}`
];

const steps = (model as any).steps?.length ? (model as any).steps.map((s: any) => s.text) : [
  `Preheat pan for ${model.title}.`,
  'Add oil and garlic; stir 1–2 min.',
  'Add main ingredients; cook until done.',
  'Season, plate, enjoy!'
];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Image source={{ uri: model.image }} style={{ width: '100%', height: 280 }} />

      <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 }}>{model.title}</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: COLORS.text, fontWeight: '700' }}>{model.creator}</Text>
          <Badge knives={model.knives} />
          <View style={{ flex: 1 }} />
          <Text style={{ color: COLORS.subtext }}>{timeAgo(model.createdAt)}</Text>
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          <StatPill label={`${compactNumber(model.cooks)} cooked`} />
          <StatPill label={`${compactNumber(likesCount)} likes`} />
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <HapticButton onPress={toggleSave} style={{ flex: 1, backgroundColor: saved ? '#14532d' : COLORS.card, paddingVertical: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}>
            <Text style={{ color: saved ? '#CFF8D6' : COLORS.text, fontWeight: '800' }}>{saved ? 'Saved ✓' : 'Save'}</Text>
          </HapticButton>
          <HapticButton onPress={toggleLike} style={{ flex: 1, backgroundColor: liked ? '#1f2937' : COLORS.card, paddingVertical: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}>
            <Text style={{ color: liked ? '#FFD1DC' : COLORS.text, fontWeight: '800' }}>{liked ? '♥ Liked' : '♡ Like'}</Text>
          </HapticButton>
          <HapticButton onPress={shareIt} style={{ width: 80, backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}>
            <Text style={{ color: '#001018', fontWeight: '900' }}>Share</Text>
          </HapticButton>
        </View>
      </View>

      {/* Ingredients */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 6 }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Ingredients</Text>
        {ings.map((t, i) => (<Text key={i} style={{ color: COLORS.subtext, marginBottom: 6 }}>• {t}</Text>))}
      </View>

      {/* STEPS */}
<View style={{ paddingHorizontal: SPACING.lg, marginTop: 16 }}>
  <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Steps</Text>
  {(Array.isArray((model as any).steps) && (model as any).steps.length
    ? (model as any).steps.map((s: any) => ({ text: s.text, seconds: s.seconds ?? null }))
    : [
        { text: `Preheat pan for ${model.title}.`, seconds: null },
        { text: 'Add oil and garlic; stir 1–2 min.', seconds: 120 },
        { text: 'Add main ingredients; cook until done.', seconds: null },
        { text: 'Season, plate, enjoy!', seconds: null }
      ]
  ).map((s: any, i: number) => (
    <View key={i} style={{ flexDirection: 'row', marginBottom: 10 }}>
      <Text style={{ color: COLORS.accent, fontWeight: '900', width: 24 }}>{i + 1}.</Text>
      <Text style={{ color: COLORS.subtext, flex: 1 }}>
        {s.text}{' '}
        {typeof s.seconds === 'number' && s.seconds > 0 && (
          <Text style={{ color: COLORS.accent }}>({String(Math.floor(s.seconds / 60)).padStart(2,'0')}:{String(s.seconds % 60).padStart(2,'0')})</Text>
        )}
      </Text>
    </View>
  ))}
</View>


      {/* Start Cook Mode */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 8 }}>
        <HapticButton onPress={startCookMode} style={{ backgroundColor: COLORS.accent, paddingVertical: 16, borderRadius: RADIUS.xl, alignItems: 'center' }}>
          <Text style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>Start Cook Mode</Text>
        </HapticButton>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
