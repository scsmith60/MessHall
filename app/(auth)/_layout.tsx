// app/(auth)/_layout.tsx

import React from "react";
import { Stack, Redirect, usePathname } from "expo-router";
import { useAuth } from "../../lib/auth";

export default function AuthLayout() {
  const { loading, isLoggedIn } = useAuth();
  const pathname = usePathname();
  const inLogoutFlow =
    pathname === "/logout" ||
    pathname === "/logout-complete" ||
    pathname?.endsWith("/logout") ||
    pathname?.endsWith("/logout-complete");

  if (!loading && isLoggedIn && !inLogoutFlow) {
    return <Redirect href="/(tabs)/index" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
