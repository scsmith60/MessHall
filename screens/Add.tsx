// screens/Add.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  FlatList,
  ActivityIndicator,
  Keyboard,
  Pressable,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import ensureDurableThumb from '../lib/ensureDurableThumb';

type AddParams = {
  sharedUrl?: string;
  sharedText?: string;
  sharedImages?: string[];
};

type OgMeta = {
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
};

export default function Add() {
  const route = useRoute<RouteProp<Record<string, AddParams>, string>>();
  const navigation = useNavigation<any>();
  const params = route.params ?? {};

  // Initials from params
  const initialSharedUrl = (params.sharedUrl || '').trim();
  const initialSharedText = (params.sharedText || '').trim();
  const initialSharedImages = Array.isArray(params.sharedImages)
    ? params.sharedImages.filter(Boolean)
    : [];

  // Local state
  const [url, setUrl] = useState(initialSharedUrl);
  const [notes, setNotes] = useState(initialSharedText);
  const [images, setImages] = useState<string[]>(initialSharedImages);

  // OG scan state
  const [og, setOg] = useState<OgMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Durable thumb state
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);

  // Keep a handle to cancel/ignore stale scans
  const scanSeqRef = useRef(0);
  // Prevent duplicate thumb builds
  const thumbSeqRef = useRef(0);

  // Input ref so we can focus when URL is empty
  const urlInputRef = useRef<TextInput>(null);

  // --- Helpers ---------------------------------------------------------------

  const isValidUrl = (s: string) => {
    if (!s) return false;
    try {
      const u = new URL(s);
      return !!u.protocol && !!u.host;
    } catch {
      return false;
    }
  };

  // Make relative image URLs absolute against the page URL
  const absolutize = (maybeUrl: string | undefined, baseUrl: string) => {
    if (!maybeUrl) return undefined;
    try {
      return new URL(maybeUrl, baseUrl).toString();
    } catch {
      return maybeUrl;
    }
  };

  // Tiny OG parser for HTML (title/description/image/sitename)
  const parseOgFromHtml = (html: string): OgMeta => {
    const pick = (prop: string) =>
      html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1] ||
      html.match(new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1];
    const tag = (name: string) =>
      html.match(new RegExp(`<${name}[^>]*>([^<]+)</${name}>`, 'i'))?.[1];

    const ogTitle = pick('og:title') || tag('title') || undefined;
    const ogDesc = pick('og:description') || pick('description') || undefined;
    const ogImg = pick('og:image') || undefined;
    const ogSite = pick('og:site_name') || undefined;

    return {
      title: ogTitle,
      description: ogDesc,
      image: ogImg,
      siteName: ogSite,
    };
  };

  const fetchOg = async (targetUrl: string) => {
    // Increment sequence so stale responses can be ignored
    const mySeq = ++scanSeqRef.current;
    setLoading(true);
    setScanError(null);

    try {
      // Basic fetch of HTML. If you later add a backend metadata proxy, call it here.
      const res = await fetch(targetUrl, { method: 'GET' });
      const text = await res.text();
      if (scanSeqRef.current !== mySeq) return; // stale

      const meta = parseOgFromHtml(text);
      const imageAbs = absolutize(meta.image, targetUrl);
      setOg({ url: targetUrl, ...meta, image: imageAbs });
    } catch {
      if (scanSeqRef.current !== mySeq) return; // stale
      setOg(null);
      setScanError('Could not read link preview.');
    } finally {
      if (scanSeqRef.current === mySeq) setLoading(false);
    }
  };

  // Build a durable thumbnail from the best available source:
  // 1) first shared image (if any), else 2) og.image
  const maybeBuildDurableThumb = async () => {
    const sourceUri = images[0] || og?.image;
    if (!sourceUri) return;

    const myThumbSeq = ++thumbSeqRef.current;
    setThumbBusy(true);
    setThumbError(null);

    try {
      // OPTIONAL: if you have the recipe row already, pass recipeId to enable cleanup
      const recipeId: string | undefined = undefined; // replace when available
      const out = await ensureDurableThumb(sourceUri, {
        recipeId,            // enables auto-cleanup per recipe folder when set
        keyHint: 'main',
        cropMode: 'third',   // 'top' | 'third' | 'center'
        targetWidth: 1200,
        signedUrlSeconds: 60 * 60 * 24 * 30, // 30 days; default is 1 year
      });

      if (thumbSeqRef.current !== myThumbSeq) return; // stale

      if (out?.url) {
        setThumbUrl(out.url);
      } else {
        setThumbError('Could not generate thumbnail.');
      }
    } catch {
      if (thumbSeqRef.current !== myThumbSeq) return; // stale
      setThumbError('Could not generate thumbnail.');
    } finally {
      if (thumbSeqRef.current === myThumbSeq) setThumbBusy(false);
    }
  };

  // UI helpers (Step‑6 polish)
  const handleRetryOg = () => { if (isValidUrl(url)) fetchOg(url); };
  const handleRetryThumb = () => { setThumbUrl(null); setThumbError(null); maybeBuildDurableThumb(); };

  const handleSave = () => {
    // TODO: insert/update Supabase row with:
    // url, notes, title: og?.title, site: og?.siteName, thumb_url: thumbUrl
    // Optionally navigate after save
    // navigation.goBack();
  };
  const handleCancel = () => {
    if (navigation?.goBack) navigation.goBack();
  };

  // --- Effects ---------------------------------------------------------------

  // Keep in sync if this screen receives new share params while mounted
  useEffect(() => {
    const nextUrl = (route.params?.sharedUrl || '').trim();
    if (nextUrl && nextUrl !== url) setUrl(nextUrl);

    const nextText = (route.params?.sharedText || '').trim();
    if (nextText && nextText !== notes) setNotes(nextText);

    const nextImages = Array.isArray(route.params?.sharedImages)
      ? route.params!.sharedImages!.filter(Boolean)
      : [];
    if (nextImages.length && JSON.stringify(nextImages) !== JSON.stringify(images)) {
      setImages(nextImages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.sharedUrl, route.params?.sharedText, route.params?.sharedImages]);

  // Immediately kick off OG scan when landing with a valid URL.
  // Also re-run when URL changes to another valid one (e.g., multiple shares while open).
  useEffect(() => {
    if (isValidUrl(url)) {
      Keyboard.dismiss();
      fetchOg(url);
    } else {
      setOg(null);
      setScanError(null);
      setTimeout(() => urlInputRef.current?.focus(), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // When we have a good candidate image (shared or OG), try to build the durable thumb
  useEffect(() => {
    // Only auto-generate if we don't already have one and not currently building
    if (!thumbUrl && !thumbBusy && (images[0] || og?.image)) {
      maybeBuildDurableThumb();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, og?.image]);

  // --- UI --------------------------------------------------------------------

  // quick pill button (local, to avoid extra file)
  const PillButton = ({
    label,
    onPress,
    variant = 'primary',
    disabled,
  }: {
    label: string;
    onPress?: () => void;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    disabled?: boolean;
  }) => {
    const baseBtn = {
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 9999,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      opacity: disabled ? 0.5 : 1,
    };
    const stylesByVariant: any = {
      primary: { btn: { backgroundColor: '#111', borderColor: '#111' }, txt: { color: '#fff', fontWeight: '600' } },
      secondary:{ btn: { backgroundColor: '#fff', borderColor: '#111' }, txt: { color: '#111', fontWeight: '600' } },
      danger:  { btn: { backgroundColor: '#fff', borderColor: '#b00020' }, txt: { color: '#b00020', fontWeight: '600' } },
      ghost:   { btn: { backgroundColor: 'transparent', borderColor: '#ddd' }, txt: { color: '#111', fontWeight: '600' } },
    };
    return (
      <Pressable onPress={onPress} disabled={disabled} style={[baseBtn, stylesByVariant[variant].btn]} hitSlop={8}>
        <Text style={stylesByVariant[variant].txt}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      {/* URL input (prefilled from share) */}
      <TextInput
        ref={urlInputRef}
        value={url}
        onChangeText={setUrl}
        placeholder="Paste or share a recipe link"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, borderRadius: 8 }}
      />

      {/* Small loading state */}
      {loading && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator />
          <Text>Scanning link…</Text>
        </View>
      )}

      {/* OG preview (polished) */}
      {!loading && og && (og.title || og.image || og.description) && (
        <View style={{ gap: 8, borderWidth: 1, borderColor: '#eee', padding: 12, borderRadius: 12 }}>
          {og.image ? (
            <Image
              source={{ uri: og.image }}
              style={{ width: '100%', height: 160, borderRadius: 8 }}
              resizeMode="cover"
            />
          ) : null}

          {/* Title bigger & bold */}
          {og.title ? <Text style={{ fontSize: 20, fontWeight: '700' }}>{og.title}</Text> : null}

          {/* Site + description */}
          {og.siteName ? <Text style={{ fontWeight: '600' }}>{og.siteName}</Text> : null}
          {og.description ? (
            <Text numberOfLines={3} style={{ color: '#555' }}>
              {og.description}
            </Text>
          ) : null}

          {/* Tiny source label */}
          <Text style={{
            alignSelf: 'flex-start',
            backgroundColor: '#f3f4f6',
            color: '#374151',
            paddingVertical: 4,
            paddingHorizontal: 8,
            borderRadius: 9999,
            fontSize: 12,
          }}>
            Source: {images.length > 0 ? 'Captured snapshot' : og.image ? 'OG image' : 'N/A'}
          </Text>
        </View>
      )}

      {/* OG error + retry */}
      {scanError && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#b00020' }}>{scanError}</Text>
          <PillButton label="Retry" variant="danger" onPress={handleRetryOg} />
        </View>
      )}

      {/* Optional notes from sharedText */}
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes (optional)"
        multiline
        style={{
          borderWidth: 1,
          borderColor: '#ddd',
          padding: 12,
          borderRadius: 8,
          minHeight: 80,
          textAlignVertical: 'top',
        }}
      />

      {/* Optional image previews from sharedImages */}
      {images.length > 0 && (
        <FlatList
          data={images}
          keyExtractor={(uri) => uri}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 12 }}
          renderItem={({ item }) => (
            <Image
              source={{ uri: item }}
              style={{ width: 96, height: 96, borderRadius: 8 }}
              resizeMode="cover"
            />
          )}
        />
      )}

      {/* Durable thumbnail state/preview */}
      {(thumbBusy || thumbUrl || thumbError) && (
        <View style={{ gap: 8, borderWidth: 1, borderColor: '#eee', padding: 12, borderRadius: 8 }}>
          {thumbBusy && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator />
              <Text>Generating thumbnail…</Text>
            </View>
          )}
          {thumbUrl && !thumbBusy && (
            <>
              <Text style={{ fontWeight: '600' }}>Durable thumbnail</Text>
              <Image
                source={{ uri: thumbUrl }}
                style={{ width: '100%', height: 160, borderRadius: 8 }}
                resizeMode="cover"
              />
              {/* Save this to your recipe record on Save */}
            </>
          )}
          {thumbError && !thumbBusy && (
            <View style={{ gap: 8 }}>
              <Text style={{ color: '#b00020' }}>{thumbError}</Text>
              <PillButton label="Retry thumbnail" variant="danger" onPress={handleRetryThumb} />
            </View>
          )}
        </View>
      )}

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        <PillButton label="Save" variant="primary" onPress={handleSave} disabled={thumbBusy} />
        <PillButton label="Cancel" variant="secondary" onPress={handleCancel} />
      </View>
    </View>
  );
}
