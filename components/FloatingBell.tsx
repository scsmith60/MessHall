// components/FloatingBell.tsx
// 🧸 Baby-simple floating bell (top-right). Small, tasteful, and glows green when unread.
// - Tap = open tray
// - Count badge = number of unread
// - Uses your lib/data.ts notification helpers
//
// If it overlaps your search button, tweak the `right`/`top` values below.

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import {
  getUnreadNotificationCount,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  subscribeToNotifications,
} from "@/lib/data";

// Local minimal type for notifications to avoid coupling to lib/data export types
type NotificationItem = {
  id: string;
  isRead?: boolean;
  recipeId?: string | null;
  actorAvatar?: string | null;
  actorUsername?: string | null;
  type?: string | null;
  title?: string | null;
  body?: string | null;
  createdAt: string;
};

// 🎨 Theme bits
const COLORS = {
  glass: "rgba(15, 23, 42, 0.55)", // subtle glass
  border: "#1f2937",
  text: "#e5e7eb",
  sub: "#94a3b8",
  card: "#0b1220",
  card2: "#0f172a",
  accent: "#22c55e", // MessHall green
};

function timeShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function FloatingBell() {
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  // gentle pop when unread appears
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const refreshCount = async () => {
    try {
      const n = await getUnreadNotificationCount();
      setCount(n);
      if (n > 0) {
        Animated.sequence([
          Animated.timing(pop, { toValue: 1, duration: 120, useNativeDriver: true }),
          Animated.spring(pop, { toValue: 0, useNativeDriver: true }),
        ]).start();
      }
    } catch {}
  };

  const refreshList = async () => {
    setLoading(true);
    try {
      const list = await listNotifications(50, true); // show only unread notifications
      setRows(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    refreshCount(); // initial badge
    const off = subscribeToNotifications(() => {
      refreshCount();
      if (open) refreshList();
    });
    return () => { try { (off as any)(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, open]);

  const openTray = async () => {
    setOpen(true);
    await refreshList();
  };
  const closeTray = () => setOpen(false);

  const onTapRow = async (n: NotificationItem) => {
    try {
      await markNotificationRead(n.id);
      // Remove the notification from the list since it's now read
      setRows((old) => old.filter((x) => x.id !== n.id));
      setCount((c) => Math.max(0, c - 1));
    } catch {}
    setOpen(false);
    if (n.recipeId) router.push(`/recipe/${n.recipeId}`);
  };

  if (!userId) return null;

  const hasUnread = count > 0;
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const topOffset = Math.max(8, insets.top + 8);

  return (
    <>
      {/* FLOATING BUTTON (top-right) */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          right: 12,                      // move farther left if overlapping search
          top: topOffset,
          zIndex: 9999,
        }}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <TouchableOpacity
            onPress={openTray}
            activeOpacity={0.9}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: COLORS.glass,        // small, subtle glass chip
              borderWidth: 1,
              borderColor: COLORS.border,
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#000",
              shadowOpacity: 0.25,
              shadowOffset: { width: 0, height: 6 },
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            {/* icon turns green when unread */}
            <Ionicons
              name={hasUnread ? "notifications" : "notifications-outline"}
              size={20}
              color={hasUnread ? COLORS.accent : COLORS.text}
            />

            {hasUnread && (
              <View
                style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: "#0b1220",
                  paddingHorizontal: 5,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}
              >
                <Text style={{ color: COLORS.accent, fontWeight: "900", fontSize: 11 }}>
                  {count > 9 ? "9+" : count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* TRAY */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={closeTray}>
        <Pressable onPress={closeTray} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}>
          <Pressable
            onPress={() => {}}
            style={{
              alignSelf: "flex-end",
              marginRight: 12,
              marginTop: Math.max(64, insets.top + 64), // tray starts under your title area
              width: 340,
              maxWidth: "92%",
              backgroundColor: COLORS.card,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: COLORS.border,
              padding: 12,
              maxHeight: "70%",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Ionicons name="notifications" size={15} color={COLORS.text} />
              <Text style={{ color: COLORS.text, fontWeight: "900", marginLeft: 6 }}>
                Notifications
              </Text>
              <View style={{ flex: 1 }} />
              {count > 0 && (
                <TouchableOpacity
                  onPress={async () => {
                    setLoading(true);
                    try {
                      await markAllNotificationsRead();
                      await refreshCount(); // Update badge count first
                      await refreshList(); // Then refresh list (will now be empty since all are read)
                    } finally {
                      setLoading(false);
                    }
                  }}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 10,
                    backgroundColor: COLORS.card2,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                >
                  <Text style={{ color: COLORS.text, fontWeight: "800" }}>Mark all read</Text>
                </TouchableOpacity>
              )}
            </View>

            {loading ? (
              <ActivityIndicator />
            ) : rows.length === 0 ? (
              <Text style={{ color: COLORS.sub, marginTop: 6 }}>Nothing yet.</Text>
            ) : (
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                {rows.map((n) => (
                  <TouchableOpacity
                    key={n.id}
                    activeOpacity={0.88}
                    onPress={() => onTapRow(n)}
                    style={{
                      backgroundColor: n.isRead ? COLORS.card2 : COLORS.glass,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      padding: 10,
                      flexDirection: "row",
                      gap: 10,
                    }}
                  >
                    {/* avatar */}
                    {n.actorAvatar ? (
                      <Image
                        source={{ uri: n.actorAvatar }}
                        style={{ width: 32, height: 32, borderRadius: 16 }}
                      />
                    ) : (
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: COLORS.card2,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 12 }}>
                          {(n.actorUsername || "U").slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                    )}

                    {/* text */}
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.text, fontWeight: "900" }}>
                        {n.title || (n.type === "comment" ? "New comment" : "New notification")}
                      </Text>
                      <Text numberOfLines={2} style={{ color: COLORS.sub, marginTop: 2 }}>
                        {n.actorUsername ? `${n.actorUsername}: ` : ""}
                        {n.body || "…"}
                      </Text>
                    </View>

                    {/* time */}
                    <Text style={{ color: COLORS.sub, marginLeft: 6 }}>{timeShort(n.createdAt)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
