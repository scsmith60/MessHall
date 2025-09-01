// app/_layout.tsx
// 💡 Wrap the app + provide Auth context. No redirects here.

import "../lib/polyfills";
import React from "react";
import { Slot } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView, StatusBar, View } from "react-native";
import { COLORS } from "../lib/theme";
import { AuthProvider } from "../lib/auth";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1 }}>
        <AuthProvider>
          <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
            <Slot />
          </View>
        </AuthProvider>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
