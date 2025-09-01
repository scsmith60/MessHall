// app/recipe/edit/[id].tsx
// Edit page. NEW: source_url awareness (imported lock) + save source_url.

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, Alert, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';

import { COLORS, RADIUS, SPACING } from '@/lib/theme';
import HapticButton from '@/components/ui/HapticButton';
import { supabase } from '@/lib/supabase';
import { dataAPI } from '@/lib/data';
import { tap, success, warn } from '@/lib/haptics';
import { uploadFromUri } from '@/lib/uploads';
import { normalizeIngredientLines } from '@/lib/ingredients';
import { tiktokOEmbedThumbnail, TikTokSnap, isTikTokUrl } from '@/lib/tiktok';
import { fetchMeta } from '@/lib/fetch_meta';

type StepRow = { text: string; seconds: number | null };
type ImageSourceState =
  | { kind: 'none' }
  | { kind: 'url-og'; url: string; resolvedImageUrl: string }
  | { kind: 'picker'; localUri: string }
  | { kind: 'camera'; localUri: string };

function extractFirstUrl(s: string): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

export default function EditRecipe() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // auth/ownership
  const [userId, setUserId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  // main fields
  const [title, setTitle] = useState('');
  const [currentImageUrl, setCurrentImageUrl] = useState<string>('');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);

  // privacy/monetization
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  const [monetizationEligible, setMonetizationEligible] = useState<boolean>(true);

  // NEW: import awareness
  const [sourceUrlDb, setSourceUrlDb] = useState<string | null>(null); // what DB already has
  const [pastedUrl, setPastedUrl] = useState('');                      // what user types now

  // image handling
  const [img, setImg] = useState<ImageSourceState>({ kind: 'none' });
  const [loadingImport, setLoadingImport] = useState(false);

  // tiktok snap
  const [snapVisible, setSnapVisible] = useState(false);
  const [snapUrl, setSnapUrl] = useState('');
  const [snapReloadKey, setSnapReloadKey] = useState(0);

  // misc
  const lastResolvedUrlRef = useRef<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // load existing recipe
  useEffect(() => {
    let off = false;
    (async () => {
      if (!id) return;
      try {
        const r: any = await dataAPI.getRecipeById(id);
        if (!r) { Alert.alert('Missing', 'Recipe not found.'); router.back(); return; }

        setTitle(r.title || '');
        setCurrentImageUrl(r.image_url || r.image || '');
        setIngredients(r.ingredients || []);
        setSteps(r.steps || []);

        const dbIsPrivate = Boolean(r.is_private);
        const dbMonet = r.monetization_eligible;
        setIsPrivate(dbIsPrivate);
        setMonetizationEligible(dbIsPrivate ? false : (typeof dbMonet === 'boolean' ? dbMonet : true));

        // NEW: read source_url (may be snake_case or camelCase from API)
        const link = (r.source_url ?? r.sourceUrl ?? '').trim();
        setSourceUrlDb(link || null);
        setPastedUrl(link); // prefill box

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

  const previewUri = useMemo(() => {
    switch (img.kind) {
      case 'url-og': return img.resolvedImageUrl;
      case 'picker':
      case 'camera': return img.localUri;
      default: return '';
    }
  }, [img]);

  const onPaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) return;
    setPastedUrl(text.trim());
  }, []);

  // import from pasted URL (fills fields + maybe image)
  const onImport = useCallback(async () => {
    const raw = (pastedUrl || '').trim();
    const url = extractFirstUrl(raw);
    if (!url) return Alert.alert('Paste a full link that starts with http(s)://');

    setLoadingImport(true);
    try {
      const meta = await fetchMeta(url);

      if (meta.title && !title.trim()) setTitle(meta.title);

      if (meta.ingredients?.length) {
        const parsed = normalizeIngredientLines(meta.ingredients);
        const canon = parsed.map(p => p.canonical).filter(Boolean);
        setIngredients(canon);
      }
      if (meta.steps?.length) {
        setSteps(meta.steps.map((t: any) => ({ text: String(t), seconds: null })));
      }

      Alert.alert('Import result', `Found ingredients: ${meta.ingredients?.length || 0}\nTitle: ${meta.title || '(none)'}`);

      let usedImage = false;
      if (meta.image) {
        setImg({ kind: 'url-og', url, resolvedImageUrl: meta.image });
        usedImage = true;
      }
      if (isTikTokUrl(url) && !usedImage) {
        try {
          const thumb = await withTimeout(tiktokOEmbedThumbnail(url), 1200).catch(() => null);
          if (thumb) {
            setImg({ kind: 'url-og', url, resolvedImageUrl: thumb });
            usedImage = true;
            lastResolvedUrlRef.current = url;
          }
        } catch {}
        if (!usedImage) {
          setImg({ kind: 'none' });
          setSnapUrl(url);
          setSnapReloadKey(k => k + 1);
          setSnapVisible(true);
        }
      }
    } catch (e: any) {
      Alert.alert('Import error', e?.message || 'Could not read that webpage.');
    } finally {
      setLoadingImport(false);
    }
  }, [pastedUrl, title]);

  // choose camera/gallery
  const chooseCameraOrGallery = useCallback(() => {
    Alert.alert('Add Photo', 'Where do you want to get the photo?', [
      {
        text: 'Camera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') return Alert.alert('Permission needed to use camera.');
          const r = await ImagePicker.launchCameraAsync({ quality: 0.92, allowsEditing: true, aspect: [4, 3] });
          if (r.canceled || !r.assets?.[0]?.uri) return;
          setPastedUrl('');
          setImg({ kind: 'camera', localUri: r.assets[0].uri });
        }
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') return Alert.alert('Permission needed to pick a photo.');
          const r = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.92,
            allowsEditing: true,
            aspect: [4, 3],
          });
          if (r.canceled || !r.assets?.[0]?.uri) return;
          setPastedUrl('');
          setImg({ kind: 'picker', localUri: r.assets[0].uri });
        }
      },
      { text: 'Cancel', style: 'cancel' },
    ], { cancelable: true });
  }, []);

  // tap right image to upload + set current
  const uploadPreviewAndSetImage = useCallback(async () => {
    if (!canEdit) { await warn(); Alert.alert('Only the owner can change the image.'); return; }
    if (!userId) { Alert.alert('Please sign in first.'); return; }

    const uri =
      img.kind === 'url-og' ? img.resolvedImageUrl :
      img.kind === 'picker' ? img.localUri :
      img.kind === 'camera' ? img.localUri : '';

    if (!uri) { Alert.alert('No new image yet.\nTip: Tap "Add/Choose Photo…" or Import.'); return; }

    const guessExt = () => (uri.match(/\.([a-zA-Z0-9]{3,4})(?:\?|$)/)?.[1] || 'jpg').toLowerCase();
    const ext = guessExt();

    const path = `${userId}/${id}/images/${Date.now()}.${ext}`;
    const storedImageUrl = await uploadFromUri({
      uri,
      storageBucket: 'recipe-images',
      path,
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
    });

    await dataAPI.updateRecipe(id!, { image_url: storedImageUrl });
    setCurrentImageUrl(storedImageUrl);
    setImg({ kind: 'none' });

    await success();
    Alert.alert('Updated', 'Recipe image updated!');
  }, [canEdit, userId, img, id]);

  // ingredient/step helpers
  const addIngredient = () => setIngredients(a => [...a, '']);
  const updateIngredient = (i: number, t: string) => setIngredients(a => a.map((v, idx) => idx === i ? t : v));
  const removeIngredient = (i: number) => setIngredients(a => a.filter((_, idx) => idx !== i));

  const addStep = () => setSteps(a => [...a, { text: '', seconds: null }]);
  const updateStepText = (i: number, t: string) => setSteps(a => a.map((v, idx) => idx === i ? { ...v, text: t } : v));
  const updateStepSeconds = (i: number, txt: string) => {
    const n = txt.replace(/[^\d]/g, '');
    const val = n === '' ? null : Math.min(24 * 60 * 60, parseInt(n, 10) || 0);
    setSteps(a => a.map((v, idx) => idx === i ? { ...v, seconds: val } : v));
  };
  const removeStep = (i: number) => setSteps(a => a.filter((_, idx) => idx !== i));

  // NEW: compute imported lock = any source_url present (DB or newly pasted)
  const importedLock = useMemo(() => {
    const current = (sourceUrlDb || '').trim();
    const pending = (pastedUrl || '').trim();
    return !!(current || pending);
  }, [sourceUrlDb, pastedUrl]);

  // what we actually show on the switch
  const monetizationEffective = (!isPrivate && !importedLock) ? monetizationEligible : false;

  // SAVE
  const saveAll = async () => {
    if (!canEdit) { await warn(); Alert.alert('Not allowed', 'Only the owner can edit this recipe.'); return; }

    const cleanTitle = title.trim();
    if (!cleanTitle) return Alert.alert('Please add a title');

    const parsed = normalizeIngredientLines(ingredients);
    const canon = parsed.map(p => p.canonical).filter(Boolean);
    const cleanSteps = steps
      .map(s => ({ text: s.text.trim(), seconds: s.seconds ?? null }))
      .filter(s => s.text.length > 0);

    // final monetization rules
    const monetizationFlag = (!isPrivate && !importedLock) ? monetizationEligible : false;

    // final source_url to send
    const finalSourceUrl = (pastedUrl && pastedUrl.trim() !== '') ? pastedUrl.trim() : (sourceUrlDb ?? null);

    setSaving(true);
    try {
      await tap();
      await dataAPI.updateRecipeFull({
        id: id!,
        title: cleanTitle,
        image_url: (currentImageUrl || '').trim() || null,
        ingredients: canon,
        steps: cleanSteps,
        is_private: isPrivate,
        monetization_eligible: monetizationFlag,
        source_url: finalSourceUrl,        // <-- IMPORTANT
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

  // guards
  if (loading) {
    return (
      <View style={{ flex:1, backgroundColor: COLORS.bg, alignItems:'center', justifyContent:'center' }}>
        <Text style={{ color: COLORS.text }}>Loading…</Text>
      </View>
    );
  }
  const canEditNow = !!userId && !!ownerId && userId === ownerId;
  if (!canEditNow) {
    return (
      <View style={{ flex:1, backgroundColor: COLORS.bg, alignItems:'center', justifyContent:'center', padding:24 }}>
        <Text style={{ color: COLORS.text, fontWeight: '800', textAlign:'center' }}>Only the owner can edit this recipe.</Text>
        <HapticButton onPress={() => router.back()} style={{ marginTop:16, backgroundColor: COLORS.card, padding:12, borderRadius: RADIUS.lg }}>
          <Text style={{ color: COLORS.accent, fontWeight:'800' }}>Go Back</Text>
        </HapticButton>
      </View>
    );
  }

  // UI
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 160 }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 16 }}>Edit Recipe</Text>

        <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="My Tasty Pizza"
          placeholderTextColor="#64748b"
          style={{ color:'white', backgroundColor:'#1e293b', borderRadius:12, padding:12, marginBottom:8 }}
        />

        {/* PRIVATE switch */}
        <View style={{ flexDirection:'row', alignItems:'center', marginBottom:4 }}>
          <Switch
            value={isPrivate}
            onValueChange={(v) => {
              setIsPrivate(v);
              if (v) setMonetizationEligible(false); // force OFF when private
            }}
            thumbColor={isPrivate ? '#22c55e' : '#e5e7eb'}
            trackColor={{ false: '#374151', true: '#14532d' }}
          />
          <Text style={{ color: COLORS.text, fontWeight:'700', marginLeft:8 }}>Private</Text>
        </View>
        <Text style={{ color:'#94a3b8', marginBottom:8, fontSize:12 }}>
          Private hides your recipe from the public feed and blocks creator earnings.
        </Text>

        {/* MONETIZATION switch — LOCKED if private OR imported */}
        <View style={{ flexDirection:'row', alignItems:'center', marginBottom:4 }}>
          <Switch
            value={monetizationEffective}
            disabled={isPrivate || importedLock}
            onValueChange={setMonetizationEligible}
            thumbColor={monetizationEffective ? '#22c55e' : '#e5e7eb'}
            trackColor={{ false: '#374151', true: '#14532d' }}
          />
          <Text style={{ color: COLORS.text, fontWeight:'700', marginLeft:8 }}>Monetization</Text>
        </View>
        <Text style={{ color:'#94a3b8', marginBottom:12, fontSize:12 }}>
          {isPrivate
            ? '🔒 Locked: recipe is Private.'
            : importedLock
              ? '🌐 Locked: recipe has a source link (Imported).'
              : 'When ON (default for public), the creator can earn on this recipe.'}
        </Text>

        {/* IMAGES — left current, right new (tap to use) */}
        <Text style={{ color: COLORS.text, marginBottom: 8 }}>Images</Text>
        <Text style={{ color:'#94a3b8', marginBottom: 10 }}>
          Left = current. Right = new. Tap the right picture to set it!
        </Text>

        <View style={{ flexDirection:'row', gap: 12, marginBottom: 12 }}>
          {/* left: current */}
          <View style={{ flex: 1, backgroundColor: '#0b1220', borderRadius: 12, borderWidth: 1, borderColor: '#243042', padding: 8 }}>
            <Text style={{ color:'#9CA3AF', marginBottom: 6, fontWeight:'700' }}>Current</Text>
            {currentImageUrl ? (
              <Image source={{ uri: currentImageUrl }} style={{ width:'100%', height:200, borderRadius:10 }} contentFit="cover" />
            ) : (
              <View style={{ height:200, borderRadius:10, backgroundColor:'#1F2937', borderWidth:1, borderColor:'#243042', alignItems:'center', justifyContent:'center' }}>
                <Text style={{ color:'#9CA3AF' }}>No image yet</Text>
              </View>
            )}
          </View>

          {/* right: new (tap to use) */}
          <TouchableOpacity
            onPress={uploadPreviewAndSetImage}
            activeOpacity={0.85}
            style={{ flex: 1, backgroundColor: '#0b1220', borderRadius: 12, borderWidth: 1, borderColor: '#243042', padding: 8 }}
          >
            <Text style={{ color:'#9CA3AF', marginBottom: 6, fontWeight:'700' }}>New (tap to use)</Text>
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={{ width:'100%', height:200, borderRadius:10 }} contentFit="cover" />
            ) : (
              <View style={{ height:200, borderRadius:10, backgroundColor:'#1F2937', borderWidth:1, borderColor:'#243042', alignItems:'center', justifyContent:'center', paddingHorizontal:8 }}>
                <Text style={{ color:'#9CA3AF', textAlign:'center' }}>No new image yet{'\n'}Tip: add/import first</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* add/choose photo */}
        <TouchableOpacity onPress={chooseCameraOrGallery} style={{ backgroundColor: COLORS.card, padding:12, borderRadius:12, alignItems:'center', marginBottom:12 }}>
          <Text style={{ color: COLORS.text, fontWeight:'800' }}>Add/Choose Photo…</Text>
        </TouchableOpacity>

        {/* import box (pre-filled if we know it) */}
        <View style={{ backgroundColor:'#111827', borderRadius:14, borderColor:'#243042', borderWidth:1, padding:12, marginBottom:12 }}>
          <Text style={{ color:'#9CA3AF', marginBottom:6 }}>Re-import from link (pre-filled if we know it)</Text>
          <View style={{ flexDirection:'row', alignItems:'center' }}>
            <TextInput
              value={pastedUrl}
              onChangeText={setPastedUrl}
              placeholder="https://www.tiktok.com/@user/video/…"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex:1, color:'#E5E7EB', backgroundColor:'#1F2937', paddingHorizontal:12, paddingVertical:10, borderRadius:10, marginRight:8 }}
            />
            <TouchableOpacity onPress={onPaste} style={{ backgroundColor:'#1F2937', paddingHorizontal:14, paddingVertical:10, borderRadius:10, marginRight:8 }}>
              <Text style={{ color:'#E5E7EB', fontWeight:'600' }}>Paste</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onImport} disabled={loadingImport} style={{ backgroundColor:'#60A5FA', paddingHorizontal:14, paddingVertical:10, borderRadius:10, opacity: loadingImport ? 0.6 : 1 }}>
              <Text style={{ color:'#0B1120', fontWeight:'700' }}>{loadingImport ? 'Importing…' : 'Import'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ingredients */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Ingredients</Text>
          {ingredients.map((ing, i) => (
            <View key={i} style={{ flexDirection:'row', alignItems:'center', marginBottom:8 }}>
              <TextInput
                value={ing}
                onChangeText={(t)=>updateIngredient(i,t)}
                placeholder={`Ingredient ${i + 1}`}
                placeholderTextColor="#64748b"
                style={{ flex:1, color:'white', backgroundColor:'#1e293b', borderRadius:10, padding:10 }}
              />
              <TouchableOpacity onPress={()=>removeIngredient(i)} style={{ marginLeft:8, paddingVertical:10, paddingHorizontal:12, backgroundColor:'#7f1d1d', borderRadius:10 }}>
                <Text style={{ color:'white', fontWeight:'800' }}>X</Text>
              </TouchableOpacity>
            </View>
          ))}
          <HapticButton onPress={addIngredient} style={{ marginTop:6, backgroundColor: COLORS.card, paddingVertical:12, borderRadius: RADIUS.lg, alignItems:'center' }}>
            <Text style={{ color: COLORS.text, fontWeight:'800' }}>+ Add Ingredient</Text>
          </HapticButton>
        </View>

        {/* steps */}
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Steps</Text>
          {steps.map((st, i) => (
            <View key={i} style={{ marginBottom: 10 }}>
              <TextInput
                value={st.text}
                onChangeText={(t)=>updateStepText(i,t)}
                placeholder="Mix everything…"
                placeholderTextColor="#64748b"
                multiline
                style={{ color:'white', backgroundColor:'#1e293b', borderRadius:10, padding:10, minHeight:60 }}
              />
              <View style={{ flexDirection:'row', alignItems:'center', marginTop:8 }}>
                <Text style={{ color:'#94a3b8', marginRight:8 }}>Seconds (optional)</Text>
                <TextInput
                  value={st.seconds === null ? '' : String(st.seconds)}
                  onChangeText={(t)=>updateStepSeconds(i,t)}
                  keyboardType="number-pad"
                  placeholder="e.g., 90"
                  placeholderTextColor="#64748b"
                  style={{ width:100, color:'white', backgroundColor:'#111827', borderRadius:10, padding:10 }}
                />
                <TouchableOpacity onPress={()=>removeStep(i)} style={{ marginLeft:10, paddingVertical:10, paddingHorizontal:12, backgroundColor:'#7f1d1d', borderRadius:10 }}>
                  <Text style={{ color:'white', fontWeight:'800' }}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <HapticButton onPress={addStep} style={{ marginTop:6, backgroundColor: COLORS.card, paddingVertical:12, borderRadius: RADIUS.lg, alignItems:'center' }}>
            <Text style={{ color: COLORS.text, fontWeight:'800' }}>+ Add Step</Text>
          </HapticButton>
        </View>
      </ScrollView>

      {/* sticky SAVE bar */}
      <View pointerEvents="box-none" style={{ position:'absolute', left:0, right:0, bottom:0, padding:12, backgroundColor: COLORS.bg, borderTopWidth:1, borderColor:'#243042' }}>
        <TouchableOpacity
          onPress={saveAll}
          disabled={saving}
          style={{ backgroundColor: saving ? '#475569' : '#22c55e', paddingVertical:14, borderRadius:12, alignItems:'center', flexDirection:'row', justifyContent:'center', opacity:saving?0.7:1 }}
        >
          {saving && <ActivityIndicator size="small" color="#fff" />}
          <Text style={{ color:'#fff', fontWeight:'800' }}>{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      {/* TikTok Snap helper */}
      <TikTokSnap
        url={snapUrl}
        visible={snapVisible}
        reloadKey={snapReloadKey}
        zoom={1.75}
        focusY={0.4}
        onCancel={() => setSnapVisible(false)}
        onFound={(uriOrUrl) => {
          setSnapVisible(false);
          if (uriOrUrl.startsWith('http')) setImg({ kind: 'url-og', url: snapUrl, resolvedImageUrl: uriOrUrl });
          else setImg({ kind: 'picker', localUri: uriOrUrl });
          lastResolvedUrlRef.current = snapUrl;
        }}
      />
    </KeyboardAvoidingView>
  );
}
