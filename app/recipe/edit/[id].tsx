// app/recipe/edit/[id].tsx
//
// LIKE I'M 5 — what this screen does
// • You edit a recipe.
// • Import tries to get a pretty picture (OG/Twitter → TikTok oEmbed → WebView snapshot).
// • We zoom, hide popups/sidebars, center on the food, and snap a photo.
// • AUTOSAVE: Any change you make is saved after you pause for a moment.
// • When you tap the right image to "use it", we show a themed toast
//   that says "New Target Aquired".
//
// ✅ Change in this version:
//   - The autosave pill and the toast are now FLOATING OVERLAYS (absolute position).
//     They fade in/out and no longer reserve blank space, so no jump + no ugly gap.

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, Alert, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ThemedNotice from '@/components/ui/ThemedNotice';
import { Ionicons } from '@expo/vector-icons';

// Hidden WebView + snapshot tool
import { WebView } from 'react-native-webview';
import { captureRef } from 'react-native-view-shot';

import { COLORS, RADIUS, SPACING } from '@/lib/theme';
import HapticButton from '@/components/ui/HapticButton';
import { supabase } from '@/lib/supabase';
import { dataAPI } from '@/lib/data';
import { success, warn } from '@/lib/haptics';
import { uploadFromUri } from '@/lib/uploads';
import { fetchMeta } from '@/lib/fetch_meta';
import * as tiktok from '@/lib/tiktok';

// ---------- tiny types ----------
type StepRow = { text: string; seconds: number | null };

// We reuse "picker" for any local image (gallery/camera/snapshot)
type ImageSourceState =
  | { kind: 'none' }
  | { kind: 'url-og'; url: string; resolvedImageUrl: string }
  | { kind: 'picker'; localUri: string }
  | { kind: 'camera'; localUri: string };

// ============================================================================
// AUTOSAVE knobs + state helpers
// ----------------------------------------------------------------------------
const AUTOSAVE_DELAY_MS = 1200; // wait 1.2s after the last change before saving

// ============================================================================
// SNAPSHOT BEHAVIOR knobs
// ----------------------------------------------------------------------------
const ZOOM_FACTOR = 1.1; // how close we zoom the page
const SHIFT_X_PCT = 0.12; // nudge RIGHT by 12% of viewport width
const SHIFT_Y_PCT = 0.55; // nudge DOWN by 28% of viewport height
const SNAP_W = 360;       // snapshot frame width
const SNAP_H = 640;       // snapshot frame height
const CROP_LEFT_PX = 150; // trim stubborn left toolbar
const CROP_TOP_PX  = 30;  // trim a bit of the top

// ============================================================================
// helpers
// ----------------------------------------------------------------------------
function extractFirstUrl(s: string): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

function normalizeImportInput(raw: string): { url: string | null; tiktokId?: string } {
  const s = (raw || '').trim();
  const u = extractFirstUrl(s);
  if (u) return { url: u };
  const idMatch =
    s.match(/(?:^|[?&]_?item?_?id=)(\d{8,22})/i) ||
    s.match(/(?:^|^_?id=)(\d{8,22})/i) ||
    s.match(/\b(\d{8,22})\b/);
  if (idMatch) {
    const id = idMatch[1];
    return { url: `https://www.tiktok.com/embed/v2/${id}`, tiktokId: id };
  }
  return { url: null };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// (kept helper; fine to keep around)
function InlineToast({
  type, message, onClose,
}: { type: 'error' | 'success' | 'info'; message: string; onClose: () => void }) {
  const stylesByType = {
    error:   { bg: '#2a0f13', border: '#7f1d1d', text: '#fecaca', icon: 'alert-circle-outline' as const },
    success: { bg: '#0f2a1a', border: '#14532d', text: '#bbf7d0', icon: 'checkmark-circle-outline' as const },
    info:    { bg: '#0b1220', border: '#243042', text: '#e5e7eb', icon: 'information-circle-outline' as const },
  }[type];

  return (
    <View style={{
      backgroundColor: stylesByType.bg, borderColor: stylesByType.border, borderWidth: 1,
      padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center',
    }}>
      <Ionicons name={stylesByType.icon} size={18} color={stylesByType.text} style={{ marginRight: 8 }} />
      <Text style={{ color: stylesByType.text, flex: 1 }}>{message}</Text>
      <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color={stylesByType.text} />
      </TouchableOpacity>
    </View>
  );
}

// ---------- safe TikTok helpers (don’t blow up if missing) ----------
const safeIsTikTokUrl = (url: string) => {
  const fn = (tiktok as any)?.isTikTokUrl;
  if (typeof fn === 'function') return fn(url);
  return /(https?:\/\/)?((www|m)\.)?tiktok\.com\/|vt\.tiktok\.com\/|tiktok\.com\/embed\/v2\//i.test(url);
};
const safeTikTokOEmbedThumbnail = async (url: string): Promise<string | null> => {
  const fn = (tiktok as any)?.tiktokOEmbedThumbnail;
  if (typeof fn === 'function') {
    try { return await fn(url); } catch { return null; }
  }
  return null;
};

// ============================================================================
// WebView scripts for cleaning/focusing before snapshot
// ----------------------------------------------------------------------------
const PREP_JS = `
(function(){
  try {
    const kill = el => { if(!el) return; el.style.setProperty('display','none','important'); el.remove && el.remove(); };
    document.querySelectorAll('[role="dialog"],[aria-modal="true"],nav,[role="navigation"],aside,.sidebar,[class*="sidebar"],[class*="SideBar"],[class*="rail"]').forEach(kill);
    ['#tiktok-portal-container','#login-modal','#modal_mount_node','#app-modal',
     '.tiktok-dialog','.tiktok-cookie-banner','.tiktok-webapp-mask','.cookie-banner']
      .forEach(sel => document.querySelectorAll(sel).forEach(kill));
    Array.from(document.querySelectorAll('body *')).forEach(el=>{
      const st = window.getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'sticky' && st.position !== 'absolute') return;
      const r = el.getBoundingClientRect();
      const nearEdge = (r.left < 120) || (r.right > (window.innerWidth - 120));
      const narrow   = r.width < 260;
      const bigMask  = (r.width > 200 && r.height > 120);
      if (nearEdge || narrow || bigMask) kill(el);
    });
    document.querySelectorAll('video').forEach(v=>{ try{ v.pause(); v.muted = true; }catch(e){} });
    const style = document.createElement('style');
    style.innerHTML='*{animation:none!important;transition:none!important} html,body{overflow-x:hidden!important;background:#000!important;margin:0!important;padding:0!important;}';
    document.head.appendChild(style);
    var factor=${ZOOM_FACTOR};
    var vp=document.querySelector('meta[name=viewport]'); if(!vp){ vp=document.createElement('meta'); vp.name='viewport'; document.head.appendChild(vp); }
    vp.setAttribute('content','width=device-width, initial-scale='+factor+', maximum-scale='+factor+', user-scalable=0');
    document.documentElement.style.zoom=factor; document.body.style.zoom=factor;
  } catch(e) {}
  true;
})();
`;

const FOCUS_SCROLL_JS = `
(function(){
  try {
    const nodes = Array.from(document.querySelectorAll('main video, video, picture img, img')).filter(el=>{
      const r = el.getBoundingClientRect(); const w=r.width, h=r.height, ar=w/Math.max(1,h);
      return w>=200 && h>=160 && ar>0.6 && ar<1.9;
    });
    let best=null, area=0;
    nodes.forEach(el=>{ const r=el.getBoundingClientRect(); const a=Math.max(1,r.width)*Math.max(1,r.height); if(a>area){ best=el; area=a; }});
    let x=0,y=0;
    if(best){
      const r=best.getBoundingClientRect(); const cx=r.left+r.width/2+window.scrollX; const cy=r.top+r.height/2+window.scrollY;
      x=Math.max(0, cx-window.innerWidth/2 + window.innerWidth*${SHIFT_X_PCT});
      y=Math.max(0, cy-window.innerHeight/2 + window.innerHeight*${SHIFT_Y_PCT});
    } else {
      const h=Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const w=Math.max(document.documentElement.scrollWidth,  document.body.scrollWidth);
      x=Mathax(0, (w-window.innerWidth)/2 + window.innerWidth*${SHIFT_X_PCT});
      y=Mathax(0, (h-window.innerHeight)/2 + window.innerHeight*${SHIFT_Y_PCT});
    }
    window.scrollTo({left:x, top:y, behavior:'instant'});
    setTimeout(function(){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'focused', ok:true})); },140);
  } catch(e) {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type:'focused', ok:false}));
  }
})();
`;

// Desktop UA → fewer mobile popups
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ============================================================================

export default function EditRecipe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  // who owns it
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

  // import area
  const [sourceUrlDb, setSourceUrlDb] = useState<string | null>(null);
  const [pastedUrl, setPastedUrl] = useState('');
  const [loadingImport, setLoadingImport] = useState(false);

  // image handling
  const [img, setImg] = useState<ImageSourceState>({ kind: 'none' });

  // creator header bits
  const [creatorUsername, setCreatorUsername] = useState<string>('someone');
  const [creatorAvatar, setCreatorAvatar] = useState<string | null>(null);

  // misc
  const lastResolvedUrlRef = useRef<string>('');
  const [loading, setLoading] = useState(true);

  // toast state
  const [toast, setToast] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null);
  const showToast = (type: 'error' | 'success' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4200);
  };

  // themed notice (modal) for errors/validation
  const [notice, setNotice] = useState<{ visible: boolean; title: string; message: string }>({ visible: false, title: '', message: '' });

  // 🔎 hidden WebView snapshot state/refs
  const [webSnapUrl, setWebSnapUrl] = useState<string | null>(null);
  const [webSnapInProgress, setWebSnapInProgress] = useState(false);
  const snapContainerRef = useRef<any>(null);
  const webViewRef = useRef<WebView>(null);

  // ===================== AUTOSAVE state =====================
  const [saveStatus, setSaveStatus] =
    useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const autosaveTimer = useRef<NodeJS.Timeout | null>(null);
  const hydratedRef = useRef(false);
  const savingRef = useRef(false);

  // auth
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
        if (!r) {
          setNotice({ visible: true, title: 'Mission Aborted', message: 'Recipe not found.' });
          router.back();
          return;
        }

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

        // Prefill from `source_url` (fallback to `sourceUrl`)
        const link = ((r.source_url ?? r.sourceUrl) ?? '').trim();
        setSourceUrlDb(link || null);
        setPastedUrl(link);

        const owner = await dataAPI.getRecipeOwnerId(id);
        if (!off) setOwnerId(owner);
      } catch (e: any) {
        setNotice({ visible: true, title: 'Mission Aborted', message: e?.message ?? 'Failed to load recipe.' });
      } finally {
        if (!off) {
          setLoading(false);
          hydratedRef.current = true;
        }
      }
    })();
    return () => { off = true; };
  }, [id]);

  const canEditNow = !!userId && !!ownerId && userId === ownerId;

  // preview for the right tile
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

  // =========================================================
  // AUTOSAVE ENGINE (debounced)
  // =========================================================
  const queueAutosave = useCallback(() => {
    if (!hydratedRef.current || !canEditNow) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaveStatus('saving');
      setSaveError(null);
      try {
        const cleanTitle = title.trim();
        if (!cleanTitle) throw new Error('Please add a title');

        const cleanSteps = steps
          .map((s) => ({ text: s.text.trim(), seconds: s.seconds ?? null }))
          .filter((s) => s.text.length > 0);

        const monetizationFlag =
          (!isPrivate && !(sourceUrlDb || pastedUrl)) ? monetizationEligible : false;

        const finalSourceUrl =
          pastedUrl && pastedUrl.trim() !== '' ? pastedUrl.trim() : sourceUrlDb ?? null;

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

        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 1600);
      } catch (e: any) {
        setSaveStatus('error');
        setSaveError(e?.message ?? 'Autosave failed');
      } finally {
        savingRef.current = false;
      }
    }, AUTOSAVE_DELAY_MS);
  }, [
    canEditNow,
    title, currentImageUrl, ingredients, steps,
    isPrivate, monetizationEligible, sourceUrlDb, pastedUrl, id,
  ]);

  useEffect(() => { queueAutosave(); }, [queueAutosave]);

  // ========================================================================
  // IMPORT (OG/Twitter → TikTok → WebView snapshot)
  // ========================================================================
  const onImport = useCallback(async () => {
    // Use what you typed; if blank, use what we already know from the DB
    const raw = (pastedUrl || sourceUrlDb || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
    const norm = normalizeImportInput(raw);
    const url = norm.url;
    if (!url) {
      showToast('info', 'Please paste a full link or a TikTok ID.');
      return;
    }

    setLoadingImport(true);
    try {
  const meta: any = await fetchMeta(url);
  // Debug: log fetched meta so we can confirm title extraction in the app runtime
  console.log('[IMPORT] fetchMeta result for', url, meta);

      if (meta.title) setTitle(meta.title);
      if (meta.ingredients?.length) setIngredients(meta.ingredients as string[]);
      if (meta.steps?.length) setSteps((meta.steps as string[]).map((t: any) => ({ text: String(t), seconds: null })));

      // If the static extraction indicates a client-render is required, open the hidden WebView
      if (meta.needsClientRender) {
        console.log('[IMPORT] meta indicates client render needed, opening WebView for', url);
        setWebSnapInProgress(true);
        setWebSnapUrl(url);
      }

      // 1) OG/Twitter image
      let usedImage = false;
      const candidate: string | null =
        meta.image || meta.ogImage || meta['og:image'] || meta.twitterImage || null;

      if (candidate) {
        setImg({ kind: 'url-og', url, resolvedImageUrl: candidate });
        usedImage = true;
      }

      // 2) TikTok oEmbed thumbnail
      if (!usedImage && (safeIsTikTokUrl(url) || norm.tiktokId)) {
        const oembedTarget = norm.tiktokId
          ? `https://www.tiktok.com/@placeholder/video/${norm.tiktokId}`
          : url;
        const thumb = await withTimeout(safeTikTokOEmbedThumbnail(oembedTarget), 5000).catch(() => null);
        if (thumb) {
          setImg({ kind: 'url-og', url, resolvedImageUrl: thumb });
          lastResolvedUrlRef.current = url;
          usedImage = true;
        }
      }

      // 3) LAST RESORT — WebView snapshot
      if (!usedImage) {
        showToast('info', 'No image found — trying a quick page snapshot…');
        setWebSnapInProgress(true);
        setWebSnapUrl(url);
      } else {
        const foundIng = meta.ingredients?.length || 0;
        showToast('success', `Imported! Image set. Found ${foundIng} ingredient${foundIng === 1 ? '' : 's'}.`);
      }
    } catch (e: any) {
      showToast('error', e?.message || 'Could not read that page/ID.');
    } finally {
      setLoadingImport(false);
    }
  }, [pastedUrl, sourceUrlDb]);

  const onWebSnapLoadEnd = useCallback(async () => {
    if (!webSnapInProgress || !snapContainerRef.current) return;
    try {
      webViewRef.current?.injectJavaScript(PREP_JS);
      setTimeout(() => { webViewRef.current?.injectJavaScript(FOCUS_SCROLL_JS); }, 250);
    } catch {
      setTimeout(async () => {
        try {
          const uri = await captureRef(snapContainerRef, { format: 'jpg', quality: 0.9, result: 'tmpfile' });
          if (uri) {
            setImg({ kind: 'picker', localUri: String(uri) });
            showToast('success', 'Imported! Snapshot image set.');
          } else {
            showToast('info', 'Imported text, but no image was found.');
          }
        } finally {
          setWebSnapInProgress(false);
          setWebSnapUrl(null);
        }
      }, 800);
    }
  }, [webSnapInProgress]);

  const onWebMessage = useCallback(async (ev: any) => {
    const data = String(ev?.nativeEvent?.data || '');
    if (!data) return;
    let msg: any = null;
    try { msg = JSON.parse(data); } catch {}

    if (msg?.type === 'focused') {
      try {
        await new Promise((r) => setTimeout(r, 220));
        const uri = await captureRef(snapContainerRef, {
          format: 'jpg',
          quality: 0.9,
          result: 'tmpfile',
        });
        if (uri) {
          setImg({ kind: 'picker', localUri: String(uri) });
          showToast('success', 'Imported! Snapshot image set.');
        } else {
          showToast('info', 'Imported text, but no image was found.');
        }
      } catch {
        showToast('info', 'Imported text, but snapshot failed. You can add a photo.');
      } finally {
        setWebSnapInProgress(false);
        setWebSnapUrl(null);
      }
    }
  }, []);

  // ---------- pick photo ----------
  const chooseCameraOrGallery = useCallback(() => {
    Alert.alert('Add Photo', 'Where do you want to get the photo?', [
      {
        text: 'Camera',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') return setNotice({ visible: true, title: 'Permission Denied', message: 'Camera access required.' });
          const r = await ImagePicker.launchCameraAsync({ quality: 0.92, allowsEditing: true, aspect: [4, 3] });
          if (r.canceled || !r.assets?.[0]?.uri) return;
          setPastedUrl('');
          setImg({ kind: 'camera', localUri: r.assets[0].uri });
        },
      },
      {
        text: 'Gallery',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') return setNotice({ visible: true, title: 'Permission Denied', message: 'Photo library access required.' });
          const r = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.92,
            allowsEditing: true,
            aspect: [4, 3],
          });
          if (r.canceled || !r.assets?.[0]?.uri) return;
          setPastedUrl('');
          setImg({ kind: 'picker', localUri: r.assets[0].uri });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  // ---------- upload chosen preview ----------
  const uploadPreviewAndSetImage = useCallback(async () => {
    if (!canEditNow) {
      await warn();
      setNotice({ visible: true, title: 'Access Restricted', message: 'Only the owner can change the image.' });
      return;
    }
    if (!userId) {
      setNotice({ visible: true, title: 'Sign-In Required', message: 'Please sign in first.' });
      return;
    }

    const uri =
      img.kind === 'url-og'
        ? img.resolvedImageUrl
        : img.kind === 'picker'
        ? img.localUri
        : img.kind === 'camera'
        ? img.localUri
        : '';

    if (!uri) {
      setNotice({ visible: true, title: 'Standby', message: 'No new image yet. Tip: Tap "Add/Choose Photo…" or Import.' });
      return;
    }

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
    showToast('success', 'New Target Aquired');
  }, [canEditNow, userId, img, id]);

  // ---------- loading / gate ----------
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top', 'left', 'right']}>
        <ThemedNotice
          visible={notice.visible}
          title={notice.title}
          message={notice.message}
          onClose={() => setNotice({ visible: false, title: '', message: '' })}
          confirmText="OK"
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.text }}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!canEditNow) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top', 'left', 'right']}>
        <ThemedNotice
          visible={notice.visible}
          title={notice.title}
          message={notice.message}
          onClose={() => setNotice({ visible: false, title: '', message: '' })}
          confirmText="OK"
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: COLORS.text, fontWeight: '800', textAlign: 'center' }}>
            Only the owner can edit this recipe.
          </Text>
          <HapticButton
            onPress={() => router.back()}
            style={{ marginTop: 16, backgroundColor: COLORS.card, padding: 12, borderRadius: RADIUS.lg }}
          >
            <Text style={{ color: COLORS.accent, fontWeight: '800' }}>Go Back</Text>
          </HapticButton>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- UI ----------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThemedNotice
          visible={notice.visible}
          title={notice.title}
          message={notice.message}
          onClose={() => setNotice({ visible: false, title: '', message: '' })}
          confirmText="OK"
        />
        {/* 🟣 FLOATING TOAST (no layout space) */}
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: insets.top + 8,
            left: SPACING.lg,
            right: SPACING.lg,
            zIndex: 50,
            opacity: toast ? 1 : 0,
          }}
        >
          {toast && (
            <InlineToast
              type={toast.type}
              message={toast.message}
              onClose={() => setToast(null)}
            />
          )}
        </View>

        {/* 🟢 FLOATING AUTOSAVE PILL (no layout space) */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: insets.top + 56,      // sit under the toast if it shows
            right: SPACING.lg,
            zIndex: 40,
            opacity: saveStatus === 'idle' ? 0 : 1,
          }}
        >
          <View
            style={{
              alignSelf: 'flex-end',
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 999,
              borderWidth: 1,
              backgroundColor:
                saveStatus === 'saved' ? '#0f2a1a' :
                saveStatus === 'error' ? '#2a0f13' : '#0b1220',
              borderColor:
                saveStatus === 'saved' ? '#14532d' :
                saveStatus === 'error' ? '#7f1d1d' : '#243042',
            }}
          >
            <Text
              style={{
                color:
                  saveStatus === 'saved' ? '#bbf7d0' :
                  saveStatus === 'error' ? '#fecaca' : '#9CA3AF',
              }}
            >
              {
                saveStatus === 'saving' ? 'Autosave: Saving…' :
                saveStatus === 'saved'  ? 'Autosave: Saved ✓' :
                saveStatus === 'error'  ? `Autosave failed${saveError ? `: ${saveError}` : ''}` :
                ''
              }
            </Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 160 + Math.max(0, insets.bottom) }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 6 }}>Edit Recipe</Text>

          {/* creator header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <TouchableOpacity onPress={() => router.push(`/u/${creatorUsername}`)} activeOpacity={0.7}>
              {creatorAvatar ? (
                <Image source={{ uri: creatorAvatar }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8 }} />
              ) : (
                <View style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#e5e7eb', fontSize: 12, fontWeight: '800' }}>{(creatorUsername || 'U')[0]?.toUpperCase()}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push(`/u/${creatorUsername}`)} activeOpacity={0.7}>
              <Text style={{ color: COLORS.text, fontWeight: '800' }}>{creatorUsername}</Text>
            </TouchableOpacity>
          </View>

          {/* Title */}
          <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="My Tasty Pizza"
            placeholderTextColor="#64748b"
            style={{ color: 'white', backgroundColor: '#1e293b', borderRadius: 12, padding: 12, marginBottom: 8 }}
          />

          {/* Private + Monetization */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Switch
              value={isPrivate}
              onValueChange={(v) => { setIsPrivate(v); if (v) setMonetizationEligible(false); }}
              thumbColor={isPrivate ? '#22c55e' : '#e5e7eb'}
              trackColor={{ false: '#374151', true: '#14532d' }}
            />
            <Text style={{ color: COLORS.text, fontWeight: '700', marginLeft: 8 }}>Private</Text>
          </View>
          <Text style={{ color: '#94a3b8', marginBottom: 8, fontSize: 12 }}>
            Private hides your recipe from the public feed and blocks creator earnings.
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Switch
              value={!isPrivate && !(sourceUrlDb || pastedUrl) ? monetizationEligible : false}
              disabled={isPrivate || !!(sourceUrlDb || pastedUrl)}
              onValueChange={setMonetizationEligible}
              thumbColor={!isPrivate && !(sourceUrlDb || pastedUrl) ? '#22c55e' : '#e5e7eb'}
              trackColor={{ false: '#374151', true: '#14532d' }}
            />
            <Text style={{ color: COLORS.text, fontWeight: '700', marginLeft: 8 }}>Monetization</Text>
          </View>
          <Text style={{ color: '#94a3b8', marginBottom: 12, fontSize: 12 }}>
            {isPrivate
              ? '🔒 Locked: recipe is Private.'
              : sourceUrlDb || pastedUrl
              ? '🌐 Locked: recipe has a source link (Imported).'
              : 'When ON (default for public), the creator can earn on this recipe.'}
          </Text>

          {/* Images */}
          <Text style={{ color: COLORS.text, marginBottom: 8 }}>Images</Text>
          <Text style={{ color: '#94a3b8', marginBottom: 10 }}>Left = current. Right = new. Tap the right picture to set it!</Text>

          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            <View style={{ flex: 1, backgroundColor: '#0b1220', borderRadius: 12, borderWidth: 1, borderColor: '#243042', padding: 8 }}>
              <Text style={{ color: '#9CA3AF', marginBottom: 6, fontWeight: '700' }}>Current</Text>
              {currentImageUrl ? (
                <Image source={{ uri: currentImageUrl }} style={{ width: '100%', height: 200, borderRadius: 10 }} contentFit="cover" />
              ) : (
                <View style={{ height: 200, borderRadius: 10, backgroundColor: '#1F2937', borderWidth: 1, borderColor: '#243042', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#9CA3AF' }}>No image yet</Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              onPress={uploadPreviewAndSetImage}
              activeOpacity={0.85}
              style={{ flex: 1, backgroundColor: '#0b1220', borderRadius: 12, borderWidth: 1, borderColor: '#243042', padding: 8 }}
            >
              <Text style={{ color: '#9CA3AF', marginBottom: 6, fontWeight: '700' }}>New (tap to use)</Text>
              {previewUri ? (
                <Image source={{ uri: previewUri }} style={{ width: '100%', height: 200, borderRadius: 10 }} contentFit="cover" />
              ) : (
                <View style={{ height: 200, borderRadius: 10, backgroundColor: '#1F2937', borderWidth: 1, borderColor: '#243042', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
                  <Text style={{ color: '#9CA3AF', textAlign: 'center' }}>
                    No new image yet{'\n'}Tip: add/import first
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={chooseCameraOrGallery}
            style={{ backgroundColor: COLORS.card, padding: 12, borderRadius: 12, alignItems: 'center', marginBottom: 12 }}
          >
            <Text style={{ color: COLORS.text, fontWeight: '800' }}>Add/Choose Photo…</Text>
          </TouchableOpacity>

          {/* Import box */}
          <View style={{ backgroundColor: '#111827', borderRadius: 14, borderColor: '#243042', borderWidth: 1, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: '#9CA3AF', marginBottom: 6 }}>Re-import from link (pre-filled if we know it)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                value={pastedUrl}
                onChangeText={setPastedUrl}
                placeholder="https://www.tiktok.com/@user/video/…  or  item_id=123…"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  flex: 1,
                  color: '#E5E7EB',
                  backgroundColor: '#1F2937',
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                  marginRight: 8,
                }}
              />
              <TouchableOpacity onPress={onPaste} style={{ backgroundColor: '#1F2937', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginRight: 8 }}>
                <Text style={{ color: '#E5E7EB', fontWeight: '600' }}>Paste</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onImport}
                disabled={loadingImport}
                style={{ backgroundColor: '#60A5FA', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, opacity: loadingImport ? 0.6 : 1 }}
              >
                <Text style={{ color: '#0B1120', fontWeight: '700' }}>{loadingImport ? 'Importing…' : 'Import'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Ingredients */}
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Ingredients</Text>
            {ingredients.map((ing, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <TextInput
                  value={ing}
                  onChangeText={(t) => setIngredients((a) => a.map((v, idx) => (idx === i ? t : v)))}
                  placeholder={`Ingredient ${i + 1}`}
                  placeholderTextColor="#64748b"
                  style={{ flex: 1, color: 'white', backgroundColor: '#1e293b', borderRadius: 10, padding: 10 }}
                />
                <TouchableOpacity
                  onPress={() => setIngredients((a) => a.filter((_, idx) => idx !== i))}
                  style={{ marginLeft: 8, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#7f1d1d', borderRadius: 10 }}
                >
                  <Text style={{ color: 'white', fontWeight: '800' }}>X</Text>
                </TouchableOpacity>
              </View>
            ))}
            <HapticButton
              onPress={() => setIngredients((a) => [...a, ''])}
              style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: 'center' }}
            >
              <Text style={{ color: COLORS.text, fontWeight: '800' }}>+ Add Ingredient</Text>
            </HapticButton>
          </View>

          {/* Steps */}
          <View style={{ marginBottom: 20 }}>
            <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Steps</Text>
            {steps.map((st, i) => (
              <View key={i} style={{ marginBottom: 10 }}>
                <TextInput
                  value={st.text}
                  onChangeText={(t) => setSteps((a) => a.map((v, idx) => (idx === i ? { ...v, text: t } : v)))}
                  placeholder="Mix everything…"
                  placeholderTextColor="#64748b"
                  multiline
                  style={{ color: 'white', backgroundColor: '#1e293b', borderRadius: 10, padding: 10, minHeight: 60 }}
                />
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <Text style={{ color: '#94a3b8', marginRight: 8 }}>Seconds (optional)</Text>
                  <TextInput
                    value={st.seconds === null ? '' : String(st.seconds)}
                    onChangeText={(txt) => {
                      const n = txt.replace(/[^\d]/g, '');
                      const val = n === '' ? null : Math.min(24 * 60 * 60, parseInt(n, 10) || 0);
                      setSteps((a) => a.map((v, idx) => (idx === i ? { ...v, seconds: val } : v)));
                    }}
                    keyboardType="number-pad"
                    placeholder="e.g., 90"
                    placeholderTextColor="#64748b"
                    style={{ color: 'white', backgroundColor: '#1e293b', borderRadius: 10, padding: 10, width: 100 }}
                  />
                </View>
              </View>
            ))}
            <HapticButton
              onPress={() => setSteps((a) => [...a, { text: '', seconds: null }])}
              style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: RADIUS.lg, alignItems: 'center' }}
            >
              <Text style={{ color: COLORS.text, fontWeight: '800' }}>+ Add Step</Text>
            </HapticButton>
          </View>

          {/* (No Save button — autosave handles everything) */}

          {/* Owner-only delete */}
          {canEditNow && (
            <HapticButton
              onPress={() =>
                Alert.alert('Delete recipe?', 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const { error } = await supabase.from('recipes').delete().match({ id, user_id: userId! });
                        if (error) return Alert.alert('Delete failed', error.message);
                        router.replace('/');
                      } catch (err: any) {
                        Alert.alert('Delete failed', err?.message ?? 'Please try again.');
                      }
                    },
                  },
                ])
              }
              style={{
                marginTop: 12,
                borderWidth: 1,
                borderColor: '#7f1d1d',
                backgroundColor: 'rgba(127,29,29,0.12)',
                paddingVertical: 12,
                borderRadius: RADIUS.lg,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Ionicons name="trash-outline" size={16} color="#fca5a5" />
              <Text style={{ color: '#fca5a5', fontWeight: '800' }}>Delete Recipe</Text>
            </HapticButton>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Hidden WebView snapshot area (off-screen) */}
        {webSnapUrl && (
          <View
            ref={snapContainerRef}
            collapsable={false}
            style={{
              position: 'absolute',
              left: -10000,
              top: -10000,
              width: SNAP_W,
              height: SNAP_H,
              overflow: 'hidden',
              backgroundColor: '#000',
              opacity: 1,
            }}
          >
            <WebView
              ref={webViewRef}
              source={{ uri: webSnapUrl }}
              userAgent={DESKTOP_UA}
              onLoadEnd={onWebSnapLoadEnd}
              onMessage={onWebMessage}
              injectedJavaScriptBeforeContentLoaded={PREP_JS}
              javaScriptEnabled
              domStorageEnabled
              scrollEnabled
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              style={{
                width: SNAP_W + CROP_LEFT_PX,
                height: SNAP_H + CROP_TOP_PX,
                marginLeft: -CROP_LEFT_PX,
                marginTop: -CROP_TOP_PX,
              }}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
