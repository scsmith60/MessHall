// app/recipe/[id].tsx
// like I'm 5: this page shows one recipe.
// today’s fix: load real counts from recipe_likes & recipe_cooks.
// we also keep the earlier fix that loads recipe_ingredients from the DB.

import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { recipeStore } from '../../lib/store';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import Badge from '../../components/ui/Badge';
import StatPill from '../../components/ui/StatPill';
import HapticButton from '../../components/ui/HapticButton';
import { compactNumber, timeAgo } from '../../lib/utils';
import { success, tap, warn } from '../../lib/haptics';
import { dataAPI } from '../../lib/data';
import { Image } from 'expo-image';
import { supabase } from '@/lib/supabase';

export default function RecipeDetail() {
  // 🧸 grab the recipe id from the URL like /recipe/123
  const { id } = useLocalSearchParams<{ id: string }>();

  // 🧸 main recipe info
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<{
    id: string;
    title: string;
    image: string;
    creator: string;
    knives: number;
    createdAt: number;
  } | null>(null);

  // 🧸 who is logged in + who owns the recipe (only owner sees Edit/Delete)
  const [userId, setUserId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const isOwner = !!userId && !!ownerId && userId === ownerId;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // 🧸 ingredients & steps live here (we fill these below)
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<{ text: string; seconds?: number | null }[]>([]);

  // 🧸 engagement: saved/liked + counts for the pills
  const [saved, setSaved] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState<number>(0);
  const [cooksCount, setCooksCount] = useState<number>(0);

  // --------------------------
  // 1) load the base recipe
  // --------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!id) return;
        const r: any = await dataAPI.getRecipeById(id);

        if (!alive) return;

        if (r) {
          setModel({
            id: r.id,
            title: r.title,
            image: r.image_url ?? r.image ?? '',
            creator: r.creator,
            knives: r.knives ?? 0,
            createdAt: new Date(r.createdAt ?? r.created_at).getTime(),
          });

          // if API includes steps/ingredients, keep them
          if (Array.isArray(r.steps)) {
            setSteps(r.steps.map((s: any) => ({ text: s.text, seconds: s.seconds ?? null })));
          }
          if (Array.isArray(r.ingredients)) {
            setIngredients(r.ingredients as string[]);
          }
        } else {
          const s: any = recipeStore.get(id);
          setModel(
            s
              ? {
                  id: s.id,
                  title: s.title,
                  image: (s as any).image_url ?? s.image ?? '',
                  creator: s.creator,
                  knives: s.knives ?? 0,
                  createdAt: s.createdAt,
                }
              : null
          );

          if (Array.isArray(s?.steps)) {
            setSteps(s.steps.map((x: any) => ({ text: x.text, seconds: x.seconds ?? null })));
          }
          if (Array.isArray(s?.ingredients)) {
            setIngredients(s.ingredients as string[]);
          }
        }
      } catch {
        const s: any = id ? recipeStore.get(id) : undefined;
        if (s) {
          setModel({
            id: s.id,
            title: s.title,
            image: (s as any).image_url ?? s.image ?? '',
            creator: s.creator,
            knives: s.knives ?? 0,
            createdAt: s.createdAt,
          });
          if (Array.isArray(s?.steps)) {
            setSteps(s.steps.map((x: any) => ({ text: x.text, seconds: x.seconds ?? null })));
          }
          if (Array.isArray(s?.ingredients)) {
            setIngredients(s.ingredients as string[]);
          }
        } else {
          setModel(null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // --------------------------
  // 2) fetch owner id (RLS guard)
  // --------------------------
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!id) return;
      const owner = await dataAPI.getRecipeOwnerId(id).catch(() => null);
      if (!gone) setOwnerId(owner);
    })();
    return () => { gone = true; };
  }, [id]);

  // --------------------------
  // 3) load INGREDIENT rows (recipe_ingredients)
  // --------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        const { data, error } = await supabase
          .from('recipe_ingredients')
          .select('*')
          .eq('recipe_id', id)
          .order('position', { ascending: true });

        if (cancelled) return;
        if (error) { console.warn('[ingredients] load failed:', error.message); return; }

        const lines = (data ?? []).map((row: any) => {
          const display = row.display_text || row.text || row.ingredient || null;
          const qty = row.quantity ?? row.qty ?? '';
          const unit = row.unit ?? '';
          const name = row.name ?? row.item ?? '';
          const note = row.note ?? row.notes ?? '';
          if (display && String(display).trim()) return String(display).trim();
          const main = [qty, unit, name].map(v => String(v ?? '').trim()).filter(Boolean).join(' ');
          return [main, String(note ?? '').trim()].filter(Boolean).join(', ');
        });

        if (lines.length > 0) setIngredients(lines);
      } catch (e: any) {
        if (!cancelled) console.warn('[ingredients] unexpected error:', e?.message ?? e);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // --------------------------
  // 4) OPTIONALLY load STEP rows (recipe_steps) if none yet
  // --------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id || steps.length > 0) return;
      try {
        const { data, error } = await supabase
          .from('recipe_steps')
          .select('*')
          .eq('recipe_id', id)
          .order('position', { ascending: true });

        if (cancelled) return;
        if (error) return;

        if ((data ?? []).length > 0) {
          setSteps((data ?? []).map((row: any) => ({
            text: row.text ?? row.step_text ?? row.description ?? '',
            seconds: row.seconds ?? row.duration_seconds ?? null,
          })));
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [id, steps.length]);

  // --------------------------
  // 5) sign the image URL (so it loads)
  // --------------------------
  const [signedImageUrl, setSignedImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function signIt(raw: string) {
      const val = (raw || '').trim();
      if (!val) { setSignedImageUrl(null); return; }

      if (val.startsWith('http://') || val.startsWith('https://')) {
        const marker = '/object/public/recipe-images/';
        const idx = val.indexOf(marker);
        if (idx === -1) { setSignedImageUrl(val); return; }
        const path = val.substring(idx + marker.length);
        const { data, error } = await supabase
          .storage.from('recipe-images')
          .createSignedUrl(path, 60 * 60 * 24 * 7);

        if (cancelled) return;
        setSignedImageUrl(error || !data?.signedUrl ? val : data.signedUrl);
        return;
      }

      const path = val.replace(/^\/+/, '');
      const { data, error } = await supabase
        .storage.from('recipe-images')
        .createSignedUrl(path, 60 * 60 * 24 * 7);

      if (cancelled) return;
      setSignedImageUrl(error || !data?.signedUrl ? null : data.signedUrl);
    }
    signIt(model?.image || '');
    return () => { cancelled = true; };
  }, [model?.image]);

  // --------------------------
  // 6) load LIKE + COOK counts (the new part)
  // --------------------------
  const fetchEngagement = React.useCallback(async () => {
    if (!id) return;

    // ❤️ total likes from recipe_likes
    const { count: likeCount } = await supabase
      .from('recipe_likes')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', id);

    setLikesCount(likeCount ?? 0);

    // did *I* like it? (so we can fill the heart)
    if (userId) {
      const { data: myLike } = await supabase
        .from('recipe_likes')
        .select('id')
        .eq('recipe_id', id)
        .eq('user_id', userId)
        .maybeSingle();
      setLiked(!!myLike);
    } else {
      setLiked(false);
    }

    // 🍳 total cooks from recipe_cooks
    const { count: cookCount } = await supabase
      .from('recipe_cooks')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', id);

    setCooksCount(cookCount ?? 0);
  }, [id, userId]);

  // call when the page knows the id (and again if login changes)
  useEffect(() => { fetchEngagement(); }, [fetchEngagement]);

  // --------------------------
  // 7) tiny actions (share/save/like/cooked/cookmode/edit/delete)
  // --------------------------
  const shareIt = async () => {
    await success();
    await Share.share({ message: `${model?.title ?? 'Recipe'} on MessHall — messhall://recipe/${id}` });
  };

  const toggleSave = async () => {
    try {
      const state = await dataAPI.toggleSave(String(id));
      setSaved(state);
      await tap();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to save recipes.');
    }
  };

  const toggleLike = async () => {
    try {
      // you already have this API; we just refresh counts afterwards
      await dataAPI.toggleLike(String(id));
      await tap();
      await fetchEngagement(); // refresh likes (and my liked state)
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to like recipes.');
    }
  };

  const markCooked = async () => {
    try {
      await dataAPI.markCooked(String(id));
      await success();
      await fetchEngagement(); // refresh cook count
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to record cooks.');
    }
  };

  const startCookMode = async () => {
    await success();
    router.push(`/cook/${id}`);
  };

  const goEdit = async () => {
    await tap();
    router.push(`/recipe/edit/${id}`);
  };

  const confirmDelete = async () => {
    await warn();
    Alert.alert('Delete recipe?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await dataAPI.deleteRecipe(String(id));
            await success();
            router.back();
          } catch (e: any) {
            await warn();
            Alert.alert('Delete failed', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  };

  // --------------------------
  // 8) gentle fallbacks so the page is never empty
  // --------------------------
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: COLORS.text }}>Loading…</Text>
      </View>
    );
  }

  if (!model) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
          Hmm, couldn’t find that recipe.
        </Text>
        <HapticButton
          onPress={() => router.back()}
          style={{ marginTop: 16, backgroundColor: COLORS.card, padding: 12, borderRadius: RADIUS.lg }}
        >
          <Text style={{ color: COLORS.accent, fontWeight: '800' }}>Go Back</Text>
        </HapticButton>
      </View>
    );
  }

  const ings = ingredients.length
    ? ingredients
    : ['2 tbsp olive oil', '2 cloves garlic, minced', '1 tsp salt', '½ tsp black pepper', `Main thing for: ${model.title}`];

  const stepList = steps.length
    ? steps
    : [
        { text: `Preheat pan for ${model.title}.`, seconds: null },
        { text: 'Add oil and garlic; stir 1–2 min.', seconds: 120 },
        { text: 'Add main ingredients; cook until done.', seconds: null },
        { text: 'Season, plate, enjoy!', seconds: null },
      ];

  // --------------------------
  // 9) UI
  // --------------------------
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* picture */}
      <Image
        source={{ uri: signedImageUrl || undefined }}
        style={{ width: '100%', height: 280, backgroundColor: '#111827' }}
        contentFit="cover"
      />

      <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 }}>{model.title}</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: COLORS.text, fontWeight: '700' }}>{model.creator}</Text>
          <Badge knives={model.knives} />
          <View style={{ flex: 1 }} />
          <Text style={{ color: COLORS.subtext }}>{timeAgo(model.createdAt)}</Text>
        </View>

        {/* owner-only controls */}
        {isOwner && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <HapticButton onPress={goEdit} style={{ flex: 1, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: 'center' }}>
              <Text style={{ color: COLORS.text, fontWeight: '800' }}>Edit</Text>
            </HapticButton>
            <HapticButton onPress={confirmDelete} style={{ width: 120, backgroundColor: '#dc2626', paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: 'center' }}>
              <Text style={{ color: 'white', fontWeight: '900' }}>Delete</Text>
            </HapticButton>
          </View>
        )}

        {/* the two pills now use REAL counts */}
        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          <StatPill label={`${compactNumber(cooksCount)} cooked`} />
          <StatPill label={`${compactNumber(likesCount)} likes`} />
        </View>

        {/* Save / Like / Share */}
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
        {ings.map((t, i) => (
          <Text key={i} style={{ color: COLORS.subtext, marginBottom: 6 }}>• {t}</Text>
        ))}
      </View>

      {/* Steps */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 16 }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Steps</Text>
        {stepList.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 10 }}>
            <Text style={{ color: COLORS.accent, fontWeight: '900', width: 24 }}>{i + 1}.</Text>
            <Text style={{ color: COLORS.subtext, flex: 1 }}>
              {s.text}{' '}
              {typeof s.seconds === 'number' && s.seconds > 0 && (
                <Text style={{ color: COLORS.accent }}>
                  ({String(Math.floor(s.seconds / 60)).padStart(2, '0')}:{String(s.seconds % 60).padStart(2, '0')})
                </Text>
              )}
            </Text>
          </View>
        ))}
      </View>

      {/* Start Cook Mode */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 8 }}>
        <HapticButton onPress={markCooked} style={{ backgroundColor: COLORS.card, paddingVertical: 16, borderRadius: RADIUS.xl, alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ color: COLORS.text, fontWeight: '900', fontSize: 16 }}>I cooked this!</Text>
        </HapticButton>

        <HapticButton onPress={startCookMode} style={{ backgroundColor: COLORS.accent, paddingVertical: 16, borderRadius: RADIUS.xl, alignItems: 'center' }}>
          <Text style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>Start Cook Mode</Text>
        </HapticButton>
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
