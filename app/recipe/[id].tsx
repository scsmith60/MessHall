// app/recipe/[id].tsx
// LIKE I'M 5:
// - This keeps your original layout.
// - Adds a tiny "Remix" chip beside your Private/Imported chips (click → go to parent).
// - Keeps the small "Remix" button below the chips (non-owners, non-private).
// - Uses recipe_ingredients/recipe_steps fallbacks if the recipe object lacks arrays.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Alert, ScrollView, Share, Text, View, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { recipeStore } from '../../lib/store';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import HapticButton from '../../components/ui/HapticButton';
import { compactNumber, timeAgo } from '../../lib/utils';
import { success, tap, warn } from '../../lib/haptics';
import { dataAPI } from '../../lib/data';
import { supabase } from '@/lib/supabase';
import RecipeComments from '../../components/RecipeComments';
import { IngredientPicker } from '@/components/IngredientPicker';

// 🧺 Find or make the user's default shopping list (used by IngredientPicker)
async function ensureDefaultList(userId: string) {
  const { data: existing, error: e1 } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();

  if (!e1 && existing?.id) return existing.id as string;

  const { data: created, error: e2 } = await supabase
    .from('shopping_lists')
    .insert({ user_id: userId, title: 'My Shopping List', is_default: true })
    .select('id')
    .single();

  if (e2) throw e2;
  return created!.id as string;
}

// 🗂️ Guess an item's category (ok if your DB table doesn’t have this column)
function categorizeIngredient(name: string): string {
  const n = name.toLowerCase();
  const hasAny = (arr: string[]) => arr.some((k) => n.includes(k));
  if (hasAny(['chicken','beef','pork','turkey','sausage','bacon','ham','ground'])) return 'Meat/Protein';
  if (hasAny(['salmon','tuna','shrimp','cod','tilapia','fish'])) return 'Seafood';
  if (hasAny(['milk','cheese','butter','yogurt','cream','mozzarella','cheddar','monterey','parmesan','egg'])) return 'Dairy/Eggs';
  if (hasAny(['tomato','onion','garlic','pepper','poblano','lettuce','spinach','carrot','celery','potato','avocado','cilantro','lime','lemon'])) return 'Produce';
  if (hasAny(['flour','sugar','rice','pasta','noodle','beans','lentil','salt','baking','yeast','cornstarch','oil','vinegar'])) return 'Pantry';
  if (hasAny(['cumin','paprika','oregano','basil','chili','peppercorn','cinnamon','spice','seasoning'])) return 'Spices';
  if (hasAny(['ketchup','mustard','mayo','sriracha','soy sauce','bbq','salsa','hot sauce'])) return 'Condiments';
  if (hasAny(['bread','bun','tortilla','pita','bagel'])) return 'Bakery';
  if (hasAny(['frozen'])) return 'Frozen';
  if (hasAny(['water','soda','juice','coffee','tea'])) return 'Beverages';
  return 'Other';
}

// 🧾 Read all unchecked item names (so we can prefill "Added" pills)
async function readActiveItemNames(listId: string): Promise<Set<string>> {
  const names = new Set<string>();
  const { data, error } = await supabase
    .from('shopping_list_items')
    .select('ingredient, checked')
    .eq('list_id', listId);

  if (!error && data) {
    for (const row of data) {
      if (row && typeof row.ingredient === 'string' && (row.checked === false || row.checked === null)) {
        names.add(row.ingredient);
      }
    }
  }
  return names;
}

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  // 📦 State
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<{
    id: string;
    title: string;
    image: string;
    creator: string;
    creatorAvatar?: string | null;
    knives: number;
    createdAt: number;
  } | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const isOwner = !!userId && !!ownerId && userId === ownerId;

  const [isPrivate, setIsPrivate] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  const [saved, setSaved] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState<number>(0);
  const [likeSaving, setLikeSaving] = useState(false);

  const [cooksCount, setCooksCount] = useState<number>(0);
  const [isCooked, setIsCooked] = useState(false);
  const [savingCook, setSavingCook] = useState(false);

  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<{ text: string; seconds?: number | null }[]>([]);

  // 🆕 Is this recipe a remix? (we’ll show a little pill if yes)
  const [parentId, setParentId] = useState<string | null>(null);

  // 🧒 Who am I?
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // 📥 Load recipe (JSON-first, then local store fallback)
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
            creatorAvatar: r.creatorAvatar ?? null,
            knives: r.knives ?? 0,
            createdAt: new Date(r.createdAt ?? r.created_at).getTime(),
          });
          setIsPrivate(!!r.is_private);
          setSourceUrl(r.sourceUrl ?? null);
          if (Array.isArray(r.steps)) setSteps(r.steps);
          if (Array.isArray(r.ingredients)) setIngredients(r.ingredients);
        } else {
          const s: any = recipeStore.get(id);
          setModel(
            s
              ? {
                  id: s.id,
                  title: s.title,
                  image: (s as any).image_url ?? s.image ?? '',
                  creator: s.creator,
                  creatorAvatar: null,
                  knives: s.knives ?? 0,
                  createdAt: s.createdAt,
                }
              : null
          );
          if (Array.isArray(s?.steps)) setSteps(s.steps);
          if (Array.isArray(s?.ingredients)) setIngredients(s.ingredients);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // 👑 Owner id (server tells us who owns it)
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!id) return;
      const owner = await dataAPI.getRecipeOwnerId(id).catch(() => null);
      if (!gone) setOwnerId(owner);
    })();
    return () => { gone = true; };
  }, [id]);

  // 🆕 Ask DB if this post has a parent (so we can render the Remix chip)
  useEffect(() => {
    let off = false;
    (async () => {
      if (!id) return;
      try {
        const { data } = await supabase
          .from('recipes')
          .select('parent_recipe_id')
          .eq('id', id)
          .maybeSingle();
        if (!off) setParentId(data?.parent_recipe_id ?? null);
      } catch {}
    })();
    return () => { off = true; };
  }, [id]);

  // 🌾 Fallbacks if recipe_ingredients / recipe_steps are normalized in DB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        const { data } = await supabase
          .from('recipe_ingredients')
          .select('*')
          .eq('recipe_id', id)
          .order('pos');
        if (!cancelled && data) {
          const lines = data.map((row: any) => row.text ?? '').filter(Boolean);
          if (lines.length) setIngredients(lines);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id || steps.length > 0) return;
      try {
        const { data } = await supabase
          .from('recipe_steps')
          .select('*')
          .eq('recipe_id', id)
          .order('pos');
        if (!cancelled && data) {
          setSteps(data.map((row: any) => ({ text: row.text ?? '', seconds: row.seconds ?? null })));
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [id, steps.length]);

  // 🖼️ Sign image (Supabase storage → temporary URL)
  const [signedImageUrl, setSignedImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function signIt(raw: string) {
      if (!raw) { setSignedImageUrl(null); return; }
      if (raw.startsWith('http')) { setSignedImageUrl(raw); return; }
      const path = raw.replace(/^\/+/, '');
      const { data } = await supabase.storage.from('recipe-images').createSignedUrl(path, 60 * 60 * 24 * 7);
      if (!cancelled) setSignedImageUrl(data?.signedUrl ?? null);
    }
    signIt(model?.image || '');
    return () => { cancelled = true; };
  }, [model?.image]);

  // ⭐ Likes / Cooks counters (and my like/cook state)
  const fetchEngagement = useCallback(async () => {
    if (!id) return;

    const { count: likeCount } = await supabase
      .from('recipe_likes')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', id);
    setLikesCount(likeCount ?? 0);

    if (userId) {
      const { data: myLike } = await supabase
        .from('recipe_likes')
        .select('id')
        .eq('recipe_id', id)
        .eq('user_id', userId)
        .maybeSingle();
      setLiked(!!myLike);
    } else setLiked(false);

    const { count: cookCount } = await supabase
      .from('recipe_cooks')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', id);
    setCooksCount(cookCount ?? 0);

    if (userId) {
      const { data: myCook } = await supabase
        .from('recipe_cooks')
        .select('id')
        .eq('recipe_id', id)
        .eq('user_id', userId)
        .maybeSingle();
      setIsCooked(!!myCook);
    } else setIsCooked(false);
  }, [id, userId]);
  useEffect(() => { fetchEngagement(); }, [fetchEngagement]);

  // 🧯 Fallbacks so page isn't empty
  const ings = ingredients.length ? ingredients : ['2 tbsp olive oil', '2 cloves garlic'];
  const stepList = steps.length ? steps : [{ text: 'Cook stuff', seconds: null }];

  // 🧱 Turn strings → rows for the IngredientPicker
  const ingredientRows = useMemo(
    () => (ingredients.length ? ingredients : ings).map((t, i) => ({ id: String(i + 1), name: t })),
    [ingredients]
  );

  // ✅ Which rows show "Added" pill
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // ⛳ Prefill pills from my default list
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) return;
      const listId = await ensureDefaultList(userId);
      const activeNames = await readActiveItemNames(listId);
      if (cancelled) return;
      setCheckedIds(new Set(ingredientRows.filter(r => activeNames.has(r.name)).map(r => r.id)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ingredientRows.length]);

  // 💾 Persist add/remove to DB for the shopping list
  async function persistToggle(idStr: string, next: boolean, name: string) {
    if (!userId) { Alert.alert('Sign in required', 'Please sign in to manage your list.'); return; }
    const listId = await ensureDefaultList(userId);

    if (next) {
      const { data: existing } = await supabase
        .from('shopping_list_items')
        .select('id')
        .eq('list_id', listId)
        .eq('ingredient', name)
        .limit(1);

      if (existing && existing.length > 0) {
        await supabase.from('shopping_list_items').update({ checked: false }).eq('id', existing[0].id);
      } else {
        const base: any = { list_id: listId, ingredient: name, quantity: null, checked: false, category: categorizeIngredient(name) };
        const ins = await supabase.from('shopping_list_items').insert(base);
        // @ts-ignore — ignore "category" column missing (42703) if your table doesn't have it
        if (ins.error && ins.error.code !== '42703') console.warn('insert error', ins.error.message);
      }
    } else {
      await supabase.from('shopping_list_items').delete().eq('list_id', listId).eq('ingredient', name);
    }

    setCheckedIds((old) => {
      const copy = new Set(old);
      if (next) copy.add(idStr); else copy.delete(idStr);
      return copy;
    });
  }

  function onToggleCheck(idStr: string, next: boolean) {
    const row = ingredientRows.find((r) => r.id === idStr);
    if (!row) return;
    persistToggle(idStr, next, row.name);
  }

  // 🔗 share/save/like/cook
  const shareIt = async () => { await success(); await Share.share({ message: `${model?.title} on MessHall — messhall://recipe/${id}` }); };
  const toggleSave = async () => {
    try { const s = await dataAPI.toggleSave(String(id)); setSaved(s); await tap(); }
    catch { await warn(); Alert.alert('Sign in required'); }
  };
  const toggleLike = async () => {
    if (!id) return;
    if (!userId) { await warn(); Alert.alert('Action not allowed', 'Please sign in to like recipes.'); return; }
    if (likeSaving) return;
    try {
      setLikeSaving(true);
      if (liked) {
        setLiked(false); setLikesCount((n) => Math.max(0, n - 1));
        const { error } = await supabase.from('recipe_likes').delete().eq('user_id', userId).eq('recipe_id', id);
        if (error) { setLiked(true); setLikesCount((n) => n + 1); throw error; }
        await tap();
      } else {
        setLiked(true); setLikesCount((n) => n + 1);
        const { error } = await supabase.from('recipe_likes').insert({ user_id: userId, recipe_id: id as any });
        // @ts-ignore
        if (error && error.code !== '23505') { setLiked(false); setLikesCount((n) => Math.max(0, n - 1)); throw error; }
        await success();
      }
    } catch (e: any) { await warn(); Alert.alert('Oops', e?.message ?? 'Could not update like.'); }
    finally { setLikeSaving(false); }
  };
  const toggleCooked = useCallback(async () => {
    if (!userId || !id) { await warn(); Alert.alert('Please sign in to record cooks.'); return; }
    if (isOwner) { Alert.alert('Heads up', "You can’t medal your own recipe."); return; }
    try {
      setSavingCook(true);
      if (isCooked) {
        setIsCooked(false); setCooksCount((n) => Math.max(0, n - 1));
        const { error } = await supabase.from('recipe_cooks').delete().eq('user_id', userId).eq('recipe_id', id);
        if (error) { setIsCooked(true); setCooksCount((n) => n + 1); throw error; }
        await tap();
      } else {
        setIsCooked(true); setCooksCount((n) => n + 1);
        const { error } = await supabase.from('recipe_cooks').insert({ user_id: userId, recipe_id: id as any });
        // @ts-ignore
        if (error && error.code !== '23505') { setIsCooked(false); setCooksCount((n) => Math.max(0, n - 1)); throw error; }
        await success();
      }
    } catch (e: any) { await warn(); Alert.alert('Oops', e?.message ?? 'Could not update cooked state.'); }
    finally { setSavingCook(false); }
  }, [id, userId, isCooked, isOwner]);

  // 🧱 Loading / Not found
  if (loading)
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: COLORS.text }}>Loading…</Text>
      </View>
    );
  if (!model)
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: COLORS.text }}>Not found</Text>
      </View>
    );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* HERO IMAGE + ✏️ edit button */}
      <View style={{ position: 'relative' }}>
        <Image
          source={{ uri: signedImageUrl || undefined }}
          style={{ width: '100%', height: 280, backgroundColor: '#111827' }}
          contentFit="cover"
        />

        {/* ✏️ owner-only edit button (unchanged) */}
        {isOwner && (
          <TouchableOpacity
            onPress={() =>
              router.push({ pathname: '/recipe/edit/[id]', params: { id: String(id) } })
            }
            activeOpacity={0.85}
            style={{
              position: 'absolute',
              top: Math.max(8, insets.top) + 4,
              right: Math.max(8, insets.right) + 12,
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: 'rgba(2,6,23,0.7)',
              borderWidth: 1,
              borderColor: '#233041',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
              elevation: 4,
            }}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
            accessibilityLabel="Edit recipe"
          >
            <MaterialCommunityIcons name="pencil" size={18} color="#e5e7eb" />
          </TouchableOpacity>
        )}
      </View>

      {/* HEADER INFO */}
      <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 }}>{model.title}</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <TouchableOpacity onPress={() => router.push(`/u/${model.creator}`)} activeOpacity={0.7}>
            {model.creatorAvatar ? (
              <Image source={{ uri: model.creatorAvatar }} style={{ width: 24, height: 24, borderRadius: 12, marginRight: 8 }} />
            ) : (
              <View style={{ width: 24, height: 24, borderRadius: 12, marginRight: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#e5e7eb', fontSize: 12, fontWeight: '800' }}>{(model.creator || 'U')[0]?.toUpperCase()}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/u/${model.creator}`)} activeOpacity={0.7}>
            <Text style={{ color: COLORS.text, fontWeight: '700' }}>{model.creator}</Text>
          </TouchableOpacity>

          {model.knives ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0b3b2e', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: '#134e4a', marginLeft: 8 }}>
              <MaterialCommunityIcons name="medal" size={14} color="#E5E7EB" />
              <Text style={{ color: COLORS.text, fontWeight: '800', fontSize: 12 }}>{compactNumber(model.knives)}</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <Text style={{ color: COLORS.sub }}>{timeAgo(model.createdAt)}</Text>
        </View>

        {/* Chips row: Private / Imported / 🆕 Remix (kept same style) */}
        {(isPrivate || (sourceUrl && sourceUrl.trim() !== '') || parentId) && (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            {isPrivate && (
              <Text style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#334155', color: '#e2e8f0', fontWeight: '700' }}>
                🔒 Private
              </Text>
            )}
            {sourceUrl && sourceUrl.trim() !== '' && (
              <Text style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#334155', color: '#e2e8f0', fontWeight: '700' }}>
                🌐 Imported
              </Text>
            )}

            {/* 🆕 Remix chip — only if this recipe has a parent. Click goes to parent recipe. */}
            {parentId ? (
              <TouchableOpacity onPress={() => router.push(`/recipe/${parentId}`)} activeOpacity={0.8}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: '#052638', // dark teal to stand out a bit
                  borderWidth: 1,
                  borderColor: '#0ea5e9',
                }}>
                  <Ionicons name="git-branch-outline" size={12} color="#7dd3fc" />
                  <Text style={{ color: '#7dd3fc', fontWeight: '800', fontSize: 12 }}>Remix</Text>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Small Remix button (unchanged) */}
        {!isOwner && !isPrivate && (
          <View style={{ marginBottom: 10 }}>
            <HapticButton
              onPress={() => router.push(`/remix/${id}`)}
              style={{
                backgroundColor: '#183B2B',
                borderWidth: 1,
                borderColor: '#2BAA6B',
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: RADIUS.lg,
                alignItems: 'center',
                alignSelf: 'flex-start',
                flexDirection: 'row',
                gap: 6,
              }}
              accessibilityRole="button"
              accessibilityLabel="Remix this recipe"
            >
              <Ionicons name="git-branch-outline" size={14} color="#CFF8D6" />
              <Text style={{ color: '#CFF8D6', fontWeight: '900', fontSize: 13 }}>Remix</Text>
            </HapticButton>
          </View>
        )}

        {/* tiny stat chips (medals + likes) */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
            <MaterialCommunityIcons name="medal" size={16} color={COLORS.accent} />
            <Text style={{ color: COLORS.text, fontWeight: '700' }}>{compactNumber(cooksCount)}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
            <Ionicons name="heart" size={16} color="#F87171" />
            <Text style={{ color: COLORS.text, fontWeight: '700' }}>{compactNumber(likesCount)}</Text>
          </View>
        </View>
      </View>

      {/* INGREDIENTS */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 6 }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Ingredients</Text>
        <IngredientPicker items={ingredientRows} checkedIds={checkedIds} onToggleCheck={onToggleCheck} />
      </View>

      {/* STEPS */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 16 }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Steps</Text>
        {(steps.length ? steps : stepList).map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', marginBottom: 10 }}>
            <Text style={{ color: COLORS.accent, fontWeight: '900', width: 24 }}>{i + 1}.</Text>
            <Text style={{ color: '#9ca3af', flex: 1 }}>
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

      {/* BOTTOM ACTIONS (owner sees Cook Mode; edit is the tiny ✏️ above) */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 8 }}>
        {isOwner ? (
          <HapticButton onPress={() => router.push(`/cook/${id}`)} style={{ backgroundColor: COLORS.accent, paddingVertical: 16, borderRadius: RADIUS.xl, alignItems: 'center' }}>
            <Text style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>Start Cook Mode</Text>
          </HapticButton>
        ) : (
          <>
            <HapticButton
              onPress={async () => {
                if (!userId) { await warn(); Alert.alert('Please sign in to record cooks.'); return; }
                await toggleCooked();
              }}
              disabled={savingCook}
              style={{ backgroundColor: isCooked ? '#14532d' : COLORS.card, paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: 'center', marginBottom: 8, opacity: savingCook ? 0.7 : 1 }}
            >
              <Text style={{ color: isCooked ? '#CFF8D6' : COLORS.text, fontWeight: '900', fontSize: 15 }}>
                {savingCook ? 'Saving…' : isCooked ? 'Uncook' : 'I cooked this!'}
              </Text>
            </HapticButton>

            <HapticButton onPress={() => router.push(`/cook/${id}`)} style={{ backgroundColor: COLORS.accent, paddingVertical: 16, borderRadius: RADIUS.xl, alignItems: 'center' }}>
              <Text style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>Start Cook Mode</Text>
            </HapticButton>
          </>
        )}
      </View>

      {/* COMMENTS */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 24 }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 10 }}>Comments</Text>
        {id ? <RecipeComments recipeId={String(id)} isRecipeOwner={isOwner} insideScroll /> : null}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
