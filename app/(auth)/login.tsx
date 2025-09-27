// app/(auth)/login.tsx
// 🧸 Explain-like-you're-5 version:
// - We show your big green "M" picture at the top.
// - We use the SAME green from that picture for buttons and highlights.
// - Everything else stays the same so your login still works.

// 👇 IMPORTANT: put your logo file at assets/brand/messhall-m.png
// (From this file, that path is ../../assets/brand/messhall-m.png)

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Image, // <-- we add Image to show your logo
} from "react-native";
import { Link, router } from "expo-router";
import { supabase } from "../../lib/supabase";
import { waitForSignedIn } from "../../lib/auth-wait";

// 🎨 Colors (pulled from your logo)
//   - M_GREEN is the main green from your image (#53856b).
//   - M_GREEN_DIM is a tiny bit darker for disabled states.
const M_GREEN = "#53856b";
const M_GREEN_DIM = "#3f6b55";

const COLORS = {
  // nice dark background that your logo sits on
  bg: "#0f172a",
  text: "#e5e7eb",
  sub: "#9ca3af",
  field: "#1f2937",
  green: M_GREEN,
  greenDim: M_GREEN_DIM,
  buttonText: "#0b0f19", // dark text on green so it pops
};

// 🧼 turn spaces into underscores for safe usernames
function normalize(s: string) {
  return s.trim().replace(/\s+/g, "_");
}

export default function Login() {
  // 📝 you can type either "email" OR "username" in the first box
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  // 🚪 when you tap "enter", we try to log you in
  async function handleLogin() {
    try {
      setBusy(true);
      let emailToUse = identifier.trim();

      // If a username (no "@"), look up the email in profiles
      if (!emailToUse.includes("@")) {
        const u = normalize(emailToUse);
        const { data, error } = await supabase
          .from("profiles")
          .select("email")
          .ilike("username", u)
          .limit(1);

        if (error) throw error;
        if (!data?.[0]?.email) throw new Error("No account found with that username.");
        emailToUse = data[0].email;
      }

      // Ask Supabase to sign us in
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });
      if (authErr) throw authErr;

      // Wait a moment until Supabase really says “yep, you’re signed in”
      const ok = await waitForSignedIn();

      // 🟢 TINY FIX: send to the HOME TAB explicitly
      //    (this is the only line I changed from your file)
      if (ok) router.replace("/(tabs)/index");
      else Alert.alert("Almost there", "Please try again.");
    } catch (e: any) {
      Alert.alert("Login failed", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // 🌐 Google/Apple buttons
  async function loginWithProvider(provider: "google" | "apple") {
    try {
      setBusy(true);
      const { error } = await supabase.auth.signInWithOAuth({ provider });
      if (error) throw error;
    } catch (e: any) {
      Alert.alert("Login failed", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // ✅ only allow the button when you typed stuff
  const canLogin = identifier.trim().length > 0 && password.length > 0 && !busy;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      {/* Outer safe padding */}
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 48 }}>
        {/* ---------- TOP: Logo + Welcome ---------- */}
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Image
            source={require("../../assets/brand/messhall-m.png")}
            style={{ width: 120, height: 120, marginBottom: 12 }}
            resizeMode="contain"
          />
          <Text style={{ color: COLORS.text, fontSize: 28, fontWeight: "800" }}>
            Welcome to MessHall
          </Text>
          <Text style={{ color: COLORS.sub, marginTop: 4 }}>
            Sign in to cook, share, and shop.
          </Text>
        </View>

        {/* ---------- CARD: Fields ---------- */}
        <View
          style={{
            backgroundColor: "#0b1220",
            borderColor: "#1f2937",
            borderWidth: 1,
            borderRadius: 16,
            padding: 16,
            gap: 12,
          }}
        >
          {/* Identifier (email or username) */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: COLORS.sub, fontSize: 12 }}>
              Email or Username
            </Text>
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com  or  your_username"
              placeholderTextColor="#6b7280"
              keyboardType="email-address"
              style={{
                backgroundColor: COLORS.field,
                color: COLORS.text,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: Platform.select({ ios: 14, android: 10 }),
                borderColor: "#334155",
                borderWidth: 1,
                fontSize: 16,
              }}
            />
          </View>

          {/* Password */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: COLORS.sub, fontSize: 12 }}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!show}
              placeholder="••••••••"
              placeholderTextColor="#6b7280"
              style={{
                backgroundColor: COLORS.field,
                color: COLORS.text,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: Platform.select({ ios: 14, android: 10 }),
                borderColor: "#334155",
                borderWidth: 1,
                fontSize: 16,
              }}
            />
            {/* Show/Hide switch */}
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Switch
                value={show}
                onValueChange={setShow}
                trackColor={{ false: "#283548", true: COLORS.greenDim }}
                thumbColor={show ? COLORS.green : "#94a3b8"}
              />
              <Text style={{ color: COLORS.sub }}>Show password</Text>
            </View>
          </View>

          {/* Forgot password */}
          <TouchableOpacity
            onPress={async () => {
              try {
                if (!identifier.trim()) {
                  Alert.alert("Need your email", "Please type your email first.");
                  return;
                }
                const email =
                  identifier.includes("@")
                    ? identifier.trim()
                    : undefined;

                if (!email) {
                  Alert.alert(
                    "Use email",
                    "Password reset needs an email, not a username."
                  );
                  return;
                }

                setBusy(true);
                const { error } = await supabase.auth.resetPasswordForEmail(
                  email,
                  {
                    redirectTo: "messhall://reset-password", // change if needed
                  }
                );
                if (error) throw error;
                Alert.alert(
                  "Check your email",
                  "We sent you a reset link if that address exists."
                );
              } catch (e: any) {
                Alert.alert("Oops", e?.message ?? String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text
              style={{
                color: COLORS.sub,
                textDecorationLine: "underline",
                fontSize: 13,
              }}
            >
              Forgot password?
            </Text>
          </TouchableOpacity>

          {/* Enter button */}
          <TouchableOpacity
            onPress={handleLogin}
            disabled={!canLogin}
            style={{
              backgroundColor: canLogin ? COLORS.green : COLORS.greenDim,
              borderRadius: 12,
              alignItems: "center",
              marginTop: 8,
              paddingVertical: 14,
              opacity: busy ? 0.8 : 1,
            }}
          >
            <Text style={{ color: COLORS.buttonText, fontWeight: "800" }}>
              {busy ? "Please wait..." : "ENTER MESS HALL"}
            </Text>
          </TouchableOpacity>

          {/* --------------- Divider text --------------- */}
          <Text style={{ color: COLORS.sub, textAlign: "center", marginTop: 8 }}>
            or continue with
          </Text>

          {/* --------------- OAuth buttons --------------- */}
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              justifyContent: "center",
              marginTop: 4,
            }}
          >
            <TouchableOpacity
              onPress={() => loginWithProvider("google")}
              style={{
                backgroundColor: COLORS.field,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 10,
                borderColor: "#334155",
                borderWidth: 1,
              }}
            >
              <Text style={{ color: COLORS.text }}>Google</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => loginWithProvider("apple")}
              style={{
                backgroundColor: COLORS.field,
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 10,
                borderColor: "#334155",
                borderWidth: 1,
              }}
            >
              <Text style={{ color: COLORS.text }}>Apple</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ---------- BOTTOM LINKS ---------- */}
        <View style={{ alignItems: "center", marginTop: 16, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Text style={{ color: COLORS.sub }}>Don’t have an account?</Text>
            {/* NOTE: If your project uses /sign-in instead of /signup, change this href accordingly */}
            <Link href="/signup">
              <Text style={{ color: COLORS.green, fontWeight: "700" }}>
                Create account.
              </Text>
            </Link>
          </View>
          <Text style={{ color: COLORS.sub }}>Terms & Privacy</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
