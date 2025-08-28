// RECIPE DETAIL SCREEN
// WHAT THIS DOES (like I'm 5):
// - It looks at the URL (recipe/:id) to know which recipe you tapped.
// - It asks our tiny store for that recipe's data.
// - It shows a big picture, title, who made it (with knives badge), and stats.
// - Buttons: Save, Like, Share, Start Cook Mode (hooked up to haptics).
// - It shows Ingredients + Steps using the title only (fake content for feed items);
//   If you saved a draft later with real items, we’ll fetch those from DB.

// imports
import React, { useMemo, useState } from 'react';
import { Alert, Image, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { recipeStore } from '../../lib/store';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import Badge from '../../components/ui/Badge';
import StatPill from '../../components/ui/StatPill';
import HapticButton from '../../components/ui/HapticButton';
import { compactNumber, timeAgo } from '../../lib/utils';
import { success, tap, warn } from '../../lib/haptics';

// helper: build some dummy sections so page looks real
function fakeIngredients(title: string) {
  return [
    '2 tbsp olive oil',
    '2 cloves garlic, minced',
    '1 tsp salt',
    '½ tsp black pepper',
    `Main thing for: ${title}`
  ];
}
function fakeSteps(title: string) {
  return [
    `Preheat pan for ${title}.`,
    'Add oil and garlic; stir 1–2 min.',
    'Add main ingredients; cook until done.',
    'Season, plate, enjoy!'
  ];
}

export default function RecipeDetail() {
  // 1) get the :id from the route
  const { id } = useLocalSearchParams<{ id: string }>();

  // 2) ask our store for the recipe
  const recipe = useMemo(() => (id ? recipeStore.get(id) : undefined), [id]);

  // 3) local like/save states (so UI updates instantly)
  const [saved, setSaved] = useState(id ? recipeStore.isSaved(id) : false);
  const [liked, setLiked] = useState(id ? recipeStore.isLiked(id) : false);
  const [likesCount, setLikesCount] = useState(420); // fake number for demo

  // 4) if not found, show friendly message
  if (!recipe) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
          Hmm, couldn’t find that recipe.
        </Text>
        <HapticButton onPress={() => router.back()} style={{ marginTop: 16, backgroundColor: COLORS.card, padding: 12, borderRadius: RADIUS.lg }}>
          <Text style={{ color: COLORS.accent, fontWeight: '800' }}>Go Back</Text>
        </HapticButton>
      </View>
    );
  }

  const shareIt = async () => {
    await success();
    await Share.share({ message: `${recipe.title} on MessHall — messhall://recipe/${recipe.id}` });
  };

  const toggleSave = async () => {
    if (!id) return;
    const newVal = recipeStore.toggleSaved(id);
    setSaved(newVal);
    await tap();
  };

  const toggleLike = async () => {
    if (!id) return;
    const newVal = recipeStore.toggleLiked(id);
    setLiked(newVal);
    setLikesCount(c => c + (newVal ? 1 : -1));
    await tap();
  };

  const startCookMode = async () => {
    await success();
    router.push(`/cook/${recipe.id}`);
    // FUTURE: router.push(`/cook/${recipe.id}`)
  };

  // dummy content
  const ings = fakeIngredients(recipe.title);
  const steps = fakeSteps(recipe.title);

  // UI
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* HERO IMAGE */}
      <Image source={{ uri: recipe.image }} style={{ width: '100%', height: 280 }} />

      {/* HEADER CARD */}
      <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 }}>
          {recipe.title}
        </Text>

        {/* CREATOR LINE */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: COLORS.text, fontWeight: '700' }}>{recipe.creator}</Text>
          <Badge knives={recipe.knives} />
          <View style={{ flex: 1 }} />
          <Text style={{ color: COLORS.subtext }}>{timeAgo(recipe.createdAt)}</Text>
        </View>

        {/* STATS */}
        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          <StatPill label={`${compactNumber(recipe.cooks)} cooked`} />
          <StatPill label={`${compactNumber(likesCount)} likes`} />
        </View>

        {/* ACTION BUTTONS */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <HapticButton
            onPress={toggleSave}
            style={{ flex: 1, backgroundColor: saved ? '#14532d' : COLORS.card, paddingVertical: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}
          >
            <Text style={{ color: saved ? '#CFF8D6' : COLORS.text, fontWeight: '800' }}>
              {saved ? 'Saved ✓' : 'Save'}
            </Text>
          </HapticButton>

          <HapticButton
            onPress={toggleLike}
            style={{ flex: 1, backgroundColor: liked ? '#1f2937' : COLORS.card, paddingVertical: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}
          >
            <Text style={{ color: liked ? '#FFD1DC' : COLORS.text, fontWeight: '800' }}>
              {liked ? '♥ Liked' : '♡ Like'}
            </Text>
          </HapticButton>

          <HapticButton
            onPress={shareIt}
            style={{ width: 80, backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}
          >
            <Text style={{ color: '#001018', fontWeight: '900' }}>Share</Text>
          </HapticButton>
        </View>
      </View>

      {/* INGREDIENTS */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 6 }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Ingredients</Text>
        {ings.map((t, i) => (
          <Text key={i} style={{ color: COLORS.subtext, marginBottom: 6 }}>• {t}</Text>
        ))}
      </View>

      {/* STEPS */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 16 }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Steps</Text>
        {steps.map((t, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 10 }}>
            <Text style={{ color: COLORS.accent, fontWeight: '900', width: 24 }}>{i + 1}.</Text>
            <Text style={{ color: COLORS.subtext, flex: 1 }}>{t}</Text>
          </View>
        ))}
      </View>

      {/* START COOK MODE */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 8 }}>
        <HapticButton
          onPress={startCookMode}
          style={{ backgroundColor: COLORS.accent, paddingVertical: 16, borderRadius: RADIUS.xl, alignItems: 'center' }}
        >
          <Text style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>Start Cook Mode</Text>
        </HapticButton>
      </View>

      {/* COMMENTS (placeholder) */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 20 }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Comments</Text>
        <View style={{ backgroundColor: COLORS.card, padding: 14, borderRadius: RADIUS.lg }}>
          <Text style={{ color: COLORS.subtext }}>
            Be the first to comment. (We’ll wire real comments when we hook Supabase.)
          </Text>
        </View>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
