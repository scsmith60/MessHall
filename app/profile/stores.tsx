// app/profile/stores.tsx
// LIKE I'M 5:
// This page lets you hook up stores and choose your default.
// We also use the phone's "safe area" so stuff doesn't hide under the clock.

import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context"; // 🧠 keeps us below the notch/clock
import { supabase } from "@/lib/supabase";
import { getProviderRegistry, setDefaultProvider, type ProviderId } from "@/lib/cart/providers";
import { COLORS, RADIUS, SPACING } from "@/lib/theme";
import HapticButton from "@/components/ui/HapticButton";

type Row = { provider: ProviderId; is_connected: boolean; is_default: boolean };

export default function StorePrefsScreen() {
  // 👶 this gives us the safe top area height
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (userId) refresh();
  }, [userId]);

  async function refresh() {
    if (!userId) return;
    const ids = Object.keys(getProviderRegistry()) as ProviderId[];
    const { data } = await supabase.from("store_links").select("*").eq("user_id", userId);
    const map = new Map<string, any>((data || []).map((r: any) => [r.provider, r]));
    const out: Row[] = ids.map((p) => ({
      provider: p,
      is_connected: !!map.get(p)?.is_connected,
      is_default: !!map.get(p)?.is_default,
    }));
    setRows(out);
  }

  async function toggleConnect(p: ProviderId) {
    if (!userId) return;
    const cur = rows.find((r) => r.provider === p);
    const is_connected = !cur?.is_connected;
    await supabase
      .from("store_links")
      .upsert({ user_id: userId, provider: p, is_connected } as any, { onConflict: "user_id,provider" });
    await refresh();
  }

  async function makeDefault(p: ProviderId) {
    if (!userId) return;
    await setDefaultProvider(userId, p);
    await refresh();
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.bg,
        // 🪄 KEY PART: we use the safe-area top + a tiny extra.
        // 👉 change the "+ 12" to push content down more or less.
        paddingTop: insets.top + 12,
        paddingHorizontal: SPACING.lg,
        paddingBottom: SPACING.lg,
        gap: 14,
      }}
    >
      <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900" }}>Store Preferences</Text>
      <Text style={{ color: COLORS.subtext }}>Connect your stores and pick a default for “Send to Cart”.</Text>

      {rows.map((r) => {
        const info = getProviderRegistry()[r.provider];
        return (
          <View key={r.provider} style={styles.card}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{info.label}</Text>
              <Text style={styles.hint}>{r.is_connected ? "Connected" : "Not connected"}</Text>
            </View>

            <HapticButton
              onPress={() => toggleConnect(r.provider)}
              style={[styles.btn, { backgroundColor: r.is_connected ? "#14532d" : COLORS.accent }]}
            >
              <Text style={{ color: r.is_connected ? "#CFF8D6" : "#001018", fontWeight: "900" }}>
                {r.is_connected ? "Disconnect" : "Connect"}
              </Text>
            </HapticButton>

            <TouchableOpacity
              onPress={() => makeDefault(r.provider)}
              style={[styles.defaultDot, r.is_default ? styles.defaultDotOn : styles.defaultDotOff]}
            />
          </View>
        );
      })}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
        <View style={[styles.defaultDot, styles.defaultDotOn]} />
        <Text style={{ color: COLORS.subtext }}>= Default store</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0b1220",
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  name: { color: "#e2e8f0", fontSize: 16, fontWeight: "800" },
  hint: { color: "#94a3b8", marginTop: 2 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.lg },
  defaultDot: { width: 18, height: 18, borderRadius: 9, marginLeft: 8, borderWidth: 2 },
  defaultDotOn: { borderColor: "#22c55e", backgroundColor: "#22c55e33" },
  defaultDotOff: { borderColor: "#334155", backgroundColor: "transparent" },
});
