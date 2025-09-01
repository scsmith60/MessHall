// app/(auth)/login.tsx
// 🗝️ Box 1 accepts Email OR Username. If there’s no "@", we treat it as username.

import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert, Switch } from "react-native";
import { Link } from "expo-router";
import { supabase } from "../../lib/supabase";

const COLORS = { bg:"#0f172a", card:"#111827", text:"#e5e7eb", sub:"#9ca3af", green:"#4CAF50", field:"#1f2937", button:"#6EE7B7" };

export default function Login() {
  const [identifier, setIdentifier] = useState(""); // email OR username
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const normalize = (s: string) => s.trim().replace(/\s+/g, "_");

  async function handleLogin() {
    try {
      setBusy(true);
      let emailToUse = identifier;

      if (!identifier.includes("@")) {
        // it’s a username → find the email
        const u = normalize(identifier);
        const { data, error } = await supabase
          .from("profiles")
          .select("email")
          .ilike("username", u)   // case-insensitive exact
          .limit(1);

        if (error) throw error;
        if (!data || data.length === 0 || !data[0].email) {
          throw new Error("No account found with that username.");
        }
        emailToUse = data[0].email!;
      }

      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });
      if (authErr) throw authErr;
      // ✅ RequireAuth will move you into /(tabs)
    } catch (e: any) {
      Alert.alert("Login failed", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loginWithProvider(provider: "google" | "apple") {
    try { setBusy(true);
      const { error } = await supabase.auth.signInWithOAuth({ provider });
      if (error) throw error;
    } catch (e: any) { Alert.alert("Sign-in failed", e.message); }
    finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, padding: 24, justifyContent: "center" }}>
      <Text style={{ color: COLORS.green, fontSize: 32, fontWeight: "800", textAlign: "center", marginBottom: 16 }}>
        MESS HALL
      </Text>

      <View style={{ flexDirection: "row", gap: 24, justifyContent: "center", marginBottom: 16 }}>
        <Text style={{ color: COLORS.text, fontWeight: "700", borderBottomColor: COLORS.green, borderBottomWidth: 2 }}>Login</Text>
        <Link href="/(auth)/signup"><Text style={{ color: COLORS.sub, fontWeight: "600" }}>Sign Up</Text></Link>
      </View>

      <TextInput placeholder="Email or Username" placeholderTextColor={COLORS.sub} autoCapitalize="none"
        value={identifier} onChangeText={setIdentifier}
        style={{ backgroundColor: COLORS.field, color: COLORS.text, padding: 14, borderRadius: 10, marginBottom: 12 }} />

      <TextInput placeholder="Password" placeholderTextColor={COLORS.sub} secureTextEntry={!show}
        value={password} onChangeText={setPassword}
        style={{ backgroundColor: COLORS.field, color: COLORS.text, padding: 14, borderRadius: 10 }} />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 10 }}>
        <Switch value={show} onValueChange={setShow} />
        <Text style={{ color: COLORS.sub }}>Show password</Text>
      </View>

      <TouchableOpacity onPress={handleLogin} disabled={busy}
        style={{ backgroundColor: COLORS.button, padding: 14, borderRadius: 12, alignItems: "center", marginTop: 8 }}>
        <Text style={{ color: "#0b0f19", fontWeight: "800" }}>{busy ? "Please wait..." : "ENTER MESS HALL"}</Text>
      </TouchableOpacity>

      <Text style={{ color: COLORS.sub, textAlign: "center", marginVertical: 16 }}>or continue with</Text>
      <View style={{ flexDirection: "row", gap: 12, justifyContent: "center" }}>
        <TouchableOpacity onPress={() => loginWithProvider("google")} disabled={busy}
          style={{ backgroundColor: COLORS.field, padding: 12, borderRadius: 10, minWidth: 120, alignItems: "center" }}>
          <Text style={{ color: COLORS.text, fontWeight: "700" }}>Google</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => loginWithProvider("apple")} disabled={busy}
          style={{ backgroundColor: COLORS.field, padding: 12, borderRadius: 10, minWidth: 120, alignItems: "center" }}>
          <Text style={{ color: COLORS.text, fontWeight: "700" }}>Apple</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: "row", gap: 6, justifyContent: "space-between", marginTop: 20 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Text style={{ color: COLORS.sub }}>Don’t have an account?</Text>
          <Link href="/(auth)/signup"><Text style={{ color: "#22c55e", fontWeight: "700" }}>Create account.</Text></Link>
        </View>
        <Text style={{ color: COLORS.sub }}>Terms & Privacy</Text>
      </View>
    </View>
  );
}
