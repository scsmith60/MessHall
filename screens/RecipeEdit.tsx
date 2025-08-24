// screens/RecipeEdit.tsx
// MessHall — Edit screen wired to MATCH Add.tsx image flow 1:1
// - Uses the SAME ensureDurableThumb helper for: camera, library, import URL, fetch from source
// - Stores whatever string Add stores into recipes.thumb_path (signedUrl/publicUrl/uri/bucketPath)
// - Uses the same ImagePicker options as Add (MediaTypeOptions.Images) to avoid no-op
// - Simple, reliable preview (no extra upload logic)

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
  Modal,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';

// ===== DEBUG SWITCH (same style as Add) =====
const DEBUG_THUMBS = true;

// ---- Optional helper (IDENTICAL pattern to Add.tsx) ----
let ensureDurableThumb:
  | undefined
  | ((src: string) => Promise<{ publicUrl: string; signedUrl?: string; bucketPath?: string; uri?: string }>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ensureDurableThumb =
    require('../lib/ensureDurableThumb').ensureDurableThumb ||
    require('../lib/ensureDurableThumb').default;
} catch {}

type R = RouteProp<RootStackParamList, 'Recipe'>;

type RecipeBase = {
  id: string;
  title: string | null;
  source_url: string | null;
  thumb_path?: string | null; // matches Add.tsx usage
};

const looksLikeUrl = (s?: string) => !!s && /^https?:\/\/[^\s]+/i.test(s?.trim() || '');
const isSupabaseSigned = (u: string) => /\/storage\/v1\/object\/sign\//.test(u);
function bustIfSafe(url: string): string {
  if (!url || isSupabaseSigned(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('_t', String(Date.now()));
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_t=${Date.now()}`;
  }
}

/** Minimal Thumb (debug-friendly) — trimmed from Add.tsx */
function Thumb({ uri, styles }: { uri: string; styles: ReturnType<typeof makeStyles> }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [displayUri, setDisplayUri] = useState(uri);
  const [dbg, setDbg] = useState<{
    isSigned: boolean;
    getSizeOK?: boolean;
    getSizeErr?: string;
    width?: number;
    height?: number;
    prefetchOK?: boolean;
    prefetchErr?: string;
    headStatus?: number;
    headCT?: string;
    headLen?: string;
    headErr?: string;
    onErrorEvt?: any;
  }>({ isSigned: isSupabaseSigned(uri) });

  useEffect(() => {
    setOk(null);
    const signed = isSupabaseSigned(uri);
    const next = signed ? uri : bustIfSafe(uri);
    if (DEBUG_THUMBS) console.log('[Edit Thumb] new uri', { uri, signed, displayUri: next });
    setDisplayUri(next);
    setDbg((d) => ({ ...d, isSigned: signed }));
  }, [uri]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await new Promise<void>((resolve, reject) => {
          Image.getSize(
            displayUri,
            (w, h) => {
              if (DEBUG_THUMBS) console.log('[Edit Thumb] getSize OK', { w, h, displayUri });
              if (!cancelled) setDbg((d) => ({ ...d, getSizeOK: true, width: w, height: h }));
              resolve();
            },
            (err) => {
              if (DEBUG_THUMBS) console.warn('[Edit Thumb] getSize FAIL', err);
              if (!cancelled) setDbg((d) => ({ ...d, getSizeOK: false, getSizeErr: String(err) }));
              reject(err);
            }
          );
        });
      } catch {}

      try {
        const pf = await Image.prefetch(displayUri);
        if (DEBUG_THUMBS) console.log('[Edit Thumb] prefetch', pf);
        if (!cancelled) setDbg((d) => ({ ...d, prefetchOK: !!pf }));
      } catch (e: any) {
        if (DEBUG_THUMBS) console.warn('[Edit Thumb] prefetch FAIL', e?.message || e);
        if (!cancelled) setDbg((d) => ({ ...d, prefetchOK: false, prefetchErr: e?.message || String(e) }));
      }

      try {
        let status = 0, ct = '', len = '';
        let res = await fetch(displayUri, { method: 'HEAD' });
        status = res.status;
        ct = res.headers.get('content-type') || '';
        len = res.headers.get('content-length') || '';
        if (DEBUG_THUMBS) console.log('[Edit Thumb] HEAD', status, ct, len);
        if (!cancelled) setDbg((d) => ({ ...d, headStatus: status, headCT: ct, headLen: len }));
        if (status >= 200 && status < 400) {
          if (!cancelled) setOk(true);
          return;
        }
        res = await fetch(displayUri, { method: 'GET', headers: { Range: 'bytes=0-0' } as any });
        status = res.status;
        ct = res.headers.get('content-type') || '';
        len = res.headers.get('content-length') || '';
        if (DEBUG_THUMBS) console.log('[Edit Thumb] Range GET', status, ct, len);
        if (!cancelled) setDbg((d) => ({ ...d, headStatus: status, headCT: ct, headLen: len }));
        if (status >= 200 && status < 400) {
          if (!cancelled) setOk(true);
        } else {
          if (!cancelled) setOk(false);
        }
      } catch (e: any) {
        if (DEBUG_THUMBS) console.warn('[Edit Thumb] HEAD/Range FAIL', e?.message || e);
        if (!cancelled) setDbg((d) => ({ ...d, headErr: e?.message || String(e) }));
        if (!cancelled && dbg.getSizeOK) setOk(true);
      }
    }

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayUri]);

  if (ok === null) {
    return (
      <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (ok === true) {
    return (
      <>
        <Image
          source={{ uri: displayUri }}
          style={[
            styles.thumb,
            { borderRadius: 12, backgroundColor: '#111' },
            DEBUG_THUMBS ? { borderWidth: 1, borderColor: '#4ade80' } : null,
          ]}
          resizeMode="cover"
          resizeMethod="resize"
          fadeDuration={0}
          onError={(e) => {
            if (DEBUG_THUMBS) console.warn('[Edit Thumb:onError]', e?.nativeEvent);
          }}
        />
        {DEBUG_THUMBS && (
          <View style={{ marginTop: 6, padding: 8, backgroundColor: '#0b1221', borderRadius: 8 }}>
            <Text style={{ color: '#93c5fd', fontWeight: '700', marginBottom: 4 }}>Thumbnail Debug</Text>
            <Text style={{ color: '#cbd5e1' }} numberOfLines={2}>uri: {uri}</Text>
            <Text style={{ color: '#e2e8f0' }}>
              getSizeOK: {String(dbg.getSizeOK)} {dbg.width && dbg.height ? `(${dbg.width}×${dbg.height})` : ''}
            </Text>
            <Text style={{ color: '#e2e8f0' }}>prefetchOK: {String(dbg.prefetchOK)}</Text>
            <Text style={{ color: '#e2e8f0' }}>
              headStatus: {dbg.headStatus ?? '-'} | ct: {dbg.headCT ?? '-'} | len: {dbg.headLen ?? '-'}
            </Text>
            {dbg.getSizeErr ? <Text style={{ color: '#fca5a5' }}>getSizeErr: {dbg.getSizeErr}</Text> : null}
            {dbg.prefetchErr ? <Text style={{ color: '#fca5a5' }}>prefetchErr: {dbg.prefetchErr}</Text> : null}
            {dbg.headErr ? <Text style={{ color: '#fca5a5' }}>headErr: {dbg.headErr}</Text> : null}
          </View>
        )}
      </>
    );
  }

  return (
    <View
      style={[
        styles.thumb,
        { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: 12 },
        DEBUG_THUMBS ? { borderWidth: 1, borderColor: '#f87171' } : null,
      ]}
    >
      <Text style={{ color: '#fff' }}>Preview unavailable</Text>
    </View>
  );
}

export default function RecipeEdit() {
  const { colors, getThemedInputProps } = useThemeController();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const nav = useNavigation<any>();
  const route = useRoute<R>();
  const insets = useSafeAreaInsets();

  const recipeId = route.params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');

  // EXACTLY like Add: this single string is what we preview AND what we store in thumb_path
  const [thumb, setThumb] = useState<string>('');
  const [thumbUrlInput, setThumbUrlInput] = useState<string>('');
  const [imgBusy, setImgBusy] = useState(false);

  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>([]);

  // Load base + children (pull thumb_path verbatim)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!recipeId) return;
      try {
        setLoading(true);

        const { data: base, error } = await supabase
          .from('recipes')
          .select('id, title, source_url, thumb_path')
          .eq('id', recipeId)
          .single<RecipeBase>();
        if (error) throw error;

        const [{ data: ing, error: ingErr }, { data: stp }] = await Promise.all([
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

        if (!alive) return;

        setTitle(base?.title || '');
        setSourceUrl(base?.source_url || '');
        setThumb(base?.thumb_path || '');
        setThumbUrlInput('');

        setIngredients(((ing as { raw: string }[]) ?? []).map(r => r.raw).filter(Boolean));
        setSteps(((stp as { step_text: string }[]) ?? []).map(r => r.step_text).filter(Boolean));
      } catch (e: any) {
        Alert.alert('Load failed', e?.message || 'Try again.');
        nav.goBack();
      } finally {
        alive && setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [nav, recipeId]);

  // Apply a new thumb value to DB + state (same shape as Add)
  const applyThumbToDb = useCallback(async (val: string) => {
    await supabase
      .from('recipes')
      .update({ thumb_path: val, updated_at: new Date().toISOString() })
      .eq('id', recipeId);
    setThumb(val);
  }, [recipeId]);

  // Single button → choose Camera or Library
  const onChooseImage = useCallback(() => {
    Alert.alert(
      'Select Image',
      'Choose an image source',
      [
        {
          text: 'Camera',
          onPress: async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Permission needed', 'Enable Camera to take a photo.');
              return;
            }
            // Use the SAME options as Add (MediaTypeOptions.Images) to avoid behavior changes
            const res = await ImagePicker.launchCameraAsync({
              mediaTypes: ImagePicker.MediaType,
              allowsEditing: true,
              aspect: [4, 3],
              quality: 0.9,
            });
            if (res.canceled || !res.assets?.length) return;
            const localUri = res.assets[0].uri;
            try {
              setImgBusy(true);
              if (ensureDurableThumb) {
                const out = await ensureDurableThumb(localUri);
                const val = out.signedUrl || out.publicUrl || out.uri || localUri;
                await applyThumbToDb(val);
              } else {
                await applyThumbToDb(localUri);
              }
            } catch (e: any) {
              Alert.alert('Image error', e?.message || 'Could not prepare the photo.');
            } finally {
              setImgBusy(false);
            }
          }
        },
        {
          text: 'Photo Library',
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('Permission needed', 'Enable Photos permission to choose an image.');
              return;
            }
            // SAME options as Add
            const res = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaType,
              quality: 0.9,
            });
            if (res.canceled || !res.assets?.length) return;
            const localUri = res.assets[0].uri;
            try {
              setImgBusy(true);
              if (ensureDurableThumb) {
                const out = await ensureDurableThumb(localUri);
                const val = out.signedUrl || out.publicUrl || out.uri || localUri;
                await applyThumbToDb(val);
              } else {
                await applyThumbToDb(localUri);
              }
            } catch (e: any) {
              Alert.alert('Image error', e?.message || 'Could not prepare the image.');
            } finally {
              setImgBusy(false);
            }
          }
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  }, [applyThumbToDb]);

  // Import raw URL via the SAME helper as Add
  const importFromUrl = useCallback(async (url: string) => {
    const input = (url || '').trim();
    if (!looksLikeUrl(input)) {
      Alert.alert('Invalid URL', 'Enter a valid http(s) URL.');
      return;
    }
    try {
      setImgBusy(true);
      if (ensureDurableThumb) {
        const out = await ensureDurableThumb(input);
        const val = out.signedUrl || out.publicUrl || out.uri || input;
        await applyThumbToDb(val);
      } else {
        await applyThumbToDb(input);
      }
      setThumbUrlInput('');
    } catch (e: any) {
      Alert.alert('Import failed', e?.message || 'Could not fetch image from the URL.');
    } finally {
      setImgBusy(false);
    }
  }, [applyThumbToDb]);

  // Fetch from Source URL (same as Add: just another call to ensureDurableThumb)
  const fetchFromSource = useCallback(async () => {
    const u = (sourceUrl || '').trim();
    if (!looksLikeUrl(u)) {
      Alert.alert('No Source URL', 'Add a valid Source URL first.');
      return;
    }
    await importFromUrl(u);
  }, [importFromUrl, sourceUrl]);

  // Save recipe (base fields + children; thumb already applied on change)
  const save = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please add a recipe title.');
      return;
    }
    setSaving(true);
    try {
      const { error: upErr } = await supabase
        .from('recipes')
        .update({
          title: title.trim(),
          source_url: looksLikeUrl(sourceUrl) ? sourceUrl.trim() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipeId);
      if (upErr) throw upErr;

      // Replace ingredients
      const ingRows = (ingredients || [])
        .map(s => s?.trim())
        .filter(Boolean)
        .map((raw, idx) => ({ recipe_id: recipeId, raw, pos: idx }));

      const { error: delIngErr } = await supabase
        .from('recipe_ingredients')
        .delete()
        .eq('recipe_id', recipeId);
      if (delIngErr) throw delIngErr;

      if (ingRows.length) {
        const { error: insIngErr } = await supabase.from('recipe_ingredients').insert(ingRows);
        if (insIngErr) throw insIngErr;
      }

      // Replace steps
      const stepRows = (steps || [])
        .map(s => s?.trim())
        .filter(Boolean)
        .map((step_text, idx) => ({ recipe_id: recipeId, step_text, position: idx }));

      const { error: delStepErr } = await supabase
        .from('recipe_steps')
        .delete()
        .eq('recipe_id', recipeId);
      if (delStepErr) { /* table may not exist yet — ignore */ }

      if (stepRows.length) {
        const { error: insStepErr } = await supabase.from('recipe_steps').insert(stepRows);
        if (insStepErr) { /* ignore if table missing */ }
      }

      Alert.alert('Updated', 'Recipe updated.');
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [ingredients, nav, recipeId, sourceUrl, steps, title]);

  const canSave = useMemo(() => !!title.trim() && !saving, [saving, title]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: '#0B0F19' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { paddingTop: Math.max(insets.top, 8) }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.h1}>Edit Recipe</Text>

          {/* Title */}
          <Text style={styles.label}>Title</Text>
          <TextInput
            {...useThemeController().getThemedInputProps()}
            style={[useThemeController().getThemedInputProps().style, styles.input]}
            placeholder="Recipe title"
            value={title}
            onChangeText={setTitle}
          />

          {/* Source URL */}
          <Text style={styles.label}>Source URL</Text>
          <TextInput
            {...useThemeController().getThemedInputProps()}
            style={[useThemeController().getThemedInputProps().style, styles.input]}
            placeholder="https://example.com"
            value={sourceUrl}
            onChangeText={setSourceUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          {/* Thumbnail */}
          <Text style={styles.label}>Thumbnail</Text>
          {thumb ? <Thumb uri={thumb} styles={styles} /> : (
            <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: 12 }]}>
              <Text style={{ color: '#fff' }}>No image yet</Text>
            </View>
          )}

          <View style={styles.actionsRow}>
            <Pressable style={styles.btnNeutral} onPress={onChooseImage} disabled={imgBusy}>
              {imgBusy ? <ActivityIndicator size="small" /> : <Text style={styles.btnNeutralText}>Choose Image</Text>}
            </Pressable>
          </View>

          <TextInput
            {...useThemeController().getThemedInputProps()}
            style={[useThemeController().getThemedInputProps().style, styles.input]}
            placeholder="Paste image URL (https://...)"
            value={thumbUrlInput}
            onChangeText={setThumbUrlInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <View style={styles.actionsRow}>
            <Pressable
              style={[styles.btnNeutral, (!thumbUrlInput.trim() || imgBusy) && styles.btnDisabled]}
              onPress={() => importFromUrl(thumbUrlInput)}
              disabled={!thumbUrlInput.trim() || imgBusy}
            >
              <Text style={styles.btnNeutralText}>Import From URL</Text>
            </Pressable>
            <Pressable
              style={[styles.btnNeutral, (!looksLikeUrl(sourceUrl) || imgBusy) && styles.btnDisabled]}
              onPress={fetchFromSource}
              disabled={!looksLikeUrl(sourceUrl) || imgBusy}
            >
              <Text style={styles.btnNeutralText}>Fetch from Source URL</Text>
            </Pressable>
          </View>

          {/* Ingredients */}
          <Text style={styles.label}>Ingredients</Text>
          <View style={styles.multiBox}>
            {(ingredients.length ? ingredients : ['']).map((val, idx) => (
              <TextInput
                key={`ing-${idx}`}
                {...useThemeController().getThemedInputProps({ variant: 'ghost' })}
                style={[useThemeController().getThemedInputProps({ variant: 'ghost' }).style, styles.multiInput]}
                placeholder={idx === 0 ? '• e.g., 1/4 tsp onion powder' : '• add another'}
                value={val}
                onChangeText={(t) => {
                  const copy = ingredients.slice();
                  if (idx === copy.length) copy.push('');
                  copy[idx] = t;
                  setIngredients(copy.filter((x, i) => (i === copy.length - 1 ? true : x !== '' || i < copy.length - 1)));
                }}
                multiline
              />
            ))}
            <Pressable onPress={() => setIngredients([...ingredients, ''])} style={styles.addLine}>
              <Text style={styles.addLineText}>+ Add ingredient</Text>
            </Pressable>
          </View>

          {/* Steps */}
          <Text style={styles.label}>Steps</Text>
          <View style={styles.multiBox}>
            {(steps.length ? steps : ['']).map((val, idx) => (
              <TextInput
                key={`step-${idx}`}
                {...useThemeController().getThemedInputProps({ variant: 'ghost' })}
                style={[useThemeController().getThemedInputProps({ variant: 'ghost' }).style, styles.multiInput]}
                placeholder={idx === 0 ? '1) Describe a step' : `${idx + 1}) Add another step`}
                value={val}
                onChangeText={(t) => {
                  const copy = steps.slice();
                  if (idx === copy.length) copy.push('');
                  copy[idx] = t;
                  setSteps(copy.filter((x, i) => (i === copy.length - 1 ? true : x !== '' || i < copy.length - 1)));
                }}
                multiline
              />
            ))}
            <Pressable onPress={() => setSteps([...steps, ''])} style={styles.addLine}>
              <Text style={styles.addLineText}>+ Add step</Text>
            </Pressable>
          </View>

          {/* Save */}
          <View style={{ marginTop: 18 }}>
            <Pressable style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={save} disabled={saving || !canSave}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </Pressable>
          </View>

          <View style={{ height: 48 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ===== Styles (themed, same design language as Add) =====
const makeStyles = (c: ReturnType<typeof useThemeController>['colors']) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    container: { padding: 16 },
    h1: { color: c.text, fontSize: 22, fontWeight: '700', marginBottom: 12 },
    label: { color: c.mutedText, marginTop: 16, marginBottom: 6, fontSize: 13 },
    input: { borderRadius: 10 },

    actionsRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' },

    btnNeutral: {
      backgroundColor: c.cardBg,
      borderColor: c.border,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
    },
    btnNeutralText: { color: c.text, fontWeight: '600' },
    btnDisabled: { opacity: 0.6 },

    thumb: { width: '100%', height: 180 },

    multiBox: {
      backgroundColor: c.cardBg,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 8,
    },
    multiInput: { borderRadius: 10, marginBottom: 8, minHeight: 44 },

    addLine: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 6 },
    addLineText: { color: c.tint },

    saveBtn: {
      backgroundColor: c.tint,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: c.shadow,
    },
    saveBtnText: { color: '#ffffff', fontWeight: '700' },
  });
