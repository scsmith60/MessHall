// app/recipe/[id].tsx
// LIKE I'M 5 👶
// What changed (only these):
// 1) A tiny "Remix" pill sits on the hero image (bottom-left), matching theme.
// 2) Bottom actions are tidy: "I cooked this!" is a proper button with spacing.
//    No more nested/overlapping buttons. No other features touched.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Alert, Share, Text, View, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
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

// Calories pill
import { useRecipeCalories } from '@/lib/nutrition';
import CaloriePill from '@/components/CaloriePill';

// Units converter
import { convertForDisplay, type UnitsPref } from '@/lib/units';

// Block helpers
import { isBlocked, unblockUser } from '@/lib/blocking';

/* -----------------------------------------------------------
   Small helpers
----------------------------------------------------------- */
function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v as any);
  return Number.isFinite(n) ? n : fallback;
}

function formatQty(n?: number | null): string {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const x = Number(n);
  const whole = Math.floor(x);
  const frac = x - whole;
  const FRACTIONS: Array<[number, string]> = [
    [0,''],[1/8,'⅛'],[1/6,'⅙'],[1/5,'⅕'],[1/4,'¼'],[1/3,'⅓'],[3/8,'⅜'],
    [2/5,'⅖'],[1/2,'½'],[3/5,'⅗'],[2/3,'⅔'],[3/4,'¾'],[4/5,'⅘'],[5/6,'⅚'],[7/8,'⅞'],
  ];
  let bestSym = '', bestDiff = 1;
  for (const [val, sym] of FRACTIONS) {
    const d = Math.abs(frac - val);
    if (d < bestDiff) { bestDiff = d; bestSym = sym; }
  }
  if (bestSym && bestDiff < 0.02) return whole === 0 ? bestSym : `${whole} ${bestSym}`;
  if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x));
  return String(Math.round(x * 10) / 10);
}

// 👮 helper: are we blocked either way?
async function isBlockedEitherWay(me: string | null, otherId: string | null) {
  if (!me || !otherId) return false;
  const { data, error } = await supabase
    .from("user_blocks")
    .select("id", { count: "exact", head: false })
    .or(
      `and(blocker_id.eq.${me},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${me})`
    )
    .limit(1);
  if (error) return false; // be safe; don't crash on client
  return !!(data && data.length);
}

/* -----------------------------------------------------------
   Shopping list helpers (unchanged)
----------------------------------------------------------- */
async function ensureDefaultList(userId: string) {
  const { data: existing } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from('shopping_lists')
    .insert({ user_id: userId, title: 'My Shopping List', is_default: true })
    .select('id')
    .single();

  if (error) throw error;
  return created!.id as string;
}

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

async function readActiveItemNames(listId: string): Promise<Set<string>> {
  const names = new Set<string>();
  const { data } = await supabase
    .from('shopping_list_items')
    .select('ingredient, checked')
    .eq('list_id', listId);

  for (const row of data || []) {
    if (row && typeof row.ingredient === 'string' && (row.checked === false || row.checked === null)) {
      names.add(row.ingredient);
    }
  }
  return names;
}

/* -----------------------------------------------------------
   Macro chip
----------------------------------------------------------- */
function MacroChip({
  label,
  value,
  tint = '#0EA5E9',
  unit = 'g',
}: {
  label: string;
  value: number | null | undefined;
  tint?: string;
  unit?: string;
}) {
  const display = Number.isFinite(value as number) ? Math.round(Number(value)) : 0;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: COLORS.card,
        borderWidth: 1,
        borderColor: '#233041',
        gap: 6,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint }} />
      <Text style={{ color: '#E5E7EB', fontWeight: '900', fontSize: 11 }}>{label}</Text>
      <Text style={{ color: '#9CA3AF', fontWeight: '800', fontSize: 11 }}>
        {display} {unit}
      </Text>
    </View>
  );
}

/* -----------------------------------------------------------
   Themed M.I.A overlay
----------------------------------------------------------- */
function BlockedScreen({
  onBack,
  onUnblock,
}: {
  onBack: () => void;
  onUnblock: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: COLORS.card,
          borderRadius: 16,
          padding: 18,
          borderWidth: 1,
          borderColor: "#233041",
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: "#052638",
            borderWidth: 1,
            borderColor: "#0ea5e9",
            alignSelf: "center",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          <Ionicons name="shield-half-outline" size={24} color="#7dd3fc" />
        </View>

        <Text
          style={{
            color: "#e5e7eb",
            fontWeight: "900",
            fontSize: 18,
            textAlign: "center",
          }}
        >
          M.I.A (missing in action)
        </Text>
        <Text
          style={{
            color: "#94a3b8",
            marginTop: 6,
            textAlign: "center",
          }}
        >
          You can’t view this recipe because you and the creator have a block in
          place.
        </Text>

        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginTop: 16,
            justifyContent: "center",
          }}
        >
          <TouchableOpacity
            onPress={onBack}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#233041",
              backgroundColor: "#0b1220",
            }}
          >
            <Text style={{ color: "#e5e7eb", fontWeight: "800" }}>Go back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onUnblock}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: COLORS.accent,
            }}
          >
            <Text style={{ color: "#001018", fontWeight: "900" }}>Unblock to view</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

/* -----------------------------------------------------------
   Screen
----------------------------------------------------------- */
export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

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

  // 👁‍🗨 whether to hide the entire recipe behind the M.I.A screen
  const [blockedView, setBlockedView] = useState(false);

  // Calories pill
  const { total: calTotal, perServing: calPer } = useRecipeCalories(id ? String(id) : undefined);

  // Macros
  const [proteinTotalG, setProteinTotalG] = useState<number>(0);
  const [fatTotalG, setFatTotalG] = useState<number>(0);
  const [carbsTotalG, setCarbsTotalG] = useState<number>(0);

  const snapshot = useMemo(() => ({ p: proteinTotalG, f: fatTotalG, c: carbsTotalG }), [proteinTotalG, fatTotalG, carbsTotalG]);

  const [isPrivate, setIsPrivate] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);

  const [saved, setSaved] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState<number>(0);
  const [likeSaving, setLikeSaving] = useState(false);
  const [cooksCount, setCooksCount] = useState<number>(0);
  const [isCooked, setIsCooked] = useState(false);
  const [savingCook, setSavingCook] = useState(false);

  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<{ text: string; seconds?: number | null }[]>([]);

  const [unitPref, setUnitPref] = useState<UnitsPref>('us');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!userId) return;
      const { data } = await supabase
        .from('profiles')
        .select('preferred_units')
        .eq('id', userId)
        .maybeSingle();
      if (!alive) return;
      const pref = (data?.preferred_units === 'metric' ? 'metric' : 'us') as UnitsPref;
      setUnitPref(pref);
    })();
    return () => { alive = false; };
  }, [userId]);

  /* ------------------ Load main recipe ------------------ */
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

  /* ------------------ Owner info ------------------ */
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!id) return;
      const owner = await dataAPI.getRecipeOwnerId(id).catch(() => null);
      if (!gone) setOwnerId(owner);
    })();
    return () => { gone = false; };
  }, [id]);

  /* ------------------ Decide if we should hide behind M.I.A ------------------ */
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!userId || !ownerId) return;
      const blocked = await isBlockedEitherWay(userId, ownerId);
      if (!alive) return;
      setBlockedView(blocked);
    })();
    return () => { alive = false; };
  }, [userId, ownerId]);

  /* ------------------ Parent / remix ------------------ */
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

  /* ------------------ Ingredients & steps structured fetch ------------------ */
  useEffect(() => {
    let cancelled = false;

    function lineFromRow(row: any, pref: UnitsPref): string {
      if (row.convertible) {
        const qty   = pref === 'metric' ? row.metric_qty     : row.us_qty;
        const qmax  = pref === 'metric' ? row.metric_qty_max : row.us_qty_max;
        const unit  = pref === 'metric' ? row.metric_unit    : row.us_unit;
        if (qty != null && unit) {
          const amount = (qmax != null && qmax !== qty)
            ? `${formatQty(qty)}–${formatQty(qmax)}`
            : `${formatQty(qty)}`;
          return [amount, unit, row.item].filter(Boolean).join(' ').trim();
        }
      }
      if (row.qty != null && row.unit) {
        const a = convertForDisplay(Number(row.qty), row.unit, pref);
        const b = row.qty_max != null ? convertForDisplay(Number(row.qty_max), row.unit, pref) : null;
        const amount = b ? `${formatQty(a.qty)}–${formatQty(b.qty)}` : `${formatQty(a.qty)}`;
        return [amount, a.unit, row.item ?? ''].filter(Boolean).join(' ').trim();
      }
      return row.text_original || row.text || '';
    }

    (async () => {
      if (!id) return;
      try {
        const { data } = await supabase
          .from('recipe_ingredients')
          .select('pos, text, text_original, convertible, qty, qty_max, unit, item, us_qty, us_qty_max, us_unit, metric_qty, metric_qty_max, metric_unit')
          .eq('recipe_id', id)
          .order('pos');

        if (!cancelled && data && data.length) {
          const lines = data.map((row: any) => lineFromRow(row, unitPref)).filter(Boolean);
          if (lines.length) setIngredients(lines);
        }
      } catch {}
    })();

    return () => { cancelled = true; };
  }, [id, unitPref]);

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

  /* ------------------ Signed image ------------------ */
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

  /* ------------------ Likes / cooks ------------------ */
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

  /* REMIX → go to Remix Editor (no instant clone) */
  const handleRemix = useCallback(async () => {
    try {
      if (!id) return;
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user;
      if (!me) {
        await warn();
        Alert.alert('Sign in required', 'Please sign in to remix this recipe.');
        return;
      }
      // open your Remix screen with this recipe as parent
      router.push({ pathname: '/remix/[parentId]', params: { parentId: String(id) } });
    } catch (e: any) {
      await warn();
      Alert.alert('Remix failed', e?.message || 'M.I.A (missing in action)');
    }
  }, [id]);

  /* ------------------ Ingredient picker prep ------------------ */
  const ings = ingredients.length ? ingredients : ['2 tbsp olive oil', '2 cloves garlic'];
  const stepList = steps.length ? steps : [{ text: 'Cook stuff', seconds: null }];
  const ingredientRows = useMemo(
    () => (ingredients.length ? ingredients : ings).map((t, i) => ({ id: String(i + 1), name: t })),
    [ingredients]
  );

  /* ------------------ Added/checked state ------------------ */
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
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
        // @ts-ignore
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

  /* ------------------ MACROS: load + subscribe + POLL REFRESH ------------------ */
  useEffect(() => {
    if (!id) return;
    let stop = false;

    const pullOnce = async () => {
      const { data } = await supabase
        .from('recipes')
        .select('protein_total_g, fat_total_g, carbs_total_g')
        .eq('id', id)
        .maybeSingle();

      if (stop) return;

      setProteinTotalG(toNum(data?.protein_total_g, 0));
      setFatTotalG(toNum(data?.fat_total_g, 0));
      setCarbsTotalG(toNum(data?.carbs_total_g, 0));
    };

    // 1) first read
    pullOnce();

    // 2) realtime updates
    const ch = supabase
      .channel(`recipe-nutrition-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'recipes', filter: `id=eq.${id}` },
        (payload: any) => {
          const row = payload?.new || {};
          setProteinTotalG((prev) => (row.protein_total_g != null ? toNum(row.protein_total_g, prev) : prev));
          setFatTotalG((prev) => (row.fat_total_g != null ? toNum(row.fat_total_g, prev) : prev));
          setCarbsTotalG((prev) => (row.carbs_total_g != null ? toNum(row.carbs_total_g, prev) : prev));
        }
      )
      .subscribe();

    // 3) brief polling safety net
    let attempts = 0;
    const maxAttempts = 6;
    const timer = setInterval(async () => {
      attempts += 1;
      const hasRealValues =
        (proteinTotalG ?? 0) > 0 ||
        (fatTotalG ?? 0) > 0 ||
        (carbsTotalG ?? 0) > 0;

      if (hasRealValues || attempts >= maxAttempts) {
        clearInterval(timer);
        return;
      }
      await pullOnce();
    }, 1000);

    return () => {
      stop = true;
      try { supabase.removeChannel(ch); } catch {}
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ------------------ Block-aware creator opener ------------------ */
  const handleOpenCreator = useCallback(async () => {
    try {
      if (!model?.creator) return;

      // first, identify the target user id
      let targetId: string | null = ownerId || null;
      if (!targetId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", model.creator)
          .maybeSingle();
        targetId = prof?.id ? String(prof.id) : null;
      }

      // if we still have no id, try a neutral open by username (may be RLS-hidden)
      if (!targetId) {
        const { data: viewable } = await supabase
          .from("profiles")
          .select("username")
          .eq("username", model.creator)
          .maybeSingle();
        if (!viewable) {
          setBlockedView(true); // themed overlay instead of system alert
          return;
        }
        router.push(`/u/${model.creator}`);
        return;
      }

      // 🚫 client guard: if either party blocked the other, don't open
      if (await isBlockedEitherWay(userId, targetId)) {
        setBlockedView(true);
        return;
      }

      // RLS check: can we read their row?
      const { data: canSee } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", targetId)
        .maybeSingle();

      if (canSee) {
        router.push({ pathname: "/u/[username]", params: { username: model.creator, uid: targetId } });
        return;
      }

      setBlockedView(true);
    } catch {
      setBlockedView(true);
    }
  }, [model?.creator, ownerId, userId]);

  /* ------------------ Render ------------------ */
  // If blocked, render themed overlay and stop
  if (blockedView) {
    return (
      <BlockedScreen
        onBack={() => router.back()}
        onUnblock={async () => {
          if (!ownerId) return;
          const ok = await unblockUser(ownerId);
          if (ok) {
            const blocked = await isBlockedEitherWay(userId, ownerId);
            setBlockedView(blocked);
          }
        }}
      />
    );
  }

  if (loading)
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  if (!model)
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: COLORS.text }}>M.I.A (missing in action)</Text>
      </View>
    );

  const Header = (
    <View>
      {/* HERO IMAGE + ✏️ edit + ✅ calories pill */}
      <View style={{ position: 'relative' }}>
        <ExpoImage
          source={{ uri: model.image ? model.image : undefined }}
          style={{ width: '100%', height: 280, backgroundColor: '#111827' }}
          contentFit="cover"
        />

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

        {/* 🟦 Small Remix pill on hero image (for non-owners) */}
        {!isOwner && (
          <TouchableOpacity
            onPress={handleRemix}
            activeOpacity={0.85}
            style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: 'rgba(5, 38, 56, 0.85)', // dark glass
              borderWidth: 1,
              borderColor: '#0ea5e9',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
            }}
          >
            <Ionicons name="git-branch-outline" size={12} color="#7dd3fc" />
            <Text style={{ color: '#7dd3fc', fontWeight: '800', fontSize: 12, marginLeft: 6 }}>
              Remix
            </Text>
          </TouchableOpacity>
        )}

        {/* Calories pill (right-bottom) */}
        <View style={{ position: 'absolute', right: 12, bottom: 12 }}>
          <CaloriePill total={calTotal ?? undefined} perServing={calPer ?? undefined} compact />
        </View>
      </View>

      {/* HEADER INFO */}
      <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 }}>{model.title}</Text>

        {/* Creator row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <TouchableOpacity onPress={handleOpenCreator} activeOpacity={0.7}>
            {model.creatorAvatar ? (
              <ExpoImage source={{ uri: model.creatorAvatar }} style={{ width: 24, height: 24, borderRadius: 12, marginRight: 8 }} />
            ) : (
              <View style={{ width: 24, height: 24, borderRadius: 12, marginRight: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#e5e7eb', fontSize: 12, fontWeight: '800' }}>{(model.creator || 'U')[0]?.toUpperCase()}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={handleOpenCreator} activeOpacity={0.7}>
            <Text style={{ color: COLORS.text, fontWeight: '700' }}>{model.creator}</Text>
          </TouchableOpacity>

          {model.knives ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0b3b2e', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: '#134e4a', marginLeft: 8 }}>
              <MaterialCommunityIcons name="medal" size={14} color="#E5E7EB" />
              <Text style={{ color: COLORS.text, fontWeight: '800', fontSize: 12 }}>{compactNumber(model.knives)}</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <Text style={{ color: COLORS.subtext }}>{timeAgo(model.createdAt)}</Text>
        </View>

        {/* Context chips */}
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
            {parentId ? (
              <TouchableOpacity onPress={() => router.push(`/recipe/${parentId}`)} activeOpacity={0.8}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: '#052638',
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

        {/* Stats + Macro chips */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
              <MaterialCommunityIcons name="medal" size={16} color={COLORS.accent} />
              <Text style={{ color: COLORS.text, fontWeight: '700' }}>{compactNumber(cooksCount)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}>
              <Ionicons name="heart" size={16} color="#F87171" />
              <Text style={{ color: COLORS.text, fontWeight: '700' }}>{compactNumber(likesCount)}</Text>
            </View>
          </View>

          <View style={{ flex: 1 }} />

          <View style={{ flexShrink: 1, maxWidth: '68%' }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
              <MacroChip label="Protein" value={proteinTotalG} tint="#34D399" />
              <MacroChip label="Carbs"   value={carbsTotalG}   tint="#38BDF8" />
              <MacroChip label="Fat"     value={fatTotalG}     tint="#F59E0B" />
            </View>
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

      {/* ---------------------------------------
         BOTTOM ACTIONS (unchanged logic, fixed layout)
      ---------------------------------------- */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 8 }}>
        {isOwner ? (
          <HapticButton
            onPress={() => router.push(`/cook/${id}`)}
            style={{
              backgroundColor: COLORS.accent,
              paddingVertical: 16,
              borderRadius: RADIUS.xl,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>
              Start Cook Mode
            </Text>
          </HapticButton>
        ) : (
          <>
            {/* ✅ "I cooked this!" — theme-matched, spaced so nothing overlaps */}
            <HapticButton
              onPress={async () => {
                if (!userId) { await warn(); Alert.alert('Please sign in to record cooks.'); return; }
                setSavingCook(true);
                try {
                  if (isCooked) {
                    await supabase.from('recipe_cooks').delete().eq('recipe_id', id).eq('user_id', userId);
                    setIsCooked(false);
                    setCooksCount((n) => Math.max(0, n - 1));
                  } else {
                    await supabase.from('recipe_cooks').insert({ recipe_id: id, user_id: userId } as any);
                    setIsCooked(true);
                    setCooksCount((n) => n + 1);
                  }
                } catch {
                  Alert.alert('M.I.A (missing in action)');
                } finally {
                  setSavingCook(false);
                }
              }}
              disabled={savingCook}
              style={{
                backgroundColor: isCooked ? '#14532d' : COLORS.card,
                borderWidth: 1,
                borderColor: isCooked ? '#166534' : '#233041',
                paddingVertical: 14,
                borderRadius: RADIUS.xl,
                alignItems: 'center',
                marginBottom: 12, // spacing so buttons never collide
                opacity: savingCook ? 0.7 : 1,
              }}
            >
              <Text
                style={{
                  color: isCooked ? '#CFF8D6' : COLORS.text,
                  fontWeight: '900',
                  fontSize: 15,
                }}
              >
                {savingCook ? 'Saving…' : isCooked ? 'Uncook' : 'I cooked this!'}
              </Text>
            </HapticButton>

            {/* Primary: Cook Mode */}
            <HapticButton
              onPress={() => router.push(`/cook/${id}`)}
              style={{
                backgroundColor: COLORS.accent,
                paddingVertical: 16,
                borderRadius: RADIUS.xl,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>
                Start Cook Mode
              </Text>
            </HapticButton>
          </>
        )}
      </View>

      {/* spacer under actions */}
      <View style={{ height: 8 }} />
    </View>
  );

  const Footer = (
    <View style={{ paddingHorizontal: SPACING.lg, paddingBottom: 32, marginTop: 24 }}>
      <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 10 }}>Comments</Text>
      {id ? <RecipeComments recipeId={String(id)} isRecipeOwner={isOwner} /> : null}
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      data={[{ key: 'content' }]}
      keyExtractor={(item) => item.key}
      renderItem={() => null}
      ListHeaderComponent={Header}
      ListFooterComponent={Footer}
    />
  );
}
