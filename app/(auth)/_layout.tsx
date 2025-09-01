// app/(auth)/_layout.tsx
// ✅ Keep auth screens public, but leave if already logged in

import React from "react";
import { Stack, Redirect } from "expo-router";
import { useAuth } from "../../lib/auth";

export default function AuthLayout() {
  const { isLoggedIn, loading } = useAuth();

  // don’t flash; only redirect when we know
  if (!loading && isLoggedIn) {
    console.log("[AuthLayout] logged in → go home");
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
