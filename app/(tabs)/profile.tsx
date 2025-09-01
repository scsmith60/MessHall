// app/(tabs)/profile.tsx
// 👶 kid version:
// - shows your Email + Username
// - lets you EDIT your Username safely
// - checks if the Username is FREE (green) or TAKEN (red) while you type
// - saves to: public.profiles.username  AND auth.user_metadata.display_name
// - you can Sign Out
//
// NOTE: We assume SQL added a UNIQUE INDEX on lower(username) in public.profiles.
// NOTE: We also assume RLS lets users update their own profile row.

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

const COLORS = {
  bg: "#0f172a",      // dark background
  card: "#1f2937",    // panels
  text: "#e5e7eb",    // main text
  sub: "#9ca3af",     // helper text
  green: "#22c55e",   // success
  red: "#ef4444",     // error
  button: "#6EE7B7",  // primary
  disabled: "#334155" // disabled button
};

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
};

// 🧼 simple normalizer: trim + swap spaces to underscores
function normalizeUsername(s: string) {
  return s.trim().replace(/\s+/g, "_");
}

export default function Profile() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  // 🔢 form state
  const [email, setEmail] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [originalUsername, setOriginalUsername] = useState<string>("");

  // 🔍 loading and saving flags
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // 1) Load current profile (email + username)
  useEffect(() => {
    let alive = true;

    async function load() {
      if (!userId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, username")
        .eq("id", userId)
        .single();

      if (!alive) return;

      if (error) {
        Alert.alert("Error", error.message);
      } else {
        const row = data as ProfileRow;
        setEmail(row.email ?? "");
        const u = row.username ?? "";
        setUsername(u);
        setOriginalUsername(u);
      }
      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, [userId]);

  // 2) Live username availability check (case-insensitive exact)
  useEffect(() => {
    let alive = true;

    const value = normalizeUsername(username);
    // if too short or unchanged → no need to check
    if (value.length < 3 || value.toLowerCase() === (originalUsername || "").toLowerCase()) {
      setAvailable(null);
      return;
    }

    (async () => {
      setChecking(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .ilike("username", value) // ILIKE = case-insensitive exact
        .limit(1);

      if (!alive) return;
      setChecking(false);

      // available if no other row has this username (or it’s our own row)
      if (error) {
        setAvailable(null);
      } else if (!data || data.length === 0) {
        setAvailable(true);
      } else {
        // if the match is our own row (editing but didn’t actually change), allow it
        const matchIsSelf = data[0].id === userId;
        setAvailable(matchIsSelf ? null : false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [username, originalUsername, userId]);

  // 3) Can the Save button be pressed?
  const canSave = useMemo(() => {
    const u = normalizeUsername(username);
    const changed = u.toLowerCase() !== (originalUsername || "").toLowerCase();
    const goodLength = u.length >= 3;
    const noSpaces = !/\s/.test(u);
    const ok = changed && goodLength && noSpaces && (available === true || available === null);
    return ok && !saving && !!userId;
  }, [username, originalUsername, available, saving, userId]);

  // 4) Save handler: update profiles.username + auth.user_metadata.display_name
  async function handleSave() {
    try {
      if (!userId) return;
      const u = normalizeUsername(username);
      if (u.length < 3) throw new Error("Username must be at least 3 characters.");

      setSaving(true);

      // A) update the profiles row (unique index on lower(username) protects us)
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ username: u }) // we keep email as-is here
        .eq("id", userId);

      if (updErr) {
        // 23505 == unique violation if a race happened
        if ((updErr as any).code === "23505") {
          throw new Error("That username was just taken. Please try a different one.");
        }
        throw updErr;
      }

      // B) update auth metadata so “display_name” matches
      const { error: metaErr } = await supabase.auth.updateUser({
        data: { display_name: u },
      });
      if (metaErr) throw metaErr;

      setOriginalUsername(u);
      setAvailable(null);
      Alert.alert("Saved", "Your username has been updated.");
    } catch (e: any) {
      Alert.alert("Could not save", e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  // 5) Sign out
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Error", error.message);
  }

  // 🧁 UI
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: COLORS.sub, marginTop: 8 }}>Loading profile…</Text>
      </View>
    );
    }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: 24, gap: 16 }}>
      {/* Title */}
      <Text style={{ color: COLORS.text, fontSize: 24, fontWeight: "800" }}>Profile</Text>

      {/* Email (read-only) */}
      <View style={{ backgroundColor: COLORS.card, padding: 16, borderRadius: 12 }}>
        <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Email</Text>
        <TextInput
          value={email}
          editable={false}
          style={{ color: COLORS.text, paddingVertical: 6 }}
        />
        <Text style={{ color: COLORS.sub, marginTop: 6 }}>
          Email can be used to sign in. You can also sign in using your username.
        </Text>
      </View>

      {/* Username (editable) */}
      <View style={{ backgroundColor: COLORS.card, padding: 16, borderRadius: 12 }}>
        <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Username (public @name)</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          placeholder="your_name"
          placeholderTextColor={COLORS.sub}
          style={{
            backgroundColor: "#111827",
            color: COLORS.text,
            padding: 12,
            borderRadius: 10,
          }}
        />

        {/* Availability status */}
        <View style={{ minHeight: 24, justifyContent: "center", marginTop: 8 }}>
          {checking ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator />
              <Text style={{ color: COLORS.sub }}>Checking username…</Text>
            </View>
          ) : available === true ? (
            <Text style={{ color: COLORS.green, fontWeight: "700" }}>✓ Username is available</Text>
          ) : available === false ? (
            <Text style={{ color: COLORS.red, fontWeight: "700" }}>✗ Username is taken</Text>
          ) : (
            <Text style={{ color: COLORS.sub }}>
              Tip: 3+ characters. We turn spaces into underscores.
            </Text>
          )}
        </View>

        {/* Save button */}
        <TouchableOpacity
          onPress={handleSave}
          disabled={!canSave}
          style={{
            backgroundColor: canSave ? COLORS.button : COLORS.disabled,
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
            marginTop: 10,
          }}
        >
          <Text style={{ color: "#0b0f19", fontWeight: "800" }}>
            {saving ? "Saving…" : "Save Username"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sign out button */}
      <TouchableOpacity
        onPress={signOut}
        style={{ backgroundColor: "#ef4444", padding: 14, borderRadius: 12, alignItems: "center", marginTop: 8 }}
      >
        <Text style={{ color: "white", fontWeight: "800" }}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
