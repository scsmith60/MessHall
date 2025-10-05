// components/RecipeComments.tsx
// LIKE I'M 5 🧸
//
// WHAT THIS DOES (clean + no debug):
// - Shows comments under a recipe, with parent → reply threads
// - Tries the *RLS-safe* view first; if that view exists but returns 0,
//   we DO NOT fall back (so blocked users stay invisible).
//   We only fall back if a view is MISSING (SQL error).
// - If we ever fall back to the raw table, we do a quick profiles lookup so
//   replies still show the person's avatar + callsign (username)
// - Lets you write comments and replies
// - Long-press any comment for moderation: Delete (yours), Block/Unblock,
//   Report, and (if you're the recipe owner) Mute/Unmute on this recipe
// - Realtime inserts/updates so new comments pop in
// - Uses a FlatList so the comments are scrollable inside the modal
//
// IMPORTANT BLOCKING FIXES:
// - Preload my blocked user IDs so the long-press menu shows "UNBLOCK USER"
//   when I already blocked them.
// - Extra local filter hides any incoming rows authored by blocked users
//   (belt + suspenders; server RLS should already hide).
//
// Neutral text: when content isn't available, elsewhere we use
// "M.I.A (missing in action)" to avoid leaking block info.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { supabase } from "@/lib/supabase";
import ThemedActionSheet, { SheetAction } from "./ui/ThemedActionSheet";
import { tap } from "@/lib/haptics";
import { COLORS } from "@/lib/theme";

/* -----------------------------
   "5m ago" helper (tiny clock)
----------------------------- */
function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d2 = Math.floor(h / 24);
  return `${d2}d`;
}

/* -----------------------------
   Little avatar with letter fallback
----------------------------- */
function Avatar({ uri, fallback }: { uri?: string | null; fallback: string }) {
  const letter = (fallback || "U").slice(0, 1).toUpperCase();
  if (uri && uri.trim().length > 0) {
    return <Image source={{ uri }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.06)" }} />;
  }
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: "rgba(255,255,255,0.06)",
        borderWidth: 1,
        borderColor: COLORS.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#e5e7eb", fontWeight: "800" }}>{letter}</Text>
    </View>
  );
}

/* -----------------------------
   Row shape we render
----------------------------- */
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
  // profile fields (may come from views OR from our enrichment step)
  username?: string | null;
  avatar_url?: string | null;
};

export default function RecipeComments({
  recipeId,
  isRecipeOwner = false,
  insideScroll = true, // we leave this prop in case other screens use it
}: {
  recipeId: string;
  isRecipeOwner?: boolean;
  insideScroll?: boolean;
}) {
  /* -----------------------------
     who am i?
  ----------------------------- */
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyId(data.user?.id ?? null));
  }, []);

  /* -----------------------------
     ui buckets
  ----------------------------- */
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const lastCreatedAt = useRef<string | null>(null);
  const pageSize = 20;

  // prevent duplicates (optimistic + realtime)
  const idsRef = useRef<Set<string>>(new Set());
  const addIfNew = (r: Row) => {
    if (idsRef.current.has(r.id)) return false;
    idsRef.current.add(r.id);
    setRows((prev) => [r, ...prev]);
    return true;
  };

  // local block/mute flags for instant UI
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const isBlockedLocal = (uid: string) => blockedIds.has(uid);
  const markBlocked = (uid: string, v: boolean) =>
    setBlockedIds((prev) => {
      const n = new Set(prev);
      v ? n.add(uid) : n.delete(uid);
      return n;
    });

  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const isMuted = (uid: string) => mutedIds.has(uid);
  const markMuted = (uid: string, v: boolean) =>
    setMutedIds((prev) => {
      const n = new Set(prev);
      v ? n.add(uid) : n.delete(uid);
      return n;
    });

  // reset when recipe changes
  useEffect(() => {
    setRows([]);
    setHasMore(true);
    setSending(false);
    setBlockedIds(new Set());
    setMutedIds(new Set());
    lastCreatedAt.current = null;
    idsRef.current = new Set();
  }, [recipeId]);

  /* -----------------------------
     PRELOAD my blocked ids (so menus say UNBLOCK when appropriate)
  ----------------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: list, error } = await supabase
        .from("user_blocks")
        .select("blocked_id");
      if (!alive || error || !list) return;
      setBlockedIds(new Set(list.map((r: any) => String(r.blocked_id))));
    })();
    return () => { alive = false; };
  }, [recipeId]);

  /* -----------------------------
     PROFILES ENRICHMENT (important fix)
     - If we fetch from the raw base table (C), there is no username/avatar.
     - So we collect missing user_ids and ask profiles for username+avatar,
       then merge those into our rows so replies look correct.
  ----------------------------- */
  const enrichMissingProfiles = useCallback(async (list: Row[]) => {
    const need = Array.from(
      new Set(
        list
          .filter((r) => !r.username || typeof r.avatar_url === "undefined")
          .map((r) => r.user_id)
      )
    );
    if (!need.length) return list;

    const { data: profs } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", need);

    const map = new Map<string, { username?: string | null; avatar_url?: string | null }>();
    for (const p of profs || []) {
      map.set(String(p.id), { username: p.username ?? null, avatar_url: p.avatar_url ?? null });
    }

    return list.map((r) =>
      map.has(r.user_id)
        ? { ...r, username: map.get(r.user_id)!.username ?? r.username, avatar_url: map.get(r.user_id)!.avatar_url ?? r.avatar_url }
        : r
    );
  }, []);

  /* -----------------------------
     Fetch page with SAFE fallback behavior
     A = visible_to_with_profiles  (preferred; DO NOT FALL BACK if returns 0)
     B = with_profiles             (fallback ONLY if A errors/missing)
     C = base table                (last resort ONLY if B errors/missing)
  ----------------------------- */
  const fetchPage = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);

    // helper to run a source and return tri-state: { ok, rows }
    const run = async (from: "A" | "B" | "C") => {
      try {
        let q;
        if (from === "A") q = supabase.from("recipe_comments_visible_to_with_profiles").select("*").eq("recipe_id", recipeId);
        else if (from === "B") q = supabase.from("recipe_comments_with_profiles").select("*").eq("recipe_id", recipeId);
        else q = supabase.from("recipe_comments").select("*").eq("recipe_id", recipeId);

        q = q.order("created_at", { ascending: false }).limit(pageSize);
        if (lastCreatedAt.current) q = q.lt("created_at", lastCreatedAt.current);

        const { data } = await q;
        return { ok: true as const, rows: (data ?? []) as Row[] };
      } catch {
        // most likely the view doesn't exist → allow fallback
        return { ok: false as const, rows: [] as Row[] };
      }
    };

    // Try A (preferred). If it succeeds (even with 0 rows), we STOP.
    const A = await run("A");
    if (A.ok) {
      await commitRows(A.rows, "A");
      return;
    }

    // Try B (only because A errored/missing)
    const B = await run("B");
    if (B.ok) {
      await commitRows(B.rows, "B");
      return;
    }

    // Try C (only because A & B errored/missing)
    const C = await run("C");
    if (C.ok) {
      const enriched = await enrichMissingProfiles(C.rows);
      await commitRows(enriched, "C");
      return;
    }

    // if everything failed
    setHasMore(false);
    setLoading(false);
  }, [loading, hasMore, recipeId, enrichMissingProfiles]);

  const commitRows = async (list: Row[], _source: "A" | "B" | "C") => {
    // extra local filter: hide comments authored by someone I blocked
    const visibleList = list.filter((r) => !isBlockedLocal(r.user_id));

    const next = [...rows];
    for (const r of visibleList) {
      if (!idsRef.current.has(r.id)) {
        idsRef.current.add(r.id);
        next.push(r);
      }
    }
    if (visibleList.length > 0) {
      lastCreatedAt.current = visibleList[visibleList.length - 1].created_at;
    }
    if (list.length < pageSize) setHasMore(false);
    setRows(next);
    setLoading(false);
  };

  // first load
  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  /* -----------------------------
     Realtime (INSERT/UPDATE)
     - On INSERT we try to enrich with profiles
  ----------------------------- */
  useEffect(() => {
    const chIns = supabase
      .channel(`rc_ins_${recipeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "recipe_comments", filter: `recipe_id=eq.${recipeId}` },
        async (payload) => {
          const fresh = payload.new as Row;
          if (!fresh?.id || idsRef.current.has(fresh.id)) return;

          // If author is blocked, skip immediately (extra guard)
          if (isBlockedLocal(fresh.user_id)) return;

          const viaView = await supabase
            .from("recipe_comments_with_profiles")
            .select("*")
            .eq("id", fresh.id)
            .maybeSingle();

          const merged: Row =
            (viaView.data as any) ||
            (await enrichMissingProfiles([fresh]).then((arr) => arr[0]));

          addIfNew(merged);
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
  }, [recipeId, enrichMissingProfiles]);

  /* -----------------------------
     Build threads (parents + replies)
     NOTE: We define this ONCE. (Fix: no duplicate declarations.)
  ----------------------------- */
  const threads = useMemo(() => {
    const byParent: Record<string, Row[]> = {};
    const tops: Row[] = [];
    for (const r of rows) {
      if (!r.parent_id) tops.push(r);
      else (byParent[r.parent_id] ??= []).push(r);
    }
    return { tops, byParent };
  }, [rows]);

  /* -----------------------------
     Send a comment (reads/writes "body")
  ----------------------------- */
  const onSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    await tap();
    try {
      setText("");
      const { error } = await supabase.rpc("add_comment", {
        p_recipe_id: recipeId,
        p_parent_id: replyTo,
        p_body: body,
      });
      if (error) throw error;
      setReplyTo(null);
      // optimistic add is not needed; realtime will insert it quickly
    } catch (e: any) {
      // Neutral, no hints about blocking state
      Alert.alert("M.I.A (missing in action)");
    } finally {
      setSending(false);
    }
  };

  /* -----------------------------
     Moderation actions
  ----------------------------- */
  const doBlock = async (uid: string) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("block_user", { p_blocked_id: uid });
    if (error) Alert.alert("Error", error.message);
    else {
      markBlocked(uid, true);
      // instantly hide their comments from the current list
      setRows((prev) => prev.filter((r) => r.user_id !== uid));
      Alert.alert("Done", "User blocked.");
    }
  };
  const doUnblock = async (uid: string) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("unblock_user", { p_blocked_id: uid });
    if (error) Alert.alert("Error", error.message);
    else {
      markBlocked(uid, false);
      Alert.alert("Done", "User unblocked.");
    }
  };
  const doMute = async (uid: string) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("mute_user_on_recipe", { p_recipe_id: recipeId, p_muted_id: uid });
    if (error) Alert.alert("Error", error.message);
    else {
      markMuted(uid, true);
      Alert.alert("Muted", "They can’t comment on this recipe.");
    }
  };
  const doUnmute = async (uid: string) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("unmute_user_on_recipe", { p_recipe_id: recipeId, p_muted_id: uid });
    if (error) Alert.alert("Error", error.message);
    else {
      markMuted(uid, false);
      Alert.alert("Unmuted", "They can comment here again.");
    }
  };
  const doDelete = async (commentId: string) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return Alert.alert("Sign in required");
    // quick optimistic hide
    setRows((prev) => prev.map((r) => (r.id === commentId ? { ...r, is_hidden: true } : r)));
    const { error } = await supabase.from("recipe_comments").update({ is_hidden: true }).eq("id", commentId);
    if (error) {
      setRows((prev) => prev.map((r) => (r.id === commentId ? { ...r, is_hidden: false } : r)));
      Alert.alert("Delete failed", error.message);
    }
  };
  const doReportWithReason = async (commentId: string, reason: string) => {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) return Alert.alert("Sign in required");
    const { error } = await supabase.rpc("report_comment", {
      p_comment_id: commentId,
      p_reason: reason,
      p_notes: null,
    });
    if (error) Alert.alert("Error", error.message);
    else Alert.alert("Thanks", "We’ll review this.");
  };

  /* -----------------------------
     Action sheet (fancy menu on long-press)
  ----------------------------- */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTitle, setSheetTitle] = useState("Options");
  const [sheetActions, setSheetActions] = useState<SheetAction[]>([]);
  const openSheet = (title: string, actions: SheetAction[]) => {
    setSheetTitle(title);
    setSheetActions(actions);
    setSheetOpen(true);
  };
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
      isBlockedLocal(r.user_id)
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

  /* -----------------------------
     One comment bubble (shows body, avatar, callsign)
  ----------------------------- */
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
      return (
        <View style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 10, opacity: 0.7 }}>
          <Text style={{ color: "#94a3b8", fontStyle: "italic" }}>🗑️ Deleted by author</Text>
        </View>
      );
    }

    const name = row.username || (row.user_id ? row.user_id.slice(0, 6) : "user");

    return (
      <TouchableOpacity onLongPress={onMenu} delayLongPress={300} activeOpacity={0.9} style={{ backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 12, padding: 10 }}>
        {/* header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <Avatar uri={row.avatar_url} fallback={name} />
          <Text style={{ color: "#93c5fd", fontWeight: "800" }}>{name}</Text>
          <Text style={{ color: "#94a3b8" }}>• {timeAgo(row.created_at)}</Text>
        </View>

        {/* body */}
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

  /* -----------------------------
     Thread renderer (parent + its replies)
  ----------------------------- */
  const renderThreadView = ({ item }: { item: Row }) => {
    const children = (threads.byParent[item.id] ?? []).filter((c) => !isBlockedLocal(c.user_id));
    return (
      <View key={item.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
        <Bubble row={item} myId={myId} onReply={() => setReplyTo(item.id)} onMenu={() => openMenu(item, !!myId && item.user_id === myId)} />
        {children.map((c) => (
          <View key={c.id} style={{ marginLeft: 16, marginTop: 6 }}>
            <Bubble row={c} myId={myId} onReply={() => setReplyTo(c.id)} onMenu={() => openMenu(c, !!myId && c.user_id === myId)} />
          </View>
        ))}
      </View>
    );
  };

  /* -----------------------------
     List (always FlatList → scrollable inside modal)
  ----------------------------- */
  const listData = useMemo(
    () => threads.tops.filter((t) => !isBlockedLocal(t.user_id)),
    [threads, blockedIds]
  );
  const keyExtractor = (i: Row) => i.id;
  const onEndReached = () => {
    if (!loading) fetchPage();
  };

  /* -----------------------------
     UI
  ----------------------------- */
  return (
    <View style={{ gap: 12 }}>
      {/* ✍️ composer */}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput
          placeholder={replyTo ? "Reply…" : "Write a comment…"}
          placeholderTextColor="#94a3b8"
          value={text}
          onChangeText={setText}
          style={{ flex: 1, backgroundColor: "#1e293b", color: "#f1f5f9", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
          multiline
        />
        <TouchableOpacity onPress={onSend} disabled={sending || text.trim().length === 0} style={{ backgroundColor: sending ? "#94a3b8" : "#38bdf8", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, opacity: sending ? 0.7 : 1 }}>
          <Text style={{ color: "#031724", fontWeight: "700" }}>{sending ? "Sending…" : "Send"}</Text>
        </TouchableOpacity>
      </View>

      {/* 📜 scrollable list */}
      {loading && listData.length === 0 ? (
        <ActivityIndicator />
      ) : listData.length === 0 ? (
        <Text style={{ color: "#94a3b8", textAlign: "center", padding: 6 }}>No comments yet — be the first!</Text>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={keyExtractor}
          renderItem={renderThreadView}
          onEndReachedThreshold={0.2}
          onEndReached={onEndReached}
          ListFooterComponent={
            loading ? (
              <ActivityIndicator style={{ marginVertical: 10 }} />
            ) : hasMore ? (
              <TouchableOpacity onPress={fetchPage} style={{ alignSelf: "center", padding: 10 }}>
                <Text style={{ color: "#94a3b8" }}>Load more</Text>
              </TouchableOpacity>
            ) : (
              <Text style={{ color: "#94a3b8", textAlign: "center", padding: 6 }}>No more comments</Text>
            )
          }
          // Make sure it plays nice inside a modal/sheet
          style={{ maxHeight: 360 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          showsVerticalScrollIndicator
        />
      )}

      {/* ⚙️ action sheet */}
      <ThemedActionSheet visible={sheetOpen} title={sheetTitle} actions={sheetActions} onClose={() => setSheetOpen(false)} />
    </View>
  );
}
