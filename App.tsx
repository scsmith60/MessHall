// App.tsx
// MessHall — root app wiring
// - Navigation (stack)
// - Deep linking (scheme: messhall) for Add + Reset Password
// - Supabase session restore & listener
// - Cross-platform share intent (expo-share-intent) → navigates to Add with sharedUrl
// - Safe-area + Theme + Toast providers

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import 'react-native-gesture-handler';
import { AppState, AppStateStatus } from 'react-native';
import * as Linking from 'expo-linking';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';

import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// ---- Supabase client ----
import { supabase } from './lib/supabaseClient';

// ---- Theme provider ----
import { ThemeProvider, useThemeController } from './lib/theme';

// ---- Toast provider ----
import { ToastProvider } from './components/ToastProvider';

// ---- Screens ----
import SignIn from './screens/SignIn';
import Home from './screens/Home';
import Add from './screens/Add';
import Recipe from './screens/Recipe';
import Profile from './screens/Profile';
import ResetPasswordScreen from './screens/ResetPasswordScreen';

// ==========================
// 1) Navigation types
// ==========================
export type RootStackParamList = {
  SignIn: undefined;
  Home: undefined;
  Add: { sharedUrl?: string } | undefined;
  Recipe: { id: string } | undefined;
  Profile: undefined;
  ResetPassword: { access_token?: string; email?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const screenOptions: NativeStackNavigationOptions = {
  headerShown: false,
  animation: 'slide_from_right',
};

// ==========================
// 2) Deep linking config
// ==========================
// Scheme must match app.json → expo.scheme = "messhall"
const linking = {
  prefixes: [Linking.createURL('/'), 'messhall://'],
  config: {
    initialRouteName: 'Home',
    screens: {
      Add: 'add',
      ResetPassword: 'reset-password',
      Home: 'home',
      Recipe: 'recipe/:id',
      Profile: 'profile',
      SignIn: 'signin',
    },
  },
};

// ==========================
// 3) Share intent helpers
// ==========================
type ShareIntentPayload = {
  text?: string | null;
  url?: string | null;
  webUrl?: string | null;
  files?: Array<{ uri?: string | null; path?: string | null; mimeType?: string | null }>;
  meta?: Record<string, unknown>;
};

function pickSharedUrlFromShareIntent(si?: ShareIntentPayload | null): string | undefined {
  if (!si) return;
  const isUrl = (s?: string | null) => !!s && /^https?:\/\//i.test(s.trim());
  // Prefer explicit web/url fields
  if (isUrl(si.webUrl)) return si.webUrl!.trim();
  if (isUrl(si.url)) return si.url!.trim();
  // Fallback: scan text for a URL
  const t = si.text ?? '';
  const match = t.match(/https?:\/\/[^\s]+/i);
  if (match?.[0]) return match[0].trim();
  // (Optional) consider file:// or content:// if Add supports it later
  return undefined;
}

// ==========================
// 4) Inner app with session + handlers
// ==========================
function AppInner() {
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const [session, setSession] =
    useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] | null>(null);
  const [ready, setReady] = useState(false);

  const lastHandledLinkRef = useRef<string | null>(null);
  const shareHandledRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ---- Restore session / listen for auth changes
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, _session) => {
      setSession(_session);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ---- Handle deep links that need param mapping
  const handleUrlNav = useCallback(
    (url: string) => {
      try {
        if (lastHandledLinkRef.current === url) return;
        lastHandledLinkRef.current = url;

        const parsed = Linking.parse(url);

        if (parsed.path?.startsWith('reset-password')) {
          const access_token = (parsed.queryParams?.access_token as string) || undefined;
          const email = (parsed.queryParams?.email as string) || undefined;
          if (navRef.isReady()) navRef.navigate('ResetPassword', { access_token, email });
          return;
        }

        if (parsed.path?.startsWith('add')) {
          const sharedUrl = (parsed.queryParams?.sharedUrl as string) || undefined;
          if (navRef.isReady()) navRef.navigate('Add', { sharedUrl });
          return;
        }

        // Let React Navigation handle other links via `linking` config.
      } catch {
        // ignore malformed links
      }
    },
    [navRef]
  );

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => handleUrlNav(url));
    (async () => {
      const initial = await Linking.getInitialURL();
      if (initial) handleUrlNav(initial);
    })();
    return () => sub.remove();
  }, [handleUrlNav]);

  // ---- Track app state (optional)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
    });
    return () => sub.remove();
  }, []);

  // ---- Cross-platform Share Target (expo-share-intent)
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;
    if (shareHandledRef.current) return;

    const sharedUrl = pickSharedUrlFromShareIntent(shareIntent as ShareIntentPayload);
    // Navigate as soon as the navigator is ready; small fallback delay helps on cold start.
    const go = () => {
      if (sharedUrl && navRef.isReady()) {
        navRef.navigate('Add', { sharedUrl });
        shareHandledRef.current = true;
        resetShareIntent?.();
      } else if (sharedUrl) {
        setTimeout(go, 120);
      }
    };
    go();
  }, [hasShareIntent, shareIntent, navRef, resetShareIntent]);

  // ---- Decide initial route
  const initialRouteName = useMemo<keyof RootStackParamList>(() => {
    return session ? 'Home' : 'SignIn';
  }, [session]);

  if (!ready) {
    // Keep native splash or a tiny placeholder here if you wish.
    return null;
  }

  return (
    <NavigationContainer ref={navRef} linking={linking}>
      <Stack.Navigator initialRouteName={initialRouteName} screenOptions={screenOptions}>
        {session ? (
          <>
            <Stack.Screen name="Home" component={Home} />
            <Stack.Screen name="Add" component={Add} />
            <Stack.Screen name="Recipe" component={Recipe} />
            <Stack.Screen name="Profile" component={Profile} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="SignIn" component={SignIn} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
            {/* Let Add open even when logged out; it can bounce to SignIn internally if needed */}
            <Stack.Screen name="Add" component={Add} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ==========================
// 5) Root with providers
// ==========================
function ThemeGate({ children }: { children: React.ReactNode }) {
  const { ready } = useThemeController();
  if (!ready) return null;
  return <>{children}</>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <ShareIntentProvider>
            <ThemeGate>
              <AppInner />
            </ThemeGate>
          </ShareIntentProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
