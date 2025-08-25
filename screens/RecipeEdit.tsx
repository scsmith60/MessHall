// screens/RecipeEdit.tsx
// MessHall — Edit screen with EXACT Add screen Enrich/AutoSnap pipeline + Delete
// - Paste / Enrich / Pick Image actions (same UX as Add)
// - TikTok robust thumb + AutoSnap WebView capture (same offsets & injection)
// - Durable upload via ensureDurableThumb; stores bucket path when available
// - Resolves storage paths to signed preview URLs
// - Delete: confirms, deletes children, recipe row, and storage object if needed
// - Does NOT auto-save: enrich just fills fields & thumb; user taps Save

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Alert,
  StyleSheet, KeyboardAvoidingView, Platform, Image, Modal
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';

// TikTok helpers (same as Add)
import { isTikTokUrl, fetchTikTokThumbRobust } from '../lib/tiktokThumb';

// ===== DEBUG SWITCH (same as Add) =====
const DEBUG_THUMBS = true;

type R = RouteProp<RootStackParamList, 'Recipe'>;

type RecipeBase = {
  id: string;
  title: string | null;
  source_url: string | null;
  thumb_path?: string | null;
};

const DURABLE_BUCKET = 'recipe-thumbs';
const PREVIEW_TTL = 60 * 60 * 24 * 14; // 14 days

// ---- Durable helper (same import pattern as Add) ----
let ensureDurableThumb:
  | undefined
  | ((src: string) => Promise<{ publicUrl: string; signedUrl?: string; bucketPath?: string; uri?: string }>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../lib/ensureDurableThumb');
  ensureDurableThumb = mod.ensureDurableThumb || mod.default;
} catch {}

// ---- Optional fetchMeta (same as Add) ----
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
} catch {}

// ====== Shared helpers (identical to Add) ======
const looksLikeUrl = (s?: string) => !!s && /^https?:\/\/[^\s]+/i.test((s || '').trim());
const uniq = (arr: string[]) => Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));

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

const isHttp = (s?: string) => !!s && /^https?:\/\//i.test(s!);
const isLikelyImageUrl = (u: string) =>
  /\.(jpg|jpeg|png|webp|gif|bmp|avif|heic|heif)(\?|#|$)/i.test(u);

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

// Build a signed preview from a storage path
async function toDisplayUrl(pathOrUrl?: string | null): Promise<string> {
  if (!pathOrUrl) return '';
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const clean = pathOrUrl.replace(new RegExp(`^${DURABLE_BUCKET}/?`, 'i'), '');
  const { data, error } = await supabase.storage.from(DURABLE_BUCKET).createSignedUrl(clean, PREVIEW_TTL);
  if (error) {
    return supabase.storage.from(DURABLE_BUCKET).getPublicUrl(clean).data?.publicUrl || '';
  }
  return data?.signedUrl || '';
}

/** Thumb with debug (copied from Add) */
function Thumb({
  uri,
  onPress,
  styles,
}: {
  uri: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
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
    if (DEBUG_THUMBS) console.log('[Thumb] new uri', { uri, signed, displayUri: next });
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
              if (DEBUG_THUMBS) console.log('[Thumb] getSize OK', { w, h, displayUri });
              if (!cancelled) setDbg((d) => ({ ...d, getSizeOK: true, width: w, height: h }));
              resolve();
            },
            (err) => {
              if (DEBUG_THUMBS) console.warn('[Thumb] getSize FAIL', err);
              if (!cancelled) setDbg((d) => ({ ...d, getSizeOK: false, getSizeErr: String(err) }));
              reject(err);
            }
          );
        });
      } catch {}

      try {
        const pf = await Image.prefetch(displayUri);
        if (DEBUG_THUMBS) console.log('[Thumb] prefetch', pf);
        if (!cancelled) setDbg((d) => ({ ...d, prefetchOK: !!pf }));
      } catch (e: any) {
        if (DEBUG_THUMBS) console.warn('[Thumb] prefetch FAIL', e?.message || e);
        if (!cancelled) setDbg((d) => ({ ...d, prefetchOK: false, prefetchErr: e?.message || String(e) }));
      }

      try {
        let status = 0, ct = '', len = '';
        let res = await fetch(displayUri, { method: 'HEAD' });
        status = res.status;
        ct = res.headers.get('content-type') || '';
        len = res.headers.get('content-length') || '';
        if (DEBUG_THUMBS) console.log('[Thumb] HEAD', status, ct, len);
        if (!cancelled) setDbg((d) => ({ ...d, headStatus: status, headCT: ct, headLen: len }));
        if (status >= 200 && status < 400) {
          if (!cancelled) setOk(true);
          return;
        }
        res = await fetch(displayUri, { method: 'GET', headers: { Range: 'bytes=0-0' } as any });
        status = res.status;
        ct = res.headers.get('content-type') || '';
        len = res.headers.get('content-length') || '';
        if (DEBUG_THUMBS) console.log('[Thumb] Range GET', status, ct, len);
        if (!cancelled) setDbg((d) => ({ ...d, headStatus: status, headCT: ct, headLen: len }));
        if (status >= 200 && status < 400) {
          if (!cancelled) setOk(true);
        } else {
          if (!cancelled) setOk(false);
        }
      } catch (e: any) {
        if (DEBUG_THUMBS) console.warn('[Thumb] HEAD/Range FAIL', e?.message || e);
        if (!cancelled) setDbg((d) => ({ ...d, headErr: e?.message || String(e) }));
        if (!cancelled && dbg.getSizeOK) setOk(true);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayUri]);

  return (
    <Pressable onPress={onPress} style={{ marginTop: 12 }}>
      {ok === null && (
        <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' }]}>
          <ActivityIndicator />
        </View>
      )}
      {ok === true && (
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
            if (DEBUG_THUMBS) console.warn('[Thumb:onError]', e?.nativeEvent);
            setOk(false);
          }}
        />
      )}
      {ok === false && (
        <View
          style={[
            styles.thumb,
            { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: 12 },
            DEBUG_THUMBS ? { borderWidth: 1, borderColor: '#f87171' } : null,
          ]}
        >
          <Text style={{ color: '#fff' }}>Preview unavailable</Text>
        </View>
      )}
    </Pressable>
  );
}

// ===== AutoSnap Modal (copied from Add; exact offsets & logic) =====
type AutoSnapModalProps = {
  visible: boolean;
  url: string;
  onDone: (durableUrl: string) => void;
  onCancel: () => void;
  colors: ReturnType<typeof useThemeController>['colors'];
  styles: ReturnType<typeof makeStyles>;
  delayMs?: number;
};

function AutoSnapModal({
  visible,
  url,
  onDone,
  onCancel,
  colors,
  styles,
  delayMs = 1200,
}: AutoSnapModalProps) {
  const [WebViewComp, setWebViewComp] = useState<any>(null);
  const [ViewShotComp, setViewShotComp] = useState<any>(null);
  const [snapping, setSnapping] = useState(false);
  const viewShotRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const gotDirectThumbRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const modWV = await import('react-native-webview');
        const WV = (modWV as any).WebView || (modWV as any).default;
        setWebViewComp(() => WV || null);
      } catch (e) {
        if (DEBUG_THUMBS) console.warn('[autosnap] webview import failed', e);
      }
      try {
        const modVS = await import('react-native-view-shot');
        const VS = (modVS as any).ViewShot || (modVS as any).default;
        setViewShotComp(() => VS || null);
      } catch (e) {
        if (DEBUG_THUMBS) console.warn('[autosnap] view-shot import failed', e);
      }
    })();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  if (!visible) return null;

  if (!WebViewComp || !ViewShotComp) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Preview unavailable</Text>
            <Text style={{ color: colors.mutedText, marginBottom: 12 }}>
              Please install react-native-webview and react-native-view-shot.
            </Text>
            <Pressable style={styles.btnNeutral} onPress={onCancel}>
              <Text style={styles.btnNeutralText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  const injectedJS = `
    (function() {
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) { meta = document.createElement('meta'); meta.name='viewport'; document.head.appendChild(meta); }
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0';

      const st = document.createElement('style');
      st.innerHTML = \`
        html, body { margin:0!important; padding:0!important; background:#fff!important; overflow:hidden!important; }
        header, footer, .tiktok-top, .tiktok-header, .tiktok-footer,
        [data-e2e="banner"], [data-e2e="openAppButton"], .download-app,
        .login-guide, .app-open, .bottomSheet, .sticky, .sidebar, .share,
        [data-e2e="interest-selection"], [data-e2e="cookie-banner"], [role="dialog"]
        { display:none!important; visibility:hidden!important; pointer-events:none!important; }
        #app, .app, .container, main { margin:0!important; padding:0!important; }
        body { transform: scale(1.08); transform-origin: 58% 48%; }
      \`;
      document.documentElement.appendChild(st);

      function pm(tag, val){ try{ window.ReactNativeWebView.postMessage(tag + '|' + val); }catch(e){} }
      var canon = document.querySelector('link[rel="canonical"]')?.href;
      if (canon && /^https?:/.test(canon)) pm('CANONICAL', canon);

      var og = document.querySelector('meta[property="og:image"]')?.content;
      if (og) pm('THUMB', og);
      var tw = document.querySelector('meta[name="twitter:image"]')?.content;
      if (tw) pm('THUMB', tw);

      var vid = document.querySelector('video');
      var poster = vid && vid.getAttribute('poster');
      if (poster) pm('THUMB', poster);

      var imgs = Array.from(document.images || []).map(i=>i.src).filter(Boolean);
      var candidates = imgs.filter(s => /(p16-sign|p19-sign|object-storage|imagecdn|img.tiktokcdn)/.test(s));
      if (candidates[0]) pm('THUMB', candidates[0]);
    })();
  `;

  const finishWithUrl = async (src: string) => {
    try {
      if (ensureDurableThumb) {
        const out = await ensureDurableThumb(src);
        onDone(out.signedUrl || out.publicUrl || out.uri || src);
      } else {
        onDone(src);
      }
    } catch (e) {
      if (DEBUG_THUMBS) console.warn('[autosnap] finishWithUrl error', e);
      onDone(src);
    }
  };

  const handleLoadEnd = () => {
    if (snapping) return;
    setSnapping(true);
    timerRef.current = setTimeout(async () => {
      if (gotDirectThumbRef.current) { setSnapping(false); return; }
      try {
        const uri: string = await viewShotRef.current?.capture?.({
          format: 'jpg',
          quality: 0.95,
          result: 'tmpfile',
        });
        if (uri) await finishWithUrl(uri);
      } catch (e) {
        if (DEBUG_THUMBS) console.warn('[autosnap] capture failed', e);
        onCancel();
      } finally {
        setSnapping(false);
      }
    }, delayMs);
  };

  const vw = 360, vh = 460;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Preparing preview…</Text>

          <ViewShotComp
            ref={viewShotRef}
            style={{ width: vw, height: vh, borderRadius: 12, alignSelf: 'center' }}
            options={{ format: 'jpg', quality: 0.95 }}
            collapsable={false}
          >
            <View style={{ width: vw, height: vh, borderRadius: 12 }} renderToHardwareTextureAndroid collapsable={false}>
              <WebViewComp
                source={{ uri: url }}
                onLoadEnd={handleLoadEnd}
                injectedJavaScript={injectedJS}
                javaScriptEnabled
                domStorageEnabled
                overScrollMode="never"
                androidHardwareAccelerationDisabled
                onMessage={async (e: any) => {
                  const data: string = e?.nativeEvent?.data || '';
                  if (!data) return;

                  if (data.startsWith('CANONICAL|')) {
                    const canon = data.slice(10);
                    if (canon) {
                      try {
                        const tikThumb = await fetchTikTokThumbRobust(canon);
                        if (tikThumb) {
                          gotDirectThumbRef.current = true;
                          if (timerRef.current) clearTimeout(timerRef.current);
                          await finishWithUrl(tikThumb);
                        }
                      } catch {}
                    }
                  }
                  if (data.startsWith('THUMB|')) {
                    const src = data.slice(6);
                    if (src) {
                      gotDirectThumbRef.current = true;
                      if (timerRef.current) clearTimeout(timerRef.current);
                      await finishWithUrl(src);
                    }
                  }
                }}
                userAgent={'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'}
                style={{
                  width: 420,
                  height: 560,
                  backgroundColor: '#fff',
                  marginLeft: -30,
                  marginTop: -40,
                  borderRadius: 12,
                }}
              />
            </View>
          </ViewShotComp>

          <View style={{ marginTop: 10, alignItems: 'center' }}>
            {snapping ? <ActivityIndicator /> : null}
          </View>
          <View style={styles.actionsRow}>
            <Pressable style={styles.btnNeutral} onPress={onCancel}>
              <Text style={styles.btnNeutralText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ===== MAIN (Edit) =====
export default function RecipeEdit() {
  const { colors, getThemedInputProps } = useThemeController();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const nav = useNavigation<any>();
  const route = useRoute<R>();
  const insets = useSafeAreaInsets();
  const recipeId = route.params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // These will be filled by Enrich (same as Add); users can tweak then Save
  const [url, setUrl] = useState<string>('');            // use as "source_url" as well
  const [title, setTitle] = useState('');
  const [thumbUrl, setThumbUrl] = useState<string>('');  // preview uri (signed or direct)
  const [thumbPathRaw, setThumbPathRaw] = useState<string>(''); // DB value to clean up storage
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>([]);

  const [autoSnapVisible, setAutoSnapVisible] = useState(false);
  const [thumbModal, setThumbModal] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);

  // ===== LOAD existing recipe =====
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

        // populate fields
        setTitle(base?.title || '');
        setUrl(base?.source_url || '');

        const path = base?.thumb_path || '';
        setThumbPathRaw(path || '');
        const resolved = await toDisplayUrl(path || '');
        if (!alive) return;
        setThumbUrl(resolved || '');

        // children
        const [{ data: ing }, { data: stp }] = await Promise.all([
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
        if (!alive) return;

        setIngredients(((ing as { raw: string }[]) ?? []).map(r => r.raw).filter(Boolean));
        setSteps(((stp as { step_text: string }[]) ?? []).map(r => r.step_text).filter(Boolean));
      } catch (e: any) {
        Alert.alert('Load failed', e?.message || 'Try again.');
        nav.goBack();
      } finally {
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [nav, recipeId]);

  // ===== Paste / Pick Image (same behaviors as Add) =====
  const pasteFromClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setUrl(text.trim());
    else Alert.alert('Clipboard empty', 'Copy a link first, then tap Paste.');
  }, []);

  const pickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Enable Photos permission to pick a thumbnail.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaType,
        quality: 0.9,
      });
      if (res.canceled || !res.assets?.length) return;
      const localUri = res.assets[0].uri;
      setImgBusy(true);
      if (ensureDurableThumb) {
        const out = await ensureDurableThumb(localUri);
        const bucketPath = out.bucketPath || '';
        const preview = out.signedUrl || out.publicUrl || out.uri || localUri;
        await supabase.from('recipes').update({ thumb_path: bucketPath || preview, updated_at: new Date().toISOString() }).eq('id', recipeId);
        setThumbPathRaw(bucketPath || preview);
        setThumbUrl(preview);
      } else {
        setThumbUrl(localUri);
      }
    } catch (e: any) {
      Alert.alert('Image error', e?.message || 'Could not prepare the image.');
    } finally {
      setImgBusy(false);
    }
  }, [recipeId]);

  // ===== doEnrich (identical logic to Add; fills fields, sets thumb) =====
  const doEnrich = useCallback(
    async (theUrl: string): Promise<{ ok: boolean; hadImage: boolean }> => {
      if (!looksLikeUrl(theUrl)) {
        Alert.alert('Invalid link', 'Please paste a valid recipe URL (https://…)');
        return { ok: false, hadImage: false };
      }
      setImgBusy(true);
      try {
        let meta: MetaResult = {};
        if (fetchMeta) meta = await fetchMeta(theUrl);
        else meta = { title: theUrl.replace(/^https?:\/\//i, '').slice(0, 60) };

        const cleanedIngredients = uniq(meta.ingredients || []);
        const cleanedSteps = uniq(meta.steps || []);

        let finalThumb = '';
        let hadImage = !!meta.image;

        if (meta.image) {
          if (ensureDurableThumb) {
            const { publicUrl, signedUrl, uri, bucketPath } = await ensureDurableThumb(meta.image);
            finalThumb = signedUrl || publicUrl || uri || meta.image;
            await supabase.from('recipes').update({
              thumb_path: bucketPath || finalThumb,
              updated_at: new Date().toISOString(),
            }).eq('id', recipeId);
            setThumbPathRaw(bucketPath || finalThumb);
          } else finalThumb = meta.image;
        } else if (isTikTokUrl(theUrl)) {
          try {
            const tikThumb = await fetchTikTokThumbRobust(theUrl);
            if (tikThumb) {
              hadImage = true;
              if (ensureDurableThumb) {
                const { publicUrl, signedUrl, uri, bucketPath } = await ensureDurableThumb(tikThumb);
                finalThumb = signedUrl || publicUrl || uri || tikThumb;
                await supabase.from('recipes').update({
                  thumb_path: bucketPath || finalThumb,
                  updated_at: new Date().toISOString(),
                }).eq('id', recipeId);
                setThumbPathRaw(bucketPath || finalThumb);
              } else finalThumb = tikThumb;
            }
          } catch {}
        }

        // Fill UI fields (user can tweak before Save)
        setTitle(meta.title || title || '');
        setUrl(theUrl);
        if (finalThumb) setThumbUrl(finalThumb);
        if (cleanedIngredients.length) setIngredients(cleanedIngredients);
        if (cleanedSteps.length) setSteps(cleanedSteps);

        return { ok: true, hadImage };
      } catch {
        Alert.alert('Enrich failed', 'Could not pull details from the link.');
        return { ok: false, hadImage: false };
      } finally {
        setImgBusy(false);
      }
    },
    [recipeId, title]
  );

  // ===== Import URL button (same as Add's Enrich button behavior) =====
  const onEnrichPress = useCallback(async () => {
    const res = await doEnrich(url);
    if (res?.ok && !res.hadImage) setAutoSnapVisible(true);
  }, [doEnrich, url]);

  // ===== Save updates (title/source_url/ingredients/steps) =====
  const save = useCallback(async () => {
    if (!title.trim()) { Alert.alert('Missing title', 'Please add a recipe title.'); return; }
    setSaving(true);
    try {
      // Base fields
      const { error: upErr } = await supabase
        .from('recipes')
        .update({
          title: title.trim(),
          source_url: looksLikeUrl(url) ? url.trim() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipeId);
      if (upErr) throw upErr;

      // Replace children
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
  }, [ingredients, nav, recipeId, steps, title, url]);

  // ===== Delete (confirm → delete children → delete row → storage cleanup) =====
  const isStoragePath = (p?: string | null) => !!p && !/^https?:\/\//i.test(p || '');

  const deleteRecipeDeep = useCallback(async () => {
    if (!recipeId) return;

    setDeleting(true);
    try {
      // delete children first
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
      await supabase.from('recipe_steps').delete().eq('recipe_id', recipeId);

      // delete recipe row
      await supabase.from('recipes').delete().eq('id', recipeId);

      // clean up storage if thumb is in our bucket
      if (isStoragePath(thumbPathRaw)) {
        const clean = String(thumbPathRaw).replace(new RegExp(`^${DURABLE_BUCKET}/?`, 'i'), '');
        await supabase.storage.from(DURABLE_BUCKET).remove([clean]);
      }

      Alert.alert('Deleted', 'Recipe deleted.');
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Delete failed', e?.message || 'Please try again.');
    } finally {
      setDeleting(false);
    }
  }, [nav, recipeId, thumbPathRaw]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Delete recipe?',
      `This will permanently delete “${title || 'Untitled'}”.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteRecipeDeep },
      ]
    );
  }, [deleteRecipeDeep, title]);

  const canEnrich = useMemo(() => looksLikeUrl(url) && !imgBusy, [url, imgBusy]);
  const canSave = useMemo(() => !!title.trim() && !saving, [saving, title]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg, paddingTop: Math.max(insets.top, 8) }}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, { backgroundColor: colors.bg }]}
      >
        <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 32 }]}>
          <Text style={[styles.h1, { color: colors.text }]}>Edit Recipe</Text>

          {/* URL (same as Add) */}
          <Text style={styles.label}>Recipe URL</Text>
          <TextInput
            {...getThemedInputProps()}
            style={[getThemedInputProps().style, styles.input]}
            placeholder="Paste or edit the recipe link"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          {/* Actions (Paste / Enrich / Pick Image) */}
          <View style={styles.actionsRow}>
            <Pressable style={styles.btnNeutral} onPress={pasteFromClipboard}>
              <Text style={styles.btnNeutralText}>Paste</Text>
            </Pressable>

            <Pressable
              style={[styles.btnNeutral, !canEnrich && styles.btnDisabled]}
              onPress={onEnrichPress}
              disabled={!canEnrich}
            >
              {imgBusy ? <ActivityIndicator size="small" color={colors.tint} /> : <Text style={styles.btnNeutralText}>Enrich</Text>}
            </Pressable>

            <Pressable style={styles.btnNeutral} onPress={pickImage} disabled={imgBusy}>
              <Text style={styles.btnNeutralText}>Pick Image</Text>
            </Pressable>
          </View>

          {/* Title */}
          <Text style={styles.label}>Title</Text>
          <TextInput
            {...getThemedInputProps()}
            style={[getThemedInputProps().style, styles.input]}
            placeholder="Recipe title"
            value={title}
            onChangeText={setTitle}
          />

          {/* Thumbnail (tap to enlarge) */}
          {thumbUrl ? <Thumb uri={thumbUrl} onPress={() => setThumbModal(true)} styles={styles} /> : null}

          {/* Ingredients */}
          <Text style={styles.label}>Ingredients</Text>
          <View style={styles.multiBox}>
            {(ingredients.length ? ingredients : ['']).map((val, idx) => (
              <TextInput
                key={`ing-${idx}`}
                {...getThemedInputProps({ variant: 'ghost' })}
                style={[getThemedInputProps({ variant: 'ghost' }).style, styles.multiInput]}
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
                {...getThemedInputProps({ variant: 'ghost' })}
                style={[getThemedInputProps({ variant: 'ghost' }).style, styles.multiInput]}
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

          {/* Save / Delete */}
          <Pressable style={[styles.saveBtn, !canSave && styles.btnDisabled]} onPress={save} disabled={!canSave}>
            {saving ? <ActivityIndicator /> : <Text style={styles.saveBtnText}>Save</Text>}
          </Pressable>

          <Pressable
            style={[styles.deleteBtn, (saving || deleting) && styles.btnDisabled]}
            onPress={confirmDelete}
            disabled={saving || deleting}
          >
            {deleting ? <ActivityIndicator /> : <Text style={styles.deleteBtnText}>Delete Recipe</Text>}
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* AutoSnap modal (EXACT) */}
        <AutoSnapModal
          visible={autoSnapVisible}
          url={url}
          colors={colors}
          styles={styles}
          onDone={async (durableUrl) => {
            // durableUrl may be a signed url or tmpfile; attempt to durable-ize & update DB path
            try {
              if (ensureDurableThumb) {
                const out = await ensureDurableThumb(durableUrl);
                const preview = out.signedUrl || out.publicUrl || out.uri || durableUrl;
                await supabase.from('recipes').update({
                  thumb_path: out.bucketPath || preview,
                  updated_at: new Date().toISOString(),
                }).eq('id', recipeId);
                setThumbPathRaw(out.bucketPath || preview);
                setThumbUrl(preview);
              } else {
                setThumbUrl(durableUrl);
              }
            } catch {
              setThumbUrl(durableUrl);
            }
            setAutoSnapVisible(false);
          }}
          onCancel={() => setAutoSnapVisible(false)}
        />

        {/* Fullscreen thumbnail viewer */}
        <Modal visible={thumbModal} transparent animationType="fade" onRequestClose={() => setThumbModal(false)}>
          <Pressable style={styles.thumbBackdrop} onPress={() => setThumbModal(false)}>
            {thumbUrl ? (
              <Image
                source={{ uri: isSupabaseSigned(thumbUrl) ? thumbUrl : bustIfSafe(thumbUrl) }}
                style={styles.thumbFullscreen}
                resizeMode="contain"
                fadeDuration={0}
              />
            ) : null}
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ====== Styles (themed; copied from Add, plus destructive) ======
const makeStyles = (c: ReturnType<typeof useThemeController>['colors']) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    container: { padding: 16 },
    h1: { color: c.text, fontSize: 22, fontWeight: '700', marginBottom: 12 },
    label: { color: c.mutedText, marginTop: 16, marginBottom: 6, fontSize: 13 },

    input: { borderRadius: 10 },

    actionsRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
      marginTop: 10,
      flexWrap: 'wrap',
    },

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

    thumbBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.9)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    thumbFullscreen: { width: '100%', height: '80%', borderRadius: 12, backgroundColor: '#111' },

    multiBox: {
      backgroundColor: c.cardBg,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 8,
      marginTop: 8,
    },
    multiInput: {
      borderRadius: 10,
      marginBottom: 8,
      minHeight: 44,
    },

    addLine: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 6 },
    addLineText: { color: c.tint },

    saveBtn: {
      backgroundColor: c.tint,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: c.shadow,
      marginTop: 18,
    },
    saveBtnText: { color: '#ffffff', fontWeight: '700' },

    deleteBtn: {
      backgroundColor: '#ef4444',
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 10,
    },
    deleteBtnText: { color: '#ffffff', fontWeight: '800' },

    modalScrim: {
      flex: 1,
      backgroundColor: '#0009',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    modalCard: {
      width: '100%',
      maxWidth: 600,
      borderRadius: 16,
      padding: 12,
      backgroundColor: c.cardBg,
      borderWidth: 1,
      borderColor: c.border,
      gap: 10,
    },
    modalTitle: { fontSize: 18, color: c.text, fontWeight: '700', marginBottom: 6 },
  });
