// app/(tabs)/index.tsx
// HOME FEED + HORIZONTAL RAIL + COMMENTS SHEET + INLINE SPONSORED INJECTOR
//
// 🧒 like I'm 5:
// - Big list is your feed.
// - Little row at the top is the rail.
// - We also put a sponsored card in the feed sometimes.
// - We show comments in a bottom sheet and keep the screen safe from the notch.
//
// 🔧 What changed right now (to fix self-like/cook):
// - We now pass ownerId + isPrivate + the same handlers your old file used to <RecipeCard>.
// - We convert createdAt to a number (getTime), like before.
// - We restored toggleSave() and imported warn/tap for it.
//
// ✅ Everything else stays the same.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ListRenderItemInfo,
  RefreshControl,
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Pressable,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { COLORS, SPACING } from "../../lib/theme";
import { dataAPI } from "../../lib/data";
import RecipeCard from "../../components/RecipeCard";
import SponsoredCard from "../../components/SponsoredCard";
import { success, tap, warn } from "../../lib/haptics"; // ⬅️ bring back tap, warn
import { recipeStore } from "../../lib/store";
import { logAdEvent } from "../../lib/ads";
import SearchFab from "../../components/SearchFab";
import { useUserId } from "../../lib/auth";
import { supabase } from "../../lib/supabase";

/* ───────── helpers ───────── */

const booly = (v: any) => v === true || v === 1 || v === "1" || String(v).toLowerCase?.() === "true";
const firstDefined = <T,>(...vals: (T | undefined | null)[]) =>
  vals.find(v => typeof v !== "undefined" && v !== null) as T | undefined;
const toDate = (v?: string | null) => (v ? new Date(v) : undefined);
const within = (now: Date, start?: Date, end?: Date) => (!start || now >= start) && (!end || now <= end);

function weightedPick<T>(items: T[], getWeight: (x: T) => number): T | undefined {
  if (!items.length) return undefined;
  let total = 0;
  for (const it of items) total += Math.max(0, getWeight(it) || 0);
  if (total <= 0) return items[0];
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, getWeight(it) || 0);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function isPrivateFlag(v: any): boolean {
  return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
}

/* ───────── types ───────── */

type SponsoredSlot = {
  id: string;
  brand?: string | null;
  title?: string | null;
  image_url?: string | null;
  cta_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  active_from?: string | null;
  active_to?: string | null;
  is_active?: boolean | null;
  weight?: number | null;
};

type FeedItem =
  | {
      type: "recipe";
      id: string;
      title: string;
      image: string | null;
      creator: string;
      creatorAvatar?: string | null;
      knives: number;
      cooks: number;
      likes: number;
      commentCount: number;
      createdAt: string;
      ownerId: string;
      is_private?: boolean;
    }
  | {
      type: "sponsored";
      id: string; // creative id when available, else slot id
      brand: string;
      title: string;
      image: string | null;
      cta?: string | null;
      slot?: {
        id: string;
        brand?: string | null;
        title?: string | null;
        image?: string | null;       // keep legacy shape
        cta_url?: string | null;
      };
    };

type RailItem =
  | { kind: "recipe"; id: string; title: string; image: string | null }
  | { kind: "creative"; id: string; title: string; image: string | null; cta_url?: string | null; slot_id?: string | null };

type Comment = {
  id: string;
  author: { username: string; avatar?: string | null };
  text: string;
  createdAt: string;
};

/* ───────── label logic ───────── */

function getSeasonalContext(now = new Date()) {
  const m = now.getMonth();
  const d = now.getDay();
  if (d === 0 || d === 6) return "gameday";
  if (m === 10) return "thanksgiving";
  if (m === 11) return "christmas";
  if (m >= 4 && m <= 7) return "grill";
  return "quick";
}
function labelForTopic(topic: string) {
  const t = (topic || "").toLowerCase();
  if (t.includes("gameday")) return "Game Day Foods";
  if (t.includes("thanksgiving")) return "Thanksgiving Table";
  if (t.includes("christmas") || t.includes("holiday")) return "Holiday Hits";
  if (t.includes("grill")) return "Grill & Chill";
  if (t.includes("quick")) return "Quick Dinners";
  return "Seasonal Picks";
}

/* ───────── rail badge ───────── */

const USE_HOUSE_BADGE = true;
const HOUSE_BADGE_TEXT = "MessHall Picks";

function RailBadge({ kind }: { kind: "house" | "sponsored" }) {
  if (kind === "sponsored") {
    return (
      <Text
        style={{
          color: COLORS.accent,
          backgroundColor: "rgba(0, 200, 120, 0.15)",
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 999,
          fontWeight: "900",
          overflow: "hidden",
        }}
      >
        Sponsored
      </Text>
    );
  }
  return (
    <Text
      style={{
        color: "#fff",
        backgroundColor: "rgba(0,0,0,0.35)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        fontWeight: "800",
        overflow: "hidden",
      }}
    >
      {HOUSE_BADGE_TEXT}
    </Text>
  );
}

/* ───────── component ───────── */

export default function HomeScreen() {
  const { userId: viewerId } = useUserId();

  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());
  const RecipeCardAny = RecipeCard as any;

  // rail state
  const [railTitle, setRailTitle] = useState<string | null>(null);
  const [railItems, setRailItems] = useState<RailItem[]>([]);
  const [railIsSponsored, setRailIsSponsored] = useState(false);
  const [railIsHouse, setRailIsHouse] = useState(false);
  const [railSponsorLogo, setRailSponsorLogo] = useState<string | null>(null);
  const [railShelfId, setRailShelfId] = useState<string | null>(null);

  // tracking
  const seenAdsRef = useRef<Set<string>>(new Set());
  const seenRailImpressions = useRef<Set<string>>(new Set());

  // privacy: only show your own private recipes
  const safetyFilter = useCallback(
    (items: FeedItem[]) =>
      items.filter((it) => {
        if (it.type !== "recipe") return true;
        if (!isPrivateFlag((it as any).is_private)) return true;
        return !!viewerId && it.ownerId === viewerId;
      }),
    [viewerId]
  );

  /* ───────── comments sheet ───────── */

  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [sheetRefreshing, setSheetRefreshing] = useState(false);

  const fetchComments = useCallback(async (recipeId: string) => {
    setCommentsLoading(true);
    try {
      const rows: Comment[] = await (dataAPI as any).getRecipeComments?.(recipeId);
      setComments(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      Alert.alert("Comments Problem", err?.message ?? "Could not load comments.");
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  const openComments = useCallback(
    async (recipeId: string) => {
      setActiveRecipeId(recipeId);
      await fetchComments(recipeId);
      setCommentsVisible(true);
    },
    [fetchComments]
  );

  const closeComments = useCallback(() => {
    setCommentsVisible(false);
    setNewText("");
  }, []);

  const refreshSheet = useCallback(async () => {
    if (!activeRecipeId) return;
    setSheetRefreshing(true);
    await fetchComments(activeRecipeId);
    setSheetRefreshing(false);
  }, [activeRecipeId, fetchComments]);

  const sendComment = useCallback(async () => {
    const message = newText.trim();
    if (!message || !activeRecipeId) return;
    try {
      await (dataAPI as any).addComment?.(activeRecipeId, message);
      setNewText("");
      await fetchComments(activeRecipeId);
    } catch (err: any) {
      Alert.alert("Could not send", err?.message ?? "Please try again.");
    }
  }, [newText, activeRecipeId, fetchComments]);

  /* ───────── RAIL loader (shelves → slots → AI) ───────── */

  const loadRail = useCallback(async () => {
    try {
      const now = new Date();

      // 1) OWNER SHELF
      try {
        const { data: shelves } = await supabase.from("rail_shelves").select("*").limit(25);
        const activeShelves = (shelves ?? []).filter((s: any) => {
          const on = booly(firstDefined(s.is_active, s.active, true));
          if (!on) return false;
          const start = toDate(firstDefined<string>(s.starts_at, s.active_from));
          const end = toDate(firstDefined<string>(s.ends_at, s.active_to));
          return within(now, start, end);
        });
        const chosenShelf = weightedPick(activeShelves, (s: any) => Number(s.weight ?? 1));
        if (chosenShelf) {
          const { data: items } = await supabase
            .from("rail_shelf_items")
            .select("id, recipe_id, position, is_active")
            .eq("shelf_id", chosenShelf.id)
            .order("position", { ascending: true });
          const live = (items ?? []).filter((x: any) => booly(firstDefined(x.is_active, true)));
          const recipeIds = live.map((i: any) => i.recipe_id).filter(Boolean).slice(0, 7);
          if (recipeIds.length) {
            const { data: rows } = await supabase
              .from("recipes")
              .select("id, title, image_url, is_private")
              .in("id", recipeIds);
            const tiles: RailItem[] = (rows ?? [])
              .filter((r: any) => !isPrivateFlag(r.is_private))
              .map((r: any) => ({ kind: "recipe", id: String(r.id), title: r.title ?? "Recipe", image: r.image_url ?? null }));
            if (tiles.length) {
              setRailShelfId(String(chosenShelf.id));
              setRailTitle(chosenShelf.title || "Featured");
              setRailItems(tiles);
              const hasSponsor = !!(chosenShelf.sponsor_brand || chosenShelf.sponsor_logo_url);
              setRailIsSponsored(!!hasSponsor);
              setRailSponsorLogo(chosenShelf.sponsor_logo_url ?? null);
              setRailIsHouse(!hasSponsor && USE_HOUSE_BADGE);
              return;
            }
          }
        }
      } catch {}

      // 2) SPONSORED SLOT → rail creatives
      try {
        const { data: slots } = await supabase.from("sponsored_slots").select("*").limit(50);
        const activeSlots = (slots ?? []).filter((s: any) => {
          const startRaw = firstDefined<string>(s.starts_at, s.active_from);
          const endRaw = firstDefined<string>(s.ends_at, s.active_to);
          const on = booly(firstDefined(s.is_active, s.active, true));
          if (!on) return false;
          const start = toDate(startRaw);
          const end = toDate(endRaw);
          return within(now, start, end);
        });
        const chosen = weightedPick(activeSlots, (s: any) => Number(s.weight ?? 1));
        if (chosen) {
          const { data: creatives } = await supabase
            .from("sponsored_creatives")
            .select("id, title, image_url, cta, cta_url, weight, is_active, recipe_id, slot_id")
            .eq("slot_id", chosen.id)
            .order("weight", { ascending: false })
            .limit(20);
          const live = (creatives ?? []).filter((c: any) => booly(c.is_active) !== false);
          const recipeIds = live.map((c: any) => c.recipe_id).filter(Boolean);
          let recipeRows: any[] = [];
          if (recipeIds.length) {
            const { data: r } = await supabase
              .from("recipes")
              .select("id, title, image_url, is_private")
              .in("id", recipeIds);
            recipeRows = r ?? [];
          }
          const out: RailItem[] = live
            .map((c: any) => {
              if (c.recipe_id) {
                const row = recipeRows.find((rr) => String(rr.id) === String(c.recipe_id));
                if (row && !isPrivateFlag(row.is_private)) {
                  return { kind: "recipe", id: String(row.id), title: row.title ?? "Recipe", image: row.image_url ?? null };
                }
              }
              return {
                kind: "creative",
                id: String(c.id),
                title: c.title ?? "Sponsored",
                image: c.image_url ?? null,
                cta_url: c.cta_url ?? undefined,
                slot_id: chosen.id,
              };
            })
            .filter(Boolean) as RailItem[];
          if (out.length) {
            setRailShelfId(null);
            setRailTitle(chosen.brand || chosen.title || "Sponsored");
            setRailItems(out);
            setRailIsSponsored(true);
            setRailSponsorLogo(null);
            setRailIsHouse(false);
            return;
          }
        }
      } catch {}

      // 3) AI fallback
      const topic = getSeasonalContext(now);
      let suggestions: RailItem[] = [];
      try {
        const smart = await (dataAPI as any).getSmartSuggestionsForContext?.(topic);
        if (Array.isArray(smart) && smart.length) {
          suggestions = smart.slice(0, 12).map((r: any) => ({ kind: "recipe", id: String(r.id), title: r.title ?? "Recipe", image: r.image ?? null }));
        }
      } catch {}
      if (!suggestions.length) {
        const { data: rows } = await supabase
          .from("recipes")
          .select("id, title, image_url, is_private")
          .ilike("title", `%${topic}%`)
          .limit(12);
        (rows ?? []).forEach((r: any) => {
          if (!isPrivateFlag(r.is_private)) suggestions.push({ kind: "recipe", id: String(r.id), title: r.title ?? "Recipe", image: r.image_url ?? null });
        });
      }
      if (!suggestions.length) {
        const { data: rows2 } = await supabase
          .from("recipes")
          .select("id, title, image_url")
          .eq("is_private", false)
          .order("created_at", { ascending: false })
          .limit(12);
        (rows2 ?? []).forEach((r: any) => suggestions.push({ kind: "recipe", id: String(r.id), title: r.title ?? "Recipe", image: r.image_url ?? null }));
      }
      if (!suggestions.length) {
        const feed: FeedItem[] = await (dataAPI as any).getFeedPage?.(0, 20);
        (feed ?? [])
          .filter((f: any) => f?.type === "recipe")
          .slice(0, 12)
          .forEach((r: any) =>
            suggestions.push({ kind: "recipe", id: String(r.id), title: r.title ?? "Recipe", image: r.image ?? null })
          );
      }
      setRailShelfId(null);
      setRailTitle(labelForTopic(topic));
      setRailItems(suggestions);
      setRailIsSponsored(false);
      setRailSponsorLogo(null);
      setRailIsHouse(USE_HOUSE_BADGE);
    } catch (e: any) {
      console.log("[rail] error:", e?.message || e);
      setRailTitle(null);
      setRailItems([]);
      setRailIsSponsored(false);
      setRailIsHouse(false);
      setRailSponsorLogo(null);
      setRailShelfId(null);
    }
  }, []);

  useEffect(() => { loadRail(); }, [loadRail]);

  useEffect(() => {
    railItems.forEach((it) => {
      if (it.kind === "creative" && !seenRailImpressions.current.has(`creative_${it.id}`)) {
        seenRailImpressions.current.add(`creative_${it.id}`);
        logAdEvent(it.id, "impression", { where: "home_rail", unit: "slot_creative" });
      }
      if (railShelfId && it.kind === "recipe" && !seenRailImpressions.current.has(`shelf_${it.id}`)) {
        seenRailImpressions.current.add(`shelf_${it.id}`);
        logAdEvent(railShelfId, "impression", { where: "home_rail", unit: "rail_shelf" }, it.id);
      }
    });
  }, [railItems, railShelfId]);

  const onPressRail = async (it: RailItem) => {
    if (it.kind === "recipe") {
      if (railShelfId) logAdEvent(railShelfId, "click", { where: "home_rail", unit: "rail_shelf" }, it.id);
      router.push(`/recipe/${it.id}`);
      return;
    }
    logAdEvent(it.id, "click", { where: "home_rail", unit: "slot_creative" });
    if (it.cta_url) {
      const url = it.cta_url.match(/^https?:\/\//i) ? it.cta_url : `https://${it.cta_url}`;
      try { await Linking.openURL(url); } catch {}
    }
  };

  const RailSkeleton = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {Array.from({ length: 4 }).map((_, i) => (
        <View
          key={`skeleton_${i}`}
          style={{
            width: 140, height: 140, marginRight: 12, borderRadius: 14,
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
          }}
        />
      ))}
    </ScrollView>
  );

  const Rail = () => (
    <View style={{ marginBottom: SPACING.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18, flex: 1 }}>
          {railTitle || "Suggestions for you"}
        </Text>
        {railSponsorLogo ? (
          <Image source={{ uri: railSponsorLogo }} style={{ width: 22, height: 22, borderRadius: 11, marginRight: 8 }} />
        ) : null}
        {railIsSponsored ? <RailBadge kind="sponsored" /> : railIsHouse ? <RailBadge kind="house" /> : null}
      </View>

      {railItems.length === 0 ? (
        <RailSkeleton />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {railItems.map((it) => (
            <Pressable
              key={`${it.kind}_${it.id}`}
              onPress={() => onPressRail(it)}
              style={{
                width: 140, marginRight: 12, borderRadius: 14, overflow: "hidden",
                backgroundColor: "rgba(255,255,255,0.04)",
                borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
              }}
            >
              {it.image ? (
                <Image source={{ uri: it.image }} style={{ width: "100%", height: 100 }} resizeMode="cover" />
              ) : (
                <View style={{ width: "100%", height: 100, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "rgba(255,255,255,0.6)" }}>No image</Text>
                </View>
              )}
              <View style={{ padding: 8 }}>
                <Text numberOfLines={2} style={{ color: "#fff", fontWeight: "800", fontSize: 13 }}>
                  {it.title}
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 }}>
                  {it.kind === "creative" ? "Ad" : "Recipe"}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );

  /* ───────── saved flags + toggle save ───────── */

  async function updateSavedFlagsFor(ids: string[], replace: boolean) {
    try {
      if (!viewerId || ids.length === 0) {
        if (replace) setSavedSet(new Set());
        return;
      }
      const uniqueIds = Array.from(new Set(ids));
      const { data: rows } = await supabase
        .from("recipe_saves")
        .select("recipe_id")
        .eq("user_id", viewerId)
        .in("recipe_id", uniqueIds);
      const found = new Set<string>((rows ?? []).map((r: any) => String(r.recipe_id)));
      setSavedSet((prev) => {
        if (replace) return found;
        const next = new Set(prev);
        for (const id of found) next.add(id);
        return next;
      });
    } catch (e: any) {
      console.log("[saved flags] exception:", e?.message || e);
    }
  }

  // ⬇️ restored from your old working file
  const toggleSave = useCallback(
    async (recipeId: string) => {
      if (!viewerId) {
        await warn();
        Alert.alert("Sign in required", "Please sign in to save recipes.");
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
        } else {
          const { error } = await supabase
            .from("recipe_saves")
            .upsert({ user_id: viewerId, recipe_id: recipeId }, { onConflict: "user_id,recipe_id" });
          if (error) throw error;
        }
        await tap();
      } catch (e: any) {
        // revert if DB write fails
        setSavedSet((prev) => {
          const next = new Set(prev);
          if (hasIt) next.add(recipeId);
          else next.delete(recipeId);
          return next;
        });
        await warn();
        Alert.alert("Save failed", e?.message ?? "Please try again.");
      }
    },
    [viewerId, savedSet]
  );

  /* ───────── inline sponsored selection ───────── */

  const pickSponsoredFeedCard = useCallback(async (): Promise<FeedItem | null> => {
    try {
      const now = new Date();

      const { data: slots } = await supabase
        .from("sponsored_slots")
        .select("id,brand,title,image_url,cta_url,starts_at,ends_at,active_from,active_to,is_active,weight")
        .limit(100);

      const liveSlots = (slots ?? []).filter((s: SponsoredSlot) => {
        const on = booly(firstDefined(s.is_active, true));
        if (!on) return false;
        const start = toDate(firstDefined<string>(s.starts_at, s.active_from));
        const end = toDate(firstDefined<string>(s.ends_at, s.active_to));
        return within(now, start, end);
      });
      if (!liveSlots.length) return null;

      const chosen = weightedPick(liveSlots, (s) => Number(s.weight ?? 1)) as SponsoredSlot | undefined;
      if (!chosen) return null;

      const { data: creatives } = await supabase
        .from("sponsored_creatives")
        .select("id,title,image_url,cta,cta_url,weight,is_active,recipe_id")
        .eq("slot_id", chosen.id)
        .limit(50);

      const liveCreatives = (creatives ?? []).filter((c: any) => booly(c.is_active) !== false);
      const picked = weightedPick(liveCreatives, (c: any) => Number(c.weight ?? 1)) as any | undefined;

      const image = picked?.image_url ?? chosen.image_url ?? null;
      const title = picked?.title ?? chosen.title ?? chosen.brand ?? "Sponsored";

      const item: FeedItem = {
        type: "sponsored",
        id: String(picked?.id ?? chosen.id),
        brand: chosen.brand ?? "Sponsored",
        title,
        image,
        cta: picked?.cta ?? undefined,
        slot: {
          id: String(chosen.id),
          brand: chosen.brand ?? undefined,
          title: chosen.title ?? undefined,
          image,
          cta_url: picked?.cta_url ?? chosen.cta_url ?? undefined,
        },
      };

      return item;
    } catch (e) {
      console.log("[inline sponsored] failed:", e);
      return null;
    }
  }, []);

  /* ───────── load page ───────── */

  const loadPage = useCallback(
    async (nextPage: number, replace = false) => {
      if (loading) return;
      setLoading(true);
      try {
        // 1) page from backend
        let items: FeedItem[] = await (dataAPI as any).getFeedPage(nextPage, PAGE_SIZE);
        let visible = safetyFilter(items ?? []);

        // 2) store recipes metadata
        const recipesOnly = visible.filter((it) => it.type === "recipe") as Extract<FeedItem, { type: "recipe" }>[];
        recipeStore.upsertMany(
          recipesOnly.map((r) => ({
            id: r.id,
            title: r.title,
            image: r.image ?? null,
            creator: r.creator,
            knives: r.knives,
            cooks: r.cooks,
            createdAt: new Date(r.createdAt).getTime(),
          }))
        );
        updateSavedFlagsFor(recipesOnly.map((r) => r.id), replace);

        // 3) inject a sponsored card if none present
        const alreadyHasSponsored = visible.some((v) => v.type === "sponsored");
        if (!alreadyHasSponsored) {
          const ad = await pickSponsoredFeedCard();
          if (ad) {
            const insertAt = Math.min(Math.max(5, Math.floor(visible.length / 2)), visible.length);
            visible = [...visible.slice(0, insertAt), ad, ...visible.slice(insertAt)];
          }
        }

        // 4) commit
        setData((prev) => mergeUniqueFeed(prev, visible, replace));
        setPage(nextPage);
      } catch (err: any) {
        Alert.alert("Feed Problem", err?.message ?? "Could not load feed.");
      } finally {
        setLoading(false);
      }
    },
    [loading, safetyFilter, pickSponsoredFeedCard]
  );

  useEffect(() => { loadPage(0, true); }, []);
  const lastViewerRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastViewerRef.current === (viewerId ?? null)) return;
    lastViewerRef.current = viewerId ?? null;
    loadPage(0, true);
    loadRail();
  }, [viewerId, loadPage, loadRail]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    seenAdsRef.current.clear();
    seenRailImpressions.current.clear();
    await loadRail();
    await loadPage(0, true);
    await success();
    setRefreshing(false);
  }, [loadPage, loadRail]);

  const onEndReached = useCallback(() => {
    if (!loading) loadPage(page + 1, false);
  }, [page, loading, loadPage]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    for (const v of viewableItems) {
      const item: FeedItem | undefined = v?.item;
      if (!item || item.type !== "sponsored") continue;
      const id = item.id || item.slot?.id;
      if (id && !seenAdsRef.current.has(id)) {
        seenAdsRef.current.add(id);
        logAdEvent(id, "impression", { where: "home_feed", unit: "inline_card" });
      }
    }
  }).current;

  /* ───────── render row ───────── */

  function renderItem({ item }: ListRenderItemInfo<FeedItem>) {
    if (item.type === "sponsored") {
      const slot = item.slot ?? {
        id: item.id,
        brand: item.brand,
        title: item.title,
        image: item.image,
        cta_url: (item as any).cta ?? undefined,
      };
      return (
        <SponsoredCard
          slotId={String(slot.id)}
          creativeId={String(slot.id)}
          brand={slot.brand ?? ""}
          title={slot.title ?? "Sponsored"}
          image_url={(slot as any).image ?? ""}
          cta_url={(slot as any).cta_url ?? (item as any).cta ?? undefined}
          cta="Learn more"
        />
      );
    }

    // ⬇️ match your old working prop mapping so RecipeCard can hide self-actions
    return (
      <RecipeCardAny
        id={item.id}
        title={item.title}
        image={item.image ?? null}
        creator={item.creator}
        creatorAvatar={item.creatorAvatar || undefined}
        knives={item.knives}
        cooks={item.cooks}
        likes={item.likes}
        commentCount={item.commentCount ?? 0}
        createdAt={new Date(item.createdAt).getTime()} // ⬅️ timestamp like before
        ownerId={item.ownerId}                          // ⬅️ needed so self-actions hide
        isPrivate={isPrivateFlag(item.is_private)}      // ⬅️ pass privacy flag
        onOpen={(id: string) => router.push(`/recipe/${id}`)}
        onOpenCreator={(username: string) => router.push(`/u/${username}`)}
        onEdit={(id: string) => router.push({ pathname: "/recipe/edit/[id]", params: { id } })}
        onOpenComments={(id: string) => openComments(id)}
        isSaved={savedSet.has(item.id)}
        onToggleSave={() => toggleSave(item.id)}        // ⬅️ restore save toggling
        onSave={() => toggleSave(item.id)}
      />
    );
  }

  /* ───────── screen ───────── */

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "left", "right"]}>
      <FlatList
        style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}
        data={data}
        keyExtractor={(it) => `${it.type}_${(it as any).id}`}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.lg }} />}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={<Rail />}
        ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 24 }} /> : null}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        initialNumToRender={8}
        windowSize={11}
      />
      <SearchFab onPress={() => router.push("/search")} bottomOffset={24} />
      {/* comments modal */}
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
            <View style={{ alignItems: "center", justifyContent: "center", paddingBottom: 8 }}>
              <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" }} />
              <TouchableOpacity onPress={closeComments} style={{ position: "absolute", right: 6, top: 0, padding: 8 }}>
                <Text style={{ color: "#fff", fontWeight: "900" }}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16, marginBottom: 8 }}>Comments</Text>

            {commentsLoading ? (
              <ActivityIndicator />
            ) : (
              <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 12 }}>
                {comments.length === 0 ? (
                  <Text style={{ color: "rgba(255,255,255,0.6)" }}>No comments yet. Be the first!</Text>
                ) : (
                  comments.map((c) => (
                    <View key={c.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" }}>
                      <Text style={{ color: "#fff", fontWeight: "800" }}>{c.author.username}</Text>
                      <Text style={{ color: "#cbd5e1" }}>{c.text}</Text>
                    </View>
                  ))
                )}
              </ScrollView>
            )}

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
              <TextInput
                value={newText}
                onChangeText={setNewText}
                placeholder="Add a comment…"
                placeholderTextColor="rgba(255,255,255,0.5)"
                style={{
                  flex: 1,
                  backgroundColor: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              />
              <TouchableOpacity
                onPress={sendComment}
                style={{ backgroundColor: COLORS.accent, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }}
              >
                <Text style={{ color: "#001018", fontWeight: "900" }}>Send</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={refreshSheet}
                style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>↻</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ───────── utils ───────── */

function mergeUniqueFeed(prev: any[], next: any[], replace: boolean): any[] {
  const merged = replace ? next : [...prev, ...next];
  const seen = new Set<string>();
  return merged.filter((it) => {
    const key = `${it.type}_${(it as any).id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
