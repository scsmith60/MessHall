// app/search/index.tsx
// LIKE I'M 5 🧸
// This screen lets you search recipes. We kept your search logic the same.
// CHANGE: Comments modal now uses the same <Comments /> UI and the "X" close button
// is big and in a header row (no absolute), so it never covers the Send button.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  TextInput,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Modal,
  Animated,
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "../../lib/supabase";
import RecipeCard from "../../components/RecipeCard";
import { COLORS, SPACING } from "../../lib/theme";
import { useUserId } from "../../lib/auth";
import { success, tap, warn } from "../../lib/haptics";
import Comments from "../../components/Comments"; // 👈 unified comments (threads + avatars + moderation)

/* ───────────────── chips/filter helpers ───────────────── */

type Chip =
  | "30 Min"
  | "Vegan"
  | "Gluten-Free"
  | "Dairy-Free"
  | "Chicken"
  | "Beef"
  | "Pork"
  | "Seafood"
  | "Pasta";

const ALL_CHIPS: Chip[] = [
  "30 Min",
  "Vegan",
  "Gluten-Free",
  "Dairy-Free",
  "Chicken",
  "Beef",
  "Pork",
  "Seafood",
  "Pasta",
];

const CONFLICTS: Record<Chip, Chip[]> = {
  Vegan: ["Chicken", "Beef", "Pork", "Seafood"],
  Chicken: ["Vegan"],
  Beef: ["Vegan"],
  Pork: ["Vegan"],
  Seafood: ["Vegan"],
  "30 Min": [],
  "Gluten-Free": [],
  "Dairy-Free": [],
  Pasta: [],
};

function filtersFromState(q: string, sel: Record<string, boolean>) {
  const diet: Array<"vegan" | "gluten_free" | "dairy_free"> = [];
  if (sel["Vegan"]) diet.push("vegan");
  if (sel["Gluten-Free"]) diet.push("gluten_free");
  if (sel["Dairy-Free"]) diet.push("dairy_free");

  const includeIngredients: string[] = [];
  if (sel["Chicken"]) includeIngredients.push("chicken");
  if (sel["Beef"]) includeIngredients.push("beef");
  if (sel["Pork"]) includeIngredients.push("pork");
  if (sel["Seafood"]) includeIngredients.push("seafood");
  if (sel["Pasta"]) includeIngredients.push("pasta");

  const maxMinutes = sel["30 Min"] ? 30 : undefined;

  return { text: q.trim(), maxMinutes, diet, includeIngredients };
}

/* ───────────────── row + counts helpers ───────────────── */

type SearchRow = {
  id: string;
  title: string;
  image: string | null;
  creator: string;
  creatorAvatar: string | null;
  ownerId: string;
  knives: number;
  cooks: number;
  likes: number;
  commentCount: number;
  createdAtMs: number;
};

// Count helper: tries fast views first, then falls back
async function fetchLiveCounts(recipeIds: string[]) {
  type C = { knives: number; cooks: number; likes: number; comments: number };
  const zero: C = { knives: 0, cooks: 0, likes: 0, comments: 0 };
  const out = new Map<string, C>();
  const put = (id: string, patch: Partial<C>) => {
    const prev = out.get(id) ?? zero;
    out.set(
      id,
      {
        ...prev,
        ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, Number(v ?? 0)])),
      } as C
    );
  };
  if (!recipeIds.length) return out;

  // 1) recipe_stats view
  try {
    const { data, error } = await supabase
      .from("recipe_stats")
      .select("recipe_id, knives, cooks, likes, comments")
      .in("recipe_id", recipeIds);
    if (!error && data) {
      for (const r of data as any[]) {
        put(String(r.recipe_id), {
          knives: r.knives,
          cooks: r.cooks,
          likes: r.likes,
          comments: r.comments,
        });
      }
      return out;
    }
  } catch {}

  // 2) recipe_totals view
  try {
    const { data, error } = await supabase
      .from("recipe_totals")
      .select("recipe_id, knife_count, cook_count, like_count, comment_count")
      .in("recipe_id", recipeIds);
    if (!error && data) {
      for (const r of data as any[]) {
        put(String(r.recipe_id), {
          knives: r.knife_count,
          cooks: r.cook_count,
          likes: r.like_count,
          comments: r.comment_count,
        });
      }
      return out;
    }
  } catch {}

  // 3) fallback: base tables
  async function countGrouped(table: string) {
    try {
      const { data } = await supabase.from(table).select("recipe_id").in("recipe_id", recipeIds);
      const m = new Map<string, number>();
      for (const row of (data ?? []) as any[]) {
        const id = String(row.recipe_id);
        m.set(id, (m.get(id) ?? 0) + 1);
      }
      return m;
    } catch {
      return new Map<string, number>();
    }
  }
  const [knivesMap, cooksMap, commentsMap] = await Promise.all([
    countGrouped("recipe_knives"),
    countGrouped("recipe_cooks"),
    countGrouped("recipe_comments"),
  ]);
  const likeTables = ["recipe_likes", "recipe_like", "recipe_hearts"];
  let likesMap = new Map<string, number>();
  for (const t of likeTables) {
    likesMap = await countGrouped(t);
    if (likesMap.size) break;
  }

  for (const id of recipeIds) {
    put(id, {
      knives: knivesMap.get(id) ?? 0,
      cooks: cooksMap.get(id) ?? 0,
      likes: likesMap.get(id) ?? 0,
      comments: commentsMap.get(id) ?? 0,
    });
  }
  return out;
}

async function getSavedSet(viewerId: string | null, ids: string[]) {
  if (!viewerId || !ids.length) return new Set<string>();
  const { data } = await supabase
    .from("recipe_saves")
    .select("recipe_id")
    .eq("user_id", viewerId)
    .in("recipe_id", ids);
  return new Set<string>((data ?? []).map((r: any) => String(r.recipe_id)));
}

/* ───────────────── the Search screen ───────────────── */

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const initialPrefill = (params?.q as string) || "";

  // who am I
  const { userId: userIdFromHook } = useUserId();
  const [viewerId, setViewerId] = useState<string | null>(userIdFromHook ?? null);
  useEffect(() => {
    if (!viewerId) supabase.auth.getUser().then(({ data }) => setViewerId(data.user?.id ?? null));
  }, [viewerId]);

  // search state
  const [q, setQ] = useState(initialPrefill);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>(
    Object.fromEntries(ALL_CHIPS.map((c) => [c, initialPrefill.toLowerCase().includes(c.toLowerCase())]))
  );
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());

  // tiny HUD
  const [hudText, setHudText] = useState<string | null>(null);
  const hudAnim = useRef(new Animated.Value(0)).current;
  const showHud = (msg: string) => {
    setHudText(msg);
    Animated.sequence([
      Animated.timing(hudAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(hudAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(hudAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  };

  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  // filters
  const args = useMemo(() => filtersFromState(q, sel), [q, sel]);

  // run search
  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      // A) public recipes matching text/filters
      let query = supabase
        .from("recipes")
        .select(
          `
          id,
          title,
          image_url,
          minutes,
          diet_tags,
          main_ingredients,
          user_id,
          created_at,
          profiles!recipes_user_id_fkey ( username, avatar_url )
        `
        )
        .eq("is_private", false)
        .order("created_at", { ascending: false })
        .limit(50);

      if (args.text) query = query.ilike("title", `%${args.text}%`);
      if (typeof args.maxMinutes === "number") query = query.lte("minutes", args.maxMinutes);
      if (args.diet.length) query = query.overlaps("diet_tags", args.diet);
      if (args.includeIngredients.length)
        query = query.overlaps("main_ingredients", args.includeIngredients.map((x) => x.toLowerCase()));

      const { data: recipeRows, error } = await query;
      if (error) throw error;

      let result = recipeRows ?? [];

      // B) ingredient text fallback
      if (!result.length && args.text) {
        const { data: ingMatches } = await supabase
          .from("recipe_ingredients")
          .select("recipe_id")
          .ilike("text", `%${args.text}%`)
          .limit(50);

        const ids = Array.from(new Set((ingMatches ?? []).map((r: any) => r.recipe_id))).filter(Boolean);
        if (ids.length) {
          const { data: byIng } = await supabase
            .from("recipes")
            .select(
              `
              id,
              title,
              image_url,
              user_id,
              created_at,
              profiles!recipes_user_id_fkey ( username, avatar_url )
            `
            )
            .in("id", ids)
            .eq("is_private", false)
            .order("created_at", { ascending: false })
            .limit(50);
          result = byIng ?? [];
        }
      }

      // counts + saved flags
      const ids = Array.from(new Set(result.map((r: any) => String(r.id))));
      const [countMap, saved] = await Promise.all([fetchLiveCounts(ids), getSavedSet(viewerId, ids)]);
      setSavedSet(saved);

      // map rows for the card
      const mapped: SearchRow[] = (result ?? []).map((r: any) => {
        const id = String(r.id);
        const c = countMap.get(id) ?? { knives: 0, cooks: 0, likes: 0, comments: 0 };
        return {
          id,
          title: r.title ?? "",
          image: r.image_url ?? null,
          creator: r.profiles?.username ?? "someone",
          creatorAvatar: r.profiles?.avatar_url ?? null,
          ownerId: r.user_id as string,
          knives: c.knives,
          cooks: c.cooks,
          likes: c.likes,
          commentCount: c.comments,
          createdAtMs: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        };
      });

      setRows(mapped);
    } finally {
      setLoading(false);
    }
  }, [args.text, args.maxMinutes, JSON.stringify(args.diet), JSON.stringify(args.includeIngredients), viewerId]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  function toggleChip(label: Chip) {
    setSel((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      if (next[label]) for (const bad of CONFLICTS[label] || []) next[bad] = false;
      return next;
    });
  }

  function onClear() {
    setQ("");
    setSel(Object.fromEntries(ALL_CHIPS.map((c) => [c, false])));
    runSearch();
    inputRef.current?.focus();
  }

  /* ───────────────── comments modal state ───────────────── */

  const [commentsVisible, setCommentsVisible] = useState(false);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);

  const openComments = useCallback((recipeId: string) => {
    setActiveRecipeId(recipeId);
    setCommentsVisible(true);
  }, []);
  const closeComments = useCallback(() => setCommentsVisible(false), []);

  /* ───────────────── save toggle ───────────────── */

  const toggleSave = useCallback(
    async (recipeId: string) => {
      if (!viewerId) {
        await warn();
        showHud("Sign in to save");
        return;
      }
      const hasIt = savedSet.has(recipeId);

      // optimistic UI
      setSavedSet((prev) => {
        const next = new Set(prev);
        if (hasIt) next.delete(recipeId);
        else next.add(recipeId);
        return next;
      });

      try {
        if (hasIt) {
          const { error } = await supabase
            .from("recipe_saves")
            .delete()
            .eq("user_id", viewerId)
            .eq("recipe_id", recipeId);
          if (error) throw error;
          await tap();
          showHud("Removed");
        } else {
          const { error } = await supabase
            .from("recipe_saves")
            .upsert({ user_id: viewerId, recipe_id: recipeId }, { onConflict: "user_id,recipe_id" });
          if (error) throw error;
          await success();
          showHud("Saved");
        }
      } catch (e: any) {
        // revert on error
        setSavedSet((prev) => {
          const next = new Set(prev);
          if (hasIt) next.add(recipeId);
          else next.delete(recipeId);
          return next;
        });
        await warn();
        showHud("Save failed");
        console.warn("save toggle error", e);
      }
    },
    [viewerId, savedSet]
  );

  /* ───────────────── render ───────────────── */

  const renderCard = ({ item }: { item: SearchRow }) => {
    const isSaved = savedSet.has(item.id);

    return (
      <RecipeCard
        id={item.id}
        title={item.title}
        image={item.image ?? ""}
        creator={item.creator}
        creatorAvatar={item.creatorAvatar ?? ""}
        knives={item.knives}
        cooks={item.cooks}
        likes={item.likes}
        comments={item.commentCount}
        createdAt={item.createdAtMs}
        ownerId={item.ownerId}
        viewerId={viewerId ?? ""}
        isSaved={isSaved}
        onToggleSave={() => toggleSave(item.id)}
        onSave={() => toggleSave(item.id)}
        onOpen={() => router.push(`/recipe/${item.id}`)}
        onOpenCreator={(username: string) => router.push(`/u/${username}`)}
        onOpenComments={(id: string) => openComments(id)}
      />
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{ flex: 1, backgroundColor: COLORS.bg }}
    >
      {/* ── header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color="#94a3b8" style={{ marginHorizontal: 8 }} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search recipes (e.g., chicken pasta)"
            placeholderTextColor="#94a3b8"
            value={q}
            onChangeText={setQ}
            onSubmitEditing={runSearch}
            returnKeyType="search"
          />
          {(q.length > 0 || Object.values(sel).some(Boolean)) && (
            <TouchableOpacity onPress={onClear} accessibilityLabel="Clear search">
              <Ionicons name="close" size={18} color="#94a3b8" style={{ marginHorizontal: 8 }} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity onPress={runSearch} style={styles.iconBtn} accessibilityLabel="Search now">
          <Ionicons name="arrow-forward" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* ── chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingVertical: 8 }}
      >
        {ALL_CHIPS.map((item, idx) => {
          const active = !!sel[item];
          return (
            <TouchableOpacity
              key={item}
              onPress={() => toggleChip(item)}
              style={[
                styles.chip,
                active && styles.chipActive,
                { marginRight: idx === ALL_CHIPS.length - 1 ? 0 : 8 },
              ]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── results ── */}
      {loading && (
        <View style={{ paddingTop: 24 }}>
          <ActivityIndicator />
        </View>
      )}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={renderCard}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 160 }}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.lg }} />}
        ListEmptyComponent={
          !loading && (
            <Text style={{ color: "#94a3b8", textAlign: "center", marginTop: 32 }}>
              No recipes yet. Try different words or chips.
            </Text>
          )
        }
      />

      {/* ── COMMENTS MODAL: unified + safe header (X never covers Send) ── */}
      <Modal visible={commentsVisible} animationType="slide" transparent onRequestClose={closeComments}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{
              backgroundColor: COLORS.bg,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingTop: 12,
              paddingBottom: 8,
              paddingHorizontal: 16,
              maxHeight: "80%",
            }}
          >
            {/* ✅ header row (no absolute, no zIndex) */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingBottom: 8,
              }}
            >
              {/* drag handle centered */}
              <View style={{ flex: 1, alignItems: "center" }}>
                <View
                  style={{
                    width: 44,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: "rgba(255,255,255,0.2)",
                  }}
                />
              </View>

              {/* big X, easy finger target */}
              <TouchableOpacity
                onPress={closeComments}
                accessibilityRole="button"
                accessibilityLabel="Close comments"
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10, // ≈44pt tall
                  marginLeft: 8,
                }}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* 🧠 The ONE comments UI (threads, avatars, moderation, replies) */}
            {activeRecipeId ? (
              <Comments recipeId={activeRecipeId} />
            ) : (
              <Text style={{ color: "#cbd5e1", textAlign: "center", paddingVertical: 24 }}>
                No recipe selected.
              </Text>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── tiny HUD ── */}
      {hudText && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: SPACING.lg,
            right: SPACING.lg,
            bottom: 24 + insets.bottom,
            paddingVertical: 10,
            borderRadius: 12,
            backgroundColor: "rgba(34,197,94,0.95)",
            transform: [
              {
                translateY: hudAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }),
              },
            ],
            opacity: hudAnim,
          }}
        >
          <Text style={{ textAlign: "center", color: "#001018", fontWeight: "800" }}>{hudText}</Text>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}

/* ───────────────── styles ───────────────── */

const styles = StyleSheet.create({
  header: {
    paddingBottom: 10,
    paddingHorizontal: SPACING.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0b1221",
  },
  iconBtn: { padding: 6 },
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2a3b",
    overflow: "hidden",
  },
  input: { flex: 1, color: "#fff", height: 40 },
  chip: {
    paddingHorizontal: 12,
    height: 36,
    backgroundColor: "#0f172a",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  chipActive: {
    backgroundColor: "rgba(56,189,248,0.15)",
    borderColor: "rgba(56,189,248,0.55)",
  },
  chipText: { color: "#cbd5e1", fontWeight: "600" },
  chipTextActive: { color: "#e2f4ff" },
});
