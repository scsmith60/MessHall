// app/(auth)/logout-complete.tsx
// 🧸 mission-complete screen — restored Messhall green

import React from "react";
import { View, Text, TouchableOpacity, Platform, BackHandler } from "react-native";
import { router } from "expo-router";
import { COLORS } from "@/lib/theme";
const LOCAL = { bg: COLORS.bg, text: COLORS.text, subtext: COLORS.subtext, green: COLORS.accent, buttonText: COLORS.onAccent };

async function closeOrGoToLogin() {
  if (Platform.OS === "android") {
    BackHandler.exitApp();
    return;
  }
  router.replace("/login");
}

export default function LogoutComplete() {
  return (
    <View style={{ flex: 1, backgroundColor: LOCAL.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: LOCAL.text, fontSize: 28, fontWeight: "800", marginBottom: 8 }}>Mission Completed</Text>
      <Text style={{ color: LOCAL.subtext, textAlign: "center", marginBottom: 24 }}>
        You’ve been signed out safely.
      </Text>

      <TouchableOpacity
        onPress={closeOrGoToLogin}
        style={{ backgroundColor: LOCAL.green, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22 }}
      >
        <Text style={{ color: LOCAL.buttonText, fontSize: 16, fontWeight: "900" }}>
          {Platform.OS === "android" ? "Close App" : "Back to Login"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
