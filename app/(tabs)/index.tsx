// app/(tabs)/index.tsx
// HOME FEED + HORIZONTAL RAIL + COMMENTS SHEET + INLINE SPONSORED INJECTOR
//
// 🧒 like I'm 5:
// - Big list is your feed.
// - Little row at the top is the rail.
// - We also put a sponsored card in the feed sometimes.
// - We show comments in a bottom sheet and keep the screen safe from the notch.
//
// 🔧 What changed right now:
// - ✅ NEW: scroll memory with AsyncStorage + safe restore (waits for layout, retries)
// - ✅ NEW: rail priority → Owner shelf > Sponsored > Seasonal/AI > For You (fallback overlay only)
// - Everything else kept the same.
import { isBlocked, unblockUser } from "../../lib/blocking";
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
  PanResponder, // for swipe-to-close on the header
  InteractionManager, // NEW: for safe scroll restore after layout
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ThemedNotice from "../../components/ui/ThemedNotice";
import { router, useFocusEffect } from "expo-router";

import { COLORS, SPACING } from "../../lib/theme";
import { dataAPI } from "../../lib/data";
import RecipeCard from "../../components/RecipeCard";
import SponsoredCard from "../../components/SponsoredCard";
import { success, tap, warn } from "../../lib/haptics";
import { recipeStore } from "../../lib/store";
import { logAdEvent as logAd } from "../../lib/ads";
import { logAdEvent as logAdEventV2 } from "../../lib/ads/logAdEvent";
import SearchFab from "../../components/SearchFab";
import { useUserId } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import Comments from "../../components/Comments";

/* ───────── storage: scroll memory ───────── */
type StorageLike = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };
const memStore: Record<string, string> = {};
const MemoryStorage: StorageLike = {
  async getItem(k) { return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
  async setItem(k, v) { memStore[k] = v; },
};
async function getStorage(): Promise<StorageLike> {
  try {
    const mod = (await import("@react-native-async-storage/async-storage")).default as any;
    if (mod?.getItem && mod?.setItem) return mod as StorageLike;
  } catch {}
  return MemoryStorage;
}
const SCROLL_KEY = "HomeFeedList:offset";
const SESSION_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
async function persistScrollOffset(y: number) {
  try {
    const storage = await getStorage();
    const payload = {
      y: Math.max(0, Math.floor(y)),
      ts: Date.now(),
      sessionId: SESSION_ID,
    };
    await storage.setItem(SCROLL_KEY, JSON.stringify(payload));
  } catch {}
}
async function loadScrollOffset(): Promise<number> {
  try {
    const storage = await getStorage();
    const raw = await storage.getItem(SCROLL_KEY);
    if (!raw) return 0;
    try {
      const obj = JSON.parse(raw);
      const y = Number(obj?.y ?? 0);
      const ts = Number(obj?.ts ?? 0);
      const sid = String(obj?.sessionId ?? "");
      // cold start: different session → ignore
      if (sid !== SESSION_ID) return 0;
      // TTL: older than 6h → ignore
      if (!Number.isFinite(ts) || Date.now() - ts > SIX_HOURS_MS) return 0;
      return Number.isFinite(y) && y >= 0 ? y : 0;
    } catch {
      // legacy numeric format fallback
      const y = parseInt(raw, 10);
      return Number.isFinite(y) && y >= 0 ? y : 0;
    }
  } catch { return 0; }
}

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
      id: string;
      brand: string;
      title: string;
      image: string | null;
      cta?: string | null;
      slot?: {
        id: string;
        brand?: string | null;
        title?: string | null;
        image?: string | null;
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

/* ───────── feed mode (client-side sort only; no backend changes) ───────── */
type FeedMode = "trending" | "top_week" | "newest";

/* ───────── seasonal labels ───────── */
function getSeasonalContext(now = new Date()) {
  const month = now.getMonth(); // 0-11
  const date = now.getDate(); // 1-31
  const day = now.getDay(); // 0=Sun

  // Weekend default to gameday/snacks
  if (day === 0 || day === 6) return "gameday";

  // Winter (Dec-Feb)
  if (month === 11) return "holiday"; // December
  if (month === 0) return date <= 7 ? "new year" : "cozy"; // January
  if (month === 1) {
    if (date <= 14) return "gameday"; // early Feb (Super Bowl period)
    if (date === 14) return "date night"; // Valentine's
    return "cozy";
  }

  // Spring (Mar-May)
  if (month === 2) return date >= 15 ? "spring" : "cozy"; // March
  if (month === 3) return "spring"; // April
  if (month === 4) {
    if (date <= 7) return "cinco"; // lead-in to Cinco de Mayo
    return "spring"; // May
  }

  // Summer (Jun-Aug)
  if (month >= 5 && month <= 7) return "bbq";

  // Back to school (Sep)
  if (month === 8) return "back to school";

  // Fall (Oct-Nov)
  if (month === 9) return "halloween"; // October
  if (month === 10) return "thanksgiving"; // November

  // Fallback
  return "quick";
}
function labelForTopic(topic: string) {
  const t = (topic || "").toLowerCase();
  if (t.includes("gameday")) return "Game Day Foods";
  if (t.includes("thanksgiving")) return "Thanksgiving Table";
  if (t.includes("christmas") || t.includes("holiday")) return "Holiday Hits";
  if (t.includes("new year")) return "New Year Fresh Starts";
  if (t.includes("date night")) return "Date Night In";
  if (t.includes("spring")) return "Spring Fresh";
  if (t.includes("bbq") || t.includes("grill")) return "Grill & Chill";
  if (t.includes("back to school")) return "Back-to-School Quick Wins";
  if (t.includes("halloween")) return "Spooky & Cozy";
  if (t.includes("cozy")) return "Cozy Comforts";
  if (t.includes("cinco")) return "Cinco de Mayo";
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
          backgroundColor: COLORS.card,
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
        backgroundColor: COLORS.card,
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

export default function HomeScreen() {
  const { userId: viewerId } = useUserId();

  const [data, setData] = useState<FeedItem[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const PAGE_SIZE = 12;

  const [savedSet, setSavedSet] = useState<Set<string>>(new Set());
  const RecipeCardAny = RecipeCard as any;

  // feed mode state (we keep everything else the same; just sort locally)
  const [mode, setMode] = useState<FeedMode>("trending");

  // rail state
  const [railTitle, setRailTitle] = useState<string | null>(null);
  const [railItems, setRailItems] = useState<RailItem[]>([]);
  const [railIsSponsored, setRailIsSponsored] = useState(false);
  const [railIsHouse, setRailIsHouse] = useState(false);
  const [railSponsorLogo, setRailSponsorLogo] = useState<string | null>(null);
  const [railShelfId, setRailShelfId] = useState<string | null>(null);

  // impressions & scroll memory
  const seenAdsRef = useRef<Set<string>>(new Set());
  const seenRailImpressions = useRef<Set<string>>(new Set());
  const listRef = useRef<FlatList>(null);
  const lastOffsetY = useRef(0);
  const pendingRestoreY = useRef<number | null>(null);   // NEW
  const restoreTries = useRef(0);                        // NEW
  const restoreDeadlineAt = useRef<number>(0);           // NEW: hard deadline to stop trying

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

  /* comments sheet (unchanged) */
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [sheetRefreshing, setSheetRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ visible: boolean; title: string; message: string }>({ visible: false, title: "", message: "" });

  // simple swipe-down-to-close (header only)
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6,
      onPanResponderMove: () => {},
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 1.0) closeComments();
      },
    })
  ).current;

  const fetchComments = useCallback(async (recipeId: string) => {
    setCommentsLoading(true);
    try {
      const rows: Comment[] = await (dataAPI as any).getRecipeComments?.(recipeId);
      setComments(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setNotice({ visible: true, title: "Comms Failure", message: err?.message ?? "Could not load comments." });
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
  const closeComments = useCallback(() => { setCommentsVisible(false); setNewText(""); }, []);
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
      setNotice({ visible: true, title: "Transmission Failed", message: err?.message ?? "Please try again." });
    }
  }, [newText, activeRecipeId, fetchComments]);

  /* recommendations + rail loader (unchanged) */
  const loadRecommendations = useCallback(async () => {
    if (!viewerId) return { title: null, items: [] as RailItem[] };

    const { data: recs, error } = await supabase.rpc("recommend_vec_for_user", {
      p_user: viewerId,
      p_limit: 12,
    });

    if (error || !Array.isArray(recs) || recs.length === 0) {
      return { title: null, items: [] as RailItem[] };
    }

    const items: RailItem[] = recs
      .filter((r: any) => !isPrivateFlag(r.is_private))
      .map((r: any) => ({
        kind: "recipe",
        id: String(r.id),
        title: r.title ?? "Recipe",
        image: r.image_url ?? null,
      }));

    return { title: "For You", items };
  }, [viewerId]);

  const loadRail = useCallback(async (): Promise<{ didSet: boolean; priority: "owner"|"sponsored"|"fallback" }> => {
    try {
      const now = new Date();

      // 1) OWNER SHELF
      try {
        const nowIso = new Date().toISOString();
        const { data: shelves } = await supabase
          .from("rail_shelves")
          .select("*")
          .eq("is_active", true)
          .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
          .or(`ends_at.is.null,ends_at.gte.${nowIso}`)
          .order("weight", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(100);
        const activeShelves = (shelves ?? []).filter((s: any) => {
          const on = booly(firstDefined(s.is_active, s.active, true));
          if (!on) return false;
          const start = toDate(firstDefined<string>(s.starts_at, s.active_from));
          const end = toDate(firstDefined<string>(s.ends_at, s.active_to));
          return within(now, start, end);
        });
        const chosenShelf = [...activeShelves].sort((a: any, b: any) => {
          const wa = Number(a.weight ?? 1);
          const wb = Number(b.weight ?? 1);
          if (wb !== wa) return wb - wa;
          const ca = new Date(a.created_at ?? 0).getTime();
          const cb = new Date(b.created_at ?? 0).getTime();
          return cb - ca;
        })[0];
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
              return { didSet: true, priority: hasSponsor ? "sponsored" : "owner" };
            }
          }
        }
      } catch {}

      // 2) SPONSORED SLOT
      try {
        const { data: slots } = await supabase.from("sponsored_slots").select("*").limit(50);
        const activeSlots = (slots ?? []).filter((s: any) => {
          const startRaw = firstDefined<string>(s.starts_at, s.active_from);
          const endRaw = firstDefined<string>(s.ends_at, s.active_to);
          const on = booly(firstDefined(s.is_active, s.active, true));
          if (!on) return false;
          const start = toDate(startRaw);
          const end = toDate(endRaw);
          return within(new Date(), start, end);
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
            return { didSet: true, priority: "sponsored" };
          }
        }
      } catch {}

      // 3) FALLBACK suggestions (seasonal, smart, latest)
      const topic = getSeasonalContext(new Date());
      const synonyms: string[] = (() => {
        const t = topic.toLowerCase();
        if (t === "holiday") return ["christmas", "holiday", "holidays"];
        if (t === "bbq") return ["bbq", "barbecue", "grill", "cookout"];
        if (t === "spring") return ["spring", "fresh", "asparagus", "salad"];
        if (t === "gameday") return ["game day", "gameday", "wings", "snacks"];
        if (t === "cozy") return ["cozy", "soup", "stew", "chili"];
        if (t === "back to school") return ["back to school", "lunch", "meal prep", "quick"];
        if (t === "date night") return ["date night", "romantic", "steak", "pasta"];
        if (t === "new year") return ["new year", "light", "healthy"];
        if (t === "cinco") return ["cinco", "taco", "mexican"];
        if (t === "halloween") return ["halloween", "pumpkin", "fall"];
        if (t === "thanksgiving") return ["thanksgiving", "turkey", "sides"];
        if (t === "quick") return ["quick", "30-minute", "easy"];
        return [t];
      })();
      let suggestions: RailItem[] = [];
      try {
        const smart = await (dataAPI as any).getSmartSuggestionsForContext?.(topic);
        if (Array.isArray(smart) && smart.length) {
          suggestions = smart.slice(0, 12).map((r: any) => ({ kind: "recipe", id: String(r.id), title: r.title ?? "Recipe", image: r.image ?? null }));
        }
      } catch {}
      if (!suggestions.length) {
        for (const word of synonyms) {
          if (suggestions.length) break;
          const { data: rows } = await supabase
            .from("recipes")
            .select("id, title, image_url, is_private")
            .ilike("title", `%${word}%`)
            .limit(12);
          (rows ?? []).forEach((r: any) => {
            if (!isPrivateFlag(r.is_private)) suggestions.push({ kind: "recipe", id: String(r.id), title: r.title ?? "Recipe", image: r.image_url ?? null });
          });
        }
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
      return { didSet: true, priority: "fallback" };
    } catch (e: any) {
      setRailTitle(null);
      setRailItems([]);
      setRailIsSponsored(false);
      setRailIsHouse(false);
      setRailSponsorLogo(null);
      setRailShelfId(null);
      return { didSet: false, priority: "fallback" };
    }
  }, []);

  /* run rail + optional overlay when fallback */
  useEffect(() => {
    (async () => {
      const res = await loadRail();
      if (res.priority === "fallback") {
        const { title, items } = await loadRecommendations();
        if (items.length) {
          setRailTitle(title);
          setRailItems(items);
          setRailIsSponsored(false);
          setRailIsHouse(false);
          setRailSponsorLogo(null);
          setRailShelfId(null);
        }
      }
    })();
  }, [loadRail, loadRecommendations]);

  useEffect(() => {
    railItems.forEach((it) => {
      if (it.kind === "creative" && !seenRailImpressions.current.has(`creative_${it.id}`)) {
        seenRailImpressions.current.add(`creative_${it.id}`);
        // placement-aware logger
        logAdEventV2({ placement: "rail", event_type: "impression", slot_id: String(it.id), meta: { unit: "slot_creative", where: "home_rail" } });
      }
      if (railShelfId && it.kind === "recipe" && !seenRailImpressions.current.has(`shelf_${it.id}`)) {
        seenRailImpressions.current.add(`shelf_${it.id}`);
        // impression for shelf tile (attribute via meta to avoid slot FK)
        logAdEventV2({ placement: "rail", event_type: "impression", slot_id: null, meta: { unit: "rail_shelf", where: "home_rail", recipe_id: it.id, shelf_id: railShelfId } });
      }
    });
  }, [railItems, railShelfId]);

  const onPressRail = async (it: RailItem) => {
    if (it.kind === "recipe") {
      if (railShelfId) {
        // placement-aware click for shelf (send shelf_id in meta, slot_id null to avoid FK fail)
        logAdEventV2({ placement: "rail", event_type: "click", slot_id: null, meta: { unit: "rail_shelf", where: "home_rail", recipe_id: it.id, shelf_id: railShelfId } });
      }
      await persistScrollOffset(lastOffsetY.current);
      router.push(`/recipe/${it.id}`);
      return;
    }
    // creative click on rail
    logAdEventV2({ placement: "rail", event_type: "click", slot_id: String(it.id), meta: { unit: "slot_creative", where: "home_rail" } });
    if (it.cta_url) {
      const url = it.cta_url.match(/^https?:\/\//i) ? it.cta_url : `https://${it.cta_url}`;
      try { await Linking.openURL(url); } catch {}
    }
  };

  /* ───────── NEW: simple segmented control (matches theme) ───────── */
  const FeedModeToggle = () => (
    <View style={{ backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 6, marginBottom: SPACING.lg }}>
      <View style={{ flexDirection: "row" }}>
        {([
          { key: "trending", label: "Trending" },
          { key: "top_week", label: "Top (7d)" },
          { key: "newest", label: "Newest" },
        ] as {key: FeedMode; label: string}[]).map((m) => {
          const active = mode === m.key;
          return (
            <Pressable
              key={m.key}
              onPress={async () => { if (mode !== m.key) { setMode(m.key); await success(); } }}
              android_ripple={{ color: "rgba(255,255,255,0.08)", borderless: true }}
              style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 12, backgroundColor: active ? "rgba(255,255,255,0.06)" : "transparent", borderWidth: active ? 1 : 0, borderColor: active ? COLORS.border : "transparent" }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={{ color: "#fff", fontWeight: active ? "900" : "700" }}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  /* ───────── rail UI (unchanged) ───────── */
  const RailSkeleton = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {Array.from({ length: 4 }).map((_, i) => (
        <View
          key={`skeleton_${i}`}
          style={{
            width: 140,
            height: 140,
            marginRight: 12,
            borderRadius: 16,
            backgroundColor: COLORS.card,
            borderWidth: 1,
            borderColor: COLORS.border,
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
                width: 140, marginRight: 12, borderRadius: 16, overflow: "hidden",
                backgroundColor: COLORS.card,
                borderWidth: 1, borderColor: "#1a2433",
                paddingBottom: 4,
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
                <Text
                  style={{
                    color: "rgba(255,255,255,0.85)",
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  {it.kind === "creative" ? "Ad" : "Recipe"}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );

  /* ───────── saved flags (unchanged) ───────── */
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
    } catch {}
  }

  const toggleSave = useCallback(
    async (recipeId: string) => {
      if (!viewerId) {
        await warn();
        setNotice({ visible: true, title: "Sign-In Required", message: "Please sign in to save recipes." });
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
        setNotice({ visible: true, title: "Save Failed", message: e?.message ?? "Please try again." });
      }
    },
    [viewerId, savedSet]
  );

  /* ───────── inline sponsored selection (unchanged) ───────── */
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
    } catch {
      return null;
    }
  }, []);

  // sort & filter in-app so we don't change server code
  const applyClientSortFilter = useCallback((items: FeedItem[]) => {
    let recipes: FeedItem[] = items;
    if (!Array.isArray(recipes) || !recipes.length) return recipes;

    // only touch recipe rows; leave sponsored alone in order
    const recipeRows = recipes.filter((r) => r.type === "recipe") as any[];
    const others = recipes.filter((r) => r.type !== "recipe");

    const now = Date.now();
    const ageHours = (d: number) => Math.max(1, (now - d) / (1000 * 60 * 60));

    let sorted = recipeRows;

    if (mode === "newest") {
      sorted = [...recipeRows].sort((a, b) => (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } else if (mode === "top_week") {
      const oneWeek = 7 * 24 * 3600 * 1000;
      const recent = recipeRows.filter((r) => (now - new Date(r.createdAt).getTime()) <= oneWeek);
      sorted = [...recent].sort((a, b) => {
        const sa = (a.likes ?? 0) * 3 + (a.cooks ?? 0) * 4 + (a.commentCount ?? 0);
        const sb = (b.likes ?? 0) * 3 + (b.cooks ?? 0) * 4 + (b.commentCount ?? 0);
        return sb - sa;
      });
    } else {
      // trending with light time decay
      sorted = [...recipeRows].sort((a, b) => {
        const va = ((a.likes ?? 0) * 3 + (a.cooks ?? 0) * 4 + (a.commentCount ?? 0)) / Math.pow(ageHours(new Date(a.createdAt).getTime())/6, 1.2);
        const vb = ((b.likes ?? 0) * 3 + (b.cooks ?? 0) * 4 + (b.commentCount ?? 0)) / Math.pow(ageHours(new Date(b.createdAt).getTime())/6, 1.2);
        return vb - va;
      });
    }

    // merge back with non-recipe items (keep others where they were)
    return [...sorted, ...others];
  }, [mode]);

  /* ───────── main page load (unchanged, we just sort afterward) ───────── */
  const loadPage = useCallback(
    async (nextPage: number, replace = false) => {
      if (loading) return;
      setLoading(true);
      try {
        // 1) page from backend
        let items: FeedItem[] = await (dataAPI as any).getFeedPage(nextPage, PAGE_SIZE);
        let visible = safetyFilter(items ?? []);
        visible = applyClientSortFilter(visible);

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
        setNotice({ visible: true, title: "Intel Down", message: err?.message ?? "Could not load feed." });
      } finally {
        setLoading(false);
      }
    },
    [loading, safetyFilter, pickSponsoredFeedCard, applyClientSortFilter]
  );

  // initial + refresh on mode change (because we re-sort)
  useEffect(() => {
    loadPage(0, true);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ... the rest of your original code stays the same ... */

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    seenAdsRef.current.clear();
    seenRailImpressions.current.clear();

    const res = await loadRail();
    if (res.priority === "fallback") {
      const { title, items } = await loadRecommendations();
      if (items.length) {
        setRailTitle(title);
        setRailItems(items);
        setRailIsSponsored(false);
        setRailIsHouse(false);
        setRailSponsorLogo(null);
        setRailShelfId(null);
      }
    }

    // reset saved scroll on manual refresh so users see newest
    await persistScrollOffset(0);
    await loadPage(0, true);
    await success();
    setRefreshing(false);
  }, [loadRail, loadRecommendations, loadPage]);

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
        logAd(id, "impression", { where: "home_feed", unit: "inline_card" });
      }
    }
  }).current;

  // remember & restore scroll
  const attemptRestoreScroll = () => {
    if (pendingRestoreY.current == null) return;
    const y = pendingRestoreY.current;
    if (restoreDeadlineAt.current && Date.now() > restoreDeadlineAt.current) {
      pendingRestoreY.current = null;
      return;
    }
    InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        listRef.current?.scrollToOffset({ offset: y, animated: false });
        restoreTries.current += 1;
        if (pendingRestoreY.current != null) {
          setTimeout(() => attemptRestoreScroll(), 100);
        }
      }, 0);
    });
  };
  // Persist last known offset if this screen blurs or unmounts
  useEffect(() => {
    return () => { persistScrollOffset(lastOffsetY.current); };
  }, []);
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      (async () => {
        const y = await loadScrollOffset();
        if (!alive) return;
        pendingRestoreY.current = y;
        restoreTries.current = 0;
        restoreDeadlineAt.current = Date.now() + 6000; // try for up to 6s
        attemptRestoreScroll();
      })();
      return () => { alive = false; };
    }, [])
  );
  const handleMomentumEnd = useCallback(async (e: any) => {
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    lastOffsetY.current = y;
    await persistScrollOffset(y);
  }, []);
  const handleEndDrag = useCallback(async (e: any) => {
    const y = e?.nativeEvent?.contentOffset?.y ?? 0;
    lastOffsetY.current = y;
    await persistScrollOffset(y);
  }, []);
   
  // Open a creator profile safely (username OR userId).
// - If profile is viewable (not blocked either way), navigate.
// - If *you* blocked them, offer to Unblock (nicety).
// - Otherwise stay neutral ("User not available").
const handleOpenCreator = React.useCallback(async (usernameOrId: string) => {
  try {
    // simple “looks like UUID” check (36 chars with dashes)
    const looksLikeId = /^[0-9a-fA-F-]{36}$/.test(usernameOrId);
    let targetId = usernameOrId;

    if (!looksLikeId) {
      // resolve username → id
      const { data: prof } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", usernameOrId)
        .maybeSingle();
      if (!prof) { Alert.alert("User not available"); return; }
      targetId = String(prof.id);
    }

    // Try to read the profile; RLS returns no row if blocked either way
    const { data: viewable } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();

    if (viewable) {
      router.push(`/u/${targetId}`);
      return;
    }

    // Not viewable → check if *you* blocked them (nicety)
    if (await isBlocked(targetId)) {
      Alert.alert(
        "You blocked this user",
        "Unblock to view their profile and content.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unblock",
            style: "destructive",
            onPress: async () => {
              const ok = await unblockUser(targetId);
              if (ok) router.push(`/u/${targetId}`);
              else Alert.alert("Sorry", "Couldn’t unblock. Try again.");
            },
          },
        ]
      );
    } else {
      // Could be they blocked you or deleted → keep it neutral
      Alert.alert("User not available");
    }
  } catch {
    Alert.alert("User not available");
  }
}, []);

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
        createdAt={new Date(item.createdAt).getTime()}
        titleRightInset={96}
        ownerId={item.ownerId}
        isPrivate={isPrivateFlag(item.is_private)}
        onOpen={(id: string) => { persistScrollOffset(lastOffsetY.current); router.push(`/recipe/${id}`); }}
        onOpenCreator={handleOpenCreator}
        onEdit={(id: string) => router.push({ pathname: "/recipe/edit/[id]", params: { id } })}
        onOpenComments={(id: string) => openComments(id)}
        isSaved={savedSet.has(item.id)}
        onToggleSave={() => toggleSave(item.id)}
        onSave={() => toggleSave(item.id)}
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "left", "right"]}>
      <ThemedNotice
        visible={notice.visible}
        title={notice.title}
        message={notice.message}
        onClose={() => setNotice({ visible: false, title: "", message: "" })}
        confirmText="OK"
      />
      <FlatList
        ref={listRef}
        style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}
        data={data}
        keyExtractor={(it) => `${it.type}_${(it as any).id}`}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.lg }} />}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={<View><FeedModeToggle /><Rail /></View>}
        ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 24 }} /> : null}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        initialNumToRender={8}
        windowSize={11}
        // track position continuously so we always know latest offset
        onScroll={(e) => { const y = e?.nativeEvent?.contentOffset?.y ?? 0; lastOffsetY.current = y; }}
        scrollEventThrottle={16}
        // remember place when the scroll stops
        onMomentumScrollEnd={handleMomentumEnd}
        onScrollEndDrag={handleEndDrag}
        // NEW: also attempt restore when layout/content changes
        onContentSizeChange={() => { if (pendingRestoreY.current != null) attemptRestoreScroll(); }}
        onLayout={() => { if (pendingRestoreY.current != null) attemptRestoreScroll(); }}
      />
      <SearchFab onPress={() => router.push("/search")} bottomOffset={24} />
      {/* comments modal */}
      <Modal visible={commentsVisible} animationType="slide" transparent onRequestClose={closeComments}>
        <View style={{ flex: 1, backgroundColor: COLORS.card, justifyContent: "flex-end" }}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{
              backgroundColor: "rgba(0,0,0,0.78)",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingTop: 12,
              paddingBottom: 8,
              paddingHorizontal: 16,
              maxHeight: "80%",
            }}
          >
            {/* header row: swipe down to close */}
            <View
              {...pan.panHandlers}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 8 }}
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

            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16, marginBottom: 8 }}>Comments</Text>

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
    </SafeAreaView>
  );
}

/* ───────── merge helper ───────── */
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
