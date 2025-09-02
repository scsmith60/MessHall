// app/u/[username]/following.tsx
// LIKE I'M 5: show who this user follows. You can tap to visit, or Unfollow.

import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import {
  getUserIdByUsername,
  listFollowing,
  getFollowState,
  toggleFollow,
} from "@/lib/data";

const C = { bg:"#0f172a", card:"#1f2937", ink:"#e5e7eb", sub:"#9ca3af", accent:"#38bdf8" };

type Person = { id: string; username: string | null; avatar_url: string | null; bio?: string | null; };

function Row({ p, onOpen, onToggle, iFollow }: {
  p: Person; onOpen: () => void; onToggle: () => void; iFollow: boolean | null;
}) {
  const letter = (p.username || "U").slice(0,1).toUpperCase();
  return (
    <View style={{ flexDirection:"row", alignItems:"center", backgroundColor:C.card, borderRadius:12, padding:12, marginBottom:10 }}>
      {p.avatar_url ? (
        <Image source={{ uri: p.avatar_url }} style={{ width:44, height:44, borderRadius:22, marginRight:12 }} />
      ) : (
        <View style={{ width:44, height:44, borderRadius:22, marginRight:12, backgroundColor:"#111827", alignItems:"center", justifyContent:"center" }}>
          <Text style={{ color:C.ink, fontWeight:"800" }}>{letter}</Text>
        </View>
      )}
      <TouchableOpacity style={{ flex:1 }} onPress={onOpen} activeOpacity={0.7}>
        <Text style={{ color:C.ink, fontWeight:"800" }}>{p.username || "Anonymous"}</Text>
        <Text numberOfLines={1} style={{ color:C.sub, marginTop:2 }}>{p.bio || "⋯"}</Text>
      </TouchableOpacity>
      {iFollow !== null && (
        <TouchableOpacity
          onPress={onToggle}
          style={{
            paddingVertical:8, paddingHorizontal:12, borderRadius:999,
            backgroundColor: iFollow ? C.card : C.accent, borderWidth:1, borderColor:C.accent
          }}
        >
          <Text style={{ color: iFollow ? C.ink : "#041016", fontWeight:"800" }}>
            {iFollow ? "Unfollow" : "Follow"}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function Following() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const viewer = session?.user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [states, setStates] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const targetId = await getUserIdByUsername(String(username || ""));
      if (!targetId) { setPeople([]); return; }
      const rows = await listFollowing(targetId); // who TARGET follows
      setPeople(rows as Person[]);
      if (viewer) {
        const pairs = await Promise.all(rows.map(async (p: any) => [p.id, await getFollowState(p.id)] as const));
        setStates(Object.fromEntries(pairs));
      } else {
        setStates({});
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not load following.");
    } finally {
      setLoading(false);
    }
  }, [username, viewer]);

  useEffect(() => { load(); }, [load]);

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
        <ActivityIndicator /><Text style={{ color:C.sub, marginTop:8 }}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, backgroundColor:C.bg, padding:16 }}>
      <Text style={{ color: C.ink, fontSize: 18, fontWeight: "900", marginBottom: 12 }}>
        Following
      </Text>
      {people.length === 0 ? (
        <View style={{ backgroundColor:C.card, padding:16, borderRadius:12 }}>
          <Text style={{ color:C.ink, fontWeight:"700" }}>Not following anyone yet</Text>
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
              iFollow={viewer ? !!states[item.id] : null}
            />
          )}
        />
      )}
    </View>
  );
}
