import React, { useCallback } from 'react';
import { AppRegistry, Text, View, StyleSheet } from 'react-native';
import * as RNLinking from 'react-native/Libraries/Linking/Linking'; // avoids name clash
import ShareMenu, { ShareData, ShareMenuReactView } from 'react-native-share-menu';

/** ---------- Helpers (match App.tsx) ---------- **/
const URL_CANDIDATE = /^(https?:\/\/|www\.)/i;
function extractUrl(candidate?: string): string {
  if (!candidate) return '';
  try {
    const raw = candidate.trim();
    const normalized =
      URL_CANDIDATE.test(raw) && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
    const u = new URL(normalized);
    return u.href;
  } catch {
    return '';
  }
}

type ParsedShare = { url: string; text: string; images: string[] };

function parseSharePayload(item?: ShareData): ParsedShare {
  if (!item) return { url: '', text: '', images: [] };
  const { mimeType, data, extras } = item as any;

  // Images (activationRules set max:1 for image)
  if (mimeType && String(mimeType).startsWith('image/')) {
    if (Array.isArray(data)) return { url: '', text: '', images: data.filter(Boolean) };
    if (typeof data === 'string') return { url: '', text: '', images: [data] };
  }

  // Text / ambiguous: gather common slots
  const candidates = []
    .concat(data ?? [])
    .concat(extras?.['android.intent.extra.TEXT'] ?? [])
    .concat(extras?.['android.intent.extra.STREAM'] ?? []);
  const flat = (candidates as any[]).flat().filter(Boolean).map(String);

  for (const c of flat) {
    const hit = extractUrl(c);
    if (hit) return { url: hit, text: '', images: [] };
  }

  // No URL—keep plain text if present
  if (typeof data === 'string' && data.trim()) {
    return { url: '', text: data.trim(), images: [] };
  }

  return { url: '', text: '', images: [] };
}
/** ------------------------------------------- **/

export default function ShareExtensionRoot() {
  // Instant handoff: no UI, just forward and close.
  const onShare = useCallback((item?: ShareData) => {
    const parsed = parseSharePayload(item);

    // Build deep link with only the params we have
    const q: string[] = [];
    if (parsed.url) q.push(`sharedUrl=${encodeURIComponent(parsed.url)}`);
    if (parsed.text) q.push(`sharedText=${encodeURIComponent(parsed.text)}`);
    if (parsed.images?.[0]) q.push(`sharedImages=${encodeURIComponent(parsed.images[0])}`);

    const deeplink = `messhall://add${q.length ? `?${q.join('&')}` : ''}`;

    // Slight delay so iOS can close the extension before opening the app
    setTimeout(() => {
      try { (ShareMenu as any).dismissExtension?.(); } catch {}
      RNLinking.openURL(deeplink).catch(() => {});
    }, 60);
  }, []);

  return (
    <ShareMenuReactView onShare={onShare}>
      {/* Fallback “no-UI UI”: shown for a split-second while handing off */}
      <View style={S.wrap}>
        <Text style={S.text}>Opening MessHall…</Text>
      </View>
    </ShareMenuReactView>
  );
}

const S = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  text: { color: 'white', fontSize: 16, opacity: 0.7 },
});

// If your config expects registration (some setups do):
AppRegistry.registerComponent('ShareExtension', () => ShareExtensionRoot);
