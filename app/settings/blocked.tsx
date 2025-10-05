// app/settings/blocked.tsx
// 👶 What this screen does (like I'm 5):
// - Shows a list of people you blocked.
// - Lets you tap "Unblock" to remove them from that list.
// - You can pull down to refresh.
//
// 🔧 What I changed:
// - Removed the require("../../assets/avatar-placeholder.png") that caused bundling errors.
// - Added a nice fallback avatar using a Feather icon when a user has no avatar_url.
//
// ✅ Everything else is untouched.

import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Image,
  Pressable,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons"; // 👈 fallback avatar icon
import { COLORS, SPACING } from "../../lib/theme";
import { listBlockedUsers, unblockUser, BlockedUser } from "../../lib/blocking";

export default function BlockedAccountsScreen() {
  // 🧠 keep our list of blocked users here
  const [items, setItems] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ⛽ load from the database (Supabase)
  const load = useCallback(async () => {
    setLoading(true);
    const rows = await listBlockedUsers(); // gets username + resolved avatar_url
    setItems(rows);
    setLoading(false);
  }, []);

  // 🚀 load when the screen mounts
  useEffect(() => {
    load();
  }, [load]);

  // 🔄 pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // 🚪 unblock flow
  const onUnblock = (u: BlockedUser) => {
    Alert.alert(
      "Unblock this user?",
      u.username
        ? `You and ${u.username} will be able to see each other again.`
        : "You will be able to see each other again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          style: "destructive",
          onPress: async () => {
            const ok = await unblockUser(u.id);
            if (!ok) {
              Alert.alert("Sorry", "Couldn’t unblock. Try again.");
              return;
            }
            // remove from list right away so it feels instant
            setItems((prev) => prev.filter((x) => x.id !== u.id));
          },
        },
      ]
    );
  };

  // 🧱 one row in the list
  const Row = ({ item }: { item: BlockedUser }) => (
    <View
      style={{
        backgroundColor: COLORS.card,
        borderColor: COLORS.border,
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      {/* 👤 Avatar: use the user's avatar_url if present, otherwise show a tidy icon */}
      {item.avatar_url ? (
        <Image
          source={{ uri: item.avatar_url }}
          style={{ width: 40, height: 40, borderRadius: 20, marginRight: 12 }}
        />
      ) : (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            marginRight: 12,
            backgroundColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="user" size={20} color="rgba(255,255,255,0.85)" />
        </View>
      )}

      {/* 📛 Username + since */}
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#fff", fontWeight: "800" }}>
          {item.username ?? "User"}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
          since {new Date(item.since).toLocaleDateString()}
        </Text>
      </View>

      {/* 🔓 Unblock button */}
      <Pressable
        onPress={() => onUnblock(item)}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: COLORS.border,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "800" }}>Unblock</Text>
      </Pressable>
    </View>
  );

  // 🖼️ Screen layout
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: COLORS.bg }}
      edges={["top", "left", "right"]}
    >
      <View style={{ padding: SPACING.lg }}>
        <Text
          style={{
            color: "#fff",
            fontSize: 22,
            fontWeight: "900",
            marginBottom: 12,
          }}
        >
          Blocked accounts
        </Text>

        {loading ? (
          <ActivityIndicator />
        ) : items.length === 0 ? (
          <Text style={{ color: "rgba(255,255,255,0.7)" }}>
            You haven’t blocked anyone.
          </Text>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(it) => it.id}
            renderItem={({ item }) => <Row item={item} />}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#fff"
              />
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}
