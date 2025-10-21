// app/search/index.tsx
// 🧸 ELI5: This is the Search page.
// What changed:
// 1) We STOP guessing BBQ/Appetizers with words.
// 2) We ASK the database for category_tags instead.
//    So when you tap "BBQ", we filter where category_tags has 'bbq'.
// 3) Diet chips still use diet_tags (vegan/gluten_free/dairy_free).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Animated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";

import { supabase } from "../../lib/supabase";
import RecipeCard from "../../components/RecipeCard";
import { useUserId } from "../../lib/auth";
import { COLORS, SPACING } from "../../lib/theme";
import { success, tap, warn } from "../../lib/haptics";
import Comments from "../../components/Comments";

/* ───────────────────────────
   0) Chips we show on top
   ─────────────────────────── */
// We keep the chips you asked for.
// Diet chips come from diet_tags.
// Category chips (BBQ/Appetizers/Chicken/Beef/Pork/Seafood/Pasta) come from category_tags.
type Chip =
  | "Vegan"
  | "Gluten-Free"
  | "Dairy-Free"
  | "BBQ"
  | "Appetizers"
  | "Chicken"
  | "Beef"
  | "Pork"
  | "Seafood"
  | "Pasta";

const ALL_CHIPS: Chip[] = [
  "Vegan",
  "Gluten-Free",
  "Dairy-Free",
  "BBQ",
  "Appetizers",
  "Chicken",
  "Beef",
  "Pork",
  "Seafood",
  "Pasta",
];

// Some chips fight each other (Vegan vs meats)
const CONFLICTS: Record<Chip, Chip[]> = {
  Vegan: ["Chicken", "Beef", "Pork", "Seafood"],
  Chicken: ["Vegan"],
  Beef: ["Vegan"],
  Pork: ["Vegan"],
  Seafood: ["Vegan"],
  "Gluten-Free": [],
  "Dairy-Free": [],
  BBQ: [],
  Appetizers: [],
  Pasta: [],
};

/* ───────────────────────────────────────
   1) Turn chip state into real DB filters
   ─────────────────────────────────────── */
// We map chip labels to the exact strings stored in DB arrays.
function filtersFromState(q: string, sel: Record<string, boolean>) {
  // Diet (exact strings in recipes.diet_tags)
  const diet: Array<"vegan" | "gluten_free" | "dairy_free"> = [];
  if (sel["Vegan"]) diet.push("vegan");
  if (sel["Gluten-Free"]) diet.push("gluten_free");
  if (sel["Dairy-Free"]) diet.push("dairy_free");

  // Category (exact strings in recipes.category_tags)
  const cats: string[] = [];
  if (sel["BBQ"]) cats.push("bbq");
  if (sel["Appetizers"]) cats.push("appetizers");
  if (sel["Chicken"]) cats.push("chicken");
  if (sel["Beef"]) cats.push("beef");
  if (sel["Pork"]) cats.push("pork");
  if (sel["Seafood"]) cats.push("seafood");
  if (sel["Pasta"]) cats.push("pasta");

  return {
    text: q.trim(), // free text for title search
    diet,           // filter on diet_tags
    cats,           // filter on category_tags
  };
}

/* ─────────────────────────────
   2) Helper types + count fetch
   ───────────────────────────── */

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

// 🧮 Get live counts from your stats tables (unchanged logic)
async function fetchLiveCounts(recipeIds: string[]) {
  type C = { knives: number; cooks: number; likes: number; comments: number };
  const zero: C = { knives: 0, cooks: 0, likes: 0, comments: 0 };
  const out = new Map<string, C>();
  const put = (id: string, patch: Partial<C>) => {
    const prev = out.get(id) ?? zero;
    out.set(id, {
      ...prev,
      ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, Number(v ?? 0)])),
    } as C);
  };
  if (!recipeIds.length) return out;

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

  async function countGrouped(table: string, parentOnly = false) {
    try {
      if (parentOnly) {
        const { data } = await supabase
          .from("recipe_comments")
          .select("recipe_id, parent_id")
          .is("parent_id", null)
          .in("recipe_id", recipeIds);
        const m = new Map<string, number>();
        for (const row of (data ?? []) as any[]) {
          const id = String(row.recipe_id);
          m.set(id, (m.get(id) ?? 0) + 1);
        }
        return m;
      } else {
        const { data } = await supabase.from(table).select("recipe_id").in("recipe_id", recipeIds);
        const m = new Map<string, number>();
        for (const row of (data ?? []) as any[]) {
          const id = String(row.recipe_id);
          m.set(id, (m.get(id) ?? 0) + 1);
        }
        return m;
      }
    } catch {
      return new Map<string, number>();
    }
  }

  const [knivesMap, cooksMap] = await Promise.all([
    countGrouped("recipe_knives"),
    countGrouped("recipe_cooks"),
  ]);

  const commentsMap = await countGrouped("recipe_comments", true);

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

/* ─────────────────────────────
   3) THE SEARCH SCREEN
   ───────────────────────────── */

export default function SearchScreen() {
  const insets = useSafeAreaInsets();

  // If you deep-link with ?q=BBQ we’ll pre-select that chip below
  const params = useLocalSearchParams<{ q?: string }>();
  const initialPrefill = (params?.q as string) || "";

  // Who am I (for saved state)
  const { userId: userIdFromHook } = useUserId();
  const [viewerId, setViewerId] = useState<string | null>(userIdFromHook ?? null);
  useEffect(() => {
    if (!viewerId) supabase.auth.getUser().then(({ data }) => setViewerId(data.user?.id ?? null));
  }, [viewerId]);

  // Search input + chip state
  const [q, setQ] = useState(initialPrefill);
  const [sel, setSel] = useState<Record<string, boolean>>(
    Object.fromEntries(ALL_CHIPS.map((c) => [c, initialPrefill.toLowerCase().includes(c.toLowerCase())]))
  );

  // Results + loading
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);

  // HUD (tiny toast)
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

  // Focus the box
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  // Build filters for DB
  const args = useMemo(() => filtersFromState(q, sel), [q, sel]);

  // 🧠 The REAL query: use diet_tags + category_tags
  const runSearch = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("recipes")
        .select(
          `
          id,
          title,
          image_url,
          user_id,
          created_at,
          diet_tags,
          category_tags,
          profiles!recipes_user_id_fkey ( username, avatar_url )
        `
        )
        .eq("is_private", false)
        .order("created_at", { ascending: false })
        .limit(60);

      // title text (simple contains)
      if (args.text) query = query.ilike("title", `%${args.text}%`);

      // ✅ diet filters (AND logic: if you pick Vegan + GF, we want both)
      if (args.diet.length) query = query.overlaps("diet_tags", args.diet);

      // ✅ category filters (AND logic across selected categories)
      // If you pick BBQ, we look for 'bbq' in category_tags.
      if (args.cats.length) query = query.overlaps("category_tags", args.cats);

      const { data, error } = await query;
      if (error) throw error;

      const result = data ?? [];
      const ids = Array.from(new Set(result.map((r: any) => String(r.id))));

      const [countMap, saved] = await Promise.all([fetchLiveCounts(ids), getSavedSet(viewerId, ids)]);

      setRows(
        result.map((r: any) => {
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
        })
      );
    } finally {
      setLoading(false);
    }
  }, [args.text, JSON.stringify(args.diet), JSON.stringify(args.cats), viewerId]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  // Flip a chip on/off (and handle conflicts like Vegan vs meats)
  function toggleChip(label: Chip) {
    setSel((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      if (next[label]) for (const bad of CONFLICTS[label] || []) next[bad] = false;
      return next;
    });
  }

  // Clear everything
  function onClear() {
    setQ("");
    setSel(Object.fromEntries(ALL_CHIPS.map((c) => [c, false])));
    runSearch();
    inputRef.current?.focus();
  }

  // Save/unsave
  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());
  const toggleSave = useCallback(
    async (recipeId: string) => {
      if (!viewerId) {
        await warn();
        setHudText("Sign in to save");
        return;
      }
      const hasIt = savedSet.has(recipeId);
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
          setHudText("Removed");
        } else {
          const { error } = await supabase
            .from("recipe_saves")
            .upsert({ user_id: viewerId, recipe_id: recipeId }, { onConflict: "user_id,recipe_id" });
          if (error) throw error;
          await success();
          setHudText("Saved");
        }
      } catch {
        setSavedSet((prev) => {
          const next = new Set(prev);
          if (hasIt) next.add(recipeId);
          else next.delete(recipeId);
          return next;
        });
        await warn();
        setHudText("Save failed");
      }
    },
    [viewerId, savedSet]
  );

  // Comments
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const openComments = useCallback((id: string) => {
    setActiveRecipeId(id);
    setCommentsVisible(true);
  }, []);
  const closeComments = useCallback(() => setCommentsVisible(false), []);

  // Render one recipe card
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
        commentCount={item.commentCount}
        createdAt={item.createdAtMs}
        ownerId={item.ownerId}
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
      {/* ── header with search box ── */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color="#94a3b8" style={{ marginHorizontal: 8 }} />
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Search recipes"
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

      {/* ── chips row ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingVertical: 8 }}
      >
        {ALL_CHIPS.map((label, idx) => {
          const active = !!sel[label];
          return (
            <TouchableOpacity
              key={label}
              onPress={() => toggleChip(label)}
              style={[
                styles.chip,
                active && styles.chipActive,
                { marginRight: idx === ALL_CHIPS.length - 1 ? 0 : 8 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
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
          loading
            ? undefined
            : (
                <Text style={{ color: "#94a3b8", textAlign: "center", marginTop: 32 }}>
                  No recipes yet. Try different chips or words.
                </Text>
              )
        }
      />

      {/* ── comments modal ── */}
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
            {/* modal header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingBottom: 8,
              }}
            >
              <View style={{ flex: 1, alignItems: "center" }}>
                <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" }} />
              </View>
              <TouchableOpacity
                onPress={closeComments}
                accessibilityRole="button"
                accessibilityLabel="Close comments"
                style={{ paddingHorizontal: 16, paddingVertical: 10, marginLeft: 8 }}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22 }}>✕</Text>
              </TouchableOpacity>
            </View>

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
              { translateY: hudAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
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

/* ─────────────────────────────
   4) Styles
   ───────────────────────────── */
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
