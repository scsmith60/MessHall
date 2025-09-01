// app/(auth)/verify.tsx
// ✅ Waits for a confirmed session BEFORE navigating, so Tabs mount reliably.

import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { supabase } from "../../lib/supabase";

const COLORS = {
  bg: "#0f172a",
  text: "#e5e7eb",
  sub: "#9ca3af",
  field: "#1f2937",
  button: "#6EE7B7",
  green: "#22c55e",
  disabled: "#334155",
};

export default function Verify() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  const unsubRef = useRef<(() => void) | null>(null);

  function handleCodeChange(v: string) {
    const onlyDigits = v.replace(/\D/g, "").slice(0, 6);
    setCode(onlyDigits);
  }

  const canVerify = email.includes("@") && code.length === 6 && !busy;

  async function verify() {
    try {
      setBusy(true);

      // 1) Ask Supabase to confirm the sign-up code.
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "signup",
      });
      if (error) throw error;

      // 2) If a session is already present, we can send you home.
      const { data: userNow } = await supabase.auth.getUser();
      if (userNow?.user?.id) {
        console.log("[verify] user confirmed immediately:", userNow.user.id);
        router.replace("/"); // Home = app/(tabs)/index.tsx
        return;
      }

      // 3) Otherwise, wait for the auth listener to deliver the session.
      console.log("[verify] waiting for auth session…");
      if (unsubRef.current) unsubRef.current();

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user?.id) {
          console.log("[verify] session arrived:", session.user.id);
          // Clean up listener before navigating
          sub.subscription.unsubscribe();
          unsubRef.current = null;
          router.replace("/"); // Home
        }
      });

      unsubRef.current = () => sub.subscription.unsubscribe();

      // 4) Failsafe: after 6s, check again (covers edge cases on slower devices).
      setTimeout(async () => {
        if (!unsubRef.current) return;
        const { data: userLater } = await supabase.auth.getUser();
        if (userLater?.user?.id) {
          console.log("[verify] failsafe ok:", userLater.user.id);
          unsubRef.current?.();
          router.replace("/");
        } else {
          console.log("[verify] failsafe still no session");
          Alert.alert("Almost there", "Code verified, but session isn’t ready yet. Try again.");
        }
      }, 6000);
    } catch (e: any) {
      Alert.alert("Verification failed", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // cleanup listener if we leave the screen
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  async function resend() {
    try {
      setBusy(true);
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      setResent(true);
      Alert.alert("Sent", "We emailed you a new code.");
    } catch (e: any) {
      Alert.alert("Could not resend", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, padding: 24, justifyContent: "center" }}>
      <Text style={{ color: COLORS.green, fontSize: 28, fontWeight: "800", textAlign: "center", marginBottom: 16 }}>
        Verify Your Email
      </Text>

      <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Email</Text>
      <TextInput
        placeholder="you@example.com"
        placeholderTextColor={COLORS.sub}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ backgroundColor: COLORS.field, color: COLORS.text, padding: 14, borderRadius: 10, marginBottom: 12 }}
      />

      <Text style={{ color: COLORS.sub, marginBottom: 6 }}>6-digit code</Text>
      <TextInput
        placeholder="123456"
        placeholderTextColor={COLORS.sub}
        keyboardType="number-pad"
        value={code}
        onChangeText={handleCodeChange}
        maxLength={6}
        style={{
          backgroundColor: COLORS.field,
          color: COLORS.text,
          padding: 14,
          borderRadius: 10,
          letterSpacing: 6,
          textAlign: "center",
          fontSize: 20,
        }}
      />

      <TouchableOpacity
        onPress={verify}
        disabled={!canVerify}
        style={{
          backgroundColor: canVerify ? COLORS.button : COLORS.disabled,
          padding: 14,
          borderRadius: 12,
          alignItems: "center",
          marginTop: 12,
        }}
      >
        <Text style={{ color: "#0b0f19", fontWeight: "800" }}>{busy ? "Please wait..." : "Verify & Continue"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={resend} disabled={busy} style={{ marginTop: 16, alignItems: "center" }}>
        <Text style={{ color: COLORS.text, fontWeight: "700" }}>Resend Code</Text>
        {resent && <Text style={{ color: COLORS.sub, marginTop: 4 }}>Check your inbox.</Text>}
      </TouchableOpacity>
    </View>
  );
}
