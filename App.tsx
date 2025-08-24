// App.tsx
// MessHall — root app wiring

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import 'react-native-gesture-handler';
import { AppState, AppStateStatus } from 'react-native';
import * as Linking from 'expo-linking';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';

import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { supabase } from './lib/supabaseClient';
import { ThemeProvider, useThemeController } from './lib/theme';
import { ToastProvider } from './components/ToastProvider';

// Screens
import SignIn from './screens/SignIn';
import Home from './screens/Home';
import Add from './screens/Add';
import Recipe from './screens/Recipe';
import RecipeEdit from './screens/RecipeEdit';
import Profile from './screens/Profile';
import ResetPasswordScreen from './screens/ResetPasswordScreen';

// ---------- Navigation types ----------
export type RootStackParamList = {
  SignIn: undefined;
  Home: undefined;
  Add: { sharedUrl?: string } | undefined;
  Recipe: { id: string } | undefined;
  RecipeEdit: { id: string };
  Profile: undefined;
  ResetPassword: { access_token?: string; email?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const screenOptions: NativeStackNavigationOptions = {
  headerShown: false,
  animation: 'slide_from_right',
};

// ---------- Deep linking ----------
const linking = {
  prefixes: [Linking.createURL('/'), 'messhall://'],
  config: {
    initialRouteName: 'Home',
    screens: {
      Add: 'add',
      ResetPassword: 'reset-password',
      Home: 'home',
      Recipe: 'recipe/:id',
      RecipeEdit: 'recipe-edit/:id',
      Profile: 'profile',
      SignIn: 'signin',
    },
  },
};

// ---------- Share intent helpers ----------
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
  if (isUrl(si.webUrl)) return si.webUrl!.trim();
  if (isUrl(si.url)) return si.url!.trim();
  const t = si.text ?? '';
  const match = t.match(/https?:\/\/[^\s]+/i);
  return match?.[0]?.trim();
}

// ---------- Inner app ----------
function AppInner() {
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const [session, setSession] =
    useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] | null>(null);
  const [ready, setReady] = useState(false);

  const lastHandledLinkRef = useRef<string | null>(null);
  const shareHandledRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, _session) => setSession(_session));
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

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
      } catch {}
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

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appStateRef.current = state;
    });
    return () => sub.remove();
  }, []);

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent || !shareIntent || shareHandledRef.current) return;
    const sharedUrl = pickSharedUrlFromShareIntent(shareIntent as ShareIntentPayload);
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

  const initialRouteName = useMemo<keyof RootStackParamList>(() => (session ? 'Home' : 'SignIn'), [session]);

  if (!ready) return null;

  return (
    <NavigationContainer ref={navRef} linking={linking}>
      <Stack.Navigator initialRouteName={initialRouteName} screenOptions={screenOptions}>
        {session ? (
          <Stack.Group>
            <Stack.Screen name="Home" component={Home} />
            <Stack.Screen name="Add" component={Add} />
            <Stack.Screen name="Recipe" component={Recipe} />
            <Stack.Screen name="RecipeEdit" component={RecipeEdit} />
            <Stack.Screen name="Profile" component={Profile} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          </Stack.Group>
        ) : (
          <Stack.Group>
            <Stack.Screen name="SignIn" component={SignIn} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
            {/* Allow Add while logged out; it can route to SignIn internally if needed */}
            <Stack.Screen name="Add" component={Add} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ---------- Root with providers ----------
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
