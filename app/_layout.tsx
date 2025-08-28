// /app/_layout.tsx
// THINK: This file wraps the whole app. It sets colors, gestures, and routing.
// EXPLAINED: Expo Router replaces App.tsx with this file. Everything renders inside <Slot />.
import React from 'react';
import { Slot } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, StatusBar, View } from 'react-native';
import { COLORS } from '../lib/theme';

// NOTE: GestureHandlerRootView is required for swipe/drag to work reliably.
// (It runs on the native UI thread for smoothness.) :contentReference[oaicite:9]{index=9}
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        {/* Slot = where child routes (tabs/screens) render */}
        <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
          <Slot />
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
