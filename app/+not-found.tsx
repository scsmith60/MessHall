// app/+not-found.tsx
// 👶 if the app tries to go somewhere that doesn't exist (like "(tabs)"),
// we land here. we log what happened and send you to the *real* home "/".
// this stops the infinite warnings and blank screen.

import { useEffect } from "react";
import { Text, View } from "react-native";
import { router, useGlobalSearchParams } from "expo-router";

export default function NotFound() {
  const params = useGlobalSearchParams();

  // helpful logs so we can see the offender once in Metro
  console.log("[+not-found] params:", params);

  useEffect(() => {
    // groups are invisible → Home lives at "/"
    router.replace("/");
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#e5e7eb" }}>Oops, that page doesn’t exist. Heading Home…</Text>
    </View>
  );
}
