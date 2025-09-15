// app/(tabs)/owner/creator-approvals.tsx
// 🧸 Like I'm 5 — what this screen does:
// • Shows a list of people who tapped “Apply for Monetization”
// • Grown-ups (admins) can Approve or Reject
// • You can “Resend Stripe Link” if a creator didn’t finish onboarding
//
// ⭐ What I changed (small + safe):
// 1) All server calls now use supabase.functions.invoke(...) so your login token
//    rides along automatically. (Fixes empty list when the request had no token.)
// 2) Admin check now reads *your* row (eq id = you). (Fixes flaky single() on profiles.)
// 3) Error banner + empty state so you’re never staring at a blank screen.
// 4) SafeAreaView so the header isn’t under the clock/notch.

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  TextInput,
  FlatList,
  Alert,
  Share, // native share sheet
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";

// 🧠 The shape of the rows we render (matches your admin-list-creator-apps output)
type AppRow = {
  application_id: number;
  user_id: string;
  application_status: "pending" | "approved" | "rejected" | "withdrawn";
  submitted_at: string;
  reviewed_at: string | null;
  reviewer: string | null;
  notes: string | null;
  username: string | null;
  email: string | null;

  // optional/derived bits you were showing
  creator_status?: "none" | "eligible" | "applied" | "approved" | "rejected" | null;
  followers?: number | null;
  recipes_published?: number | null;
  views_30d?: number | null;
  avg_rating?: number | null;
  affiliate_conversions_60d?: number | null;
  two_factor_enabled?: boolean | null;

  // payout info (optional)
  stripe_account_id?: string | null;
  details_submitted: boolean | null;
};

export default function OwnerCreatorApprovals() {
  // 🧺 little state baskets for our screen
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AppRow[]>([]);
  const [statusFilter, setStatusFilter] =
    useState<"pending" | "approved" | "rejected" | "withdrawn" | "">("pending");
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null); // 🆕 show problems nicely

  // 👮 step 1: “am I a grown-up?” (admin check)
  // We read *my* profile row (eq id = me). If is_admin is true → I can use this screen.
  const checkAdmin = async () => {
    const { data: au } = await supabase.auth.getUser();
    const uid = au?.user?.id;
    if (!uid) {
      setIsAdmin(false);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", uid) // ← read my row only
      .maybeSingle();
    setIsAdmin(!!data?.is_admin);
  };

  // 📬 step 2: fetch list from our Edge Function (token auto-attached)
  const load = async () => {
    setLoading(true);
    setErrMsg(null);
    try {
      // ✅ invoke = adds Bearer token for us
      const { data, error } = await supabase.functions.invoke(
        "admin-list-creator-apps",
        { body: { status: statusFilter } } // function accepts body OR querystring
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      setItems([]);
      setErrMsg(e?.message || "Couldn’t load creator requests.");
    } finally {
      setLoading(false);
    }
  };

  // 🚦 when the chip/tab changes, re-check admin and reload
  useEffect(() => {
    checkAdmin().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // ✅ approve button tapped (call your function; then refresh)
  const approve = async (application_id: number) => {
    try {
      const note = noteById[application_id] || "";
      const { data, error } = await supabase.functions.invoke(
        "admin-approve-creator",
        { body: { application_id, note } }
      );
      if (error || !data?.ok) {
        throw new Error(error?.message || data?.error || "Couldn’t approve.");
      }
      Alert.alert("Approved", "Application approved.");
      load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Something went wrong.");
    }
  };

  // ❌ reject button tapped
  const reject = async (application_id: number) => {
    try {
      const note = noteById[application_id] || "";
      const { data, error } = await supabase.functions.invoke(
        "admin-reject-creator",
        { body: { application_id, note } }
      );
      if (error || !data?.ok) {
        throw new Error(error?.message || data?.error || "Couldn’t reject.");
      }
      Alert.alert("Rejected", "Application rejected.");
      load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Something went wrong.");
    }
  };

  // 🔁 RESEND STRIPE LINK (only shows if details_submitted === false)
  const resendStripe = async (row: AppRow) => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-resend-stripe-onboarding",
        { body: { user_id: row.user_id } }
      );
      if (error || !data?.url) throw new Error(error?.message || data?.error || "No link was returned");
      // open native share sheet so owner can send the link to the creator
      await Share.share({ message: `Complete your MessHall payout onboarding:\n${data.url}` });
      Alert.alert("Sent", "Onboarding link created.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Couldn’t create onboarding link.");
    }
  };

  if (!isAdmin) {
    // Kid-friendly “nope”
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1220" }} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ color: "#f1f5f9", fontWeight: "900", fontSize: 18 }}>Admins Only</Text>
          <Text style={{ color: "#94a3b8", marginTop: 6, textAlign: "center" }}>
            You need admin access to review creator requests.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1220" }} edges={["top"]}>
        <View
          style={{
            flex: 1,
            padding: 24,
            backgroundColor: "#0b1220",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <ActivityIndicator />
          <Text style={{ color: "#f8fafc" }}>Loading requests…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // 🎨 pill helpers (green when selected)
  const chip = (on: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: on ? "#22c55e" : "#1f2937",
  });
  const chipText = (on: boolean) => ({
    color: on ? "#001018" : "#e5e7eb",
    fontWeight: "900",
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0b1220" }} edges={["top"]}>
      <View style={{ flex: 1, backgroundColor: "#0b1220", padding: 16, gap: 12 }}>
        {/* Title */}
        <Text style={{ color: "#f8fafc", fontWeight: "900", fontSize: 22 }}>Creator Approvals</Text>

        {/* 🆕 Error banner (if something failed) */}
        {errMsg && (
          <View
            style={{
              backgroundColor: "#3f1d1d",
              borderColor: "#7f1d1d",
              borderWidth: 1,
              padding: 10,
              borderRadius: 12,
            }}
          >
            <Text style={{ color: "#fecaca", fontWeight: "800" }}>We hit a snag</Text>
            <Text style={{ color: "#fecaca", marginTop: 4 }}>{errMsg}</Text>
            <Pressable
              onPress={load}
              style={{
                alignSelf: "flex-start",
                marginTop: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: "#ef4444",
              }}
            >
              <Text style={{ color: "white", fontWeight: "800" }}>Try again ↻</Text>
            </Pressable>
          </View>
        )}

        {/* Filter chips */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable style={chip(statusFilter === "pending")} onPress={() => setStatusFilter("pending")}>
            <Text style={chipText(statusFilter === "pending")}>pending</Text>
          </Pressable>
          <Pressable style={chip(statusFilter === "approved")} onPress={() => setStatusFilter("approved")}>
            <Text style={chipText(statusFilter === "approved")}>approved</Text>
          </Pressable>
          <Pressable style={chip(statusFilter === "rejected")} onPress={() => setStatusFilter("rejected")}>
            <Text style={chipText(statusFilter === "rejected")}>rejected</Text>
          </Pressable>
        </View>

        {/* Empty state */}
        {items.length === 0 && !errMsg && (
          <View
            style={{
              padding: 16,
              backgroundColor: "#0f172a",
              borderWidth: 1,
              borderColor: "#1f2937",
              borderRadius: 12,
            }}
          >
            <Text style={{ color: "#94a3b8" }}>
              No {statusFilter || "matching"} requests yet.
            </Text>
          </View>
        )}

        {/* The list */}
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.application_id)}
          contentContainerStyle={{ paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <View
              style={{
                padding: 12,
                backgroundColor: "#111827",
                borderRadius: 12,
                gap: 6,
                borderWidth: 1,
                borderColor: "#1f2937",
              }}
            >
              {/* Header */}
              <Text style={{ color: "#f8fafc", fontWeight: "900", fontSize: 16 }}>
                {item.username || item.email} • {item.application_status.toUpperCase()}
              </Text>

              {/* Quick stats (only show what we have) */}
              <Text style={{ color: "#cbd5e1" }}>
                Recipes: {item.recipes_published ?? 0} • Followers: {item.followers ?? 0} •
                Views30d: {item.views_30d ?? 0}
              </Text>
              <Text style={{ color: "#cbd5e1" }}>
                Avg Rating: {item.avg_rating ?? "—"} • Conversions60d:{" "}
                {item.affiliate_conversions_60d ?? 0}
              </Text>
              <Text style={{ color: "#cbd5e1" }}>
                2FA: {item.two_factor_enabled ? "✅" : "❌"} • Stripe:{" "}
                {item.details_submitted ? "✅ Onboarded" : "⭕ Not done"}
              </Text>

              {/* Notes box (owner can type a reason before Approve/Reject) */}
              <TextInput
                placeholder="Optional note to the creator…"
                placeholderTextColor="#64748b"
                value={noteById[item.application_id] || ""}
                onChangeText={(t) =>
                  setNoteById((prev) => ({ ...prev, [item.application_id]: t }))
                }
                style={{
                  backgroundColor: "#0b1220",
                  borderWidth: 1,
                  borderColor: "#1f2937",
                  color: "#e2e8f0",
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  marginTop: 6,
                }}
              />

              {/* Action row */}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                {/* Approve */}
                <Pressable
                  onPress={() => approve(item.application_id)}
                  style={{
                    backgroundColor: "#22c55e",
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: "#001018", fontWeight: "700" }}>Approve</Text>
                </Pressable>

                {/* Reject */}
                <Pressable
                  onPress={() => reject(item.application_id)}
                  style={{
                    backgroundColor: "#ef4444",
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ color: "white", fontWeight: "700" }}>Reject</Text>
                </Pressable>

                {/* Resend Stripe Link (only if not finished yet) */}
                {!item.details_submitted && (
                  <Pressable
                    onPress={() => resendStripe(item)}
                    style={{
                      backgroundColor: "#2563eb",
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderRadius: 8,
                    }}
                  >
                    <Text style={{ color: "#ffffff", fontWeight: "700" }}>
                      Resend Stripe Link
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        />
      </View>
    </SafeAreaView>
  );
}
