// app/u/[username]/followers.tsx
// LIKE I'M 5: show people who follow this user.
// You can tap a person to visit their profile, or tap Follow/Unfollow.

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import {
  getUserIdByUsername,
  listFollowers,
  getFollowState,
  toggleFollow,
} from "@/lib/data";

const C = {
  bg: "#0f172a", card: "#1f2937", ink: "#e5e7eb", sub: "#9ca3af", accent: "#38bdf8"
};

type Person = {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio?: string | null;
  followers?: number | null;
  following?: number | null;
};

function Row({ p, onOpen, onToggle, isFollowing }: {
  p: Person; onOpen: () => void; onToggle: () => void; isFollowing: boolean | null;
}) {
  const letter = (p.username || "U").slice(0,1).toUpperCase();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 10 }}>
      {p.avatar_url ? (
        <Image source={{ uri: p.avatar_url }} style={{ width: 44, height: 44, borderRadius: 22, marginRight: 12 }} />
      ) : (
        <View style={{ width: 44, height: 44, borderRadius: 22, marginRight: 12, backgroundColor: "#111827", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: C.ink, fontWeight: "800" }}>{letter}</Text>
        </View>
      )}
      <TouchableOpacity style={{ flex: 1 }} onPress={onOpen} activeOpacity={0.7}>
        <Text style={{ color: C.ink, fontWeight: "800" }}>{p.username || "Anonymous"}</Text>
        <Text numberOfLines={1} style={{ color: C.sub, marginTop: 2 }}>{p.bio || "⋯"}</Text>
      </TouchableOpacity>
      {isFollowing !== null && (
        <TouchableOpacity
          onPress={onToggle}
          style={{
            paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999,
            backgroundColor: isFollowing ? C.card : C.accent, borderWidth: 1, borderColor: C.accent
          }}
        >
          <Text style={{ color: isFollowing ? C.ink : "#041016", fontWeight: "800" }}>
            {isFollowing ? "Unfollow" : "Follow"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function Followers() {
  // 1) read who we’re looking at from the URL: /u/:username/followers
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();

  // 2) who am *I* (so we can show Follow buttons)
  const { session } = useAuth();
  const viewer = session?.user?.id ?? null;

  // 3) page state
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [states, setStates] = useState<Record<string, boolean>>({}); // id -> am I following them?

  // 4) load data
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const targetId = await getUserIdByUsername(String(username || ""));
      if (!targetId) { setPeople([]); return; }
      const rows = await listFollowers(targetId); // who follows TARGET
      setPeople(rows as Person[]);
      // pre-check my follow state for each person
      if (viewer) {
        const pairs = await Promise.all(rows.map(async (p: any) => [p.id, await getFollowState(p.id)] as const));
        setStates(Object.fromEntries(pairs));
      } else {
        setStates({});
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not load followers.");
    } finally {
      setLoading(false);
    }
  }, [username, viewer]);

  useEffect(() => { load(); }, [load]);

  // 5) toggle button
  const onToggle = async (id: string) => {
    try {
      const now = await toggleFollow(id);
      setStates(s => ({ ...s, [id]: now }));
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not update follow.");
    }
  };

  if (loading) {
    return (
      <View style={{ flex:1, backgroundColor:C.bg, alignItems:"center", justifyContent:"center" }}>
        <ActivityIndicator /><Text style={{ color: C.sub, marginTop: 8 }}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, backgroundColor:C.bg, padding:16 }}>
      <Text style={{ color: C.ink, fontSize: 18, fontWeight: "900", marginBottom: 12 }}>
        Followers
      </Text>
      {people.length === 0 ? (
        <View style={{ backgroundColor: C.card, padding: 16, borderRadius: 12 }}>
          <Text style={{ color: C.ink, fontWeight: "700" }}>No followers yet</Text>
        </View>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <Row
              p={item}
              onOpen={() => router.push(`/u/${item.username}`)}
              onToggle={() => onToggle(item.id)}
              isFollowing={viewer ? !!states[item.id] : null}
            />
          )}
        />
      )}
    </View>
  );
}
