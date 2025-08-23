// App.tsx
// MessHall — root app wiring
// - Navigation (stack)
// - Deep linking (scheme: messhall) for Add + Reset Password
// - Supabase session restore & listener
// - Android share-intent (react-native-share-menu) → navigates to Add with sharedUrl
// - Safe-area + Theme + Toast providers
// - Defensive dynamic imports, lifecycle-safe navigation

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Linking from 'expo-linking';

import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// ---- Supabase client ----
import { supabase } from './lib/supabaseClient';

// ---- Theme provider ----
import { ThemeProvider, useThemeController } from './lib/theme';

// ---- Toast provider (wrap at root; screens can call useToast there) ----
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
// 3) Share intent (Android)
// ==========================
type ShareData = {
  mimeType?: string | null;
  data?: string | null;
  extraData?: string | null;
  subject?: string | null;
  title?: string | null;
  urls?: string[] | null;
};

function pickSharedUrl(payload: ShareData): string | undefined {
  const isUrlLike = (s?: string | null) => !!s && /^(https?:\/\/|messhall:\/\/)/i.test(s.trim());
  if (payload?.urls?.length) {
    const first = payload.urls.find((u) => isUrlLike(u));
    if (first) return first.trim();
  }
  if (isUrlLike(payload?.data)) return payload!.data!.trim();
  if (isUrlLike(payload?.extraData)) return payload!.extraData!.trim();
  const blob = `${payload?.data || ''}\n${payload?.extraData || ''}`;
  const match = blob.match(/https?:\/\/[^\s]+/i);
  return match?.[0]?.trim();
}

// ==========================
// 4) Inner app with session + handlers
// ==========================
function AppInner() {
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const [session, setSession] =
    useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] | null>(null);
  const [ready, setReady] = useState(false);

  const lastHandledRef = useRef<string | null>(null);
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
        if (lastHandledRef.current === url) return;
        lastHandledRef.current = url;

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

  // ---- Track app state (optional, kept for future logic)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
    });
    return () => sub.remove();
  }, []);

  // ---- Android Share Target (react-native-share-menu)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let removeListener: undefined | (() => void);
    let cancelled = false;

    (async () => {
      try {
        const ShareMenu = (await import('react-native-share-menu')).default;
        const { ShareMenuReactView } = await import('react-native-share-menu');

        removeListener = ShareMenu.addNewShareListener((sharedItem: ShareData) => {
          if (cancelled) return;
          const sharedUrl = pickSharedUrl(sharedItem);
          if (!sharedUrl) return;
          if (navRef.isReady()) navRef.navigate('Add', { sharedUrl });
        });

        ShareMenuReactView?.getSharedItem?.((sharedItem: ShareData | null) => {
          if (cancelled || !sharedItem) return;
          const sharedUrl = pickSharedUrl(sharedItem);
          if (!sharedUrl) return;
          if (navRef.isReady()) {
            navRef.navigate('Add', { sharedUrl });
          } else {
            setTimeout(() => {
              if (navRef.isReady()) navRef.navigate('Add', { sharedUrl });
            }, 150);
          }
        });
      } catch {
        // Module not installed or environment mismatch — ignore gracefully
      }
    })();

    return () => {
      cancelled = true;
      if (removeListener) try { removeListener(); } catch {}
    };
  }, [navRef]);

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
            <Stack.Screen name="RecipeEdit" component={RecipeEdit} />
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
          <ThemeGate>
            <AppInner />
          </ThemeGate>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
