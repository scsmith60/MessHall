// app/(tabs)/owner/index.tsx
// 🧒 ELI5: This is the Owner home page.
// - We check if you are a boss using profiles.is_admin (TRUE = boss).
// - If you are, we load sponsor-friendly metric tiles.
// - If not, we show a friendly "Not Authorized" panel (no redirects).

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useColorScheme,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";

/* ----------------------------- Tiny theme ----------------------------- */
// 🟢 MessHall-like theme (works in dark/light). Keep or wire to your design system.
function useTheme() {
  const scheme = useColorScheme();
  if (scheme === "dark") {
    return {
      bg: "#0b1220",
      card: "#111827",
      border: "#1f2937",
      text: "#F8FAFC",
      textMuted: "#93A3B8",
      accent: "#22c55e", // MessHall green
      primary: "#3b82f6",
      pillBg: "rgba(255,255,255,0.08)",
      pillBorder: "rgba(255,255,255,0.12)",
      pillText: "#E5E7EB",
      trim: "#166534",
      danger: "#ef4444",
    };
  }
  return {
    bg: "#F8FAFC",
    card: "#FFFFFF",
    border: "#E5E7EB",
    text: "#0F172A",
    textMuted: "#475569",
    accent: "#16a34a",
    primary: "#2563eb",
    pillBg: "#1f2937",
    pillBorder: "#111827",
    pillText: "#E5E7EB",
    trim: "#065f46",
    danger: "#ef4444",
  };
}

/* ----------------------------- Pill Button ---------------------------- */
// 🔘 Reusable rounded action button
type PillProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  variant?: "primary" | "neutral" | "success" | "danger";
};
function PillButton({ icon, label, onPress, variant = "neutral" }: PillProps) {
  const C = useTheme();
  const bg =
    variant === "primary" ? C.primary :
    variant === "success" ? C.accent :
    variant === "danger" ? C.danger :
    C.pillBg;
  const text = variant === "primary" || variant === "success" || variant === "danger" ? "#001018" : C.pillText;
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        paddingVertical: 11,
        paddingHorizontal: 16,
        borderRadius: 999,
        backgroundColor: bg,
        borderWidth: variant === "neutral" ? 1 : 0,
        borderColor: variant === "neutral" ? C.pillBorder : "transparent",
        gap: 8,
      }}
    >
      <Ionicons name={icon} size={18} color={text} />
      <Text style={{ color: text, fontWeight: "900", fontSize: 16 }}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ----------------------------- Stat Card ------------------------------ */
// 📊 One small tile with a big number
function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  const C = useTheme();
  return (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: 16,
        padding: 12,
        borderWidth: 1,
        borderColor: C.border,
        minWidth: "46%",
        flexGrow: 1,
      }}
    >
      <Text style={{ color: C.textMuted, fontSize: 12, marginBottom: 6 }}>{label}</Text>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: "900" }}>{value}</Text>
      {!!hint && <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>{hint}</Text>}
    </View>
  );
}

/* -------------------------- Slot Row (list) --------------------------- */
// 🧱 Row shows Clicks (7d/30d) and Impressions (7d/30d) for sponsors
function SlotRow({
  label,
  clicks7,
  clicks30,
  imps7,
  imps30,
}: {
  label: string;
  clicks7: number;
  clicks30: number;
  imps7: number;
  imps30: number;
}) {
  const C = useTheme();
  const Pill = ({ text }: { text: string }) => (
    <View
      style={{
        backgroundColor: C.trim,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "800" }}>{text}</Text>
    </View>
  );
  return (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: C.border,
        gap: 8,
      }}
    >
      <Text style={{ color: C.text }} numberOfLines={1}>
        {label || "Unnamed Slot"}
      </Text>

      {/* Clicks pills */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: C.textMuted, fontSize: 12, width: 84 }}>Clicks</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pill text={`7d: ${clicks7}`} />
          <Pill text={`30d: ${clicks30}`} />
        </View>
      </View>

      {/* Impressions pills */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: C.textMuted, fontSize: 12, width: 84 }}>Impr.</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pill text={`7d: ${imps7}`} />
          <Pill text={`30d: ${imps30}`} />
        </View>
      </View>
    </View>
  );
}

/* ------------------------------ Screen -------------------------------- */
export default function OwnerDashboard() {
  // ✅ single theme instance for this component
  const C = useTheme();

  // 🔒 Admin gate states: we only use profiles.is_admin
  const [gate, setGate] = useState<"checking" | "authorized" | "unauthorized">("checking");

  // 📈 Metrics state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>(null);

  // 👮 Check admin (ONLY profiles.is_admin)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        console.log("[OwnerGate] start check");
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) {
          console.log("[OwnerGate] no session token");
          if (alive) setGate("unauthorized");
          return;
        }

        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) {
          console.log("[OwnerGate] no user id");
          if (alive) setGate("unauthorized");
          return;
        }

        // ✅ Only pull is_admin (since role column does not exist for you)
        const { data, error } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", uid)
          .maybeSingle();

        if (error) {
          console.log("[OwnerGate] profiles error:", error.message);
          if (alive) setGate("unauthorized");
          return;
        }
        if (!data) {
          console.log("[OwnerGate] no profile row for user");
          if (alive) setGate("unauthorized");
          return;
        }

        const isAdminFlag = Boolean(
          data.is_admin === true || data.is_admin === "true" || data.is_admin === "TRUE"
        );
        console.log("[OwnerGate] is_admin:", isAdminFlag, "=> allowed:", isAdminFlag);

        if (alive) setGate(isAdminFlag ? "authorized" : "unauthorized");
      } catch (e: any) {
        console.log("[OwnerGate] exception:", e?.message || e);
        if (alive) setGate("unauthorized");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 📊 Load metrics via Edge Function (server still re-checks auth)
  const loadMetrics = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      // get JWT first so we can see status/body on direct fetch
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) {
        console.log("[OwnerMetrics] no JWT token");
        setErr("Not signed in.");
        setMetrics(null);
        return;
      }

      // call the Edge Function directly to capture status + body
      const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/owner-metrics`;
      const res = await fetch(url, {
        method: "POST", // function also accepts GET
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ping: "hello" }),
      });

      const text = await res.text();
      console.log("[OwnerMetrics] status:", res.status);
      console.log("[OwnerMetrics] body:", text);

      if (!res.ok) {
        try {
          const j = JSON.parse(text);
          setErr(j?.error || `HTTP ${res.status}`);
        } catch {
          setErr(text || `HTTP ${res.status}`);
        }
        setMetrics(null);
        return;
      }

      let payload: any = {};
      try {
        payload = JSON.parse(text);
      } catch {
        setErr("Bad JSON from server.");
        setMetrics(null);
        return;
      }

      if (payload?.error) {
        setErr(String(payload.error));
        setMetrics(null);
        return;
      }

      setMetrics(payload);
      console.log("[OwnerMetrics] loaded at", payload?.generated_at);
    } catch (e: any) {
      console.log("[OwnerMetrics] exception:", e?.message || e);
      setErr(e?.message || "Couldn’t load metrics.");
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gate === "authorized") loadMetrics();
  }, [gate, loadMetrics]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMetrics();
    setRefreshing(false);
  };

  /* ---------- Gate Screens (no redirects) ---------- */
  if (gate === "checking") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <ActivityIndicator />
          <Text style={{ color: C.textMuted }}>Checking permission…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (gate === "unauthorized") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
        <View style={{ flex: 1, padding: 16, gap: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: "900", color: C.text }}>Owner Area</Text>
          <View style={{ padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border }}>
            <Text style={{ color: C.text, fontWeight: "800", marginBottom: 6 }}>Not Authorized</Text>
            <Text style={{ color: C.textMuted }}>
              You need <Text style={{ fontWeight: "800", color: C.text }}>profiles.is_admin = true</Text>.
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <PillButton icon="arrow-back" label="Back to Feed" onPress={() => router.push("/(tabs)")} />
            <PillButton
              icon="refresh"
              label="Check Again"
              variant="primary"
              onPress={() => {
                console.log("[OwnerGate] manual recheck");
                // Toggle gate to re-run the effect
                setGate("checking");
              }}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  /* ---------- Authorized: Dashboard UI ---------- */

  const dau = metrics?.users?.dau ?? 0;
  const totalUsers = metrics?.users?.total ?? 0;
  const new24h = metrics?.users?.new?.last_24h ?? 0;
  const new7d = metrics?.users?.new?.last_7d ?? 0;
  const new30d = metrics?.users?.new?.last_30d ?? 0;
  const newYTD = metrics?.users?.new?.ytd ?? 0;

  const clicksTotals = metrics?.ads?.clicks?.totals ?? {};
  const byPlacement = metrics?.ads?.clicks?.byPlacement ?? {};

  // clicks by slot (existing) and NEW impressions by slot
  const bySlotClicks: Array<{ slot_id: string; label: string; d7: number; d30: number }> =
    (metrics?.ads?.clicks?.bySlot ?? []).map((s: any) => ({
      slot_id: s.slot_id,
      label: s.label ?? "Unnamed Slot",
      d7: s.d7 ?? 0,
      d30: s.d30 ?? 0,
    }));

  const bySlotImpsMap = new Map<string, { d7: number; d30: number }>();
  (metrics?.ads?.impressions?.bySlot ?? []).forEach((s: any) => {
    bySlotImpsMap.set(s.slot_id, { d7: s.d7 ?? 0, d30: s.d30 ?? 0 });
  });

  // merge into a display-friendly shape
  const engagementRows = bySlotClicks.map((c) => {
    const i = bySlotImpsMap.get(c.slot_id) ?? { d7: 0, d30: 0 };
    return {
      slot_id: c.slot_id,
      label: c.label,
      clicks7: c.d7,
      clicks30: c.d30,
      imps7: i.d7,
      imps30: i.d30,
    };
  });

  // order by clicks 7d (desc)
  const topSlots = engagementRows.sort((a, b) => (b.clicks7 || 0) - (a.clicks7 || 0)).slice(0, 10);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {/* Title */}
        <Text style={{ fontSize: 26, fontWeight: "900", color: C.text, marginBottom: 4 }}>
          Owner Dashboard
        </Text>
        <Text style={{ color: C.textMuted, marginBottom: 16 }}>
          Sponsor-ready stats in MessHall green. 🎯
        </Text>

        {/* Quick actions (kept) */}
        <View style={{ gap: 10, marginBottom: 16 }}>
          <PillButton
            icon="checkmark-done-circle"
            label="Review Creator Requests"
            variant="primary"
            onPress={() => router.push("/(tabs)/owner/creator-approvals")}
          />
          <PillButton
            icon="albums"
            label="Manage Shelves"
            onPress={() => router.push("/(tabs)/owner/owner-rails")}
          />
          <PillButton
            icon="settings"
            label="Manage Slots"
            onPress={() => router.push("/(tabs)/owner/owner-slots")}
          />
          <PillButton
            icon="add-circle"
            label="New Sponsored Slot"
            variant="success"
            onPress={() => router.push("/(tabs)/owner/create-slot")}
          />
        </View>

        {/* Metrics */}
        <View style={{ gap: 12, marginBottom: 12 }}>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: "800" }}>Users</Text>
          {loading ? (
            <View style={{ paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator />
              <Text style={{ color: C.textMuted }}>Loading metrics…</Text>
            </View>
          ) : err ? (
            <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#3f1d1d", borderWidth: 1, borderColor: "#7f1d1d" }}>
              <Text style={{ color: "#fecaca", fontWeight: "800" }}>We hit a snag</Text>
              <Text style={{ color: "#fecaca", marginTop: 4 }}>{err}</Text>
              <TouchableOpacity
                onPress={loadMetrics}
                style={{ alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: C.danger }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Try again ↻</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* User tiles grid */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <StatCard label="Daily Active Users" value={dau} hint="last 24 hours" />
                <StatCard label="Total Users" value={totalUsers} />
                <StatCard label="New (24h)" value={new24h} />
                <StatCard label="New (7d)" value={new7d} />
                <StatCard label="New (30d)" value={new30d} />
                <StatCard label="New (YTD)" value={newYTD} />
              </View>

              {/* Ad performance */}
              <Text style={{ color: C.text, fontSize: 18, fontWeight: "800", marginTop: 16 }}>
                Ad Performance
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <StatCard label="Clicks (24h)" value={(metrics?.ads?.clicks?.totals ?? {}).last_24h ?? 0} />
                <StatCard label="Clicks (7d)" value={(metrics?.ads?.clicks?.totals ?? {}).last_7d ?? 0} />
                <StatCard label="Clicks (30d)" value={(metrics?.ads?.clicks?.totals ?? {}).last_30d ?? 0} />
                <StatCard label="Clicks (YTD)" value={(metrics?.ads?.clicks?.totals ?? {}).ytd ?? 0} />
                <StatCard label="Rail (7d)" value={(byPlacement?.rail ?? {}).last_7d ?? 0} hint="rail only" />
                <StatCard label="Feed (7d)" value={(byPlacement?.feed ?? {}).last_7d ?? 0} hint="feed only" />
              </View>

              {/* Ad Engagement (Clicks + Impressions by slot) */}
              <View
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 16,
                  backgroundColor: C.card,
                  borderWidth: 1,
                  borderColor: C.trim,
                }}
              >
                <Text style={{ color: C.text, fontWeight: "800", marginBottom: 8 }}>
                  Ad Engagement (top 10)
                </Text>
                {topSlots.length === 0 ? (
                  <Text style={{ color: C.textMuted }}>No engagement yet.</Text>
                ) : (
                  <FlatList
                    data={topSlots}
                    keyExtractor={(it) => it.slot_id}
                    ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                    renderItem={({ item }) => (
                      <SlotRow
                        label={item.label || "Unnamed Slot"}
                        clicks7={item.clicks7 ?? 0}
                        clicks30={item.clicks30 ?? 0}
                        imps7={item.imps7 ?? 0}
                        imps30={item.imps30 ?? 0}
                      />
                    )}
                    scrollEnabled={false}
                  />
                )}
              </View>
            </>
          )}
        </View>

        {/* Placeholder cards (kept for layout parity) */}
        <View style={{ gap: 12 }}>
          <View
            style={{
              padding: 14,
              borderRadius: 16,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.border,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.text }}>Revenue</Text>
            <Text style={{ color: C.textMuted }}>$0.00 today (wire up real data)</Text>
          </View>

          <View
            style={{
              padding: 14,
              borderRadius: 16,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.border,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.text }}>Payouts</Text>
            <Text style={{ color: C.textMuted }}>Approve creator payouts securely.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
