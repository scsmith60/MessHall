// screens/Add.tsx
// MessHall — Add screen (themed, TikTok auto-snap)
// - Robust TikTok thumb via helpers (no login banners)
// - Auto WebView screenshot fallback (no button; delay + capture + upload)
// - Pasting or sharing a URL enriches immediately
// - SafeArea padding + tap-to-enlarge thumbnail

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

// ---- Optional helpers (expected to exist; safe fallbacks if they don't) ----
let ensureDurableThumb:
  | undefined
  | ((src: string) => Promise<{ publicUrl: string; bucketPath?: string; uri?: string }>);
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ensureDurableThumb =
    require('../lib/ensureDurableThumb').ensureDurableThumb ||
    require('../lib/ensureDurableThumb').default;
} catch {
  /* optional */
}

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
} catch {
  /* optional */
}

// ---- Types ----
type AddRoute = RouteProp<RootStackParamList, 'Add'>;

// Basic URL validator (generous)
const looksLikeUrl = (s?: string) => !!s && /^https?:\/\/[^\s]+/i.test(s.trim());

// Normalize arrays produced by parsers; remove empties/dupes
const uniq = (arr: string[]) =>
  Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));

// ===== AutoSnap Modal (WebView + ViewShot) =====
// NOTE: We pass `styles` from the parent so this component doesn’t try to use it out of scope.
type AutoSnapModalProps = {
  visible: boolean;
  url: string;
  onDone: (durableUrl: string) => void;
  onCancel: () => void;
  colors: ReturnType<typeof useThemeController>['colors'];
  styles: ReturnType<typeof makeStyles>; // receive themed styles
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

  useEffect(() => {
    (async () => {
      try {
        const modWV = await import('react-native-webview');
        const WV = (modWV as any).WebView || (modWV as any).default;
        setWebViewComp(() => WV || null);
      } catch (e) {
        console.warn('[autosnap] webview import failed', e);
        setWebViewComp(() => null);
      }
      try {
        const modVS = await import('react-native-view-shot');
        const VS = (modVS as any).ViewShot || (modVS as any).default;
        setViewShotComp(() => VS || null);
      } catch (e) {
        console.warn('[autosnap] view-shot import failed', e);
        setViewShotComp(() => null);
      }
    })();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!visible) return null;

  if (!WebViewComp || !ViewShotComp) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Preview unavailable</Text>
            <Text style={{ color: colors.mutedText, marginBottom: 12 }}>
              Please install <Text style={{ fontWeight: '700' }}>react-native-webview</Text> and{' '}
              <Text style={{ fontWeight: '700' }}>react-native-view-shot</Text>.
            </Text>
            <Pressable style={styles.btnNeutral} onPress={onCancel}>
              <Text style={styles.btnNeutralText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  // Try to hide common promo/login chrome via injected CSS (best-effort)
  const injectedJS = `
    (function() {
      const st = document.createElement('style');
      st.innerHTML = \`
        header, footer, .tiktok-top, .tiktok-header, .tiktok-footer,
        [data-e2e="banner"], [data-e2e="openAppButton"], .download-app,
        .login-guide, .app-open, .bottomSheet, .sticky, .sidebar
        { display:none !important; visibility:hidden !important; }
        body { background: #fff !important; }
      \`;
      document.documentElement.appendChild(st);
      true;
    })();
  `;

  const handleLoadEnd = () => {
    if (snapping) return;
    setSnapping(true);
    timerRef.current = setTimeout(async () => {
      try {
        const uri: string = await viewShotRef.current?.capture?.({
          format: 'jpg',
          quality: 0.9,
          result: 'tmpfile',
        });
        if (!uri) throw new Error('ViewShot returned empty URI');

        if (ensureDurableThumb) {
          const out = await ensureDurableThumb(uri);
          onDone(out.publicUrl || out.uri || uri);
        } else {
          onDone(uri);
        }
      } catch (e) {
        console.warn('[autosnap:capture]', e);
        onCancel();
      } finally {
        setSnapping(false);
      }
    }, delayMs);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Preparing preview…</Text>
          <ViewShotComp ref={viewShotRef} style={{ borderRadius: 12, overflow: 'hidden' }}>
            <WebViewComp
              source={{ uri: url }}
              onLoadEnd={handleLoadEnd}
              injectedJavaScript={injectedJS}
              javaScriptEnabled
              domStorageEnabled
              userAgent={'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'}
              style={{ width: 360, height: 460, borderRadius: 12, backgroundColor: '#fff' }}
            />
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

// ===== Lazy WebView (kept for any manual preview code) =====
function LazyWebView({ url, height = 420 }: { url: string; height?: number }) {
  const [Comp, setComp] = useState<any>(null);
  useEffect(() => {
    (async () => {
      try {
        const mod = await import('react-native-webview');
        setComp(() => (mod as any).WebView || (mod as any).default || null);
      } catch {
        setComp(() => null);
      }
    })();
  }, []);
  if (!Comp) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text>Install react-native-webview to preview</Text>
      </View>
    );
  }
  return <Comp source={{ uri: url }} style={{ height, borderRadius: 12, overflow: 'hidden' }} />;
}

// ===== Main screen =====
export default function Add() {
  const route = useRoute<AddRoute>();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();

  // THEME
  const { colors, getThemedInputProps } = useThemeController();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ====== State ======
  const initialSharedUrl = (route.params?.sharedUrl || '').trim();
  const [url, setUrl] = useState(initialSharedUrl);
  const [title, setTitle] = useState('');
  const [thumbUrl, setThumbUrl] = useState<string>(''); // public URL (storage or remote)
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoEnrichOnMount] = useState<boolean>(looksLikeUrl(initialSharedUrl));

  // Auto-snap modal visibility
  const [autoSnapVisible, setAutoSnapVisible] = useState(false);

  // Tap-to-enlarge thumbnail
  const [thumbModal, setThumbModal] = useState(false);

  // Avoid clobbering manual edits if a new share arrives
  const userTouchedUrlRef = useRef(false);

  // ====== Sync URL if a new share arrives while this screen is active ======
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.sharedUrl]);

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
        if (!cancelled && res && !res.hadImage) {
          setAutoSnapVisible(true);
        }
      } catch (e) {
        console.warn('[add:autoEnrich]', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEnrichOnMount]);

  // ====== Actions ======
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
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsMultipleSelection: false,
      });
      if (res.canceled || !res.assets?.length) return;

      const localUri = res.assets[0].uri; // may be content:// or file://
      setLoading(true);

      if (ensureDurableThumb) {
        try {
          const out = await ensureDurableThumb(localUri);
          setThumbUrl(out.publicUrl || out.uri || localUri);
        } catch (e: any) {
          console.warn('[add:pickImage ensureDurableThumb]', e);
          const msg = typeof e?.message === 'string' ? e.message : String(e);
          Alert.alert('Image error', `Could not prepare the image.\n\n${msg}`);
        }
      } else {
        setThumbUrl(localUri);
      }
    } catch (e: any) {
      console.warn('[add:pickImage]', e);
      const msg = typeof e?.message === 'string' ? e.message : String(e);
      Alert.alert('Image error', `Could not prepare the image.\n\n${msg}`);
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

        // 2) Determine a thumbnail:
        //    (a) Use meta.image if present
        //    (b) If TikTok and no image, use robust finder
        //    (c) If still none, caller will auto-snap via WebView
        let finalThumb = '';
        let hadImage = !!meta.image;

        if (meta.image) {
          if (ensureDurableThumb) {
            try {
              const { publicUrl, uri } = await ensureDurableThumb(meta.image);
              finalThumb = publicUrl || uri || meta.image;
            } catch (e) {
              console.warn('[add:ensureDurableThumb]', e);
              finalThumb = meta.image; // fall back to remote
            }
          } else {
            finalThumb = meta.image;
          }
        } else if (isTikTokUrl(theUrl)) {
          try {
            const tikThumb = await fetchTikTokThumbRobust(theUrl);
            if (tikThumb) {
              hadImage = true; // we got a clean image
              if (ensureDurableThumb) {
                const { publicUrl, uri } = await ensureDurableThumb(tikThumb);
                finalThumb = publicUrl || uri || tikThumb;
              } else {
                finalThumb = tikThumb;
              }
            }
          } catch (e) {
            console.warn('[add:tiktok-thumb]', e);
          }
        }

        // 3) Set state
        setTitle(meta.title || '');
        if (finalThumb) setThumbUrl(finalThumb);
        setIngredients(cleanedIngredients);
        setSteps(cleanedSteps);

        return { ok: true, hadImage };
      } catch (e: any) {
        console.warn('[add:enrich]', e?.message || e);
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
    <SafeAreaView style={[styles.flex, { paddingTop: Math.max(insets.top, 8) }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.h1}>Add Recipe</Text>

          {/* URL Input Row */}
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
              {loading ? (
                <ActivityIndicator size="small" color={colors.tint} />
              ) : (
                <Text style={styles.btnNeutralText}>Enrich</Text>
              )}
            </Pressable>

            <Pressable style={styles.btnNeutral} onPress={pickImage}>
              <Text style={styles.btnNeutralText}>Pick Image</Text>
            </Pressable>

            {/* Clear */}
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

          {/* Thumbnail Preview (tap to enlarge) */}
          {thumbUrl ? (
            <Pressable style={styles.thumbWrap} onPress={() => setThumbModal(true)}>
              <Image source={{ uri: thumbUrl }} style={styles.thumb} resizeMode="cover" />
            </Pressable>
          ) : null}

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
                  setIngredients(
                    copy.filter((x, i) => (i === copy.length - 1 ? true : x !== '' || i < copy.length - 1))
                  );
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
                  setSteps(
                    copy.filter((x, i) => (i === copy.length - 1 ? true : x !== '' || i < copy.length - 1))
                  );
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
            <Pressable
              style={[styles.saveBtn, saving && styles.btnDisabled]}
              onPress={saveRecipe}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Save Recipe</Text>
              )}
            </Pressable>
          </View>

          <View style={{ height: 48 }} />
        </ScrollView>

        {/* AutoSnap modal — opens automatically only if we couldn't find a thumbnail */}
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
              <Image source={{ uri: thumbUrl }} style={styles.thumbFullscreen} resizeMode="contain" />
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
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.cardBg,
    },
    thumb: { width: '100%', height: 180 },

    // Fullscreen thumb modal
    thumbBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.9)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    thumbFullscreen: { width: '100%', height: '80%', borderRadius: 12 },

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

    // Modal shell reused by AutoSnap dependency-missing message
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
