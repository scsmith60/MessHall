// screens/RecipeEdit.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';
import { useToast } from '../components/ToastProvider';

type R = RouteProp<RootStackParamList, 'Recipe'>; // reuse same param { id: string }

type RecipeRow = {
  id: string;
  title: string | null;
  source_url: string | null;
  thumb_url: string | null;
  ingredients: string[] | null;
  steps: string[] | null;
};

export default function RecipeEdit() {
  const { isDark } = useThemeController();
  const nav = useNavigation<any>();
  const route = useRoute<R>();
  const { show } = useToast();

  const recipeId = route.params?.id;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.from('recipes').select('*').eq('id', recipeId).maybeSingle<RecipeRow>();
        if (error) throw error;
        if (!alive) return;
        setTitle(data?.title || '');
        setSourceUrl(data?.source_url || '');
        setIngredients(data?.ingredients || []);
        setSteps(data?.steps || []);
      } catch (e: any) {
        Alert.alert('Load failed', e?.message || 'Try again.');
        nav.goBack();
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [nav, recipeId]);

  const save = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please add a recipe title.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        source_url: sourceUrl.trim() || null,
        ingredients,
        steps,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('recipes').update(payload).eq('id', recipeId);
      if (error) throw error;
      show('Recipe updated');
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [ingredients, nav, recipeId, show, sourceUrl, steps, title]);

  const canSave = useMemo(() => !!title.trim() && !saving, [saving, title]);

  if (loading) {
    return <View style={[styles.center, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}><ActivityIndicator /></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.flex, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.h1, { color: isDark ? '#E5E7EB' : '#111827' }]}>Edit Recipe</Text>

        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Title</Text>
        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          value={title}
          onChangeText={setTitle}
          placeholder="Recipe title"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />

        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Source URL</Text>
        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          value={sourceUrl}
          onChangeText={setSourceUrl}
          placeholder="https://example.com"
          autoCapitalize="none"
          keyboardType="url"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />

        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Ingredients</Text>
        {(!ingredients.length ? [''] : ingredients).map((v, i) => (
          <TextInput
            key={`ing-${i}`}
            style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
            value={v}
            onChangeText={(t) => {
              const copy = ingredients.slice();
              if (i === copy.length) copy.push('');
              copy[i] = t;
              const trimmed = copy.filter((x, idx) => (idx === copy.length - 1 ? true : x.trim() !== '' || idx < copy.length - 1));
              setIngredients(trimmed);
            }}
            placeholder={i === 0 ? '• 1/4 tsp onion powder' : '• add another'}
            multiline
            placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
          />
        ))}
        <Pressable onPress={() => setIngredients([...ingredients, ''])} style={styles.addLine}>
          <Text style={styles.addLineText}>+ Add ingredient</Text>
        </Pressable>

        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Steps</Text>
        {(!steps.length ? [''] : steps).map((v, i) => (
          <TextInput
            key={`step-${i}`}
            style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
            value={v}
            onChangeText={(t) => {
              const copy = steps.slice();
              if (i === copy.length) copy.push('');
              copy[i] = t;
              const trimmed = copy.filter((x, idx) => (idx === copy.length - 1 ? true : x.trim() !== '' || idx < copy.length - 1));
              setSteps(trimmed);
            }}
            placeholder={i === 0 ? '1) Do the thing' : `${i + 1}) add another`}
            multiline
            placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
          />
        ))}
        <Pressable onPress={() => setSteps([...steps, ''])} style={styles.addLine}>
          <Text style={styles.addLineText}>+ Add step</Text>
        </Pressable>

        <Pressable style={[styles.saveBtn, !canSave && styles.btnDisabled]} onPress={save} disabled={!canSave}>
          {saving ? <ActivityIndicator /> : <Text style={styles.saveBtnText}>Save</Text>}
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16 },
  h1: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  label: { fontSize: 13, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginBottom: 8 },
  inputDark: { backgroundColor: '#111827', borderColor: '#1F2937', color: '#E5E7EB' },
  inputLight: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', color: '#111827' },
  addLine: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 6, marginBottom: 4 },
  addLineText: { color: '#93C5FD' },
  saveBtn: { backgroundColor: '#4F46E5', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: 'white', fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});
