// app/recipe/edit/[id].tsx
// LIKE I'M 5:
// - This is the "Edit Recipe" screen.
// - We added ONE new thing: a tiny, sleek "Delete Recipe" pill that ONLY the creator can see.
// - Tap it → we ask "Are you sure?" → delete safely → go home.
// - Nothing else was changed.

// (original imports)
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, Alert, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';

// 👇 Safe Area imports (already in your file)
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, RADIUS, SPACING } from '@/lib/theme';
import HapticButton from '@/components/ui/HapticButton';
import { supabase } from '@/lib/supabase';
import { dataAPI } from '@/lib/data';
import { tap, success, warn } from '@/lib/haptics';
import { uploadFromUri } from '@/lib/uploads';
import { normalizeIngredientLines } from '@/lib/ingredients';
import { tiktokOEmbedThumbnail, TikTokSnap, isTikTokUrl } from '@/lib/tiktok';
import { fetchMeta } from '@/lib/fetch_meta';

// 🆕 small trash icon for the delete pill (purely visual)
import { Ionicons } from '@expo/vector-icons';

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

  // Safe Area
  const insets = useSafeAreaInsets();

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

  // import awareness
  const [sourceUrlDb, setSourceUrlDb] = useState<string | null>(null);
  const [pastedUrl, setPastedUrl] = useState('');

  // image handling
  const [img, setImg] = useState<ImageSourceState>({ kind: 'none' });
  const [loadingImport, setLoadingImport] = useState(false);

  // creator header bits
  const [creatorUsername, setCreatorUsername] = useState<string>('someone');
  const [creatorAvatar, setCreatorAvatar] = useState<string | null>(null);

  // misc
  const lastResolvedUrlRef = useRef<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 🆕 deleting busy flag (only for the new delete button)
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // load existing recipe
  useEffect(() => {
    let off = false;
    (async () => {
      if (!id) return;
      try {
        const r: any = await dataAPI.getRecipeById(id); // now returns creatorAvatar too
        if (!r) { Alert.alert('Missing', 'Recipe not found.'); router.back(); return; }

        setTitle(r.title || '');
        setCurrentImageUrl(r.image_url || r.image || '');
        setIngredients(r.ingredients || []);
        setSteps(r.steps || []);

        setCreatorUsername(r.creator || 'someone');
        setCreatorAvatar(r.creatorAvatar ?? null);

        const dbIsPrivate = Boolean(r.is_private);
        const dbMonet = r.monetization_eligible;
        setIsPrivate(dbIsPrivate);
        setMonetizationEligible(dbIsPrivate ? false : (typeof dbMonet === 'boolean' ? dbMonet : true));

        const link = (r.sourceUrl ?? '').trim();
        setSourceUrlDb(link || null);
        setPastedUrl(link);

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

  const onImport = useCallback(async () => {
    const raw = (pastedUrl || '').trim();
    const url = extractFirstUrl(raw);
    if (!url) return Alert.alert('Paste a full link that starts with http(s)://');

    setLoadingImport(true);
    try {
      const meta = await fetchMeta(url);

      if (meta.title && !title.trim()) setTitle(meta.title);
      if (meta.ingredients?.length) {
        const lines = meta.ingredients as string[];
        setIngredients(lines);
      }
      if (meta.steps?.length) {
        setSteps((meta.steps as string[]).map(t => ({ text: String(t), seconds: null })));
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
        }
      }
    } catch (e: any) {
      Alert.alert('Import error', e?.message || 'Could not read that webpage.');
    } finally {
      setLoadingImport(false);
    }
  }, [pastedUrl, title]);

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

  const monetizationEffective = (!isPrivate && !(sourceUrlDb || pastedUrl)) ? monetizationEligible : false;

  const saveAll = async () => {
    if (!canEdit) { await warn(); Alert.alert('Not allowed', 'Only the owner can edit this recipe.'); return; }

    const cleanTitle = title.trim();
    if (!cleanTitle) return Alert.alert('Please add a title');

    const cleanSteps = steps
      .map(s => ({ text: s.text.trim(), seconds: s.seconds ?? null }))
      .filter(s => s.text.length > 0);

    const monetizationFlag = (!isPrivate && !(sourceUrlDb || pastedUrl)) ? monetizationEligible : false;
    const finalSourceUrl = (pastedUrl && pastedUrl.trim() !== '') ? pastedUrl.trim() : (sourceUrlDb ?? null);

    setSaving(true);
    try {
      await tap();
      await dataAPI.updateRecipeFull({
        id: id!,
        title: cleanTitle,
        image_url: (currentImageUrl || '').trim() || null,
        ingredients,
        steps: cleanSteps,
        is_private: isPrivate,
        monetization_eligible: monetizationFlag,
        source_url: finalSourceUrl,
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

  // 🆕 DELETE — ONLY change added
  // like I'm 5:
  // - we show a tiny delete pill ONLY if you're the owner.
  // - we ask "are you sure?", then delete your recipe (and optionally its children if you un-comment).
  // - we also match by user_id so nobody else can delete via API.
  const canEditNow = !!userId && !!ownerId && userId === ownerId;

  const reallyDelete = useCallback(async () => {
    if (!canEditNow || !id || !userId) return;
    try {
      setDeleting(true);

      // If you do NOT have ON DELETE CASCADE for children, un-comment these two lines:
      // await supabase.from('recipe_ingredients').delete().eq('recipe_id', id);
      // await supabase.from('recipe_steps').delete().eq('recipe_id', id);

      const { error } = await supabase
        .from('recipes')
        .delete()
        .match({ id, user_id: userId });

      if (error) {
        Alert.alert('Delete failed', error.message);
        setDeleting(false);
        return;
      }
      router.replace('/'); // send them home (change if you prefer another screen)
    } catch (err: any) {
      Alert.alert('Delete failed', err?.message ?? 'Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [canEditNow, id, userId]);

  const askDelete = useCallback(() => {
    Alert.alert(
      'Delete recipe?',
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: reallyDelete },
      ],
      { cancelable: true }
    );
  }, [reallyDelete]);

  // 🧽 Loading + Not-allowed (unchanged)
  if (loading) {
    return (
      <SafeAreaView style={{ flex:1, backgroundColor: COLORS.bg }} edges={['top','left','right']}>
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <Text style={{ color: COLORS.text }}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!canEditNow) {
    return (
      <SafeAreaView style={{ flex:1, backgroundColor: COLORS.bg }} edges={['top','left','right']}>
        <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding:24 }}>
          <Text style={{ color: COLORS.text, fontWeight: '800', textAlign:'center' }}>Only the owner can edit this recipe.</Text>
          <HapticButton onPress={() => router.back()} style={{ marginTop:16, backgroundColor: COLORS.card, padding:12, borderRadius: RADIUS.lg }}>
            <Text style={{ color: COLORS.accent, fontWeight:'800' }}>Go Back</Text>
          </HapticButton>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top','left','right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 160 + Math.max(0, insets.bottom) }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 }}>Edit Recipe</Text>

          {/* creator header (unchanged) */}
          <View style={{ flexDirection:'row', alignItems:'center', marginBottom: 14 }}>
            <TouchableOpacity onPress={() => router.push(`/u/${creatorUsername}`)} activeOpacity={0.7}>
              {creatorAvatar ? (
                <Image source={{ uri: creatorAvatar }} style={{ width:28, height:28, borderRadius:14, marginRight:8 }} />
              ) : (
                <View style={{ width:28, height:28, borderRadius:14, marginRight:8, backgroundColor:'#111827', alignItems:'center', justifyContent:'center' }}>
                  <Text style={{ color:'#e5e7eb', fontSize:12, fontWeight:'800' }}>{(creatorUsername||'U')[0]?.toUpperCase()}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push(`/u/${creatorUsername}`)} activeOpacity={0.7}>
              <Text style={{ color: COLORS.text, fontWeight:'800' }}>{creatorUsername}</Text>
            </TouchableOpacity>
          </View>

          {/* Title (unchanged) */}
          <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="My Tasty Pizza"
            placeholderTextColor="#64748b"
            style={{ color:'white', backgroundColor:'#1e293b', borderRadius:12, padding:12, marginBottom:8 }}
          />

          {/* Private + Monetization (unchanged) */}
          <View style={{ flexDirection:'row', alignItems:'center', marginBottom:4 }}>
            <Switch
              value={isPrivate}
              onValueChange={(v) => {
                setIsPrivate(v);
                if (v) setMonetizationEligible(false);
              }}
              thumbColor={isPrivate ? '#22c55e' : '#e5e7eb'}
              trackColor={{ false: '#374151', true: '#14532d' }}
            />
            <Text style={{ color: COLORS.text, fontWeight:'700', marginLeft:8 }}>Private</Text>
          </View>
          <Text style={{ color:'#94a3b8', marginBottom:8, fontSize:12 }}>
            Private hides your recipe from the public feed and blocks creator earnings.
          </Text>

          <View style={{ flexDirection:'row', alignItems:'center', marginBottom:4 }}>
            <Switch
              value={(!isPrivate && !(sourceUrlDb || pastedUrl)) ? monetizationEligible : false}
              disabled={isPrivate || !!(sourceUrlDb || pastedUrl)}
              onValueChange={setMonetizationEligible}
              thumbColor={(!isPrivate && !(sourceUrlDb || pastedUrl)) ? '#22c55e' : '#e5e7eb'}
              trackColor={{ false: '#374151', true: '#14532d' }}
            />
            <Text style={{ color: COLORS.text, fontWeight:'700', marginLeft:8 }}>Monetization</Text>
          </View>
          <Text style={{ color:'#94a3b8', marginBottom:12, fontSize:12 }}>
            {isPrivate
              ? '🔒 Locked: recipe is Private.'
              : (sourceUrlDb || pastedUrl)
                ? '🌐 Locked: recipe has a source link (Imported).'
                : 'When ON (default for public), the creator can earn on this recipe.'}
          </Text>

          {/* Images (unchanged) */}
          <Text style={{ color: COLORS.text, marginBottom: 8 }}>Images</Text>
          <Text style={{ color:'#94a3b8', marginBottom: 10 }}>
            Left = current. Right = new. Tap the right picture to set it!
          </Text>

          <View style={{ flexDirection:'row', gap: 12, marginBottom: 12 }}>
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

          <TouchableOpacity onPress={chooseCameraOrGallery} style={{ backgroundColor: COLORS.card, padding:12, borderRadius:12, alignItems:'center', marginBottom:12 }}>
            <Text style={{ color: COLORS.text, fontWeight:'800' }}>Add/Choose Photo…</Text>
          </TouchableOpacity>

          {/* Import (unchanged) */}
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

          {/* Ingredients (unchanged) */}
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Ingredients</Text>
            {ingredients.map((ing, i) => (
              <View key={i} style={{ flexDirection:'row', alignItems:'center', marginBottom:8 }}>
                <TextInput
                  value={ing}
                  onChangeText={(t)=>setIngredients(a => a.map((v, idx) => idx === i ? t : v))}
                  placeholder={`Ingredient ${i + 1}`}
                  placeholderTextColor="#64748b"
                  style={{ flex:1, color:'white', backgroundColor:'#1e293b', borderRadius:10, padding:10 }}
                />
                <TouchableOpacity onPress={()=>setIngredients(a => a.filter((_, idx) => idx !== i))} style={{ marginLeft:8, paddingVertical:10, paddingHorizontal:12, backgroundColor:'#7f1d1d', borderRadius:10 }}>
                  <Text style={{ color:'white', fontWeight:'800' }}>X</Text>
                </TouchableOpacity>
              </View>
            ))}
            <HapticButton onPress={()=>setIngredients(a => [...a, ''])} style={{ marginTop:6, backgroundColor: COLORS.card, paddingVertical:12, borderRadius: RADIUS.lg, alignItems:'center' }}>
              <Text style={{ color: COLORS.text, fontWeight:'800' }}>+ Add Ingredient</Text>
            </HapticButton>
          </View>

          {/* Steps (unchanged) */}
          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Steps</Text>
            {steps.map((st, i) => (
              <View key={i} style={{ marginBottom: 10 }}>
                <TextInput
                  value={st.text}
                  onChangeText={(t)=>setSteps(a => a.map((v, idx) => idx === i ? { ...v, text: t } : v))}
                  placeholder="Mix everything…"
                  placeholderTextColor="#64748b"
                  multiline
                  style={{ color:'white', backgroundColor:'#1e293b', borderRadius:10, padding:10, minHeight:60 }}
                />
                <View style={{ flexDirection:'row', alignItems:'center', marginTop:8 }}>
                  <Text style={{ color:'#94a3b8', marginRight:8 }}>Seconds (optional)</Text>
                  <TextInput
                    value={st.seconds === null ? '' : String(st.seconds)}
                    onChangeText={(txt)=>{
                      const n = txt.replace(/[^\d]/g, '');
                      const val = n === '' ? null : Math.min(24 * 60 * 60, parseInt(n, 10) || 0);
                      setSteps(a => a.map((v, idx) => idx === i ? { ...v, seconds: val } : v));
                    }}
                    keyboardType="number-pad"
                    placeholder="e.g., 90"
                    placeholderTextColor="#64748b"
                    style={{ color:'white', backgroundColor:'#1e293b', borderRadius:10, padding:10, width:100 }}
                  />
                </View>
              </View>
            ))}
            <HapticButton onPress={()=>setSteps(a => [...a, { text: '', seconds: null }])} style={{ marginTop:6, backgroundColor: COLORS.card, paddingVertical:12, borderRadius: RADIUS.lg, alignItems:'center' }}>
              <Text style={{ color: COLORS.text, fontWeight:'800' }}>+ Add Step</Text>
            </HapticButton>
          </View>

          {/* Save (unchanged) */}
          <HapticButton onPress={saveAll} disabled={saving} style={{ backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: RADIUS.xl, alignItems:'center' }}>
            <Text style={{ color:'#001018', fontWeight:'900' }}>{saving ? 'Saving…' : 'Save Changes'}</Text>
          </HapticButton>

          {/* 🆕 OWNER-ONLY DELETE — the only new UI */}
          {canEditNow && (
            <HapticButton
              onPress={askDelete}
              disabled={deleting}
              style={{
                marginTop: 12,
                borderWidth: 1,
                borderColor: '#7f1d1d',                 // deep, subtle red
                backgroundColor: 'rgba(127,29,29,0.12)', // faint wash (on-brand dark)
                paddingVertical: 12,
                borderRadius: RADIUS.lg,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Ionicons name="trash-outline" size={16} color="#fca5a5" />
              <Text style={{ color: '#fca5a5', fontWeight: '800' }}>
                {deleting ? 'Deleting…' : 'Delete Recipe'}
              </Text>
            </HapticButton>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
