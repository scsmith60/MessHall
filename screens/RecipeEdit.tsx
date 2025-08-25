// screens/RecipeEdit.tsx
// MessHall — Edit screen with DEBUG + durable thumb parity (uses recipe-thumbs)
// - Camera/Library: ensureDurableThumb(localUri); on upload error → fallback to signed upload
// - Import/Fetch:   ensureDurableThumb(url) OR server-side refresh (edge) → fallback HEAD+download→signed upload
// - Preview: signed URL from recipe-thumbs when thumb_path is a storage path
// - Cleanup: deletes old storage object after successful replace
// - ImagePicker mediaTypes helper works across old/new Expo SDKs

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Alert,
  StyleSheet, KeyboardAvoidingView, Platform, Image
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';

type R = RouteProp<RootStackParamList, 'Recipe'>;

type RecipeBase = {
  id: string;
  title: string | null;
  source_url: string | null;
  thumb_path?: string | null;
};

const DURABLE_BUCKET = 'recipe-thumbs';
const DURABLE_FOLDER = 'u';
const PREVIEW_TTL = 60 * 60 * 24 * 14; // 14 days

// ===== DEBUG =====
const dbg = (...a: any[]) => console.log('DBG[edit]:', ...a);
const j = (x: any) => { try { return JSON.stringify(x); } catch { return String(x); } };

// ===== ImagePicker mediaTypes helper =====
const getMediaImages = () => {
  const anyIP: any = ImagePicker as any;
  if (anyIP?.MediaType?.Images) return anyIP.MediaType.Images; // new API (no warning)
  if (anyIP?.MediaTypeOptions?.Images) return anyIP.MediaTypeOptions.Images; // old API (may warn)
  return undefined; // avoid "undefined.Images" crash
};

// ===== Helpers =====
const isHttp = (s?: string) => !!s && /^https?:\/\//i.test(s!);
const isLikelyImageUrl = (u: string) => /\.(jpg|jpeg|png|webp|gif|bmp|avif|heic|heif)(\?|#|$)/i.test(u);
const base64ToUint8 = (b64: string) => {
  const binary = global.atob ? global.atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const getExtAndCT = (uri: string) => {
  const raw = (uri.split('.').pop() || '').split('?')[0].toLowerCase();
  const ext = ['jpg','jpeg','png','webp','gif','bmp','avif','heic','heif'].includes(raw) ? raw : 'jpg';
  const ct =
    ext === 'png' ? 'image/png' :
    ext === 'webp' ? 'image/webp' :
    ext === 'gif' ? 'image/gif' :
    ext === 'bmp' ? 'image/bmp' :
    ext === 'avif' ? 'image/avif' :
    ext === 'heic' ? 'image/heic' :
    ext === 'heif' ? 'image/heif' :
    'image/jpeg';
  return { ext, ct };
};

// ===== Durable helper from your lib (same as Add) =====
let ensureDurableThumb:
  | undefined
  | ((src: string, opts?: any) => Promise<{ publicUrl: string; bucketPath: string; uri?: string; signed?: boolean }>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../lib/ensureDurableThumb');
  ensureDurableThumb = mod.ensureDurableThumb || mod.default;
  dbg('ensureDurableThumb present:', !!ensureDurableThumb);
} catch {
  dbg('ensureDurableThumb not found at ../lib/ensureDurableThumb');
}

// ===== Remove previous storage object if we own it (avoid dirty bucket) =====
async function removeOldThumbIfOwned(prev?: string | null, next?: string | null) {
  try {
    if (!prev || !next || prev === next) return;
    if (/^https?:\/\//i.test(prev)) return; // don't delete external URLs

    // Normalize: allow “recipe-thumbs/…” or bare “u/…”
    const clean = String(prev).replace(new RegExp(`^${DURABLE_BUCKET}/?`, 'i'), '');
    const res = await supabase.storage.from(DURABLE_BUCKET).remove([clean]);
    if (res.error) dbg('removeOldThumbIfOwned error:', res.error.message);
    else dbg('removeOldThumbIfOwned removed:', clean);
  } catch (e: any) {
    dbg('removeOldThumbIfOwned exception:', e?.message || e);
  }
}

export default function RecipeEdit() {
  const { isDark } = useThemeController();
  const nav = useNavigation<any>();
  const route = useRoute<R>();
  const insets = useSafeAreaInsets();
  const recipeId = route.params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>([]);

  const [thumbPath, setThumbPath] = useState<string>('');       // DB value (bucketPath or URL)
  const [thumbPreview, setThumbPreview] = useState<string>(''); // signed URL or direct URL
  const [thumbUrlInput, setThumbUrlInput] = useState<string>('');
  const [imgBusy, setImgBusy] = useState(false);

  // ===== Quick storage sanity check (DEBUG only) =====
  useEffect(() => {
    (async () => {
      try {
        const res = await supabase.storage.from(DURABLE_BUCKET).list(DURABLE_FOLDER, { limit: 1 });
        dbg('storage sanity list:', res.error?.message || 'ok', res.data?.length || 0);
      } catch (e: any) {
        dbg('storage sanity exception:', e?.message || e);
      }
    })();
  }, []);

  // ===== Resolve preview any time thumbPath changes =====
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!thumbPath) { setThumbPreview(''); return; }

      if (isHttp(thumbPath)) {
        if (!cancelled) setThumbPreview(thumbPath);
        return;
      }
      // treat as storage path (relative inside recipe-thumbs)
      const clean = thumbPath.replace(new RegExp(`^${DURABLE_BUCKET}/?`, 'i'), '');
      try {
        const signed = await supabase.storage.from(DURABLE_BUCKET).createSignedUrl(clean, PREVIEW_TTL);
        if (!cancelled) {
          if (signed.error) {
            dbg('preview signed error=', signed.error.message);
            const { data } = supabase.storage.from(DURABLE_BUCKET).getPublicUrl(clean);
            setThumbPreview(data?.publicUrl || '');
          } else {
            setThumbPreview(signed.data?.signedUrl || '');
          }
        }
      } catch (e: any) {
        dbg('preview resolution error', e?.message || e);
        const { data } = supabase.storage.from(DURABLE_BUCKET).getPublicUrl(clean);
        if (!cancelled) setThumbPreview(data?.publicUrl || '');
      }
    })();
    return () => { cancelled = true; };
  }, [thumbPath]);

  // ===== LOAD =====
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!recipeId) return;
      try {
        setLoading(true);
        dbg('load start recipeId=', recipeId);

        const { data: base, error } = await supabase
          .from('recipes')
          .select('id, title, source_url, thumb_path')
          .eq('id', recipeId)
          .single<RecipeBase>();
        dbg('select recipes error=', error?.message || 'none');
        if (error) throw error;

        const [{ data: ing, error: ingErr }, { data: stp, error: stpErr }] = await Promise.all([
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
        dbg('children errs ing=', ingErr?.message || 'none', ' stp=', stpErr?.message || 'none');
        if (ingErr) throw ingErr;

        if (!alive) return;

        setTitle(base?.title || '');
        setSourceUrl(base?.source_url || '');
        const tp = base?.thumb_path || '';
        setThumbPath(tp); // preview resolves via effect

        setThumbUrlInput('');
        setIngredients(((ing as { raw: string }[]) ?? []).map(r => r.raw).filter(Boolean));
        setSteps(((stp as { step_text: string }[]) ?? []).map(r => r.step_text).filter(Boolean));
      } catch (e: any) {
        dbg('LOAD ERROR', e?.message || e);
        Alert.alert('Load failed', e?.message || 'Try again.');
        nav.goBack();
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [nav, recipeId]);

  // ===== Fallback: Signed upload directly to recipe-thumbs (used for fallback branches) =====
  const uploadLocalUriWithSignedUrl = useCallback(async (localUri: string) => {
    if (!recipeId) throw new Error('Missing recipe id');
    const { ext, ct } = getExtAndCT(localUri);
    const storageRel = `${DURABLE_FOLDER}/recipes/${recipeId}/${Date.now()}.${ext}`;
    dbg('signed upload start', { localUri, storageRel, ct });

    const signed = await supabase.storage.from(DURABLE_BUCKET).createSignedUploadUrl(storageRel);
    dbg('createSignedUploadUrl err=', signed.error?.message || 'none');
    if (signed.error) throw signed.error;
    const { token } = signed.data;

    const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    const bytes = base64ToUint8(b64);
    dbg('read local file bytes=', bytes.byteLength);

    const up = await supabase.storage.from(DURABLE_BUCKET).uploadToSignedUrl(storageRel, token, bytes, { contentType: ct });
    dbg('uploadToSignedUrl err=', up.error?.message || 'none');
    if (up.error) throw up.error;

    // cleanup: remove old object if owned
    const prev = thumbPath;

    const { error: recErr } = await supabase
      .from('recipes')
      .update({ thumb_path: storageRel, updated_at: new Date().toISOString() })
      .eq('id', recipeId);
    dbg('update recipe err=', recErr?.message || 'none');
    if (recErr) throw recErr;

    await removeOldThumbIfOwned(prev, storageRel);

    setThumbPath(storageRel); // effect will refresh preview
    setThumbUrlInput('');
  }, [recipeId, thumbPath]);

  // ===== Camera/Library — ensureDurableThumb(localUri) with fallback =====
  const onChooseImage = useCallback(() => {
    dbg('onChooseImage pressed');
    Alert.alert(
      'Select Image',
      'Choose an image source',
      [
        {
          text: 'Camera',
          onPress: async () => {
            dbg('Camera chosen');
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            dbg('Camera permission=', perm.granted);
            if (!perm.granted) { Alert.alert('Permission needed', 'Enable Camera.'); return; }
            try {
              const res = await ImagePicker.launchCameraAsync({
                mediaTypes: getMediaImages(),
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.9,
              });
              dbg('launchCameraAsync result=', j({ canceled: res.canceled, assets: res.assets?.length || 0 }));
              if (res.canceled || !res.assets?.length) return;

              const localUri = res.assets[0].uri;
              setImgBusy(true);

              try {
                if (!ensureDurableThumb) throw new Error('no-durable-helper');
                dbg('ensureDurableThumb(localUri) start');
                const out = await ensureDurableThumb(localUri);
                const val = out.bucketPath || out.publicUrl || localUri;
                dbg('ensureDurableThumb OK ->', val);
                const prev = thumbPath;
                await supabase.from('recipes').update({ thumb_path: val, updated_at: new Date().toISOString() }).eq('id', recipeId);
                await removeOldThumbIfOwned(prev, val);
                setThumbPath(val);
              } catch (e: any) {
                dbg('ensureDurableThumb(localUri) FAILED:', e?.message || e);
                // Fallback: signed upload to recipe-thumbs
                try {
                  await uploadLocalUriWithSignedUrl(localUri);
                  Alert.alert('Image updated', 'Photo saved (fallback path).');
                } catch (e2: any) {
                  dbg('fallback signed upload FAILED:', e2?.message || e2);
                  Alert.alert('Upload failed', e2?.message || 'Could not upload photo.');
                }
              }
            } finally {
              setImgBusy(false);
            }
          }
        },
        {
          text: 'Photo Library',
          onPress: async () => {
            dbg('Library chosen');
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            dbg('Library permission=', perm.granted);
            if (!perm.granted) { Alert.alert('Permission needed', 'Enable Photos.'); return; }
            try {
              const res = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: getMediaImages(),
                quality: 0.9,
              });
              dbg('launchImageLibraryAsync result=', j({ canceled: res.canceled, assets: res.assets?.length || 0 }));
              if (res.canceled || !res.assets?.length) return;

              const localUri = res.assets[0].uri;
              setImgBusy(true);

              try {
                if (!ensureDurableThumb) throw new Error('no-durable-helper');
                dbg('ensureDurableThumb(localUri) start');
                const out = await ensureDurableThumb(localUri);
                const val = out.bucketPath || out.publicUrl || localUri;
                dbg('ensureDurableThumb OK ->', val);
                const prev = thumbPath;
                await supabase.from('recipes').update({ thumb_path: val, updated_at: new Date().toISOString() }).eq('id', recipeId);
                await removeOldThumbIfOwned(prev, val);
                setThumbPath(val);
              } catch (e: any) {
                dbg('ensureDurableThumb(localUri) FAILED:', e?.message || e);
                // Fallback: signed upload to recipe-thumbs
                try {
                  await uploadLocalUriWithSignedUrl(localUri);
                  Alert.alert('Image updated', 'Image saved (fallback path).');
                } catch (e2: any) {
                  dbg('fallback signed upload FAILED:', e2?.message || e2);
                  Alert.alert('Upload failed', e2?.message || 'Could not upload image.');
                }
              }
            } finally {
              setImgBusy(false);
            }
          }
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  }, [recipeId, uploadLocalUriWithSignedUrl, thumbPath]);

  // ===== Server-side: refresh from source page (Edge Function) =====
  const refreshFromSource = useCallback(async (pageUrl: string) => {
    dbg('refreshFromSource', pageUrl);
    const url = (pageUrl || '').trim();
    if (!isHttp(url)) { Alert.alert('Invalid URL', 'Enter a valid http(s) URL.'); return; }

    try {
      setImgBusy(true);
      const prev = thumbPath;

      // Prefer your dedicated refresh function (server does og:image/screenshot + upload + DB update)
      const fx = await supabase.functions.invoke('refresh-recipe-thumb', {
        body: { recipeId, url },
      });

      if (fx.error) {
        dbg('refresh-recipe-thumb error:', fx.error.message || fx.error);
        throw new Error(fx.error.message || 'Edge function error');
      }

      const out: any = fx.data || {};
      const newPath = out.bucketPath || out.path || '';
      if (!newPath) throw new Error('No bucketPath returned from refresh function');

      // Ensure DB has the new path (function already updates DB, but do it idempotently here)
      await supabase.from('recipes').update({ thumb_path: newPath, updated_at: new Date().toISOString() }).eq('id', recipeId);

      await removeOldThumbIfOwned(prev, newPath);

      setThumbPath(newPath);
      setThumbUrlInput('');
      Alert.alert('Image updated', 'Fetched from source.');
    } catch (e: any) {
      dbg('refreshFromSource FAIL:', e?.message || e);
      Alert.alert('Fetch failed', e?.message || 'Could not refresh from source.');
    } finally {
      setImgBusy(false);
    }
  }, [recipeId, thumbPath]);

  // ===== Import URL (page or image) =====
  const importFromUrl = useCallback(async (url: string) => {
    const input = (url || '').trim();
    dbg('importFromUrl', input);
    if (!isHttp(input)) { Alert.alert('Invalid URL', 'Enter a valid http(s) URL.'); return; }

    try {
      setImgBusy(true);

      // 1) Direct image URL and durable helper exists → prefer durable pipeline
      if (isLikelyImageUrl(input) && ensureDurableThumb) {
        dbg('likely image URL → ensureDurableThumb first');
        try {
          const out = await ensureDurableThumb(input);
          const val = out.bucketPath || out.publicUrl || input;
          const prev = thumbPath;
          await supabase.from('recipes').update({ thumb_path: val, updated_at: new Date().toISOString() }).eq('id', recipeId);
          await removeOldThumbIfOwned(prev, val);
          setThumbPath(val);
          setThumbUrlInput('');
          Alert.alert('Image updated', 'Imported from URL.');
          return;
        } catch (e: any) {
          dbg('ensureDurableThumb(imageURL) failed; will fallback', e?.message || e);
        }
      }

      // 2) Page URL → server-side refresh (Edge Fn)
      if (!isLikelyImageUrl(input)) {
        await refreshFromSource(input);
        return;
      }

      // 3) Final client fallback: for direct image, download → signed upload
      try {
        const head = await fetch(input, { method: 'HEAD' });
        const ct = head.headers.get('content-type') || '';
        dbg('HEAD status=', head.status, 'ct=', ct);
        if (!head.ok || !/^image\//i.test(ct)) {
          throw new Error('That link is a web page. Use Fetch from Source, or paste a direct image URL.');
        }
        const tmp = FileSystem.cacheDirectory + `mh_${Date.now()}.bin`;
        const dl = await FileSystem.downloadAsync(input, tmp);
        dbg('downloadAsync status=', dl.status, 'uri=', dl.uri);
        if (dl.status >= 200 && dl.status < 400) {
          await uploadLocalUriWithSignedUrl(dl.uri);
          setThumbUrlInput('');
          Alert.alert('Image updated', 'Imported by downloading image.');
          return;
        }
      } catch (e: any) {
        dbg('HEAD/download fallback failed', e?.message || e);
        throw e;
      }

      // 4) Last attempt: durable helper (sometimes handles redirects)
      if (ensureDurableThumb) {
        const out = await ensureDurableThumb(input, { allowPage: true });
        const val = out.bucketPath || out.publicUrl || input;
        const prev = thumbPath;
        await supabase.from('recipes').update({ thumb_path: val, updated_at: new Date().toISOString() }).eq('id', recipeId);
        await removeOldThumbIfOwned(prev, val);
        setThumbPath(val);
        setThumbUrlInput('');
        Alert.alert('Image updated', 'Imported via durable helper.');
        return;
      }

      throw new Error('No importer handled this URL. Use Fetch from Source or paste a direct image URL.');
    } catch (e: any) {
      dbg('importFromUrl ERROR', e?.message || e);
      Alert.alert('Import failed', e?.message || 'Could not fetch image from the URL.');
    } finally {
      setImgBusy(false);
    }
  }, [recipeId, uploadLocalUriWithSignedUrl, refreshFromSource, thumbPath]);

  const fetchFromSource = useCallback(async () => {
    const u = (sourceUrl || '').trim();
    dbg('fetchFromSource', u);
    if (!isHttp(u)) { Alert.alert('No Source URL', 'Add a valid Source URL.'); return; }
    await refreshFromSource(u);
  }, [refreshFromSource, sourceUrl]);

  // ===== Save =====
  const save = useCallback(async () => {
    if (!title.trim()) { Alert.alert('Missing title', 'Please add a recipe title.'); return; }
    setSaving(true);
    try {
      const { error: upErr } = await supabase
        .from('recipes')
        .update({
          title: title.trim(),
          source_url: sourceUrl.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipeId);
      if (upErr) throw upErr;

      const ingRows = (ingredients || []).map(s => s?.trim()).filter(Boolean).map((raw, idx) => ({ recipe_id: recipeId, raw, pos: idx }));
      const { error: delIngErr } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
      if (delIngErr) throw delIngErr;
      if (ingRows.length) {
        const { error: insIngErr } = await supabase.from('recipe_ingredients').insert(ingRows);
        if (insIngErr) throw insIngErr;
      }

      const stepRows = (steps || []).map(s => s?.trim()).filter(Boolean).map((step_text, idx) => ({ recipe_id: recipeId, step_text, position: idx }));
      const { error: delStepErr } = await supabase.from('recipe_steps').delete().eq('recipe_id', recipeId);
      if (delStepErr) { /* ignore if table missing */ }
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
      <View style={[styles.center, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: isDark ? '#0B0F19' : '#F9FAFB', paddingTop: Math.max(insets.top, 8) }}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}
      >
        <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 32 }]}>
          <Text style={[styles.h1, { color: isDark ? '#E5E7EB' : '#111827' }]}>Edit Recipe</Text>

          {/* Thumbnail */}
          <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Thumbnail</Text>
          <View style={[styles.thumbWrap, { borderColor: isDark ? '#1F2937' : '#E5E7EB', backgroundColor: isDark ? '#0F172A' : '#FFFFFF' }]}>
            {thumbPreview ? (
              <Image source={{ uri: thumbPreview }} style={styles.thumbImg} />
            ) : (
              <View style={styles.thumbPlaceholder}><Text style={{ color: isDark ? '#6B7280' : '#9CA3AF' }}>No image yet</Text></View>
            )}
          </View>

          <View style={styles.thumbActionsRow}>
            <Pressable onPress={onChooseImage} style={[styles.smallBtn, styles.smallBtnPrimary]} disabled={imgBusy}>
              {imgBusy ? <ActivityIndicator /> : <Text style={styles.smallBtnText}>Choose Image</Text>}
            </Pressable>
          </View>

          {/* Import URL + Fetch from Source */}
          <TextInput
            style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
            value={thumbUrlInput}
            onChangeText={setThumbUrlInput}
            placeholder="Paste image URL or page (https://...)"
            autoCapitalize="none"
            keyboardType="url"
            placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
          />
          <Pressable onPress={() => importFromUrl(thumbUrlInput)} style={[styles.smallBtn, styles.smallBtnGhost]} disabled={imgBusy || !thumbUrlInput.trim()}>
            <Text style={[styles.smallBtnText, { color: isDark ? '#E5E7EB' : '#111827' }]}>Import From URL</Text>
          </Pressable>

          <Pressable onPress={() => refreshFromSource(sourceUrl)} style={[styles.smallBtn, styles.smallBtnGhost]} disabled={imgBusy || !sourceUrl.trim()}>
            <Text style={[styles.smallBtnText, { color: isDark ? '#E5E7EB' : '#111827' }]}>Fetch from Source URL</Text>
          </Pressable>

          {/* Title */}
          <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Title</Text>
          <TextInput
            style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
            value={title}
            onChangeText={setTitle}
            placeholder="Recipe title"
            placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
          />

          {/* Source URL */}
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

          {/* Ingredients */}
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
                const trimmed = copy.filter((x, idx) =>
                  (idx === copy.length - 1 ? true : x.trim() !== '' || idx < copy.length - 1)
                );
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

          {/* Steps */}
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
                const trimmed = copy.filter((x, idx) =>
                  (idx === copy.length - 1 ? true : x.trim() !== '' || idx < copy.length - 1)
                );
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

          {/* Save */}
          <Pressable style={[styles.saveBtn, !canSave && styles.btnDisabled]} onPress={save} disabled={!canSave}>
            {saving ? <ActivityIndicator /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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

  thumbWrap: { width: '100%', height: 210, borderWidth: 1, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  thumbImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  thumbPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  thumbActionsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },

  smallBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  smallBtnPrimary: { backgroundColor: '#4F46E5' },
  smallBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#E5E7EB', marginTop: 4, alignSelf: 'flex-start' },
  smallBtnText: { color: 'white', fontWeight: '600' },

  addLine: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 6, marginBottom: 4 },
  addLineText: { color: '#93C5FD' },

  saveBtn: { backgroundColor: '#4F46E5', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: 'white', fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});
