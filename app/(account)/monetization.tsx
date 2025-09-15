// app/(account)/monetization.tsx
//
// LIKE I'M 5 (what changed):
// • When you're APPROVED, the "Earn on your recipes" switch now saves to the database:
//    - ON  -> profiles.monetize_enabled_at = now()
//    - OFF -> profiles.monetize_enabled_at = null
//   We also read that value on load so the switch remembers your choice.
// • We only show/compute the Eligibility checklist BEFORE you apply (appStatus === "none").
//   That removes the scary "We couldn’t load your checklist" once you're pending/approved.
//
// Everything else stays the same.

import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Switch,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

const COLORS = {
  bg: "#0b1220",
  card: "#111827",
  card2: "#0f172a",
  border: "#1f2937",
  text: "#e5e7eb",
  sub: "#94a3b8",
  good: "#22c55e",
  bad: "#ef4444",
  accent: "#38bdf8",
  glass: "rgba(255,255,255,0.06)",
};

// 🧁 tiny dark popup we control (no more white OS Alert)
function ThemedToast({
  visible,
  onClose,
  title,
  message,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: COLORS.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 16,
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 16 }}>
            {title}
          </Text>
          <Text style={{ color: COLORS.sub, marginTop: 8 }}>{message}</Text>
          <Pressable
            onPress={onClose}
            style={{
              alignSelf: "flex-end",
              marginTop: 14,
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: 999,
              backgroundColor: COLORS.accent,
            }}
          >
            <Text style={{ color: "#041016", fontWeight: "900" }}>OK</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type ChecklistItem = { label: string; help?: string; passed: boolean };
type AppStatus = "none" | "pending" | "approved" | "rejected" | "withdrawn";

export default function MonetizationScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id;

  // 🧺 little buckets
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [applying, setApplying] = useState(false);
  const [appStatus, setAppStatus] = useState<AppStatus>("none");

  // switch state now persists to DB via profiles.monetize_enabled_at
  const [monetizeOn, setMonetizeOn] = useState(false);
  const monetizationToggleEnabled = useMemo(
    () => appStatus === "approved",
    [appStatus]
  );

  // 🌈 our dark popup state
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  // 🕵️ load newest application (+ eligibility only if needed) and current switch state
  const load = async () => {
    if (!userId) return;
    setLoading(true);

    // 1) newest application row (might not exist)
    const { data: apps, error: appErr } = await supabase
      .from("creator_applications")
      .select("status, submitted_at")
      .eq("user_id", userId)
      .order("submitted_at", { ascending: false })
      .limit(1);

    let status: AppStatus = "none";
    if (!appErr && apps && apps.length > 0) {
      status = (apps[0].status as AppStatus) || "none";
    }
    setAppStatus(status);

    // 2) If APPROVED, read current on/off from profiles.monetize_enabled_at
    if (status === "approved") {
      const { data: prof } = await supabase
        .from("profiles")
        .select("monetize_enabled_at")
        .eq("id", userId)
        .maybeSingle();
      setMonetizeOn(!!prof?.monetize_enabled_at);
      // We skip the eligibility checklist once you've applied/been approved.
      setEligible(null);
      setChecklist([]);
      setLoading(false);
      return;
    }

    // 3) If PENDING/REJECTED, we also skip the checklist (no need to nag).
    if (status === "pending" || status === "rejected" || status === "withdrawn") {
      setEligible(null);
      setChecklist([]);
      setLoading(false);
      return;
    }

    // 4) Only when there's NO application yet (status === "none"), load the checklist
    try {
      const { data, error } = await supabase.functions.invoke("eligibility-check", {
        body: {},
      });
      if (error) throw error;
      setEligible(!!data?.eligible);
      setChecklist(Array.isArray(data?.checklist) ? data.checklist : []);
    } catch {
      setEligible(null);
      setChecklist([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [userId]);

  // 🚀 user taps Apply — unchanged except we already use invoke()
  const applyNow = async () => {
    try {
      setApplying(true);

      const { data, error } = await supabase.functions.invoke("creator-apply", {
        body: {},
      });

      if (error || !data?.ok) {
        setToastMsg(error?.message || data?.error || "Couldn’t submit application. Please try again.");
        setToastOpen(true);
        return;
      }

      // ✅ immediately reflect "pending" in UI
      setAppStatus("pending");
      setToastMsg("Application submitted! We’ll email you when approved.");
      setToastOpen(true);
    } catch (e: any) {
      setToastMsg(e?.message || "Something went wrong.");
      setToastOpen(true);
    } finally {
      setApplying(false);
    }
  };

  // 🧲 toggle saver: writes to profiles.monetize_enabled_at
  const setMonetize = async (next: boolean) => {
    if (!userId || !monetizationToggleEnabled) return;
    setMonetizeOn(next); // optimistic
    try {
      const updates =
        next
          ? { monetize_enabled_at: new Date().toISOString() }
          : { monetize_enabled_at: null };

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", userId);

      if (error) {
        // revert if save failed
        setMonetizeOn(!next);
        setToastMsg(error.message || "Couldn’t save your setting. Please try again.");
        setToastOpen(true);
      } else {
        setToastMsg(next ? "Monetization turned ON." : "Monetization turned OFF.");
        setToastOpen(true);
      }
    } catch (e: any) {
      setMonetizeOn(!next);
      setToastMsg(e?.message || "Couldn’t save your setting.");
      setToastOpen(true);
    }
  };

  // 🎨 helpers (unchanged)
  const chip = (text: string, color: string) => (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: color,
        borderRadius: 999,
      }}
    >
      <Text style={{ color: "#041016", fontWeight: "900" }}>{text}</Text>
    </View>
  );

  const Row = ({ ok, label, help }: { ok: boolean; label: string; help?: string }) => (
    <View
      style={{
        backgroundColor: COLORS.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
      }}
    >
      <Text style={{ color: ok ? COLORS.text : COLORS.sub, fontWeight: "800" }}>
        {ok ? "✅" : "⭕"} {label}
      </Text>
      {help ? <Text style={{ color: COLORS.sub, marginTop: 4 }}>{help}</Text> : null}
    </View>
  );

  // 🧠 decide button text + disabled state (unchanged)
  let buttonText = "Apply for Monetization";
  let buttonDisabled = false;

  if (appStatus === "pending") {
    buttonText = "Application pending";
    buttonDisabled = true;
  } else if (appStatus === "approved") {
    buttonText = "Approved";
    buttonDisabled = true;
  } else if (appStatus === "rejected") {
    buttonText = "Application rejected";
    buttonDisabled = true; // (you can add a "Reapply" flow later)
  } else {
    // no application yet → use eligibility gates
    if (eligible === false) {
      buttonText = "Complete the steps to apply";
      buttonDisabled = true;
    }
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900" }}>
          Monetization
        </Text>

        {/* Status pill */}
        {appStatus === "pending" && chip("Pending review", COLORS.accent)}
        {appStatus === "approved" && chip("Approved", COLORS.good)}
        {appStatus === "rejected" && chip("Rejected", COLORS.bad)}

        {/* Loading spinner */}
        {loading && (
          <View style={{ padding: 12, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
            <Text style={{ color: COLORS.sub, marginTop: 6 }}>Checking your status…</Text>
          </View>
        )}

        {/* Checklist — ONLY before you apply (no app yet) */}
        {!loading && appStatus === "none" && (
          <View style={{ gap: 10 }}>
            <Text style={{ color: COLORS.sub }}>Eligibility checklist</Text>
            {checklist.length === 0 && (
              <Text style={{ color: COLORS.sub }}>
                We couldn’t load your checklist right now.
              </Text>
            )}
            {checklist.map((c, i) => (
              <Row key={i} ok={!!c.passed} label={c.label} help={c.help} />
            ))}
          </View>
        )}

        {/* Apply button */}
        <Pressable
          disabled={buttonDisabled || applying}
          onPress={applyNow}
          style={{
            marginTop: 8,
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 14,
            borderRadius: 999,
            backgroundColor:
              buttonDisabled || applying ? COLORS.border : COLORS.good,
            opacity: applying ? 0.8 : 1,
          }}
        >
          <Text
            style={{
              color: buttonDisabled || applying ? "#a7b0bf" : "#041016",
              fontWeight: "900",
            }}
          >
            {applying ? "Submitting…" : buttonText}
          </Text>
        </Pressable>

        {/* Monetization switch: enabled only when APPROVED; saves to DB */}
        <View
          style={{
            marginTop: 8,
            backgroundColor: COLORS.card2,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>
              Earn on your recipes
            </Text>
            <Text style={{ color: COLORS.sub, marginTop: 4 }}>
              Turn this on after you’re approved.
            </Text>
          </View>
          <Switch
            value={monetizeOn}
            onValueChange={(v) => setMonetize(v)}
            disabled={!monetizationToggleEnabled}
            trackColor={{ false: COLORS.border, true: COLORS.good }}
            thumbColor={monetizationToggleEnabled ? "#041016" : "#2a3446"}
          />
        </View>

        <Text style={{ color: COLORS.sub, fontSize: 12 }}>
          Tip: Once approved, we’ll email you and unlock the switch.
        </Text>
      </ScrollView>

      {/* Dark popup for messages */}
      <ThemedToast
        visible={toastOpen}
        onClose={() => setToastOpen(false)}
        title="All set"
        message={toastMsg}
      />
    </SafeAreaView>
  );
}
