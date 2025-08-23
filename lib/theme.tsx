// lib/theme.ts
// MessHall — simple light/dark theme context with persistence (Hermes-safe)

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextValue = {
  ready: boolean;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  // Optionally expose a derived boolean for convenience
  isDark: boolean;
};

const ThemeCtx = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = 'messhall.theme.mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<ThemeMode>('system');

  // Load saved mode on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (mounted && (saved === 'light' || saved === 'dark' || saved === 'system')) {
          setMode(saved);
        }
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Persist mode
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, [mode, ready]);

  const colorScheme = Appearance.getColorScheme() || 'light';
  const effective = mode === 'system' ? (colorScheme === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeContextValue>(() => ({
    ready,
    mode,
    setMode,
    toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')),
    isDark: effective === 'dark',
  }), [ready, mode, effective]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useThemeController() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useThemeController must be used within ThemeProvider');
  return ctx;
}
