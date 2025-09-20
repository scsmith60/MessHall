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
const normalize = (s: string) => s.trim().replace(/\s+/g, "_");

export default function Login() {
  // 🧠 little boxes that remember what you type
  const [identifier, setIdentifier] = useState(""); // email OR username
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
        emailToUse = data[0].email!;
      }

      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });
      if (authErr) throw authErr;

      const ok = await waitForSignedIn();
      if (ok) router.replace("/(tabs)");
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
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
        {/* ===================== Header with Logo ===================== */}
        <View style={{ alignItems: "center", marginBottom: 16 }}>
          {/* 🖼️ your big green "M" image */}
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
          {/* Word mark underneath */}
          <Text
            style={{
              color: COLORS.green,
              fontSize: 28,
              fontWeight: "900",
              letterSpacing: 2,
            }}
          >
            MESSHALL
          </Text>
        </View>

        {/* ======================= Tab Switcher ======================= */}
        <View style={{ flexDirection: "row", gap: 24, justifyContent: "center", marginBottom: 16 }}>
          <Text
            style={{
              color: COLORS.text,
              fontWeight: "700",
              borderBottomColor: COLORS.green,
              borderBottomWidth: 2,
              paddingBottom: 2,
            }}
          >
            Login
          </Text>
          <Link href="/signup">
            <Text style={{ color: COLORS.sub, fontWeight: "600" }}>Sign Up</Text>
          </Link>
        </View>

        {/* ===================== Email or Username ===================== */}
        <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Email or Username</Text>
        <TextInput
          placeholder="you@example.com  or  CallSign"
          placeholderTextColor={COLORS.sub}
          autoCapitalize="none"
          autoCorrect={false}
          value={identifier}
          onChangeText={setIdentifier}
          style={{
            backgroundColor: COLORS.field,
            color: COLORS.text,
            padding: 14,
            borderRadius: 10,
            marginBottom: 12,
          }}
          returnKeyType="next"
        />

        {/* ========================== Password ======================== */}
        <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Password</Text>
        <TextInput
          placeholder="••••••••"
          placeholderTextColor={COLORS.sub}
          secureTextEntry={!show}
          value={password}
          onChangeText={setPassword}
          style={{ backgroundColor: COLORS.field, color: COLORS.text, padding: 14, borderRadius: 10 }}
          returnKeyType="go"
          onSubmitEditing={() => canLogin && handleLogin()}
        />

        {/* 👀 Show/Hide switch */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 10 }}>
          <Switch value={show} onValueChange={setShow} />
          <Text style={{ color: COLORS.sub }}>Show password</Text>
        </View>

        {/* ==================== Big Green Button ====================== */}
        <TouchableOpacity
          onPress={handleLogin}
          disabled={!canLogin}
          style={{
            backgroundColor: canLogin ? COLORS.green : COLORS.greenDim,
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <Text style={{ color: COLORS.buttonText, fontWeight: "800" }}>
            {busy ? "Please wait..." : "ENTER MESS HALL"}
          </Text>
        </TouchableOpacity>

        {/* --------------- Divider text --------------- */}
        <Text style={{ color: COLORS.sub, textAlign: "center", marginVertical: 16 }}>or continue with</Text>

        {/* ----------------- OAuth buttons ----------------- */}
        <View style={{ flexDirection: "row", gap: 12, justifyContent: "center" }}>
          <TouchableOpacity
            onPress={() => loginWithProvider("google")}
            disabled={busy}
            style={{
              backgroundColor: COLORS.field,
              padding: 12,
              borderRadius: 10,
              minWidth: 120,
              alignItems: "center",
            }}
          >
            <Text style={{ color: COLORS.text, fontWeight: "700" }}>Google</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => loginWithProvider("apple")}
            disabled={busy}
            style={{
              backgroundColor: COLORS.field,
              padding: 12,
              borderRadius: 10,
              minWidth: 120,
              alignItems: "center",
            }}
          >
            <Text style={{ color: COLORS.text, fontWeight: "700" }}>Apple</Text>
          </TouchableOpacity>
        </View>

        {/* ---------------------- Footer ---------------------- */}
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            justifyContent: "space-between",
            marginTop: 20,
            alignItems: "center",
          }}
        >
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Text style={{ color: COLORS.sub }}>Don’t have an account?</Text>
            <Link href="/signup">
              <Text style={{ color: COLORS.green, fontWeight: "700" }}>Create account.</Text>
            </Link>
          </View>
          <Text style={{ color: COLORS.sub }}>Terms & Privacy</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
