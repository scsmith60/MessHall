// app/search/index.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  TextInput,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, SPACING } from '../../lib/theme';
import { dataAPI } from '../../lib/data';
import RecipeCard from '../../components/RecipeCard';

type SearchRow = { id: string; title: string; image: string | null; creator: string };

// ⬇️ Pills list
const ALL_CHIPS = [
  '30 Min',
  'Vegan',
  'Gluten-Free',
  'Dairy-Free',
  'Chicken',
  'Beef',
  'Pork',
  'Seafood',
  'Pasta',
] as const;
type Chip = typeof ALL_CHIPS[number];

// conflict map (vegan vs any meat/seafood)
const CONFLICTS: Record<Chip, Chip[]> = {
  Vegan: ['Chicken', 'Beef', 'Pork', 'Seafood'],
  Chicken: ['Vegan'],
  Beef: ['Vegan'],
  Pork: ['Vegan'],
  Seafood: ['Vegan'],
  '30 Min': [],
  'Gluten-Free': [],
  'Dairy-Free': [],
  Pasta: [],
};

function filtersFromState(q: string, sel: Record<string, boolean>) {
  const diet: Array<'vegan' | 'gluten_free' | 'dairy_free'> = [];
  if (sel['Vegan']) diet.push('vegan');
  if (sel['Gluten-Free']) diet.push('gluten_free');
  if (sel['Dairy-Free']) diet.push('dairy_free');

  const includeIngredients: string[] = [];
  if (sel['Chicken']) includeIngredients.push('chicken');
  if (sel['Beef']) includeIngredients.push('beef');
  if (sel['Pork']) includeIngredients.push('pork');
  if (sel['Seafood']) includeIngredients.push('seafood');
  if (sel['Pasta']) includeIngredients.push('pasta');

  const maxMinutes = sel['30 Min'] ? 30 : undefined;

  return { text: q.trim(), maxMinutes, diet, includeIngredients };
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const initialPrefill = (params?.q as string) || '';

  const [q, setQ] = useState(initialPrefill);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALL_CHIPS.map((c) => [c, initialPrefill.toLowerCase().includes(c.toLowerCase())]))
  );
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const args = useMemo(() => filtersFromState(q, sel), [q, sel]);

  async function runSearch() {
    setLoading(true);
    try {
      // 🔁 Always search. With no filters AND no text, API returns latest recipes.
      const out = await dataAPI.searchRecipesAdvanced(args);
      setRows(out);
    } finally {
      setLoading(false);
    }
  }

  function toggleChip(label: Chip) {
    setSel((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      if (next[label]) for (const bad of CONFLICTS[label] || []) next[bad] = false;
      return next;
    });
  }

  // whenever filters change, search
  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.text, args.maxMinutes, JSON.stringify(args.diet), JSON.stringify(args.includeIngredients)]);

  function onClear() {
    setQ('');
    setSel(Object.fromEntries(ALL_CHIPS.map((c) => [c, false])));
    runSearch(); // ⬅️ immediately refresh to "latest"
    inputRef.current?.focus();
  }

  const renderCard = ({ item }: { item: SearchRow }) => (
    <RecipeCard
      id={item.id}
      title={item.title}
      image={item.image ?? ''}
      creator={item.creator}
      creatorAvatar={undefined}
      knives={0}
      cooks={0}
      likes={0}
      createdAt={new Date().toISOString()}
      ownerId={''}
      onOpen={() => router.push(`/recipe/${item.id}`)}
      onSave={() => {}}
      onOpenCreator={(username: string) => router.push(`/u/${username}`)}
    />
  );

  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: undefined })} style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* Safe header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color="#94a3b8" style={{ marginHorizontal: 8 }} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search recipes (e.g., chicken pasta)"
            placeholderTextColor="#94a3b8"
            value={q}
            onChangeText={setQ}
            onSubmitEditing={runSearch}
            returnKeyType="search"
          />
          {(q.length > 0 || Object.values(sel).some(Boolean)) && (
            <TouchableOpacity onPress={onClear} accessibilityLabel="Clear search">
              <Ionicons name="close" size={18} color="#94a3b8" style={{ marginHorizontal: 8 }} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity onPress={runSearch} style={styles.iconBtn} accessibilityLabel="Search now">
          <Ionicons name="arrow-forward" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Pills (horizontally scrollable) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingVertical: 8 }}
      >
        {ALL_CHIPS.map((item, idx) => {
          const active = !!sel[item];
          return (
            <TouchableOpacity
              key={item}
              onPress={() => toggleChip(item)}
              style={[styles.chip, active && styles.chipActive, { marginRight: idx === ALL_CHIPS.length - 1 ? 0 : 8 }]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Big Feed-style Cards */}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={renderCard}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 120 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.lg }} />}
        ListEmptyComponent={
          !loading && (
            <Text style={{ color: '#94a3b8', textAlign: 'center', marginTop: 32 }}>
              No recipes yet. Try different words or chips.
            </Text>
          )
        }
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: 10,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0b1221',
  },
  iconBtn: { padding: 6 },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2a3b',
    overflow: 'hidden',
  },
  input: { flex: 1, color: '#fff', height: 40 },
  chip: {
    paddingHorizontal: 12,
    height: 36,
    backgroundColor: '#0f172a',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  chipActive: {
    backgroundColor: 'rgba(56,189,248,0.15)',
    borderColor: 'rgba(56,189,248,0.55)',
  },
  chipText: { color: '#cbd5e1', fontWeight: '600' },
  chipTextActive: { color: '#e2f4ff' },
});
