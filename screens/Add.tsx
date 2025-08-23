// screens/Add.tsx
// MessHall — Add screen
// ✅ Prefills from route.params.sharedUrl (deep link or Android share target)
// ✅ If a new share arrives while Add is open, updates the input without clobbering manual edits
// ✅ Optional auto-enrich on mount when a sharedUrl is provided
// ✅ Robust enrich() pipeline: fetch meta → normalize → durable thumbnail upload
// ✅ Save to Supabase (recipes table), defensive logging & toasts
// ✅ Minimal, dependency-safe code (Hermes-friendly), no fancy UI libs required

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../lib/supabaseClient';
import type { RootStackParamList } from '../App';

// ---- Optional helpers (expected to exist; safe fallbacks if they don't) ----
let ensureDurableThumb: undefined | ((src: string) => Promise<{ publicUrl: string; bucketPath: string }>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ensureDurableThumb = require('../lib/ensureDurableThumb').ensureDurableThumb || require('../lib/ensureDurableThumb').default;
} catch { /* optional */ }

type MetaResult = {
  title?: string;
  image?: string;
  ingredients?: string[];
  steps?: string[];
  source?: string;
};
let fetchMeta: undefined | ((url: string) => Promise<MetaResult>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  fetchMeta = require('../lib/fetch_meta').fetchMeta || require('../lib/fetch_meta').default;
} catch { /* optional */ }

// ---- Types ----
type AddRoute = RouteProp<RootStackParamList, 'Add'>;

// Basic URL validator (generous)
const looksLikeUrl = (s?: string) => !!s && /^https?:\/\/[^\s]+/i.test(s.trim());

// Normalize arrays produced by parsers; remove empties/dupes
const uniq = (arr: string[]) => Array.from(new Set(arr.map(s => s.trim()).filter(Boolean)));

export default function Add() {
  const route = useRoute<AddRoute>();
  const nav = useNavigation();

  // ====== State ======
  const initialSharedUrl = (route.params?.sharedUrl || '').trim();
  const [url, setUrl] = useState(initialSharedUrl);
  const [title, setTitle] = useState('');
  const [thumbUrl, setThumbUrl] = useState<string>('');       // public URL (storage or remote)
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoEnrichOnMount] = useState<boolean>(looksLikeUrl(initialSharedUrl));

  // track whether user has touched the URL field to avoid clobbering manual edits
  const userTouchedUrlRef = useRef(false);

  // ====== Sync URL if a new share arrives while this screen is active ======
  useEffect(() => {
    const incoming = (route.params?.sharedUrl || '').trim();
    if (!incoming) return;

    // If user hasn't typed into URL box since mount, or if it's a different URL, adopt it
    if (!userTouchedUrlRef.current || (incoming && incoming !== url)) {
      setUrl(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.sharedUrl]);

  // Mark that user typed in the URL box
  const onUrlChange = useCallback((v: string) => {
    userTouchedUrlRef.current = true;
    setUrl(v);
  }, []);

  // ====== Auto-enrich when launched from a share/deep link ======
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!autoEnrichOnMount) return;
      if (!looksLikeUrl(url)) return;
      setLoading(true);
      try {
        const res = await doEnrich(url);
        if (!cancelled && res) {
          // already set inside doEnrich
        }
      } catch (e) {
        console.warn('[add:autoEnrich]', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEnrichOnMount]);

  // ====== Actions ======
  const pasteFromClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setUrl(text.trim());
    } else {
      Alert.alert('Clipboard empty', 'Copy a link first, then tap Paste.');
    }
  }, []);

  const pickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Enable Photos permission to pick a thumbnail.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (res.canceled || !res.assets?.length) return;
    const localUri = res.assets[0].uri;
    // If ensureDurableThumb exists, upload to storage; otherwise just keep local file://
    try {
      if (ensureDurableThumb) {
        setLoading(true);
        const out = await ensureDurableThumb(localUri);
        setThumbUrl(out.publicUrl);
      } else {
        setThumbUrl(localUri);
      }
    } catch (e) {
      console.warn('[add:pickImage]', e);
      Alert.alert('Image error', 'Could not prepare the image.');
    } finally {
      setLoading(false);
    }
  }, []);

  const doEnrich = useCallback(async (theUrl: string) => {
    if (!looksLikeUrl(theUrl)) {
      Alert.alert('Invalid link', 'Please paste a valid recipe URL (https://…)');
      return false;
    }
    setLoading(true);
    try {
      // 1) Fetch meta (title, hero image, ingredients, steps)
      let meta: MetaResult = {};
      if (fetchMeta) {
        meta = await fetchMeta(theUrl);
      } else {
        // Safe fallback if lib is not present
        meta = {
          title: theUrl.replace(/^https?:\/\//i, '').slice(0, 60),
          image: undefined,
          ingredients: [],
          steps: [],
          source: theUrl,
        };
      }

      const cleanedIngredients = uniq(meta.ingredients || []);
      const cleanedSteps = uniq(meta.steps || []);

      // 2) Durable thumbnail if we have one
      let finalThumb = '';
      if (meta.image) {
        if (ensureDurableThumb) {
          try {
            const { publicUrl } = await ensureDurableThumb(meta.image);
            finalThumb = publicUrl;
          } catch (e) {
            console.warn('[add:ensureDurableThumb]', e);
            finalThumb = meta.image; // fall back to remote
          }
        } else {
          finalThumb = meta.image;
        }
      }

      // 3) Set state
      setTitle(meta.title || '');
      setThumbUrl(finalThumb);
      setIngredients(cleanedIngredients);
      setSteps(cleanedSteps);

      return true;
    } catch (e: any) {
      console.warn('[add:enrich]', e?.message || e);
      Alert.alert('Enrich failed', 'Could not pull details from the link.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearAll = useCallback(() => {
    setTitle('');
    setThumbUrl('');
    setIngredients([]);
    setSteps([]);
  }, []);

  const saveRecipe = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please add a recipe title.');
      return;
    }
    setSaving(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        Alert.alert('Sign in required', 'Please sign in to save recipes.');
        return;
      }

      const payload = {
        user_id: user.id,
        title: title.trim(),
        source_url: looksLikeUrl(url) ? url.trim() : null,
        thumb_url: thumbUrl || null,
        ingredients,
        steps,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('recipes').insert(payload);
      if (error) throw error;

      Alert.alert('Saved', 'Your recipe has been saved.');
      // Navigate home or to the newly created recipe if your insert returns id (add returning option server-side)
      // nav.goBack();
    } catch (e: any) {
      console.warn('[add:save]', e?.message || e);
      Alert.alert('Save failed', 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [ingredients, nav, steps, thumbUrl, title, url]);

  // Derived
  const canEnrich = useMemo(() => looksLikeUrl(url) && !loading, [url, loading]);

  // ====== UI ======
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>Add Recipe</Text>

        {/* URL Input Row */}
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            placeholder="Paste or share a recipe link"
            value={url}
            onChangeText={onUrlChange}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>

        <View style={styles.actionsRow}>
          <Pressable style={styles.btn} onPress={pasteFromClipboard}>
            <Text style={styles.btnText}>Paste</Text>
          </Pressable>
          <Pressable style={[styles.btn, !canEnrich && styles.btnDisabled]} onPress={() => doEnrich(url)} disabled={!canEnrich}>
            {loading ? <ActivityIndicator /> : <Text style={styles.btnText}>Enrich</Text>}
          </Pressable>
          <Pressable style={styles.btn} onPress={pickImage}>
            <Text style={styles.btnText}>Pick Image</Text>
          </Pressable>
          <Pressable style={styles.btnGhost} onPress={clearAll}>
            <Text style={styles.btnGhostText}>Clear</Text>
          </Pressable>
        </View>

        {/* Title */}
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          placeholder="Recipe title"
          value={title}
          onChangeText={setTitle}
        />

        {/* Thumbnail Preview */}
        {thumbUrl ? (
          <View style={styles.thumbWrap}>
            <Image source={{ uri: thumbUrl }} style={styles.thumb} resizeMode="cover" />
          </View>
        ) : null}

        {/* Ingredients */}
        <Text style={styles.label}>Ingredients</Text>
        <View style={styles.multiBox}>
          {(ingredients.length ? ingredients : ['']).map((val, idx) => (
            <TextInput
              key={`ing-${idx}`}
              style={styles.multiInput}
              placeholder={idx === 0 ? '• e.g., 1/4 tsp onion powder' : '• add another'}
              value={val}
              onChangeText={(t) => {
                const copy = ingredients.slice();
                // grow list as user types on last line
                if (idx === copy.length) copy.push('');
                copy[idx] = t;
                setIngredients(copy.filter((x, i) => i === copy.length - 1 ? true : x !== '' || i < copy.length - 1));
              }}
              multiline
            />
          ))}
          <Pressable
            onPress={() => setIngredients([...ingredients, ''])}
            style={styles.addLine}
          >
            <Text style={styles.addLineText}>+ Add ingredient</Text>
          </Pressable>
        </View>

        {/* Steps */}
        <Text style={styles.label}>Steps</Text>
        <View style={styles.multiBox}>
          {(steps.length ? steps : ['']).map((val, idx) => (
            <TextInput
              key={`step-${idx}`}
              style={styles.multiInput}
              placeholder={idx === 0 ? '1) Describe a step' : `${idx + 1}) Add another step`}
              value={val}
              onChangeText={(t) => {
                const copy = steps.slice();
                if (idx === copy.length) copy.push('');
                copy[idx] = t;
                setSteps(copy.filter((x, i) => i === copy.length - 1 ? true : x !== '' || i < copy.length - 1));
              }}
              multiline
            />
          ))}
          <Pressable
            onPress={() => setSteps([...steps, ''])}
            style={styles.addLine}
          >
            <Text style={styles.addLineText}>+ Add step</Text>
          </Pressable>
        </View>

        {/* Save */}
        <View style={styles.footer}>
          <Pressable style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={saveRecipe} disabled={saving}>
            {saving ? <ActivityIndicator /> : <Text style={styles.saveBtnText}>Save Recipe</Text>}
          </Pressable>
        </View>

        {/* Spacer */}
        <View style={{ height: 48 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ====== Styles ======
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0B0F19' }, // Tailwind-esque slate-900
  container: { padding: 16 },
  h1: { color: '#E5E7EB', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  label: { color: '#9CA3AF', marginTop: 16, marginBottom: 6, fontSize: 13 },
  input: {
    backgroundColor: '#111827',
    borderColor: '#1F2937',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    color: '#E5E7EB',
  },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionsRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' },
  btn: { backgroundColor: '#374151', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#F3F4F6', fontWeight: '600' },
  btnGhost: { paddingHorizontal: 8, paddingVertical: 10 },
  btnGhostText: { color: '#9CA3AF' },
  thumbWrap: { marginTop: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#1F2937' },
  thumb: { width: '100%', height: 180 },
  multiBox: {
    backgroundColor: '#0F172A',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  multiInput: {
    backgroundColor: '#111827',
    color: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    minHeight: 44,
  },
  addLine: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 6 },
  addLineText: { color: '#93C5FD' },
  footer: { marginTop: 18 },
  saveBtn: { backgroundColor: '#4F46E5', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: 'white', fontWeight: '700' },
});
