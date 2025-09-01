// app/(auth)/signup.tsx
// 👶 kid version (super simple):
// - You type Email, Password, and Username.
// - We check if the Username is free (green = good, red = taken).
// - We create your account in Supabase (email must be unique).
// - We save { email, username } into public.profiles for your user.
// - We also set auth.user_metadata.display_name = username.
// - THEN we send you to a screen to enter the 6-digit code from your email
//   (/(auth)/verify), so no broken deep links.
//
// Requirements (already covered by our setup):
// - public.profiles has columns: id (uuid PK), email text, username text
// - UNIQUE INDEX on lower(username) and lower(email)
// - RLS: anyone can select; user can update their own row

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Link, router } from "expo-router";
import { supabase } from "../../lib/supabase";

const COLORS = {
  bg: "#0f172a",
  text: "#e5e7eb",
  sub: "#9ca3af",
  field: "#1f2937",
  button: "#6EE7B7",
  green: "#22c55e",
  red: "#ef4444",
};

// 🧼 take what user typed and make it username-safe (spaces → underscores)
function normalize(s: string) {
  return s.trim().replace(/\s+/g, "_");
}

export default function SignUp() {
  // ✍️ what the user types
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");

  // 🔎 username availability status
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  // ⏱️ buttons/requests state
  const [busy, setBusy] = useState(false);

  // 👂 live check username availability as they type (case-insensitive)
  useEffect(() => {
    const value = normalize(username);

    // Too short? Don’t check yet.
    if (value.length < 3) {
      setAvailable(null);
      return;
    }

    let alive = true;
    (async () => {
      setChecking(true);

      // ILIKE = case-insensitive exact match (we pass the full normalized value)
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", value)
        .limit(1);

      if (!alive) return;

      setChecking(false);

      // available if no row was found (and no error)
      setAvailable(!error && (data?.length ?? 0) === 0);
    })();

    // if component unmounts quickly, stop updating state
    return () => {
      alive = false;
    };
  }, [username]);

  // ✅ can we press the CREATE ACCOUNT button?
  const canSubmit = useMemo(() => {
    return (
      email.includes("@") &&
      password.length >= 6 &&
      normalize(username).length >= 3 &&
      available === true &&
      !busy
    );
  }, [email, password, username, available, busy]);

  // 🚀 main sign-up flow
  async function handleSignup() {
    try {
      setBusy(true);

      const u = normalize(username);
      if (!u || u.length < 3) throw new Error("Username must be at least 3 characters.");
      if (available === false) throw new Error("That username is already taken.");

      // 1) Create the auth user. Supabase enforces unique email here.
      const { data: sign, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Keep display name in auth metadata so it shows up in dashboards/logs.
          data: { display_name: u },
        },
      });
      if (signErr) throw signErr;

      // We should have a user id even if email confirmation is required.
      const userId = sign.user?.id;
      if (!userId) throw new Error("Could not create user.");

      // 2) Save username + email on our profiles row (linked by id).
      //    UNIQUE INDEX on lower(username) protects against races.
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ username: u, email })
        .eq("id", userId);

      if (profileErr) {
        // 23505 = unique violation (someone grabbed that username a split-second before)
        if ((profileErr as any).code === "23505") {
          throw new Error("That username was just taken. Please choose another.");
        }
        throw profileErr;
      }

      // 3) Instead of deep-linking via email “magic page”, we take users to
      //    a friendly 6-digit code screen. They already got the code by email.
      router.replace({ pathname: "/(auth)/verify", params: { email } });
    } catch (e: any) {
      Alert.alert("Sign up failed", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, padding: 24, justifyContent: "center" }}>
      {/* App title */}
      <Text style={{ color: COLORS.green, fontSize: 32, fontWeight: "800", textAlign: "center", marginBottom: 16 }}>
        MESS HALL
      </Text>

      {/* Header tabs (Login / Sign Up) */}
      <View style={{ flexDirection: "row", gap: 24, justifyContent: "center", marginBottom: 16 }}>
        <Link href="/(auth)/login">
          <Text style={{ color: COLORS.sub, fontWeight: "600" }}>Login</Text>
        </Link>
        <Text style={{ color: COLORS.text, fontWeight: "700", borderBottomColor: COLORS.green, borderBottomWidth: 2 }}>
          Sign Up
        </Text>
      </View>

      {/* Email */}
      <TextInput
        placeholder="Email"
        placeholderTextColor={COLORS.sub}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{
          backgroundColor: COLORS.field,
          color: COLORS.text,
          padding: 14,
          borderRadius: 10,
          marginBottom: 12,
        }}
      />

      {/* Password */}
      <TextInput
        placeholder="Password (min 6)"
        placeholderTextColor={COLORS.sub}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{
          backgroundColor: COLORS.field,
          color: COLORS.text,
          padding: 14,
          borderRadius: 10,
          marginBottom: 12,
        }}
      />

      {/* Username */}
      <TextInput
        placeholder="Username (your public @name)"
        placeholderTextColor={COLORS.sub}
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
        style={{
          backgroundColor: COLORS.field,
          color: COLORS.text,
          padding: 14,
          borderRadius: 10,
        }}
      />

      {/* Availability feedback */}
      <View style={{ minHeight: 22, justifyContent: "center", marginTop: 6 }}>
        {checking ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator />
            <Text style={{ color: COLORS.sub }}>Checking username…</Text>
          </View>
        ) : available === true ? (
          <Text style={{ color: COLORS.green, fontWeight: "700" }}>✓ Username is available</Text>
        ) : available === false ? (
          <Text style={{ color: COLORS.red, fontWeight: "700" }}>✗ Username is taken</Text>
        ) : (
          <Text style={{ color: COLORS.sub }}>Tip: 3+ characters. We turn spaces into underscores.</Text>
        )}
      </View>

      {/* Create Account */}
      <TouchableOpacity
        onPress={handleSignup}
        disabled={!canSubmit}
        style={{
          backgroundColor: canSubmit ? COLORS.button : "#334155",
          padding: 14,
          borderRadius: 12,
          alignItems: "center",
          marginTop: 12,
        }}
      >
        <Text style={{ color: "#0b0f19", fontWeight: "800" }}>
          {busy ? "Please wait..." : "CREATE ACCOUNT"}
        </Text>
      </TouchableOpacity>

      {/* Bottom link */}
      <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", marginTop: 16 }}>
        <Text style={{ color: COLORS.sub }}>Already have an account?</Text>
        <Link href="/(auth)/login">
          <Text style={{ color: "#22c55e", fontWeight: "700" }}>Login.</Text>
        </Link>
      </View>
    </View>
  );
}
