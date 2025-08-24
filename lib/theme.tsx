// lib/theme.ts
// MessHall — simple light/dark theme context with persistence (Hermes-safe)
// Now also exposes `colors` tokens and `getThemedInputProps()` for screens.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, TextInputProps } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeMode = 'light' | 'dark' | 'system';

type ColorTokens = {
  bg: string;
  text: string;
  mutedText: string;
  cardBg: string;
  border: string;
  tint: string;
  onTint: string;
  shadow: string;
};

type InputVariant = 'solid' | 'ghost';

type ThemeContextValue = {
  ready: boolean;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  isDark: boolean;

  // NEW: design tokens & helpers consumed by screens
  colors: ColorTokens;
  getThemedInputProps: (opts?: { variant?: InputVariant }) => Partial<TextInputProps>;
};

const STORAGE_KEY = 'messhall.theme.mode';
const ThemeCtx = createContext<ThemeContextValue | undefined>(undefined);

// ---- Palettes ----
const lightColors: ColorTokens = {
  bg: '#FFFFFF',
  text: '#111113',
  mutedText: '#666872',
  cardBg: '#F7F7FA',
  border: '#E5E6EB',
  tint: '#7C4DFF',   // brand-ish purple
  onTint: '#FFFFFF',
  shadow: '#000000',
};

const darkColors: ColorTokens = {
  bg: '#0E0F12',
  text: '#F4F5F7',
  mutedText: '#A6A8B1',
  cardBg: '#16181D',
  border: '#282C33',
  tint: '#9F7AEA',
  onTint: '#FFFFFF',
  shadow: '#000000',
};

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

  const systemScheme = Appearance.getColorScheme() || 'light';
  const effective = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const colors = effective === 'dark' ? darkColors : lightColors;

  const getThemedInputProps = useMemo(
    () =>
      (opts?: { variant?: InputVariant }): Partial<TextInputProps> => {
        const variant = opts?.variant ?? 'solid';
        const baseStyle = {
          color: colors.text,
          borderColor: variant === 'ghost' ? 'transparent' : colors.border,
          backgroundColor: variant === 'ghost' ? 'transparent' : colors.cardBg,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1 as const,
          borderRadius: 10,
        };
        return {
          placeholderTextColor: colors.mutedText,
          style: baseStyle,
        };
      },
    [colors]
  );

  const value = useMemo<ThemeContextValue>(() => ({
    ready,
    mode,
    setMode,
    toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')),
    isDark: effective === 'dark',
    colors,
    getThemedInputProps,
  }), [ready, mode, effective, colors, getThemedInputProps]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useThemeController() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useThemeController must be used within ThemeProvider');
  return ctx;
}
