// components/RequireAuth.tsx
// 🚧 Redirect logic that only runs after validation:
// - while loading: render nothing
// - if not logged in and not in (auth): go to /(auth)/login
// - if logged in and in (auth): go to "/" (Home = app/(tabs)/index.tsx)

import React from "react";
import { Redirect, Slot, useSegments } from "expo-router";
import { useAuth } from "../lib/auth";

export default function RequireAuth() {
  const { isLoggedIn, loading } = useAuth();
  const segments = useSegments();
  const inAuth = segments[0] === "(auth)";

  // ⏳ don’t move yet; we’re validating getUser()
  if (loading) return null;

  if (!isLoggedIn && !inAuth) {
    return <Redirect href="/(auth)/login" />;
  }

  if (isLoggedIn && inAuth) {
    return <Redirect href="/" />;
  }

  return <Slot />;
}
