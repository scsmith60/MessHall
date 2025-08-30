// app/recipe/[id].tsx
// ELI5: the kid who made the recipe can edit or delete it.
// we check who owns it, then show the buttons for that kid only.

import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, Text, View, TextInput } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { recipeStore } from '../../lib/store';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import Badge from '../../components/ui/Badge';
import StatPill from '../../components/ui/StatPill';
import HapticButton from '../../components/ui/HapticButton';
import { compactNumber, timeAgo } from '../../lib/utils';
import { success, tap, warn } from '../../lib/haptics';
import { dataAPI } from '../../lib/data';
import { Image } from 'expo-image';           // better image component
import { supabase } from '@/lib/supabase';    // we'll sign URLs + get auth

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // 1) page state (loading + recipe model)
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<{
    id: string;
    title: string;
    image: string;
    creator: string;
    knives: number;
    cooks: number;
    createdAt: number;
  } | null>(null);

  // 2) auth + owner checks
  const [userId, setUserId] = useState<string | null>(null);      // who is logged in
  const [ownerId, setOwnerId] = useState<string | null>(null);    // who owns recipe
  const isOwner = !!userId && !!ownerId && userId === ownerId;    // only owner can edit/delete

  useEffect(() => {
    // grab current user once
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  // 3) fetch recipe data (your existing flow)
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
            knives: r.knives,
            cooks: r.cooks,
            createdAt: new Date(r.createdAt ?? r.created_at).getTime(),
          });
        } else {
          const s: any = recipeStore.get(id);
          setModel(
            s
              ? {
                  id: s.id,
                  title: s.title,
                  image: (s as any).image_url ?? s.image ?? '',
                  creator: s.creator,
                  knives: s.knives,
                  cooks: s.cooks,
                  createdAt: s.createdAt,
                }
              : null
          );
        }
      } catch {
        const s: any = id ? recipeStore.get(id) : undefined;
        setModel(s ? { ...s } : null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // 4) also fetch the official owner id of the recipe (so RLS can compare)
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!id) return;
      const owner = await dataAPI.getRecipeOwnerId(id).catch(() => null);
      if (!gone) setOwnerId(owner);
    })();
    return () => { gone = true; };
  }, [id]);

  // 5) turn model.image into a signed URL (or fall back to original)
  const [signedImageUrl, setSignedImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;

    async function signIt(raw: string) {
      const val = (raw || '').trim();
      if (!val) { setSignedImageUrl(null); return; }

      // If we got a full http(s) URL…
      if (val.startsWith('http://') || val.startsWith('https://')) {
        // try to extract a storage path from “…/object/public/recipe-images/<PATH>”
        const marker = '/object/public/recipe-images/';
        const idx = val.indexOf(marker);
        if (idx === -1) {
          // not a supabase public URL — just use as-is
          setSignedImageUrl(val);
          return;
        }
        const path = val.substring(idx + marker.length);
        const { data, error } = await supabase
          .storage
          .from('recipe-images')
          .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days

        if (cancelled) return;
        if (error || !data?.signedUrl) {
          console.warn('[RecipeDetail] sign-from-public failed; using original url:', error?.message);
          setSignedImageUrl(val); // fall back
        } else {
          setSignedImageUrl(data.signedUrl);
        }
        return;
      }

      // Otherwise we assume it's a storage path
      const path = val.replace(/^\/+/, '');
      const { data, error } = await supabase
        .storage
        .from('recipe-images')
        .createSignedUrl(path, 60 * 60 * 24 * 7);

      if (cancelled) return;
      if (error || !data?.signedUrl) {
        console.warn('[RecipeDetail] sign-from-path failed; path =', path, error?.message);
        setSignedImageUrl(null);
      } else {
        setSignedImageUrl(data.signedUrl);
      }
    }

    signIt(model?.image || '');
    return () => { cancelled = true; };
  }, [model?.image]);

  // liked/saved local UI state
  const [saved, setSaved] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(420);
  const [cooksCount, setCooksCount] = useState<number>(() => model?.cooks ?? 0);
  useEffect(() => {
    if (typeof model?.cooks === 'number') setCooksCount(model.cooks);
  }, [model?.cooks]);

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

  // 🎈 share
  const shareIt = async () => {
    await success();
    await Share.share({ message: `${model.title} on MessHall — messhall://recipe/${model.id}` });
  };

  // 💾 save
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

  // ❤️ like
  const toggleLike = async () => {
    try {
      const { liked, likesCount } = await dataAPI.toggleLike(model.id);
      setLiked(liked);
      setLikesCount(likesCount || 0);
      setModel(m => m ? { ...m, knives: Math.max(0, (m.knives ?? 0) + (liked ? +1 : -1)) } : m);
      await tap();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to like recipes.');
    }
  };

  // 🍳 cooked
  const markCooked = async () => {
    try {
      await dataAPI.markCooked(model.id);
      setCooksCount(c => c + 1);
      setModel(m => m ? { ...m, knives: Math.max(0, (m.knives ?? 0) + 3) } : m);
      await success();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to record cooks.');
    }
  };

  // ▶️ cook mode
  const startCookMode = async () => {
    await success();
    router.push(`/cook/${model.id}`);
  };

  // ✏️ go to edit screen (only owner sees button below)
  const goEdit = async () => {
    await tap();
    router.push(`/recipe/edit/${model.id}`);
  };

  // 🗑️ delete (only owner sees button below)
  const confirmDelete = async () => {
    await warn();
    Alert.alert(
      'Delete recipe?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await dataAPI.deleteRecipe(model.id); // RLS will block if not owner
              await success();
              router.back();
            } catch (e: any) {
              await warn();
              Alert.alert('Delete failed', e?.message ?? 'Please try again.');
            }
          }
        }
      ]
    );
  };

  // dummy arrays if not loaded yet
  const ings =
    (model as any).ingredients?.length
      ? (model as any).ingredients
      : ['2 tbsp olive oil','2 cloves garlic, minced','1 tsp salt','½ tsp black pepper',`Main thing for: ${model.title}`];

  const steps =
    (model as any).steps?.length
      ? (model as any).steps.map((s: any) => s.text)
      : [`Preheat pan for ${model.title}.`, 'Add oil and garlic; stir 1–2 min.', 'Add main ingredients; cook until done.', 'Season, plate, enjoy!'];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* picture */}
      <Image
        source={{ uri: signedImageUrl || undefined }}
        style={{ width: '100%', height: 280, backgroundColor: '#111827' }}
        contentFit="cover"
        onError={(e) => {
          console.log('[RecipeDetail:image] failed for uri:', signedImageUrl, e?.nativeEvent || e);
          console.log('[RecipeDetail:image] original model.image was:', model.image);
        }}
      />

      <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 }}>{model.title}</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ color: COLORS.text, fontWeight: '700' }}>{model.creator}</Text>
          <Badge knives={model.knives} />
          <View style={{ flex: 1 }} />
          <Text style={{ color: COLORS.subtext }}>{timeAgo(model.createdAt)}</Text>
        </View>

        {/* OWNER BUTTONS */}
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

        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          <StatPill label={`${compactNumber(cooksCount)} cooked`} />
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

      {/* Steps */}
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
                <Text style={{ color: COLORS.accent }}>
                  ({String(Math.floor(s.seconds / 60)).padStart(2,'0')}:{String(s.seconds % 60).padStart(2,'0')})
                </Text>
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
