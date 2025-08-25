// screens/Add.tsx
// MessHall — Add screen (themed, TikTok auto-snap)
// - Prefetch + getSize preflight; HEAD/Range check for signed URL reachability
// - Auto WebView screenshot fallback + TikTok robust thumb
// - SafeArea padding + tap-to-enlarge thumbnail
// - Title extraction debugger (shows every signal used to compute title)

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
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { isTikTokUrl, fetchTikTokThumbRobust } from '../lib/tiktokThumb';

import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';
import type { RootStackParamList } from '../App';

// ===== DEBUG SWITCHES =====
// Turn OFF the old thumbnail debugger UI
const DEBUG_THUMBS = false;
// Turn ON the new title debugger UI
const DEBUG_TITLE = true;

/** --- Title extraction helpers --- */
const BAD_TITLES = new Set<string>([
  'TikTok – Make Your Day',
  'TikTok - Make Your Day',
  'TikTok',
  'YouTube',
  'Instagram',
  'Login • Instagram',
  'Pinterest',
]);

function cleanTitle(t?: string) {
  if (!t) return '';
  let out = t.trim();
  out = out.replace(/\s*[|–-]\s*(TikTok|YouTube|Instagram|Pinterest|Allrecipes|Food Network|NYT Cooking).*/i, '');
  out = out.replace(/\s{2,}/g, ' ').trim();
  out = out.replace(/[–—-]\s*$/,'').trim();
  return out;
}

function fallbackTitleFromUrl(u: string) {
  try {
    const { pathname } = new URL(u);
    const last = pathname.split('/').filter(Boolean).pop() || '';
    const cleaned = decodeURIComponent(last.replace(/[-_]+/g, ' ')).trim();
    return cleaned ? cleaned.replace(/\b\w/g, c => c.toUpperCase()) : '';
  } catch { return ''; }
}

function pickMetaContent(html: string, name: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return '';
  const tag = m[0];
  const cm = tag.match(/content=["']([^"']+)["']/i);
  return cm?.[1]?.trim() || '';
}
function pickLinkRel(html: string, rel: string) {
  const re = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return '';
  const tag = m[0];
  const hm = tag.match(/href=["']([^"']+)["']/i);
  return hm?.[1]?.trim() || '';
}
function pickTitleTag(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1]?.replace(/\s+/g, ' ').trim() || '';
}
function safeJSON<T = any>(str?: string | null): T | undefined {
  if (!str) return;
  try { return JSON.parse(str); } catch { return; }
}

function extractFromJSONLD(html: string) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    const json = safeJSON<any>(s[1]);
    if (!json) continue;
    const arr = Array.isArray(json) ? json : [json];
    for (const node of arr) {
      const name = (node?.name || node?.headline || '').toString().trim();
      if (name) return name;
      if (node?.['@graph']) {
        for (const g of node['@graph']) {
          const gn = (g?.name || g?.headline || '').toString().trim();
          if (gn) return gn;
        }
      }
    }
  }
  return '';
}

function cleanCaptionToTitle(desc: string) {
  if (!desc) return '';
  let s = desc.replace(/\r/g, '').split('\n').filter(Boolean)[0] || desc;
  s = s.split(/ingredients\s*:/i)[0] || s;
  s = s.replace(/[#@][\w_]+/g, '').replace(/https?:\/\/\S+/g, '').trim();
  s = cleanTitle(s);
  if (s.length > 120) s = s.slice(0, 117).trim() + '…';
  return s;
}

function extractDescCandidates(html: string) {
  const descs = [
    pickMetaContent(html, 'og:description'),
    pickMetaContent(html, 'twitter:description'),
  ].filter(Boolean);
  const best = descs.find(Boolean) || '';
  return cleanCaptionToTitle(best);
}

function extractFromTikTokSIGI(html: string) {
  const m = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
  const json = safeJSON<any>(m?.[1]);
  if (!json) return '';
  const itemModule = json?.ItemModule;
  if (itemModule && typeof itemModule === 'object') {
    const first: any = Object.values(itemModule)[0];
    const desc = (first?.desc || '').toString().trim();
    const cleaned = cleanCaptionToTitle(desc);
    if (cleaned) return cleaned;
  }
  const seo = json?.SEOState || json?.ShareMeta || json?.app || {};
  const shareTitle = (seo?.metaParams?.title || seo?.shareMeta?.title || '').toString().trim();
  if (shareTitle) return cleanCaptionToTitle(shareTitle);
  return '';
}

/** Title debugger payload returned by fetchAndExtractTitle */
type TitleDebug = {
  finalUrl?: string;
  canonical?: string;
  metaTitle?: string;
  jsonLdName?: string;
  ogTitle?: string;
  twitterTitle?: string;
  titleTag?: string;
  tiktokCaption?: string;
  metaDescriptionTitle?: string;
  slugTitle?: string;
  picked?: string;
};

async function fetchAndExtractTitle(rawUrl: string): Promise<{ title?: string; canonical?: string; debug: TitleDebug }> {
  const debug: TitleDebug = {};
  try {
    const res = await fetch(rawUrl, { redirect: 'follow' });
    const finalUrl = (res as any)?.url || rawUrl;
    const html = await res.text();
    debug.finalUrl = finalUrl;

    const canonical = pickLinkRel(html, 'canonical') || pickMetaContent(html, 'og:url') || finalUrl;
    debug.canonical = canonical;

    debug.jsonLdName = extractFromJSONLD(html);
    debug.ogTitle = pickMetaContent(html, 'og:title');
    debug.twitterTitle = pickMetaContent(html, 'twitter:title');
    debug.titleTag = pickTitleTag(html);

    let t =
      debug.jsonLdName ||
      debug.ogTitle ||
      debug.twitterTitle ||
      debug.titleTag ||
      '';

    t = cleanTitle(t);

    if (!t || BAD_TITLES.has(t)) {
      debug.tiktokCaption = extractFromTikTokSIGI(html);
      if (debug.tiktokCaption) t = debug.tiktokCaption;
    }
    if (!t || BAD_TITLES.has(t)) {
      debug.metaDescriptionTitle = extractDescCandidates(html);
      if (debug.metaDescriptionTitle) t = debug.metaDescriptionTitle;
    }
    if (!t || BAD_TITLES.has(t)) {
      debug.slugTitle = fallbackTitleFromUrl(finalUrl);
      if (debug.slugTitle) t = debug.slugTitle;
    }

    debug.picked = t || undefined;
    return { title: t || undefined, canonical, debug };
  } catch {
    return { debug };
  }
}

// ---- Optional helpers ----
let ensureDurableThumb:
  | undefined
  | ((src: string) => Promise<{ publicUrl: string; signedUrl?: string; bucketPath?: string; uri?: string }>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ensureDurableThumb =
    require('../lib/ensureDurableThumb').ensureDurableThumb ||
    require('../lib/ensureDurableThumb').default;
} catch {}

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

type AddRoute = RouteProp<RootStackParamList, 'Add'>;

const looksLikeUrl = (s?: string) => !!s && /^https?:\/\/[^\s]+/i.test(s?.trim() || '');
const uniq = (arr: string[]) => Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));

const isSupabaseSigned = (u: string) => /\/storage\/v1\/object\/sign\//.test(u);

// Build a cache-busted URL for public/CDN images, but **never** for Supabase signed URLs
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

/** Thumb (thumbnail debugger UI disabled) */
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

  useEffect(() => {
    setOk(null);
    const signed = isSupabaseSigned(uri);
    const next = signed ? uri : bustIfSafe(uri);
    setDisplayUri(next);
  }, [uri]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await new Promise<void>((resolve, reject) => {
          Image.getSize(
            displayUri,
            () => {
              if (!cancelled) setOk(true);
              resolve();
            },
            () => {
              if (!cancelled) setOk(false);
              reject(null);
            }
          );
        });
      } catch {}
      if (ok === null) {
        try {
          const pf = await Image.prefetch(displayUri);
          if (!cancelled) setOk(!!pf);
        } catch { if (!cancelled) setOk(false); }
      }
    }
    run();
    return () => { cancelled = true; };
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
          style={[styles.thumb, { borderRadius: 12, backgroundColor: '#111' }]}
          resizeMode="cover"
          resizeMethod="resize"
          fadeDuration={0}
        />
      )}
      {ok === false && (
        <View
          style={[
            styles.thumb,
            { alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: 12 },
          ]}
        >
          <Text style={{ color: '#fff' }}>Preview unavailable</Text>
        </View>
      )}
    </Pressable>
  );
}

// ===== AutoSnap Modal (WebView + ViewShot) =====
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
      } catch {}
      try {
        const modVS = await import('react-native-view-shot');
        const VS = (modVS as any).ViewShot || (modVS as any).default;
        setViewShotComp(() => VS || null);
      } catch {}
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
    } catch {
      onDone(src);
    }
  };

  const handleLoadEnd = () => {
    if (snapping) return;
    setSnapping(true);
    timerRef.current = setTimeout(async () => {
      if (gotDirectThumbRef.current) { setSnapping(false); return; }
      try {
        const uri: string = await (viewShotRef.current?.capture?.({
          format: 'jpg',
          quality: 0.95,
          result: 'tmpfile',
        }) as Promise<string>);
        if (uri) await finishWithUrl(uri);
      } catch {
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

// ===== Main screen =====
export default function Add() {
  const route = useRoute<AddRoute>();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();

  const { colors, getThemedInputProps } = useThemeController();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const initialSharedUrl = (route.params?.sharedUrl || '').trim();
  const [url, setUrl] = useState(initialSharedUrl);
  const [title, setTitle] = useState('');
  const [thumbUrl, setThumbUrl] = useState<string>('');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoEnrichOnMount] = useState<boolean>(looksLikeUrl(initialSharedUrl));

  const [autoSnapVisible, setAutoSnapVisible] = useState(false);
  const [thumbModal, setThumbModal] = useState(false);
  const userTouchedUrlRef = useRef(false);

  // Title debugger state
  const [titleDebug, setTitleDebug] = useState<TitleDebug | null>(null);

  useEffect(() => {
    const incoming = (route.params?.sharedUrl || '').trim();
    if (!incoming) return;

    if (!userTouchedUrlRef.current || (incoming && incoming !== url)) {
      setUrl(incoming);
      if (looksLikeUrl(incoming)) {
        (async () => {
          const res = await doEnrich(incoming);
          if (res?.ok && !res.hadImage) setAutoSnapVisible(true);
        })();
      }
    }
  }, [route.params?.sharedUrl]);

  const onUrlChange = useCallback((v: string) => {
    userTouchedUrlRef.current = true;
    setUrl(v);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!autoEnrichOnMount) return;
      if (!looksLikeUrl(url)) return;
      setLoading(true);
      try {
        const res = await doEnrich(url);
        if (!cancelled && res && !res.hadImage) setAutoSnapVisible(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [autoEnrichOnMount]);

  const pasteFromClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      const clipped = text.trim();
      setUrl(clipped);
      if (looksLikeUrl(clipped)) {
        const res = await doEnrich(clipped);
        if (res?.ok && !res.hadImage) setAutoSnapVisible(true);
      }
    } else {
      Alert.alert('Clipboard empty', 'Copy a link first, then tap Paste.');
    }
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
      setLoading(true);
      if (ensureDurableThumb) {
        const out = await ensureDurableThumb(localUri);
        setThumbUrl(out.signedUrl || out.publicUrl || out.uri || localUri);
      } else {
        setThumbUrl(localUri);
      }
    } catch (e: any) {
      Alert.alert('Image error', e?.message || 'Could not prepare the image.');
    } finally {
      setLoading(false);
    }
  }, []);

  const doEnrich = useCallback(
    async (theUrl: string): Promise<{ ok: boolean; hadImage: boolean }> => {
      if (!looksLikeUrl(theUrl)) {
        Alert.alert('Invalid link', 'Please paste a valid recipe URL (https://…)');
        return { ok: false, hadImage: false };
      }
      setLoading(true);
      try {
        let meta: MetaResult = {};
        if (fetchMeta) meta = await fetchMeta(theUrl);
        else meta = { title: theUrl.replace(/^https?:\/\//i, '').slice(0, 60) };

        let nextTitle = cleanTitle(meta.title || '');

        // Deep extraction + debugger
        const { title: better, canonical, debug } = await fetchAndExtractTitle(theUrl);
        if (debug) setTitleDebug({
          ...debug,
          metaTitle: meta.title || '',
        });

        if (!nextTitle || BAD_TITLES.has(nextTitle)) {
          if (better) nextTitle = better;
          if (canonical && canonical !== theUrl) setUrl(canonical);
        }
        if (!nextTitle) nextTitle = fallbackTitleFromUrl(theUrl) || theUrl;

        const cleanedIngredients = uniq(meta.ingredients || []);
        const cleanedSteps = uniq(meta.steps || []);

        let finalThumb = '';
        let hadImage = !!meta.image;

        if (meta.image) {
          if (ensureDurableThumb) {
            const { publicUrl, signedUrl, uri } = await ensureDurableThumb(meta.image);
            finalThumb = signedUrl || publicUrl || uri || meta.image;
          } else finalThumb = meta.image;
        } else if (isTikTokUrl(theUrl)) {
          try {
            const tikThumb = await fetchTikTokThumbRobust(theUrl);
            if (tikThumb) {
              hadImage = true;
              if (ensureDurableThumb) {
                const { publicUrl, signedUrl, uri } = await ensureDurableThumb(tikThumb);
                finalThumb = signedUrl || publicUrl || uri || tikThumb;
              } else finalThumb = tikThumb;
            }
          } catch {}
        }

        setTitle(nextTitle || '');
        if (finalThumb) setThumbUrl(finalThumb);
        setIngredients(cleanedIngredients);
        setSteps(cleanedSteps);

        return { ok: true, hadImage };
      } catch {
        Alert.alert('Enrich failed', 'Could not pull details from the link.');
        return { ok: false, hadImage: false };
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clearAll = useCallback(() => {
    setUrl('');
    setTitle('');
    setThumbUrl('');
    setIngredients([]);
    setSteps([]);
    setTitleDebug(null);
    userTouchedUrlRef.current = false;
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

      const base = {
        user_id: user.id,
        title: title.trim(),
        source_url: looksLikeUrl(url) ? url.trim() : null,
        thumb_path: thumbUrl || null,
        created_at: new Date().toISOString(),
      };

      const { data: created, error: createErr } = await supabase
        .from('recipes')
        .insert(base)
        .select('id')
        .single();

      if (createErr) throw createErr;
      const newId = created.id as string;

      const ingRows = (ingredients || [])
        .map(s => s?.trim())
        .filter(Boolean)
        .map((raw, idx) => ({ recipe_id: newId, raw, pos: idx }));
      if (ingRows.length) {
        const { error: insIngErr } = await supabase.from('recipe_ingredients').insert(ingRows);
        if (insIngErr) throw insIngErr;
      }

      const stepRows = (steps || [])
        .map(s => s?.trim())
        .filter(Boolean)
        .map((step_text, idx) => ({ recipe_id: newId, step_text, position: idx }));
      if (stepRows.length) {
        const { error: insStepErr } = await supabase.from('recipe_steps').insert(stepRows);
        if (insStepErr) throw insStepErr;
      }

      Alert.alert('Saved', 'Your recipe has been saved.');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }, [ingredients, steps, thumbUrl, title, url]);

  const canEnrich = useMemo(() => looksLikeUrl(url) && !loading, [url, loading]);

  return (
    <SafeAreaView style={[styles.flex, { paddingTop: Math.max(insets.top, 8) }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.h1}>Add Recipe</Text>

          {/* URL */}
          <View style={styles.row}>
            <TextInput
              {...getThemedInputProps()}
              style={[getThemedInputProps().style, styles.input]}
              placeholder="Paste or share a recipe link"
              value={url}
              onChangeText={onUrlChange}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <View style={styles.actionsRow}>
            <Pressable style={styles.btnNeutral} onPress={pasteFromClipboard}>
              <Text style={styles.btnNeutralText}>Paste</Text>
            </Pressable>

            <Pressable
              style={[styles.btnNeutral, !canEnrich && styles.btnDisabled]}
              onPress={async () => {
                const res = await doEnrich(url);
                if (res?.ok && !res.hadImage) setAutoSnapVisible(true);
              }}
              disabled={!canEnrich}
            >
              {loading ? <ActivityIndicator size="small" color={colors.tint} /> : <Text style={styles.btnNeutralText}>Enrich</Text>}
            </Pressable>

            <Pressable style={styles.btnNeutral} onPress={pickImage}>
              <Text style={styles.btnNeutralText}>Pick Image</Text>
            </Pressable>

            <Pressable style={styles.btnGhost} onPress={clearAll}>
              <Text style={styles.btnGhostText}>Clear</Text>
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

          {/* Title Debugger */}
          {DEBUG_TITLE && titleDebug ? (
            <View style={styles.titleDebugBox}>
              <Text style={styles.titleDebugH}>Title Debug</Text>
              <Text style={styles.titleDebugLine}>finalUrl: {titleDebug.finalUrl || '-'}</Text>
              <Text style={styles.titleDebugLine}>canonical: {titleDebug.canonical || '-'}</Text>
              <Text style={styles.titleDebugLine}>meta.title (fetchMeta): {titleDebug.metaTitle || '-'}</Text>
              <Text style={styles.titleDebugLine}>JSON‑LD name/headline: {titleDebug.jsonLdName || '-'}</Text>
              <Text style={styles.titleDebugLine}>og:title: {titleDebug.ogTitle || '-'}</Text>
              <Text style={styles.titleDebugLine}>twitter:title: {titleDebug.twitterTitle || '-'}</Text>
              <Text style={styles.titleDebugLine}>&lt;title&gt; tag: {titleDebug.titleTag || '-'}</Text>
              <Text style={styles.titleDebugLine}>TikTok caption/share: {titleDebug.tiktokCaption || '-'}</Text>
              <Text style={styles.titleDebugLine}>meta description cleaned: {titleDebug.metaDescriptionTitle || '-'}</Text>
              <Text style={styles.titleDebugLine}>slug fallback: {titleDebug.slugTitle || '-'}</Text>
              <Text style={[styles.titleDebugLine, { color: '#93c5fd' }]}>PICKED: {titleDebug.picked || '-'}</Text>
            </View>
          ) : null}

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

          {/* Save */}
          <View style={styles.footer}>
            <Pressable style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={saveRecipe} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save Recipe</Text>}
            </Pressable>
          </View>

          <View style={{ height: 48 }} />
        </ScrollView>

        {/* AutoSnap modal */}
        <AutoSnapModal
          visible={autoSnapVisible}
          url={url}
          colors={colors}
          styles={styles}
          onDone={(durableUrl) => {
            setThumbUrl(durableUrl);
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

// ====== Styles (themed) ======
const makeStyles = (c: ReturnType<typeof useThemeController>['colors']) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
    container: { padding: 16 },
    h1: { color: c.text, fontSize: 22, fontWeight: '700', marginBottom: 12 },
    label: { color: c.mutedText, marginTop: 16, marginBottom: 6, fontSize: 13 },

    input: { borderRadius: 10 },

    row: { flexDirection: 'row', gap: 8, alignItems: 'center' },

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

    btnGhost: { paddingHorizontal: 8, paddingVertical: 10, borderRadius: 10 },
    btnGhostText: { color: c.mutedText },

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

    // Title debugger styles
    titleDebugBox: {
      marginTop: 10,
      padding: 10,
      borderRadius: 10,
      backgroundColor: '#0b1221',
      borderWidth: 1,
      borderColor: '#1f2a44',
      gap: 4,
    },
    titleDebugH: { color: '#93c5fd', fontWeight: '700', marginBottom: 4 },
    titleDebugLine: { color: '#cbd5e1', fontSize: 12 },

    multiBox: {
      backgroundColor: c.cardBg,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: 12,
      padding: 8,
    },
    multiInput: {
      borderRadius: 10,
      marginBottom: 8,
      minHeight: 44,
    },

    addLine: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 6 },
    addLineText: { color: c.tint },

    footer: { marginTop: 18 },
    saveBtn: {
      backgroundColor: c.tint,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      shadowColor: c.shadow,
    },
    saveBtnText: { color: '#ffffff', fontWeight: '700' },

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
