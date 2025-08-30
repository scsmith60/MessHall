// app/_layout.tsx
// THINK: This file wraps the whole app. It sets colors, gestures, and routing.
// EXPLAINED: Expo Router replaces App.tsx with this file. Everything renders inside <Slot />.

// 1) Load polyfills FIRST so Supabase + URLs work on mobile.
//    Use a RELATIVE import to avoid alias issues.
import '../lib/polyfills';

import React from 'react';
import { Slot } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, StatusBar, View } from 'react-native';
import { COLORS } from '../lib/theme';

export default function RootLayout() {
  return (
    // 2) This wrapper makes swipes/gestures super smooth.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* 3) Make text/icons in the status bar light so they are readable. */}
      <StatusBar barStyle="light-content" />

      {/* 4) Safe area keeps content away from notches. */}
      <SafeAreaView style={{ flex: 1 }}>
        {/* 5) Slot = where child routes (tabs/screens) render. */}
        <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
          <Slot />
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
