// app/recipe/edit/[id].tsx
// LIKE I'M 5: you can change everything.
// • We show the CURRENT picture.
// • One button asks “Camera or Gallery?” then lets you pick/take.
// • When you choose a new picture we upload it, switch the DB to it, and delete the old one.
// • You can also remove the current picture completely.

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, Alert, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { COLORS, RADIUS, SPACING } from '@/lib/theme';
import HapticButton from '@/components/ui/HapticButton';
import { supabase } from '@/lib/supabase';
import { dataAPI } from '@/lib/data';
import { tap, success, warn } from '@/lib/haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';

// 👇 same helpers used by Capture so behavior matches
import { fetchOgForUrl } from '@/lib/og';
import { isTikTokUrl, tiktokOEmbedThumbnail, TikTokSnap } from '@/lib/tiktok';
// cleanup helper to delete a single storage path (works with public URL too)
import { removeStoragePath } from '@/lib/uploads';

// ===== tiny helpers (like Capture) =====
type ImageSourceState =
  | { kind: 'none' }
  | { kind: 'url-og'; url: string; resolvedImageUrl: string }
  | { kind: 'picker'; localUri: string }
  | { kind: 'camera'; localUri: string };

function extractFirstUrl(s: string): string | null {
  if (!s) return null;
  const match = s.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// ===== the screen =====
type StepRow = { text: string; seconds: number | null };

export default function EditRecipe() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // me + owner
  const [userId, setUserId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  // fields
  const [title, setTitle] = useState('');
  const [currentImageUrl, setCurrentImageUrl] = useState<string>(''); // the image currently on the recipe

  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);

  // image import state (new one we want to use)
  const [img, setImg] = useState<ImageSourceState>({ kind: 'none' });
  const [pastedUrl, setPastedUrl] = useState('');
  const [loadingOg, setLoadingOg] = useState(false);
  const [snapVisible, setSnapVisible] = useState(false);
  const [snapUrl, setSnapUrl] = useState('');
  const [snapReloadKey, setSnapReloadKey] = useState(0);
  const lastResolvedUrlRef = useRef<string>('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // load recipe
  useEffect(() => {
    let off = false;
    (async () => {
      if (!id) return;
      try {
        const r = await dataAPI.getRecipeById(id);
        if (!r) {
          Alert.alert('Missing', 'Recipe not found.');
          router.back();
          return;
        }
        setTitle(r.title || '');
        setCurrentImageUrl(r.image || '');          // ← current image on the recipe
        setIngredients(r.ingredients || []);
        setSteps(r.steps || []);
        const owner = await dataAPI.getRecipeOwnerId(id);
        if (!off) setOwnerId(owner);
      } catch (e: any) {
        Alert.alert('Error', e?.message ?? 'Failed to load recipe.');
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [id]);

  const canEdit = !!userId && !!ownerId && userId === ownerId;

  // build preview for the NEW image (if the user is selecting one)
  const previewUri = useMemo(() => {
    switch (img.kind) {
      case 'url-og': return img.resolvedImageUrl;
      case 'picker':
      case 'camera': return img.localUri;
      default: return '';
    }
  }, [img]);

  // ===== import helpers (same as Capture) =====
  const onPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;
    setPastedUrl(text.trim());
  }, []);

  const resolveOg = useCallback(async (raw: string) => {
    const url = extractFirstUrl(raw?.trim() || '');
    if (!url) {
      setImg({ kind: 'none' });
      Alert.alert('Link error', 'Please paste a full link that starts with http(s)://');
      return;
    }

    if (isTikTokUrl(url)) {
      try {
        const thumb = await withTimeout(tiktokOEmbedThumbnail(url), 1200).catch(() => null);
        if (thumb) {
          setImg({ kind: 'url-og', url, resolvedImageUrl: thumb });
          lastResolvedUrlRef.current = url;
          return;
        }
      } catch {}
      setImg({ kind: 'none' });
      setSnapUrl(url);
      setSnapReloadKey((k) => k + 1);
      setSnapVisible(true);
      return;
    }

    try {
      const out = await fetchOgForUrl(url);
      if (out?.image) {
        setImg({ kind: 'url-og', url, resolvedImageUrl: out.image });
        lastResolvedUrlRef.current = url;
        if (out?.title && !title.trim()) setTitle(out.title);
      } else {
        setImg({ kind: 'none' });
        Alert.alert('No image found on that page', out?.error || 'Try a different link or add a photo.');
      }
    } catch (e: any) {
      setImg({ kind: 'none' });
      Alert.alert('Link error', e?.message || 'Could not read that webpage.');
    }
  }, [title]);

  const onImport = useCallback(() => {
    if (!pastedUrl || pastedUrl.trim().length < 5) {
      Alert.alert('Paste a link first.');
      return;
    }
    setLoadingOg(true);
    lastResolvedUrlRef.current = '';
    setImg({ kind: 'none' });
    setSnapVisible(false);
    Promise.resolve().then(() => resolveOg(pastedUrl.trim())).finally(() => setLoadingOg(false));
  }, [pastedUrl, resolveOg]);

  // one button → choose camera or gallery
  const chooseCameraOrGallery = useCallback(() => {
    Alert.alert(
      'Add Photo',
      'Where do you want to get the photo?',
      [
        { text: 'Camera', onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') return Alert.alert('Permission needed to use camera.');
          const r = await ImagePicker.launchCameraAsync({ quality: 0.92, allowsEditing: true, aspect: [4,3] });
          if (r.canceled || !r.assets?.[0]?.uri) return;
          setPastedUrl('');
          setImg({ kind: 'camera', localUri: r.assets[0].uri });
        }},
        { text: 'Gallery', onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') return Alert.alert('Permission needed to pick a photo.');
          const r = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.92, allowsEditing: true, aspect: [4, 3],
          });
          if (r.canceled || !r.assets?.[0]?.uri) return;
          setPastedUrl('');
          setImg({ kind: 'picker', localUri: r.assets[0].uri });
        }},
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true }
    );
  }, []);

  // put the new picture in storage + DB, delete the old file, update UI
  const uploadPreviewAndSetImage = useCallback(async () => {
    if (!canEdit) { await warn(); Alert.alert('Only the owner can change the image.'); return; }
    if (!userId) { Alert.alert('Please sign in first.'); return; }

    const uri =
      img.kind === 'url-og' ? img.resolvedImageUrl :
      img.kind === 'picker' ? img.localUri :
      img.kind === 'camera' ? img.localUri :
      '';

    if (!uri) { Alert.alert('No image selected yet.'); return; }

    try {
      const newUrl = await dataAPI.replaceRecipeImage(id!, uri);
      setCurrentImageUrl(newUrl);  // update the “current” preview
      setImg({ kind: 'none' });
      await success();
      Alert.alert('Updated', 'Recipe image updated!');
    } catch (e: any) {
      await warn();
      Alert.alert('Image update failed', e?.message ?? 'Please try again.');
    }
  }, [canEdit, userId, img, id]);

  // remove the current image entirely (clear DB + delete file)
  const removeCurrentImage = useCallback(async () => {
    if (!canEdit) return;
    if (!currentImageUrl) return;

    Alert.alert('Remove image?', 'This will delete the file and clear the recipe image.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          await tap();
          // clear DB first
          await dataAPI.updateRecipe(id!, { image_url: null });
          // delete file from storage (works with public URL)
          await removeStoragePath('recipe-images', currentImageUrl);
          setCurrentImageUrl('');
          await success();
        } catch (e: any) {
          await warn();
          Alert.alert('Remove failed', e?.message ?? 'Please try again.');
        }
      }},
    ]);
  }, [canEdit, currentImageUrl, id]);

  // list helpers
  const addIngredient = () => setIngredients(arr => [...arr, '']);
  const updateIngredient = (idx: number, text: string) =>
    setIngredients(arr => arr.map((v, i) => (i === idx ? text : v)));
  const removeIngredient = (idx: number) =>
    setIngredients(arr => arr.filter((_, i) => i !== idx));

  const addStep = () => setSteps(arr => [...arr, { text: '', seconds: null }]);
  const updateStepText = (idx: number, text: string) =>
    setSteps(arr => arr.map((v, i) => (i === idx ? { ...v, text } : v)));
  const updateStepSeconds = (idx: number, secText: string) => {
    const n = secText.replace(/[^\d]/g, '');
    const val = n === '' ? null : Math.min(24 * 60 * 60, parseInt(n, 10) || 0);
    setSteps(arr => arr.map((v, i) => (i === idx ? { ...v, seconds: val } : v)));
  };
  const removeStep = (idx: number) =>
    setSteps(arr => arr.filter((_, i) => i !== idx));

  // save everything (title + ingredients + steps)
  const saveAll = async () => {
    if (!canEdit) {
      await warn();
      Alert.alert('Not allowed', 'Only the owner can edit this recipe.');
      return;
    }
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      Alert.alert('Please add a title');
      return;
    }

    const cleanIngredients = ingredients.map(s => s.trim()).filter(Boolean);
    const cleanSteps = steps
      .map(s => ({ text: s.text.trim(), seconds: s.seconds ?? null }))
      .filter(s => s.text.length > 0);

    setSaving(true);
    try {
      await tap();
      await dataAPI.updateRecipeFull({
        id: id!,
        title: cleanTitle,
        image_url: currentImageUrl || null, // whatever is currently set
        ingredients: cleanIngredients,
        steps: cleanSteps,
      });
      await success();
      router.replace(`/recipe/${id}`);
    } catch (e: any) {
      await warn();
      Alert.alert('Save failed', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ===== UI =====
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: COLORS.text }}>Loading…</Text>
      </View>
    );
  }

  if (!canEdit) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: COLORS.text, fontWeight: '800', textAlign: 'center' }}>
          Only the owner can edit this recipe.
        </Text>
        <HapticButton onPress={() => router.back()} style={{ marginTop: 16, backgroundColor: COLORS.card, padding: 12, borderRadius: RADIUS.lg }}>
          <Text style={{ color: COLORS.accent, fontWeight: '800' }}>Go Back</Text>
        </HapticButton>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 140 }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 16 }}>Edit Recipe</Text>

        {/* Title */}
        <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="My Tasty Pizza"
          placeholderTextColor="#64748b"
          style={{ color: 'white', backgroundColor: '#1e293b', borderRadius: 12, padding: 12, marginBottom: 12 }}
        />

        {/* CURRENT IMAGE */}
        <View style={{ backgroundColor: '#111827', borderRadius: 14, borderColor: '#243042', borderWidth: 1, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: '#9CA3AF', marginBottom: 6 }}>Current image</Text>
          {currentImageUrl ? (
            <Image source={{ uri: currentImageUrl }} style={{ width: '100%', height: 220, borderRadius: 12 }} contentFit="cover" />
          ) : (
            <View style={{ height: 220, borderRadius: 12, backgroundColor: '#1F2937', borderWidth: 1, borderColor: '#243042', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#9CA3AF' }}>No image on this recipe</Text>
            </View>
          )}
          {currentImageUrl ? (
            <TouchableOpacity onPress={removeCurrentImage} style={{ marginTop: 10, backgroundColor: '#7f1d1d', padding: 12, borderRadius: 10 }}>
              <Text style={{ color: 'white', textAlign: 'center', fontWeight: '800' }}>Remove current image</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* IMPORT / REPLACE IMAGE */}
        <View style={{ backgroundColor: '#111827', borderRadius: 14, borderColor: '#243042', borderWidth: 1, padding: 12, marginBottom: 12 }}>
          <Text style={{ color: '#9CA3AF', marginBottom: 6 }}>Import or replace image</Text>

          {/* Paste + Import row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <TextInput
              value={pastedUrl}
              onChangeText={setPastedUrl}
              placeholder="Paste page URL (YouTube/TikTok/blog)…"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, color: '#E5E7EB', backgroundColor: '#1F2937', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginRight: 8 }}
            />
            <TouchableOpacity onPress={onPaste} style={{ backgroundColor: '#1F2937', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginRight: 8 }}>
              <Text style={{ color: '#E5E7EB', fontWeight: '600' }}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onImport} disabled={loadingOg} style={{ backgroundColor: '#60A5FA', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, opacity: loadingOg ? 0.6 : 1 }}>
              <Text style={{ color: '#0B1120', fontWeight: '700' }}>{loadingOg ? 'Importing…' : 'Import'}</Text>
            </TouchableOpacity>
          </View>

          {/* New preview + source chooser */}
          <View style={{ marginTop: 8 }}>
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={{ width: '100%', height: 220, borderRadius: 12 }} contentFit="cover" />
            ) : (
              <View style={{ height: 220, borderRadius: 12, backgroundColor: '#1F2937', borderWidth: 1, borderColor: '#243042', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#9CA3AF' }}>No new image selected</Text>
              </View>
            )}

            {/* ONE BUTTON: ask Camera or Gallery */}
            <TouchableOpacity onPress={chooseCameraOrGallery} style={{ marginTop: 10, backgroundColor: '#1F2937', padding: 12, borderRadius: 10 }}>
              <Text style={{ color: '#E5E7EB', textAlign: 'center', fontWeight: '600' }}>Add/Choose Photo…</Text>
            </TouchableOpacity>

            <HapticButton onPress={uploadPreviewAndSetImage} style={{ marginTop: 10, backgroundColor: '#49B265', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>Use This Image</Text>
            </HapticButton>
          </View>
        </View>

        {/* Ingredients */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Ingredients</Text>
          {ingredients.map((ing, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <TextInput
                value={ing}
                onChangeText={(t) => updateIngredient(i, t)}
                placeholder={`Ingredient ${i + 1}`}
                placeholderTextColor="#64748b"
                style={{ flex: 1, color: 'white', backgroundColor: '#1e293b', borderRadius: 10, padding: 10 }}
              />
              <TouchableOpacity onPress={() => removeIngredient(i)} style={{ marginLeft: 8, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#7f1d1d', borderRadius: 10 }}>
                <Text style={{ color: 'white', fontWeight: '800' }}>X</Text>
              </TouchableOpacity>
            </View>
          ))}
          <HapticButton onPress={addIngredient} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: 'center' }}>
            <Text style={{ color: COLORS.text, fontWeight: '800' }}>+ Add Ingredient</Text>
          </HapticButton>
        </View>

        {/* Steps */}
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Steps</Text>
          {steps.map((st, i) => (
            <View key={i} style={{ marginBottom: 10 }}>
              <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Step {i + 1}</Text>
              <TextInput
                value={st.text}
                onChangeText={(t) => updateStepText(i, t)}
                placeholder="Mix everything…"
                placeholderTextColor="#64748b"
                multiline
                style={{ color: 'white', backgroundColor: '#1e293b', borderRadius: 10, padding: 10, minHeight: 60 }}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <Text style={{ color: COLORS.subtext, marginRight: 8 }}>Seconds (optional)</Text>
                <TextInput
                  value={st.seconds === null ? '' : String(st.seconds)}
                  onChangeText={(t) => updateStepSeconds(i, t)}
                  keyboardType="number-pad"
                  placeholder="e.g., 90"
                  placeholderTextColor="#64748b"
                  style={{ width: 100, color: 'white', backgroundColor: '#111827', borderRadius: 10, padding: 10 }}
                />
                <TouchableOpacity onPress={() => removeStep(i)} style={{ marginLeft: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#7f1d1d', borderRadius: 10 }}>
                  <Text style={{ color: 'white', fontWeight: '800' }}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <HapticButton onPress={addStep} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: 'center' }}>
            <Text style={{ color: COLORS.text, fontWeight: '800' }}>+ Add Step</Text>
          </HapticButton>
        </View>
      </ScrollView>

      {/* Save bar */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: COLORS.bg, borderTopWidth: 1, borderColor: '#243042' }}>
        <TouchableOpacity
          onPress={saveAll}
          disabled={saving}
          style={{ backgroundColor: saving ? '#475569' : '#22c55e', paddingVertical: 14, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: saving ? 0.7 : 1 }}
        >
          {saving && <ActivityIndicator size="small" color="#fff" />}
          <Text style={{ color: '#fff', fontWeight: '800' }}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      {/* TikTok snap modal (same as Capture) */}
      <TikTokSnap
        url={snapUrl}
        visible={snapVisible}
        reloadKey={snapReloadKey}
        zoom={1.75}
        focusY={0.4}
        onCancel={() => setSnapVisible(false)}
        onFound={(uriOrUrl) => {
          setSnapVisible(false);
          if (uriOrUrl.startsWith('http')) {
            setImg({ kind: 'url-og', url: snapUrl, resolvedImageUrl: uriOrUrl });
          } else {
            setImg({ kind: 'picker', localUri: uriOrUrl }); // screenshot fallback becomes local file
          }
          lastResolvedUrlRef.current = snapUrl;
        }}
      />
    </KeyboardAvoidingView>
  );
}
