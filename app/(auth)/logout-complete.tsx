// app/(auth)/logout-complete.tsx
// 🧸 mission-complete screen — restored Messhall green

import React from "react";
import { View, Text, TouchableOpacity, Platform, BackHandler } from "react-native";
import { router } from "expo-router";

const COLORS = {
  bg: "#0b1220",
  text: "#e5e7eb",
  sub: "#94a3b8",
  green: "#22c55e",
  greenDim: "#16a34a",
  buttonText: "#0b0f19",
};

async function closeOrGoToLogin() {
  if (Platform.OS === "android") {
    BackHandler.exitApp();
    return;
  }
  router.replace("/login");
}

export default function LogoutComplete() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: COLORS.text, fontSize: 28, fontWeight: "800", marginBottom: 8 }}>Mission Completed</Text>
      <Text style={{ color: COLORS.sub, textAlign: "center", marginBottom: 24 }}>
        You’ve been signed out safely.
      </Text>

      <TouchableOpacity
        onPress={closeOrGoToLogin}
        style={{ backgroundColor: COLORS.green, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22 }}
      >
        <Text style={{ color: COLORS.buttonText, fontSize: 16, fontWeight: "900" }}>
          {Platform.OS === "android" ? "Close App" : "Back to Login"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
