// app/(auth)/logout.tsx
//
// like i'm 5:
// - we go to the "mission complete" page right away.
// - in the background we press the Supabase OFF switch and sweep crumbs.
// - even if the OFF switch is slow, you already left the spinner screen.

import React, { useEffect, useRef } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../../lib/supabase";

const COLORS = { bg: "#0b1220", text: "#e5e7eb", sub: "#9ca3af" };

// 🧽 sweep local Supabase keys so we don't wake up "anonymous"
async function clearSupabaseKeys() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const sbKeys = keys.filter((k) => k.startsWith("sb-") || k.includes("supabase"));
    if (sbKeys.length) await AsyncStorage.multiRemove(sbKeys);
  } catch {
    // ignore storage errors; navigation already moved on
  }
}

export default function Logout() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // 1) 🚀 leave THIS screen immediately so no spinner trap
    //    (we still render something tiny below, but this line fires right away)
    setTimeout(() => router.replace("/logout-complete"), 0);

    // 2) 📴 do the actual sign-out + cleanup in the background
    (async () => {
      try {
        // try fast local scope first (clears native session immediately)
        try {
          // @ts-ignore ("scope" exists on native)
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          await supabase.auth.signOut();
        }

        // give Supabase a tiny breath to flip its switch
        const t0 = Date.now();
        while (Date.now() - t0 < 500) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) break;
          await new Promise((r) => setTimeout(r, 60));
        }
      } finally {
        // sweep any leftover cached tokens
        await clearSupabaseKeys();
      }
    })();
  }, []);

  // you barely see this, we navigate away instantly above
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
      <Text style={{ color: COLORS.text, marginTop: 12, fontWeight: "600" }}>Signing you out…</Text>
      <Text style={{ color: COLORS.sub, marginTop: 6, fontSize: 12 }}>Moving along…</Text>
    </View>
  );
}
