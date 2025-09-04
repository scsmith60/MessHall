// components/RecipeComments.tsx
// LIKE I'M 5: this is our chat under a recipe.
// WHAT'S NEW:
// 1) When you tap "Report", we first ASK WHY (a little menu of reasons).
// 2) If the server says "too fast" or some other error, we show that message.
// 3) Still the same: long-press a comment for the menu (Delete / Block / Unblock / Report / Mute / Unmute),
//    no double posts, and works inside a ScrollView.
//
// SERVER EXPECTATIONS (already added on your side):
// - RPC add_comment(...) does rate limiting and safety checks.
// - RPC report_comment(p_comment_id, p_reason, p_notes)
// - RPC block_user / unblock_user
// - RPC mute_user_on_recipe / unmute_user_on_recipe
// - View recipe_comments_visible_to_with_profiles filters out blocked users.
// - RLS allows your own UPDATE to soft-delete (is_hidden=true).

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { supabase } from "../lib/supabase";
import { tap } from "../lib/haptics";

// One comment row (shape matches your view/table)
type Row = {
  id: string;
  recipe_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  is_hidden: boolean;
  is_flagged: boolean;
  flagged_reason: string | null;
  username?: string | null;
  avatar_url?: string | null;
};

export default function RecipeComments({
  recipeId,
  isRecipeOwner = false, // 👑 if true, show Mute/Unmute in the menu
  insideScroll = true,   // 👶 if true, we DON'T render a FlatList (so no nested list warning)
}: {
  recipeId: string;
  isRecipeOwner?: boolean;
  insideScroll?: boolean;
}) {
  // WHO AM I?
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  // LITTLE BINS FOR OUR TOYS (state)
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastCreatedAt = useRef<string | null>(null);
  const pageSize = 20;

  // 🧱 A WALL OF IDS so we never add the same comment twice
  const idsRef = useRef<Set<string>>(new Set());
  const addIfNew = (r: Row) => {
    if (idsRef.current.has(r.id)) return false;
    idsRef.current.add(r.id);
    setRows((prev) => [r, ...prev]);
    return true;
  };

  // 👥 local remember-sets so UI flips instantly after block/mute
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const isBlocked = (uid: string) => blockedIds.has(uid);
  const markBlocked = (uid: string, v: boolean) =>
    setBlockedIds((prev) => {
      const next = new Set(prev);
      v ? next.add(uid) : next.delete(uid);
      return next;
    });

  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const isMuted = (uid: string) => mutedIds.has(uid);
  const markMuted = (uid: string, v: boolean) =>
    setMutedIds((prev) => {
      const n = new Set(prev);
      v ? n.add(uid) : n.delete(uid);
      return n;
    });

  // 🔄 reset when the recipe changes
  useEffect(() => {
    setRows([]);
    setHasMore(true);
    setSending(false);
    setBlockedIds(new Set());
    setMutedIds(new Set());
    lastCreatedAt.current = null;
    idsRef.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  // 1) GET A PAGE OF COMMENTS (from the filtered view)
  const fetchPage = async () => {
    if (loading || !hasMore) return;
    setLoading(true);

    let q = supabase
      .from("recipe_comments_visible_to_with_profiles") // 🌈 server hides blocked users both ways
      .select("*")
      .eq("recipe_id", recipeId)
      .order("created_at", { ascending: false })
      .limit(pageSize);

    if (lastCreatedAt.current) q = q.lt("created_at", lastCreatedAt.current);

    const { data, error } = await q;
    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    const list = (data ?? []) as Row[];
    if (list.length) {
      const next = [...rows];
      for (const r of list) {
        if (!idsRef.current.has(r.id)) {
          idsRef.current.add(r.id);
          next.push(r);
        }
      }
      setRows(next);
      lastCreatedAt.current = list[list.length - 1].created_at;
      if (list.length < pageSize) setHasMore(false);
    } else {
      setHasMore(false);
    }
  };

  // 👉 load the first page
  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  // 2) REALTIME: see new or changed comments without reloading
  useEffect(() => {
    const chIns = supabase
      .channel(`rc_ins_${recipeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "recipe_comments", filter: `recipe_id=eq.${recipeId}` },
        (payload) => {
          const r = payload.new as Row;
          if (idsRef.current.has(r.id)) return; // we already added it
          addIfNew({ ...r, username: undefined, avatar_url: undefined });
        }
      )
      .subscribe();

    const chUpd = supabase
      .channel(`rc_upd_${recipeId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "recipe_comments", filter: `recipe_id=eq.${recipeId}` },
        (payload) => {
          const updated = payload.new as Partial<Row> & { id: string };
          setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } as Row : r)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chIns);
      supabase.removeChannel(chUpd);
    };
  }, [recipeId]);

  // 3) MAKE THREADS (group replies under parents)
  const threads = useMemo(() => {
    const byParent: Record<string, Row[]> = {};
    const tops: Row[] = [];
    for (const r of rows) {
      if (!r.parent_id) tops.push(r);
      else (byParent[r.parent_id] ??= []).push(r);
    }
    return { tops, byParent };
  }, [rows]);

  // 4) SEND A COMMENT (RPC handles user_id + rate-limit)
  const onSend = async () => {
    const body = text.trim();
    if (!body || sending) return; // no empty / no double
    setSending(true);
    await tap();
    try {
      setText("");
      const { data, error } = await supabase.rpc("add_comment", {
        p_recipe_id: recipeId,
        p_parent_id: replyTo,
        p_body: body,
      });
      if (error) throw error;

      setReplyTo(null);

      // optimistic add (realtime will skip because id is now known)
      if (data && (data as any).id) {
        const row = data as Row;
        if (!idsRef.current.has(row.id)) {
          idsRef.current.add(row.id);
          setRows((prev) => [row, ...prev]);
        }
      }
    } catch (e: any) {
      // show the exact server message (like "Slow down a little …")
      Alert.alert("Could not post", e?.message ?? "Unknown error");
    } finally {
      setSending(false);
    }
  };

  // 5) LITTLE HELPERS — Block / Unblock / Mute / Unmute / Delete / Report(with reason)
  const doBlock = async (uid: string) => {
    if (!myId) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("block_user", { p_blocked_id: uid });
    if (error) Alert.alert("Error", error.message);
    else {
      markBlocked(uid, true);
      Alert.alert("Done", "User blocked.");
    }
  };
  const doUnblock = async (uid: string) => {
    if (!myId) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("unblock_user", { p_blocked_id: uid });
    if (error) Alert.alert("Error", error.message);
    else {
      markBlocked(uid, false);
      Alert.alert("Done", "User unblocked.");
    }
  };
  const doMute = async (uid: string) => {
    if (!myId) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("mute_user_on_recipe", {
      p_recipe_id: recipeId,
      p_muted_id: uid,
    });
    if (error) Alert.alert("Error", error.message);
    else {
      markMuted(uid, true);
      Alert.alert("Muted", "They can’t comment on this recipe.");
    }
  };
  const doUnmute = async (uid: string) => {
    if (!myId) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("unmute_user_on_recipe", {
      p_recipe_id: recipeId,
      p_muted_id: uid,
    });
    if (error) Alert.alert("Error", error.message);
    else {
      markMuted(uid, false);
      Alert.alert("Unmuted", "They can comment here again.");
    }
  };

  // 🧹 soft delete = set is_hidden = true on your own comment
  const doDelete = async (commentId: string) => {
    if (!myId) return Alert.alert("Sign in required");
    Alert.alert("Delete comment?", "This hides your comment for everyone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          // quick local hide (optimistic)
          setRows((prev) => prev.map((r) => (r.id === commentId ? { ...r, is_hidden: true } : r)));
          const { error } = await supabase
            .from("recipe_comments")
            .update({ is_hidden: true })
            .eq("id", commentId);
          if (error) {
            // flip back on error
            setRows((prev) => prev.map((r) => (r.id === commentId ? { ...r, is_hidden: false } : r)));
            Alert.alert("Delete failed", error.message);
          }
        },
      },
    ]);
  };

  // 🎫 Pick a report reason first, then call the RPC
  const chooseReason = (): Promise<string | null> =>
    new Promise((resolve) => {
      // simple cross-platform picker using Alert buttons
      Alert.alert(
        "Report reason",
        "Pick one:",
        [
          { text: "Spam", onPress: () => resolve("spam") },
          { text: "Harassment", onPress: () => resolve("harassment") },
          { text: "Hate", onPress: () => resolve("hate") },
          { text: "Sexual content", onPress: () => resolve("sexual_content") },
          { text: "Self-harm", onPress: () => resolve("self_harm") },
          { text: "Violence/Threat", onPress: () => resolve("violence_or_threat") },
          { text: "Illegal activity", onPress: () => resolve("illegal_activity") },
          { text: "Other", onPress: () => resolve("other") },
          { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        ],
        { cancelable: true }
      );
    });

  const doReport = async (commentId: string) => {
    if (!myId) return Alert.alert("Sign in required");
    const reason = await chooseReason();
    if (!reason) return; // user cancelled

    // (Optional) Notes: Alert.prompt is iOS only; skip on Android for now.
    let notes: string | null = null;
    if (Platform.OS === "ios") {
      await new Promise<void>((resolve) => {
        Alert.prompt(
          "Add details (optional)",
          "Tell us anything helpful for the moderator.",
          [
            { text: "Skip", style: "cancel", onPress: () => { notes = null; resolve(); } },
            { text: "Send", onPress: (txt) => { notes = (txt ?? "").trim() || null; resolve(); } },
          ],
          "plain-text"
        );
      });
    }

    const { error } = await supabase.rpc("report_comment", {
      p_comment_id: commentId,
      p_reason: reason,
      p_notes: notes,
    });
    if (error) Alert.alert("Error", error.message);
    else Alert.alert("Thanks", "We’ll review this.");
  };

  // 6) LONG-PRESS MENU (replace tiny inline buttons)
  const openMenu = (r: Row, isMine: boolean) => {
    const items: { text: string; onPress: () => void; style?: "cancel" | "destructive" | "default" }[] = [];

    if (isMine) items.push({ text: "Delete", onPress: () => doDelete(r.id), style: "destructive" });

    items.push(
      isBlocked(r.user_id)
        ? { text: "Unblock user", onPress: () => doUnblock(r.user_id) }
        : { text: "Block user", onPress: () => doBlock(r.user_id) }
    );

    items.push({ text: "Report", onPress: () => doReport(r.id) });

    if (!isMine && isRecipeOwner) {
      items.push(
        isMuted(r.user_id)
          ? { text: "Unmute on this recipe", onPress: () => doUnmute(r.user_id) }
          : { text: "Mute on this recipe", onPress: () => doMute(r.user_id) }
      );
    }

    items.push({ text: "Cancel", onPress: () => {}, style: "cancel" });

    Alert.alert("Comment options", undefined, items.map((i) => ({ text: i.text, onPress: i.onPress, style: i.style })));
  };

  // 7) ONE THREAD (top comment + its replies)
  const renderThreadView = (item: Row) => {
    const children = threads.byParent[item.id] ?? [];
    return (
      <View key={item.id} style={{ paddingVertical: 8 }}>
        <Bubble
          row={item}
          myId={myId}
          onReply={() => setReplyTo(item.id)}
          onMenu={() => openMenu(item, !!myId && item.user_id === myId)}
        />
        {children.map((c) => (
          <View key={c.id} style={{ marginLeft: 16, marginTop: 6 }}>
            <Bubble
              row={c}
              myId={myId}
              onReply={() => setReplyTo(c.id)}
              onMenu={() => openMenu(c, !!myId && c.user_id === myId)}
            />
          </View>
        ))}
      </View>
    );
  };

  // 8) TWO LIST MODES (embedded vs full)
  const ListWhenEmbedded = () => (
    <View>
      {threads.tops.map(renderThreadView)}
      {loading ? (
        <ActivityIndicator />
      ) : hasMore ? (
        <TouchableOpacity onPress={fetchPage} style={{ alignSelf: "center", padding: 10 }}>
          <Text style={{ color: "#94a3b8" }}>Load more</Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ color: "#94a3b8", textAlign: "center", padding: 6 }}>No more comments</Text>
      )}
    </View>
  );

  const ListWhenStandalone = () => (
    <FlatList
      data={threads.tops}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => renderThreadView(item)}
      ListFooterComponent={
        loading ? (
          <ActivityIndicator />
        ) : hasMore ? (
          <TouchableOpacity onPress={fetchPage} style={{ alignSelf: "center", padding: 10 }}>
            <Text style={{ color: "#94a3b8" }}>Load more</Text>
          </TouchableOpacity>
        ) : (
          <Text style={{ color: "#94a3b8", textAlign: "center", padding: 6 }}>No more comments</Text>
        )
      }
      onEndReachedThreshold={0.2}
      onEndReached={() => {
        if (!loading) fetchPage();
      }}
    />
  );

  // 9) THE WHOLE WIDGET
  return (
    <View style={{ gap: 12 }}>
      {/* type box + send button */}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput
          placeholder={replyTo ? "Reply…" : "Write a comment…"}
          placeholderTextColor="#94a3b8"
          value={text}
          onChangeText={setText}
          style={{
            flex: 1,
            backgroundColor: "#1e293b",
            color: "#f1f5f9",
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
          multiline
        />
        <TouchableOpacity
          onPress={onSend}
          disabled={sending || text.trim().length === 0}
          style={{
            backgroundColor: sending ? "#94a3b8" : "#38bdf8",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            opacity: sending ? 0.7 : 1,
          }}
        >
          <Text style={{ color: "#031724", fontWeight: "700" }}>
            {sending ? "Sending…" : "Send"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* list mode */}
      {insideScroll ? <ListWhenEmbedded /> : <ListWhenStandalone />}
    </View>
  );
}

function Bubble({
  row,
  myId,
  onReply,
  onMenu,
}: {
  row: Row;
  myId: string | null;
  onReply: () => void;
  onMenu: () => void;
}) {
  const isMine = !!myId && row.user_id === myId;
  const hidden = !!row.is_hidden;

  // if deleted, show a little gray pillow
  if (hidden) {
    return (
      <View style={{ backgroundColor: "#0f172a", borderRadius: 12, padding: 10, opacity: 0.7 }}>
        <Text style={{ color: "#94a3b8", fontStyle: "italic" }}>🗑️ Deleted by author</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onLongPress={onMenu}     // 👉 hold for the menu
      delayLongPress={300}
      activeOpacity={0.9}
      style={{ backgroundColor: "#0f172a", borderRadius: 12, padding: 10 }}
    >
      {row.is_flagged && <Text style={{ color: "#f59e0b", marginBottom: 4 }}>Marked for review</Text>}
      <Text style={{ color: "#f1f5f9" }}>{row.body}</Text>

      {/* keep one quick "Reply" button visible */}
      <View style={{ flexDirection: "row", gap: 14, marginTop: 6 }}>
        <TouchableOpacity onPress={onReply}>
          <Text style={{ color: "#38bdf8" }}>Reply</Text>
        </TouchableOpacity>
        {isMine ? <Text style={{ color: "#94a3b8" }}>(long-press for more)</Text> : null}
      </View>
    </TouchableOpacity>
  );
}
