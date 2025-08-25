// screens/Add.tsx
// MessHall — Add screen (themed, TikTok auto-snap, thumbnail debugger)
// - Fixes Android black-image issue (no overflow clipping; radius on Image)
// - Adds DEBUG_THUMBS panel + logs to inspect why preview fails
// - Prefetch + getSize preflight; HEAD/Range check for signed URL reachability
// - Auto WebView screenshot fallback + TikTok robust thumb
// - SafeArea padding + tap-to-enlarge thumbnail
// - *** Title extraction hardening: prefers JSON-LD/OG/Twitter/TikTok SIGI_STATE, cleans site slogans, avoids numeric slugs

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

// ===== DEBUG SWITCH =====
const DEBUG_THUMBS = true;

/** --- Title extraction helpers (inline so this file "just works") --- */
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
  // strip " | Site" / " - Site" style suffixes
  out = out.replace(/\s*[|–-]\s*(TikTok|YouTube|Instagram|Pinterest|Allrecipes|Food Network|NYT Cooking).*/i, '');
  // collapse whitespace
  return out.replace(/\s{2,}/g, ' ').trim();
}

function isMostlyDigitsOrJunk(s: string) {
  const trimmed = s.trim();
  if (!trimmed) return true;
  if (/^\d+$/.test(trimmed)) return true;                   // pure digits
  if (/^[0-9_-]+$/.test(trimmed)) return true;              // digits/underscores/dashes
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) return true;        // hex-ish IDs
  const letters = (trimmed.match(/[A-Za-z]/g) || []).length;
  const ratio = letters / trimmed.length;
  if (ratio < 0.25) return true;                            // not enough letters
  return false;
}

function isBadTitle(t?: string) {
  if (!t) return true;
  const c = cleanTitle(t);
  if (!c) return true;
  if (BAD_TITLES.has(c)) return true;
  if (c.length < 3) return true;
  if (isMostlyDigitsOrJunk(c)) return true;
  return false;
}

function fallbackTitleFromUrl(u: string) {
  try {
    const { pathname } = new URL(u);
    const last = pathname.split('/').filter(Boolean).pop() || '';
    const cleaned = decodeURIComponent(last.replace(/[-_]+/g, ' ')).trim();
    if (!cleaned || isMostlyDigitsOrJunk(cleaned)) return ''; // refuse numeric/ID slugs
    return cleaned.replace(/\b\w/g, c => c.toUpperCase());
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

function extractDescCandidates(html: string) {
  const descs = [
    pickMetaContent(html, 'og:description'),
    pickMetaContent(html, 'twitter:description'),
  ].filter(Boolean);
  const best = descs.find(d => !isBadTitle(d)) || '';
  return cleanTitle(best);
}

function extractFromTikTokSIGI(html: string) {
  const m = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
  const json = safeJSON<any>(m?.[1]);
  if (!json) return '';
  const itemModule = json?.ItemModule;
  if (itemModule && typeof itemModule === 'object') {
    const first: any = Object.values(itemModule)[0];
    const desc = (first?.desc || '').toString().trim();
    if (!isBadTitle(desc)) return desc; // prefer non-junk caption
  }
  return '';
}

async function fetchAndExtractTitle(rawUrl: string): Promise<{ title?: string; canonical?: string }> {
  try {
    const res = await fetch(rawUrl, { redirect: 'follow' });
    const finalUrl = (res as any)?.url || rawUrl;
    const html = await res.text();

    const canonical = pickLinkRel(html, 'canonical') || pickMetaContent(html, 'og:url') || finalUrl;

    // Try title sources
    let t =
      extractFromJSONLD(html) ||
      pickMetaContent(html, 'og:title') ||
      pickMetaContent(html, 'twitter:title') ||
      pickTitleTag(html) ||
      '';

    t = cleanTitle(t);

    // If bad, try TikTok SIGI desc or general meta descriptions
    if (isBadTitle(t)) {
      const tk = extractFromTikTokSIGI(html);
      if (!isBadTitle(tk)) t = tk;
    }
    if (isBadTitle(t)) {
      const desc = extractDescCandidates(html);
      if (!isBadTitle(desc)) t = desc;
    }

    // As absolute last resort, use slug — but only if not junk
    if (isBadTitle(t)) {
      const slug = fallbackTitleFromUrl(finalUrl);
      if (!isBadTitle(slug)) t = slug;
    }

    return { title: isBadTitle(t) ? undefined : t, canonical };
  } catch {
    return {};
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

/** Thumb with debug */
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
            setDbg((d) => ({ ...d, onErrorEvt: e?.nativeEvent }));
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
      {DEBUG_THUMBS && (
        <View style={{ marginTop: 6, padding: 8, backgroundColor: '#0b1221', borderRadius: 8 }}>
          <Text style={{ color: '#93c5fd', fontWeight: '700', marginBottom: 4 }}>Thumbnail Debug</Text>
          <Text style={{ color: '#cbd5e1' }} numberOfLines={3}>uri: {uri}</Text>
          <Text style={{ color: '#cbd5e1' }} numberOfLines={2}>displayUri: {displayUri}</Text>
          <Text style={{ color: '#e2e8f0' }}>
            signed: {String(dbg.isSigned)} | getSizeOK: {String(dbg.getSizeOK)} {dbg.width && dbg.height ? `(${dbg.width}×${dbg.height})` : ''}
          </Text>
          {dbg.getSizeErr ? <Text style={{ color: '#fca5a5' }}>getSizeErr: {dbg.getSizeErr}</Text> : null}
          <Text style={{ color: '#e2e8f0' }}>
            prefetchOK: {String(dbg.prefetchOK)}
          </Text>
          {dbg.prefetchErr ? <Text style={{ color: '#fca5a5' }}>prefetchErr: {dbg.prefetchErr}</Text> : null}
          <Text style={{ color: '#e2e8f0' }}>
            headStatus: {dbg.headStatus ?? '-'} | ct: {dbg.headCT ?? '-'} | len: {dbg.headLen ?? '-'}
          </Text>
          {dbg.headErr ? <Text style={{ color: '#fca5a5' }}>headErr: {dbg.headErr}</Text> : null}
          {dbg.onErrorEvt ? <Text style={{ color: '#fca5a5' }}>imageError: {JSON.stringify(dbg.onErrorEvt)}</Text> : null}
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
        const uri: string = await (viewShotRef.current?.capture?.({
          format: 'jpg',
          quality: 0.95,
          result: 'tmpfile',
        }) as Promise<string>);
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

        // --- TITLE: robust selection with junk/ID guards
        let nextTitle = cleanTitle(meta.title || '');
        if (isBadTitle(nextTitle)) {
          const { title: better, canonical } = await fetchAndExtractTitle(theUrl);
          if (better && !isBadTitle(better)) nextTitle = better;
          if (canonical && canonical !== theUrl) setUrl(canonical); // adopt canonical for future enriches
        }
        // If still bad, do NOT force a numeric slug — leave empty so the user can type
        if (isBadTitle(nextTitle)) nextTitle = '';

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

      // 1) Create the base recipe row
      const base = {
        user_id: user.id,
        title: title.trim(),
        source_url: looksLikeUrl(url) ? url.trim() : null,
        thumb_path: thumbUrl || null, // <-- matches your schema
        created_at: new Date().toISOString(),
      };

      const { data: created, error: createErr } = await supabase
        .from('recipes')
        .insert(base)
        .select('id')
        .single();

      if (createErr) throw createErr;
      const newId = created.id as string;

      // 2) Insert ingredients as rows (raw/pos)
      const ingRows = (ingredients || [])
        .map(s => s?.trim())
        .filter(Boolean)
        .map((raw, idx) => ({ recipe_id: newId, raw, pos: idx }));

      if (ingRows.length) {
        const { error: insIngErr } = await supabase.from('recipe_ingredients').insert(ingRows);
        if (insIngErr) throw insIngErr;
      }

      // 3) Insert steps as rows (step_text/position)
      const stepRows = (steps || [])
        .map(s => s?.trim())
        .filter(Boolean)
        .map((step_text, idx) => ({ recipe_id: newId, step_text, position: idx }));

      if (stepRows.length) {
        const { error: insStepErr } = await supabase.from('recipe_steps').insert(stepRows);
        if (insStepErr) throw insStepErr;
      }

      Alert.alert('Saved', 'Your recipe has been saved.');
      // Optionally: nav.navigate('Recipe' as never, { id: newId } as never);
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
                onError={(e) => {
                  if (DEBUG_THUMBS) console.warn('[Thumb Fullscreen:onError]', e?.nativeEvent);
                }}
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

    thumbWrap: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.cardBg,
      borderRadius: 12,
      padding: 0,
    },
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
