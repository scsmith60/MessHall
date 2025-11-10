// app/(auth)/signup.tsx
// 🧸 Like-you're-5 notes:
// - Same big "M" image on top.
// - Same logo green for highlights.
// - We keep your username availability checker and normal logic working.

// 👇 IMPORTANT: put your logo file at assets/brand/messhall-m.png

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image, // <-- show logo
} from "react-native";
import { Link, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { makeRedirectUri } from "expo-auth-session";
import { GoogleButton, AppleButton } from "../../components/ui/SocialButtons";
import { supabase } from "../../lib/supabase";
import { COLORS as THEME } from "@/lib/theme";

const COLORS = {
  bg: THEME.bg,
  text: THEME.text,
  sub: THEME.subtext,
  subtext: THEME.subtext,
  field: THEME.card,
  green: THEME.accent,
  greenDim: THEME.accentActive,
  red: "#ef4444",
};

// 🧼 make username safe (spaces → underscores)
function normalize(s: string) {
  return s.trim().replace(/\s+/g, "_");
}

export default function SignUp() {
  // boxes that remember what you type
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");

  // username checker
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  // button spinner
  const [busy, setBusy] = useState(false);

  // 🔍 check if username is taken while user types
  useEffect(() => {
    const value = normalize(username);
    if (value.length < 3) {
      setAvailable(null);
      return;
    }

    let alive = true;
    (async () => {
      setChecking(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", value)
        .limit(1);

      if (!alive) return;

      setChecking(false);
      setAvailable(!error && (data?.length ?? 0) === 0);
    })();

    return () => {
      alive = false;
    };
  }, [username]);

  const canSubmit = useMemo(() => {
    return (
      email.includes("@") &&
      password.length >= 6 &&
      normalize(username).length >= 3 &&
      available === true &&
      !busy
    );
  }, [email, password, username, available, busy]);

  // 🧒 Create the account
  async function handleSignup() {
    try {
      setBusy(true);

      const u = normalize(username);
      if (!u || u.length < 3) throw new Error("Call sign must be at least 3 characters.");
      if (available === false) throw new Error("That call sign is already taken.");

      const { data: sign, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: u } },
      });
      if (signErr) throw signErr;

      const userId = sign.user?.id;
      if (!userId) throw new Error("Could not create user.");

      // Use UPSERT to create or update the profile
      // This handles the case where the profile doesn't exist yet (e.g., after data clear)
      const { error: profileErr } = await supabase
        .from("profiles")
        .upsert(
          { 
            id: userId, 
            username: u, 
            email 
          },
          { 
            onConflict: "id" 
          }
        );

      if (profileErr) {
        if ((profileErr as any).code === "23505") {
          throw new Error("That call sign was just taken. Please choose another.");
        }
        throw profileErr;
      }

      router.replace({ pathname: "/verify", params: { email } });
    } catch (e: any) {
      Alert.alert("Sign up failed", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // 🌐 Google OAuth (same flow as login)
  async function signupWithGoogle() {
    try {
      setBusy(true);
      const redirectTo = makeRedirectUri({ scheme: "messhall" });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (data?.url) {
        await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        const t0 = Date.now();
        while (Date.now() - t0 < 4000) {
          const { data: s } = await supabase.auth.getSession();
          if (s.session) break;
          await new Promise((r) => setTimeout(r, 120));
        }
      }
    } catch (e: any) {
      Alert.alert("Google sign in failed", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, padding: 24, justifyContent: "center" }}>
      {/* ===================== Header with Logo ===================== */}
      <View style={{ alignItems: "center", marginBottom: 16 }}>
        <Image
          source={require("../../assets/brand/messhall-m.png")}
          accessibilityLabel="MessHall logo"
          style={{
            width: 96,
            height: 96,
            borderRadius: 18,
            marginBottom: 10,
            resizeMode: "contain",
          }}
        />
        <Text style={{ color: COLORS.green, fontSize: 28, fontWeight: "900", letterSpacing: 2 }}>
          MESSHALL
        </Text>
      </View>

      {/* ======================= Tab Switcher ======================= */}
      <View style={{ flexDirection: "row", gap: 24, justifyContent: "center", marginBottom: 16 }}>
        <Link href="/login">
          <Text style={{ color: COLORS.subtext, fontWeight: "600" }}>Login</Text>
        </Link>
        <Text style={{ color: COLORS.text, fontWeight: "700", borderBottomColor: COLORS.green, borderBottomWidth: 2 }}>
          Sign Up
        </Text>
      </View>

      {/* ============================ Email ========================= */}
      <TextInput
        placeholder="Email"
        placeholderTextColor={COLORS.subtext}
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

      {/* ========================== Password ======================== */}
      <TextInput
        placeholder="Password (min 6)"
        placeholderTextColor={COLORS.subtext}
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

      {/* =========================== Call Sign ======================= */}
      <TextInput
        placeholder="Call sign (your public @name)"
        placeholderTextColor={COLORS.subtext}
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

      {/* ------------- Availability message (live checker) ---------- */}
      <View style={{ minHeight: 22, justifyContent: "center", marginTop: 6 }}>
        {checking ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator />
            <Text style={{ color: COLORS.subtext }}>Checking call sign…</Text>
          </View>
        ) : available === true ? (
          <Text style={{ color: COLORS.green, fontWeight: "700" }}>✓ Call sign is available</Text>
        ) : available === false ? (
          <Text style={{ color: COLORS.red, fontWeight: "700" }}>✗ Call sign is taken</Text>
        ) : (
          <Text style={{ color: COLORS.subtext }}>Tip: Call sign must be 3+ characters. We turn spaces into underscores.</Text>
        )}
      </View>

      {/* ==================== Create Account Button ================= */}
      <TouchableOpacity
        onPress={handleSignup}
        disabled={!canSubmit}
        style={{
          backgroundColor: canSubmit ? COLORS.green : COLORS.greenDim,
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

      {/* -------------------- Divider + OAuth -------------------- */}
      <Text style={{ color: COLORS.subtext, textAlign: "center", marginTop: 10 }}>or continue with</Text>
      <View style={{ flexDirection: "column", gap: 10, marginTop: 6 }}>
        <GoogleButton label="Sign in with Google" onPress={signupWithGoogle} />
        <AppleButton
          label="Continue with Apple"
          onPress={() => Alert.alert("Coming soon", "Apple Sign in will be enabled after keys are added.")}
        />
      </View>

      {/* -------------------- Bottom link -------------------- */}
      <View style={{ flexDirection: "row", gap: 6, justifyContent: "center", marginTop: 16 }}>
        <Text style={{ color: COLORS.subtext }}>Already have an account?</Text>
        <Link href="/login">
          <Text style={{ color: COLORS.green, fontWeight: "700" }}>Login.</Text>
        </Link>
      </View>
    </View>
  );
}
