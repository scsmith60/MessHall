// components/RecipeComments.tsx
// LIKE I'M 5: this is the chat under a recipe.
// WHAT CHANGED:
// - We REMOVED white Alert menus for long-press.
// - We SHOW a dark, rounded ThemedActionSheet for options.
// - We also use a sheet for "Report reason" and "Delete?" confirm.
// (Errors still use Alert for now; we can theme those later if you want.)

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { supabase } from "../lib/supabase";
import { tap } from "../lib/haptics";
import ThemedActionSheet, { SheetAction } from "./ui/ThemedActionSheet";

// One comment row (matches your view/table)
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
  isRecipeOwner = false, // 👑 if true, show Mute/Unmute
  insideScroll = true,   // 👶 if true, no FlatList (avoid nested scroll warning)
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

  // LITTLE BINS (state)
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastCreatedAt = useRef<string | null>(null);
  const pageSize = 20;

  // prevent dupes
  const idsRef = useRef<Set<string>>(new Set());
  const addIfNew = (r: Row) => {
    if (idsRef.current.has(r.id)) return false;
    idsRef.current.add(r.id);
    setRows((prev) => [r, ...prev]);
    return true;
  };

  // remember Block/Mute locally so UI flips instantly
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

  // reset on recipe change
  useEffect(() => {
    setRows([]);
    setHasMore(true);
    setSending(false);
    setBlockedIds(new Set());
    setMutedIds(new Set());
    lastCreatedAt.current = null;
    idsRef.current = new Set();
  }, [recipeId]);

  // 1) Get a page
  const fetchPage = async () => {
    if (loading || !hasMore) return;
    setLoading(true);

    let q = supabase
      .from("recipe_comments_visible_to_with_profiles")
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

  // first load
  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  // 2) Realtime
  useEffect(() => {
    const chIns = supabase
      .channel(`rc_ins_${recipeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "recipe_comments", filter: `recipe_id=eq.${recipeId}` },
        (payload) => {
          const r = payload.new as Row;
          if (idsRef.current.has(r.id)) return;
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
          setRows((prev) => prev.map((r) => (r.id === updated.id ? ({ ...r, ...updated } as Row) : r)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chIns);
      supabase.removeChannel(chUpd);
    };
  }, [recipeId]);

  // 3) Threads
  const threads = useMemo(() => {
    const byParent: Record<string, Row[]> = {};
    const tops: Row[] = [];
    for (const r of rows) {
      if (!r.parent_id) tops.push(r);
      else (byParent[r.parent_id] ??= []).push(r);
    }
    return { tops, byParent };
  }, [rows]);

  // 4) Send a comment
  const onSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
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
      if (data && (data as any).id) {
        const row = data as Row;
        if (!idsRef.current.has(row.id)) {
          idsRef.current.add(row.id);
          setRows((prev) => [row, ...prev]);
        }
      }
    } catch (e: any) {
      Alert.alert("Could not post", e?.message ?? "Unknown error");
    } finally {
      setSending(false);
    }
  };

  // 5) Helpers — Block / Unblock / Mute / Unmute / Delete / Report
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

  const doDelete = async (commentId: string) => {
    if (!myId) return Alert.alert("Sign in required");
    // quick local hide (optimistic)
    setRows((prev) => prev.map((r) => (r.id === commentId ? { ...r, is_hidden: true } : r)));
    const { error } = await supabase.from("recipe_comments").update({ is_hidden: true }).eq("id", commentId);
    if (error) {
      // flip back if server said no
      setRows((prev) => prev.map((r) => (r.id === commentId ? { ...r, is_hidden: false } : r)));
      Alert.alert("Delete failed", error.message);
    }
  };

  const doReportWithReason = async (commentId: string, reason: string) => {
    if (!myId) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("report_comment", {
      p_comment_id: commentId,
      p_reason: reason,
      p_notes: null, // keep it simple, no OS prompt = no white box
    });
    if (error) Alert.alert("Error", error.message);
    else Alert.alert("Thanks", "We’ll review this.");
  };

  // 6) SHEETS (our themed menus)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTitle, setSheetTitle] = useState("Options");
  const [sheetActions, setSheetActions] = useState<SheetAction[]>([]);

  // open the sheet helper
  const openSheet = (title: string, actions: SheetAction[]) => {
    setSheetTitle(title);
    setSheetActions(actions);
    setSheetOpen(true);
  };

  // long-press menu
  const openMenu = (r: Row, isMine: boolean) => {
    const actions: SheetAction[] = [];

    if (isMine) {
      actions.push({
        label: "DELETE",
        destructive: true,
        onPress: () =>
          openSheet("Delete comment?", [
            { label: "Delete", destructive: true, onPress: () => doDelete(r.id) },
            { label: "Cancel", onPress: () => {} },
          ]),
      });
    }

    actions.push(
      isBlocked(r.user_id)
        ? { label: "UNBLOCK USER", onPress: () => doUnblock(r.user_id) }
        : { label: "BLOCK USER", onPress: () => doBlock(r.user_id) }
    );

    actions.push({
      label: "REPORT",
      onPress: () =>
        openSheet("Report reason", [
          { label: "Spam", onPress: () => doReportWithReason(r.id, "spam") },
          { label: "Harassment", onPress: () => doReportWithReason(r.id, "harassment") },
          { label: "Hate", onPress: () => doReportWithReason(r.id, "hate") },
          { label: "Sexual content", onPress: () => doReportWithReason(r.id, "sexual_content") },
          { label: "Self-harm", onPress: () => doReportWithReason(r.id, "self_harm") },
          { label: "Violence/Threat", onPress: () => doReportWithReason(r.id, "violence_or_threat") },
          { label: "Illegal activity", onPress: () => doReportWithReason(r.id, "illegal_activity") },
          { label: "Other", onPress: () => doReportWithReason(r.id, "other") },
          { label: "Cancel", onPress: () => {} },
        ]),
    });

    if (!isMine && isRecipeOwner) {
      actions.push(
        isMuted(r.user_id)
          ? { label: "UNMUTE ON THIS RECIPE", onPress: () => doUnmute(r.user_id) }
          : { label: "MUTE ON THIS RECIPE", onPress: () => doMute(r.user_id) }
      );
    }

    openSheet("Comment options", actions);
  };

  // 7) one thread (top + replies)
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

  // 8) list modes
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

  // 9) the widget
  return (
    <View style={{ gap: 12 }}>
      {/* type box + send */}
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

      {/* list */}
      {insideScroll ? <ListWhenEmbedded /> : <ListWhenStandalone />}

      {/* our dark sheet */}
      <ThemedActionSheet
        visible={sheetOpen}
        title={sheetTitle}
        actions={sheetActions}
        onClose={() => setSheetOpen(false)}
      />
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

  if (hidden) {
    // gentle gray pillow for deleted
    return (
      <View style={{ backgroundColor: "#0f172a", borderRadius: 12, padding: 10, opacity: 0.7 }}>
        <Text style={{ color: "#94a3b8", fontStyle: "italic" }}>🗑️ Deleted by author</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity onLongPress={onMenu} delayLongPress={300} activeOpacity={0.9} style={{ backgroundColor: "#0f172a", borderRadius: 12, padding: 10 }}>
      {row.is_flagged && <Text style={{ color: "#f59e0b", marginBottom: 4 }}>Marked for review</Text>}
      <Text style={{ color: "#f1f5f9" }}>{row.body}</Text>

      {/* quick reply */}
      <View style={{ flexDirection: "row", gap: 14, marginTop: 6 }}>
        <TouchableOpacity onPress={onReply}>
          <Text style={{ color: "#38bdf8" }}>Reply</Text>
        </TouchableOpacity>
        {isMine ? <Text style={{ color: "#94a3b8" }}>(long-press for more)</Text> : null}
      </View>
    </TouchableOpacity>
  );
}
