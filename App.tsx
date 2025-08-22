import React, { useEffect } from 'react';
import ShareMenu, { ShareData } from 'react-native-share-menu';
import * as Linking from 'expo-linking';
import {
  NavigationContainer,
  useNavigationContainerRef,
  LinkingOptions,
} from '@react-navigation/native';

/** ---------- Route types ---------- **/
type RootStackParamList = {
  Add: { sharedUrl?: string; sharedText?: string; sharedImages?: string[] } | undefined;
  Recipe: { id: string };
  // ...add others as you grow
};

/** ---------- Step 6 helpers ---------- **/
// Accepts http/https and "www." (normalizes to https)
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

// Coalesce ShareData into { url | text | images }
function parseSharePayload(item?: ShareData): ParsedShare {
  if (!item) return { url: '', text: '', images: [] };

  const { mimeType, data, extras } = item as any;

  // Images
  if (mimeType && String(mimeType).startsWith('image/')) {
    if (Array.isArray(data)) return { url: '', text: '', images: data.filter(Boolean) };
    if (typeof data === 'string') return { url: '', text: '', images: [data] };
  }

  // Text / ambiguous
  const candidates = []
    .concat(data ?? [])
    .concat(extras?.['android.intent.extra.TEXT'] ?? [])
    .concat(extras?.['android.intent.extra.STREAM'] ?? []);
  const flat = (candidates as any[]).flat().filter(Boolean).map(String);

  for (const c of flat) {
    const hit = extractUrl(c);
    if (hit) return { url: hit, text: '', images: [] };
  }

  if (typeof data === 'string' && data.trim()) {
    return { url: '', text: data.trim(), images: [] };
  }

  return { url: '', text: '', images: [] };
}

/** ---------- Linking config ---------- **/
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['messhall://'],
  config: {
    screens: {
      Add: 'add',              // messhall://add
      Recipe: 'recipe/:id',    // messhall://recipe/123
    },
  },
  getInitialURL: () => Linking.getInitialURL(),
  subscribe: (listener) => {
    const sub = Linking.addEventListener('url', ({ url }) => listener(url));
    return () => sub.remove();
  },
};
/** ------------------------------------ **/

export default function App() {
  const navRef = useNavigationContainerRef<RootStackParamList>();

  useEffect(() => {
    const navigateToAdd = (payload: ParsedShare) => {
      const hasSomething =
        !!payload.url || !!payload.text || (payload.images && payload.images.length > 0);
      if (!hasSomething) return;

      const params = {
        sharedUrl: payload.url || '',
        sharedText: payload.text || '',
        sharedImages: payload.images || [],
      } as never;

      const go = () => navRef.navigate('Add' as never, params);

      if (navRef.isReady()) {
        go();
      } else {
        const unsub = navRef.addListener('state', () => {
          if (navRef.isReady()) {
            go();
            unsub();
          }
        });
      }
    };

    const handleShare = (item?: ShareData) => {
      const parsed = parseSharePayload(item);
      navigateToAdd(parsed);
    };

    // Initial share (cold start) + legacy fallback
    ShareMenu.getInitialShare?.((initial?: ShareData) => handleShare(initial));
    (ShareMenu as any).getSharedItems?.().then(handleShare).catch(() => {});

    // New shares while app is running
    const listener = ShareMenu.addNewShareListener(handleShare);
    return () => listener?.remove?.();
  }, [navRef]);

  // Simple analytics hook
  const onStateChange = () => {
    const route = navRef.getCurrentRoute();
    if (!route) return;
    // Replace with your analytics call
    console.log('[nav]', route.name, route.params);
  };

  return (
    <NavigationContainer linking={linking} ref={navRef} onStateChange={onStateChange}>
      {/* your stacks here */}
    </NavigationContainer>
  );
}
