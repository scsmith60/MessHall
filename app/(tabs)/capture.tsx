// app/(tabs)/capture.tsx
// 🧒 ELI5: We paste a TikTok link, our robot opens it,
// reads the caption + lots of comments, builds a recipe-looking text,
// and gives that to the parser. If still weak, we OCR screenshots.

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, Alert,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Image as RNImage, Animated, Easing, Dimensions, Modal, StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable, RectButton } from "react-native-gesture-handler";
import { useFocusEffect } from "@react-navigation/native";
import WebView from "react-native-webview";

import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";

import { supabase } from "@/lib/supabase";
import { fetchOgForUrl } from "@/lib/og";
import { uploadFromUri } from "@/lib/uploads";
import { parseRecipeText } from "@/lib/unified_parser";

import TikTokSnap from "@/lib/tiktok";
import TTDomScraper from "@/components/TTDomScraper";

import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import Svg, { Line, Circle } from "react-native-svg";

// -------------- theme --------------
const COLORS = {
  bg: "#0B1120",
  card: "#0E1726",
  sunken: "#1F2937",
  text: "#E5E7EB",
  sub: "#A8B3BA",
  accent: "#22c55e",
  green: "#22c55e",
  red: "#EF4444",
  border: "#243042",
};
const MESSHALL_GREEN = "#2FAE66";

// -------------- timings --------------
const CAPTURE_DELAY_MS = 700;
const BETWEEN_SHOTS_MS = 120;
const SNAP_ATTEMPTS = 2;
const IMPORT_HARD_TIMEOUT_MS = 35000;
const ATTEMPT_TIMEOUT_FIRST_MS = 8000;
const ATTEMPT_TIMEOUT_SOFT_MS = 2200;
const MIN_IMG_W = 600, MIN_IMG_H = 600;
const SOFT_MIN_W = 360, SOFT_MIN_H = 360;
const MIN_LOCAL_BYTES = 30_000;
const FOCUS_Y_DEFAULT = 0.4;

// -------------- tiny utils --------------
// wait or give up
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
// get first url from a string
function extractFirstUrl(s: string): string | null {
  const m = (s || "").match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}
function ensureHttps(u: string) { return /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`; }
async function resolveFinalUrl(u: string) {
  try { const r = await fetch(u); if ((r as any)?.url) return (r as any).url as string; } catch {}
  return u;
}
function canonicalizeUrl(u: string): string {
  try {
    const raw = ensureHttps(u.trim());
    const url = new URL(raw);
    url.protocol = "https:"; url.hash = ""; url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const kill = ["fbclid", "gclid", "ref"];
    for (const [k] of url.searchParams.entries()) if (k.toLowerCase().startsWith("utm_") || kill.includes(k)) url.searchParams.delete(k);
    url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch { return u.trim(); }
}
function isTikTokLike(url: string): boolean {
  try { const h = new URL(url).hostname.toLowerCase(); return h === "www.tiktok.com" || h.endsWith(".tiktok.com") || h === "tiktok.com" || h === "vm.tiktok.com"; }
  catch { return /tiktok\.com/i.test(url); }
}
function extractTikTokIdFromUrl(u: string): string | null {
  const m = u.match(/\/(?:video|photo)\/(\d{6,})/);
  return m ? m[1] : null;
}
async function resolveTikTokEmbedUrl(rawUrl: string) {
  const start = ensureHttps(rawUrl.trim());
  const final = await resolveFinalUrl(start);
  let id = extractTikTokIdFromUrl(final);
  if (!id) {
    try {
      const html = await (await fetch(final)).text();
      const m =
        html.match(/"videoId"\s*:\s*"(\d{6,})"/) ||
        html.match(/"itemId"\s*:\s*"(\d{6,})"/) ||
        html.match(/<link\s+rel="canonical"\s+href="https?:\/\/www\.tiktok\.com\/@[^\/]+\/(?:video|photo)\/(\d{6,})"/i);
      if (m) id = m[1];
    } catch {}
  }
  return { embedUrl: id ? `https://www.tiktok.com/embed/v2/${id}` : null, finalUrl: final, id };
}
function decodeEntities(s: string) {
  return (s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function extractMetaContent(html: string, nameOrProp: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const m = html.match(re);
  return m?.[1]?.trim() || null;
}
function hostToBrand(host: string) {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (h.includes("tiktok")) return "tiktok";
  if (h.includes("foodnetwork")) return "food network";
  if (h.includes("allrecipes")) return "allrecipes";
  if (h.includes("youtube")) return "youtube";
  if (h.includes("pinterest")) return "pinterest";
  return h.split(".")[0];
}
function cleanTitle(raw: string, url: string) {
  let s = decodeEntities((raw || "").trim());
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const brand = host ? hostToBrand(host) : "";
  const splitters = [" | ", " - ", " • ", " – "];
  for (const sp of splitters) {
    const parts = s.split(sp);
    if (parts.length > 1) {
      const last = parts[parts.length - 1].trim().toLowerCase();
      if (brand && (last === brand || last.includes(brand))) { s = parts.slice(0, -1).join(sp).trim(); break; }
    }
  }
  s = s.replace(/\s+[\-\|•–]\s*(tiktok|food\s*network|allrecipes|youtube)\s*$/i, "").trim();
  s = s.replace(/\b\(?video\)?\b\s*$/i, "").trim();
  return s;
}
// ------------------------------
// 🍭 Title helpers (fixed)
// ------------------------------

/** Turn a TikTok caption into a short, pretty recipe title */
function captionToNiceTitle(raw?: string): string {
  if (!raw) return "";
  let s = String(raw)
    .replace(/\r|\t/g, " ")
    .replace(/https?:\/\/\S+/gi, "")                  // drop links
    .replace(/[#@][\w_]+/g, "")                       // drop #tags/@users
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // drop emojis
    .replace(/\s{2,}/g, " ")
    .trim();

  // Cut off when the caption starts listing sections like Ingredients, Directions, etc.
  const cutWords = /(ingredients?|directions?|instructions?|method|prep\s*time|cook\s*time|total\s*time|servings?|yields?|calories?|kcal)/i;
  const m = s.match(cutWords);
  if (m && m.index! > 0) s = s.slice(0, m.index).trim();

  // Prefer first line or first sentence that’s at least a few chars
  const firstLine = (s.split("\n")[0] || s).trim();
  const firstSentence = firstLine.split(/(?<=\.)\s+/)[0];
  if (firstSentence && firstSentence.length >= 6) s = firstSentence.trim();
  else s = firstLine;

  // Trim trailing site names like " | TikTok"
  s = s.replace(/\s*[|–-]\s*(TikTok|YouTube|Instagram|Pinterest|Allrecipes|Food\s*Network|NYT\s*Cooking).*/i, "");

  // Remove a dangling single period, e.g. "Title ."
  s = s.replace(/\s*\.$/, "");

  // Normalize dashes and spaces
  s = s.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  return s;
}

/** Decide if a TikTok-ish title is junk */
function isTikTokJunkTitle(s?: string | null) {
  const t = (s || "").toLowerCase().trim();
  if (!t) return true;
  if (t === "tiktok") return true;
  if (t === "make your day") return true;
  if (t === "tiktok - make your day" || t === "tiktok | make your day") return true;
  if (t.includes("tiktok") && t.includes("make your day")) return true;
  return false;
}

/** Decide if current title is too weak to keep */
function isWeakTitle(t?: string | null) {
  const s = (t || "").trim();
  if (!s) return true;
  if (isTikTokJunkTitle(s)) return true;
  const lower = s.toLowerCase();
  if (lower === "food network" || lower === "allrecipes" || lower === "youtube") return true;
  if (s.length < 4) return true;
  if (/^\d{6,}$/.test(s)) return true;
  // If it starts directly with "Ingredients:" it's not a real title
  if (/^\s*ingredients?:/i.test(s)) return true;
  return false;
}

// 🧠 Find "Ingredients" and "Steps" inside one long TikTok caption
function sectionizeCaption(raw: string) {
  const s = (raw || "").replace(/\r/g, "\n");
  const low = s.toLowerCase();
  // find anchors
  const iIdx = low.search(/\bingredients?\b/);
  const sIdx = low.search(/\b(steps?|directions?|method)\b/);

  let ing = "", steps = "", before = s.trim();

  if (iIdx >= 0 && sIdx >= 0) {
    if (iIdx < sIdx) {
      ing = s.slice(iIdx, sIdx);
      steps = s.slice(sIdx);
    } else {
      steps = s.slice(sIdx, iIdx);
      ing = s.slice(iIdx);
    }
  } else if (iIdx >= 0) {
    ing = s.slice(iIdx);
  } else if (sIdx >= 0) {
    steps = s.slice(sIdx);
  }

  if (!ing && !steps) return { before, ing: "", steps: "" };
  return { before: s.slice(0, Math.min(...[iIdx, sIdx].filter(x => x >= 0))).trim(), ing, steps };
}

// 🔪 Turn “Ingredients 1 lb chicken 1 cup panko …” into line items
function explodeIngredientsBlock(block: string) {
  if (!block) return "";

  let txt = block
    .replace(/^\s*ingredients?:?/i, "")    // drop the heading
    .replace(/[\u2022\u25CF\u25CB]/g, "•") // normalize bullets
    .replace(/\s{2,}/g, " ")
    .trim();

  // rule A: split on explicit bullets
  txt = txt.replace(/\s*•\s*/g, "\n• ");

  // rule B: split on ", " or "; " **when** there's a quantity/unit before it
  txt = txt.replace(
    /(\d+(?:\.\d+)?|[¼-¾½])\s*(?:cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|liter|litre|clove|cloves|egg|eggs|stick|sticks)\b\s*[,;]\s*/gi,
    "$&\n"
  );

  // rule C: split when a new quantity+unit appears without punctuation
  txt = txt.replace(
    /\s(?=(\d+(?:\/\d+)?(?:\.\d+)?|[¼-¾½])\s*(?:cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|liter|litre|clove|cloves|egg|eggs|stick|sticks)\b)/gi,
    "\n"
  );

  const lines = txt
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[-*•]/.test(l) ? l : `• ${l}`));

  return ["Ingredients:", ...lines].join("\n");
}

// 🔧 Turn “Steps 1. Mix 2. Bake …” into numbered lines
function explodeStepsBlock(block: string) {
  if (!block) return "";

  let txt = block
    .replace(/^\s*(steps?|directions?|method):?/i, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

  // split on “1.” “2)” “3 -” etc
  txt = txt.replace(/(?:\s*)(\d+)[\.\)\-]\s*/g, "\n$1. ");
  // also split on bullets
  txt = txt.replace(/\s*•\s*/g, "\n• ");

  const lines = txt
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => (/^\d+\./.test(l) ? l : `${i + 1}. ${l}`));

  return ["Steps:", ...lines].join("\n");
}

// 🧪 Build a recipe-looking text purely from CAPTION
function captionToRecipeText(caption: string) {
  const { before, ing, steps } = sectionizeCaption(caption);
  const ingBlock = explodeIngredientsBlock(ing);
  const stepBlock = explodeStepsBlock(steps);
  const beforeBlock = before ? `Title/Captions:\n${before.trim()}` : "";
  return [beforeBlock, ingBlock, stepBlock].filter(Boolean).join("\n\n").trim();
}

async function fetchWithUA(url: string, ms = 7000, as: "json" | "text" = "text"): Promise<any> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Accept": as === "json" ? "application/json,*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  const res = (await withTimeout(fetch(url, { headers }), ms)) as unknown as Response;
  if (!res.ok) throw new Error(`http ${res.status}`);
  return as === "json" ? res.json() : res.text();
}
async function getTikTokOEmbedTitle(url: string): Promise<string | null> {
  try {
    const j: any = await fetchWithUA(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, 7000, "json");
    const t = j?.title && String(j.title).trim();
    return t && !isTikTokJunkTitle(t) ? t : null;
  } catch { return null; }
}

// -------------- image helpers --------------
function absolutizeImageUrl(candidate: string, pageUrl: string): string | null {
  if (!candidate) return null;
  try {
    if (candidate.startsWith("//")) return "https:" + candidate;
    if (candidate.startsWith("data:")) return null;
    if (/^https?:\/\//i.test(candidate)) return candidate;
    if (candidate.startsWith("/")) {
      const u = new URL(ensureHttps(pageUrl));
      return `${u.protocol}//${u.host}${candidate}`;
    }
    const base = new URL(ensureHttps(pageUrl));
    return new URL(candidate, base).toString();
  } catch { return null; }
}
async function getAnyImageFromPage(url: string): Promise<string | null> {
  try {
    const html = await fetchWithUA(url, 12000, "text");
    const og = extractMetaContent(html, "og:image") || extractMetaContent(html, "twitter:image");
    if (og) return absolutizeImageUrl(og, url);
    return null;
  } catch {
    return null;
  }
}
async function getLocalDimensions(uri: string): Promise<{ w: number; h: number }> {
  try { const r = await ImageManipulator.manipulateAsync(uri, [], { compress: 0, format: ImageManipulator.SaveFormat.JPEG }); return { w: r.width ?? 0, h: r.height ?? 0 }; }
  catch { return { w: 0, h: 0 }; }
}
async function ensureMinLocalImage(uri: string): Promise<string | null> {
  const { w, h } = await getLocalDimensions(uri);
  if (!w || !h) return null;
  if (w >= MIN_IMG_W && h >= MIN_IMG_H) return uri;
  if (w >= SOFT_MIN_W && h >= SOFT_MIN_H) {
    const scale = Math.max(MIN_IMG_W / w, MIN_IMG_H / h);
    const newW = Math.round(w * scale), newH = Math.round(h * scale);
    try {
      const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: newW, height: newH } }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      return out.uri || null;
    } catch { return null; }
  }
  return null;
}
async function downloadRemoteToLocalImage(url: string, referer?: string): Promise<string | null> {
  const stripQuery = (u: string) => { try { const x = new URL(u); x.search = ""; return x.toString(); } catch { return u; } };
  const candidates: string[] = [url, stripQuery(url)];
  const origin = (() => { try { return referer ? new URL(referer).origin : undefined; } catch { return undefined; } })();
  const headerSets: Record<string, string>[] = [
    { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15", "Accept": "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8", ...(referer ? { Referer: referer } : {}), ...(origin ? { Origin: origin } : {}) },
    { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "image/*,*/*;q=0.8" },
  ];
  for (const cand of candidates) {
    for (const headers of headerSets) {
      const dst = FileSystem.cacheDirectory + `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.img`;
      try {
        const res = await FileSystem.downloadAsync(cand, dst, { headers });
        if (res.status >= 200 && res.status < 300) {
          const out = await ImageManipulator.manipulateAsync(res.uri, [], { compress: 0.96, format: ImageManipulator.SaveFormat.JPEG });
          const ok = await ensureMinLocalImage(out.uri);
          return ok || out.uri;
        }
      } catch {}
      try { await FileSystem.deleteAsync(dst, { idempotent: true }); } catch {}
    }
  }
  return null;
}

// -------------- OCR --------------
async function ocrImageToText(localUri: string): Promise<string | null> {
  try {
    const prepped = await ImageManipulator.manipulateAsync(localUri, [], { compress: 0.96, format: ImageManipulator.SaveFormat.JPEG });
    const path = `ocr/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    let publicUrl: string | null = null;
    try { publicUrl = await uploadFromUri({ uri: prepped.uri, storageBucket: "tmp-uploads", path, contentType: "image/jpeg" }); }
    catch { publicUrl = null; }
    if (!publicUrl) return null;
    const { data, error } = await (supabase as any).functions.invoke("ocr", { body: { url: publicUrl } });
    if (error) return null;
    const text = (data && (data.text || data.ocr || data.result)) ? String(data.text || data.ocr || data.result) : "";
    return text.trim() || null;
  } catch { return null; }
}

// -------------- NEW: comment scoring & fusion --------------
// 🧠 score how “ingredienty/stepy” a comment looks
function scoreRecipeComment(s: string) {
  let sc = 0;
  const low = s.toLowerCase();
  if (/ingredients?|what you need|for the (?:dough|sauce|filling)|shopping list/.test(low)) sc += 600;
  if (/directions?|steps?|method|how to/.test(low)) sc += 320;
  if (/[0-9½¼¾]/.test(s)) sc += 160;
  if (/(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|liter|litre)/i.test(s)) sc += 220;
  if (/^(\s*[-*•]|\s*\d+\.)/m.test(s)) sc += 120;
  const lines = s.split(/\r?\n/).length; sc += Math.min(lines, 40) * 6;
  const L = s.length; if (L > 80) sc += 40; if (L > 240) sc += 30; if (L > 900) sc -= 120;
  return sc;
}
// 🚿 clean up comments (strip “log in/open app” cruft)
function isJunkComment(s: string) {
  const low = s.toLowerCase();
  if (low.length < 8) return true;
  return /log\s*in|sign\s*in|open app|download|scan the qr|p_search_score|search_video/.test(low);
}
function normalizeLines(s: string) {
  // turn inline “1) mix 2) bake” into newline list, keep bullets
  let t = s
    .replace(/\r/g, "\n")
    .replace(/[\u2022\u25CF\u25CB]/g, "•")
    .replace(/(?:\s*[,;]\s*)(?=(?:\d+[\.)]|[-*•]))/g, "\n")
    .replace(/(\d+)[\)\.]\s*/g, "$1. ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t;
}
// 🍱 build a “recipe-like” text from caption + top comments
function fuseCaptionAndComments(caption: string, comments: string[], topN = 5) {
  const good = comments.filter((c) => c && !isJunkComment(c)).map((c) => normalizeLines(c));
  const ranked = good.sort((a, b) => scoreRecipeComment(b) - scoreRecipeComment(a));
  const picked = ranked.slice(0, Math.min(topN, ranked.length));
  // separate likely ingredients from likely steps
  const ing: string[] = [], stp: string[] = [];
  for (const c of picked) {
    const lower = c.toLowerCase();
    const looksIng = /ingredients?|what you need|cups?|tsp|tbsp|oz|gram|ml|^[-*•]|\d+\s*(?:cup|tsp|tbsp|oz|g|ml)/im.test(lower);
    const looksSteps = /steps?|directions?|method|\d+\./im.test(lower);
    if (looksIng && !looksSteps) ing.push(c);
    else if (looksSteps && !looksIng) stp.push(c);
    else {
      // ambiguous: send to bucket with better score bias
      (scoreRecipeComment(c) >= 400 ? ing : stp).push(c);
    }
  }

  const cap = (caption || "").trim();
  const capBlock = cap ? `Title/Captions:\n${normalizeLines(cap)}\n` : "";

  const glue = [
    capBlock,
    ing.length ? `Ingredients:\n${ing.join("\n")}` : "",
    stp.length ? `\n\nSteps:\n${stp.join("\n")}` : "",
  ].filter(Boolean).join("\n");

  // last polish: ensure each list item is on its own line
  return normalizeLines(glue);
}

// -------------- screen state --------------
type ImageSourceState =
  | { kind: "none" }
  | { kind: "url-og"; url: string; resolvedImageUrl: string }
  | { kind: "picker"; localUri: string }
  | { kind: "camera"; localUri: string };

export default function CaptureScreen() {
  const [debugLog, setDebugLog] = useState<string>("");
  const [showDebug, setShowDebug] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const [title, setTitle] = useState("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState<string[]>([""]);
  const [steps, setSteps] = useState<string[]>([""]);
  const [img, setImg] = useState<ImageSourceState>({ kind: "none" });

  const dbg = useCallback((...args: any[]) => {
    try {
      const line = args.map((a) => typeof a === "string" ? a : (()=>{ try { return JSON.stringify(a); } catch { return String(a); } })()).join(" ");
      setDebugLog((prev) => (prev ? prev + "\n" : "") + line);
      console.log("[IMPORT]", line);
    } catch {}
  }, []);
  const safeErr = useCallback((e: any): string => {
    try {
      if (!e) return "unknown";
      if (typeof e === "string") return e;
      if (e instanceof Error && e.message) return e.message;
      const msg = (e?.message || e?.toString?.() || JSON.stringify(e));
      return typeof msg === "string" ? msg : "unknown";
    } catch { return "unknown"; }
  }, []);

  const [hudVisible, setHudVisible] = useState(false);
  const [hudPhase, setHudPhase] = useState<"scanning" | "acquired">("scanning");
  const IMPORT_STEPS = ["Importing photo", "Reading content", "Parsing ingredients", "Parsing steps"];
  const [stageIndex, setStageIndex] = useState(0);
  const bumpStage = useCallback((n: number) => setStageIndex((s) => (n > s ? n : s)), []);
  const [saving, setSaving] = useState(false);

  const [snapVisible, setSnapVisible] = useState(false);
  const [snapUrl, setSnapUrl] = useState("");
  const [snapReloadKey, setSnapReloadKey] = useState(0);
  const [snapResnapKey, setSnapResnapKey] = useState(0);
  const [improvingSnap, setImprovingSnap] = useState(false);
  const [tiktokShots, setTikTokShots] = useState<string[]>([]);

  const [domScraperVisible, setDomScraperVisible] = useState(false);
  const [domScraperUrl, setDomScraperUrl] = useState("");
  const domScraperResolverRef = useRef<((payload: any) => void) | null>(null);

  const [snapFocusY, setSnapFocusY] = useState(FOCUS_Y_DEFAULT);
  const [snapZoom, setSnapZoom] = useState(1.2);

  const [pendingImportUrl, setPendingImportUrl] = useState<string | null>(null);
  const [abortVisible, setAbortVisible] = useState(false);
  const [okModalVisible, setOkModalVisible] = useState(false);

  const snapResolverRef = useRef<null | ((uri: string) => void)>(null);
  const snapRejectRef = useRef<null | ((e: any) => void)>(null);
  const snapCancelledRef = useRef(false);
  const importRunIdRef = useRef(0);
  const gotSomethingForRunRef = useRef(false);
  const lastResolvedUrlRef = useRef<string>("");
  const lastGoodPreviewRef = useRef<string>("");

  const { sharedUrl: sharedParam } = useLocalSearchParams<{ sharedUrl?: string | string[] }>();
  const sharedRaw = useMemo(() => (Array.isArray(sharedParam) ? sharedParam[0] : sharedParam) || "", [sharedParam]);

  useEffect(() => {
    if (sharedRaw && /^https?:\/\//i.test(sharedRaw)) {
      setPastedUrl((prev) => (prev?.trim() ? prev : sharedRaw.trim()));
      setTimeout(() => { resolveOg(); }, 0);
    }
  }, [sharedRaw]);

  const getImageDims = useCallback(async (uri: string) => {
    if (!uri) return { w: 0, h: 0 };
    if (uri.startsWith("file://")) return await getLocalDimensions(uri);
    return await new Promise<{ w: number; h: number }>((ok) => RNImage.getSize(uri, (w, h) => ok({ w, h }), () => ok({ w: 0, h: 0 })));
  }, []);
  const validateOrRepairLocal = useCallback(async (uri: string): Promise<string | null> => {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || (info.size ?? 0) < MIN_LOCAL_BYTES) {
        const resaved = await ImageManipulator.manipulateAsync(uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }).catch(() => null);
        if (resaved?.uri) uri = resaved.uri; else return null;
      }
    } catch { return null; }
    return await ensureMinLocalImage(uri);
  }, []);
  const isValidCandidate = useCallback(async (uri: string): Promise<{ ok: boolean; useUri?: string }> => {
    if (!uri) return { ok: false };
    if (uri.startsWith("file://")) {
      const fixed = await validateOrRepairLocal(uri);
      if (!fixed) return { ok: false };
      const { w, h } = await getImageDims(fixed);
      if (w < MIN_IMG_W || h < MIN_IMG_H) return { ok: false };
      return { ok: true, useUri: fixed };
    } else {
      try { await withTimeout(RNImage.prefetch(uri), 1800).catch(() => null); } catch {}
      const { w, h } = await getImageDims(uri);
      if ((w >= MIN_IMG_W && h >= MIN_IMG_H) || (w === 0 && h === 0)) return { ok: true, useUri: uri };
      try {
        const dl = await FileSystem.downloadAsync(uri, FileSystem.cacheDirectory + `snap_${Date.now()}.jpg`);
        const fixed = await validateOrRepairLocal(dl.uri);
        if (fixed) return { ok: true, useUri: fixed };
      } catch {}
      return { ok: false };
    }
  }, [getImageDims, validateOrRepairLocal]);

  const currentPreviewUri = useCallback(() => {
    if (img.kind === "url-og") return img.resolvedImageUrl;
    if (img.kind === "picker" || img.kind === "camera") return img.localUri;
    return "";
  }, [img]);
  const setGoodPreview = useCallback((uri: string, originUrl: string) => {
    bumpStage(1);
    if (uri.startsWith("http")) setImg({ kind: "url-og", url: originUrl, resolvedImageUrl: uri });
    else setImg({ kind: "picker", localUri: uri });
    lastGoodPreviewRef.current = uri;
    lastResolvedUrlRef.current = originUrl;
    gotSomethingForRunRef.current = true;
  }, [bumpStage]);

  const hardResetImport = useCallback(() => {
    snapCancelledRef.current = false;
    snapResolverRef.current = null;
    snapRejectRef.current = null;
    setHudVisible(false);
    setHudPhase("scanning");
    setSnapVisible(false);
    setDomScraperVisible(false);
    setImprovingSnap(false);
    setTikTokShots([]);
    setAbortVisible(false);
    setStageIndex(0);
  }, []);

  useEffect(() => {
    if (hudVisible && pendingImportUrl) {
      const url = pendingImportUrl;
      setPendingImportUrl(null);
      (async () => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await startImport(url);
      })();
    }
  }, [hudVisible, pendingImportUrl]);

  // 🧲 HUD “z-index key” — we bump this whenever a helper modal opens,
  // so the HUD remounts LAST and stays on top like a blanket.
  const [hudZKey, setHudZKey] = useState(0);
  const bringHudToFront = useCallback(() => setHudZKey((k) => k + 1), []);

  // 🔍 open tiny web window to read caption + comments
  // ❗️FIX: DO NOT convert to /embed. Open the real page to expose SIGI/NEXT JSON and allow “see more” clicks.
  const scrapeTikTokDom = useCallback(async (rawUrl: string): Promise<{
    text?: string; caption?: string; comments?: string[]; bestComment?: string; debug?: string;
  } | null> => {
    // 1) follow any short link (vm.tiktok.com)
    const finalUrl = await resolveFinalUrl(ensureHttps(rawUrl.trim()));
    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; setDomScraperVisible(false); resolve(null); }
      }, 16000);
      // 2) open the full **desktop** page; TTDomScraper will handle viewports and "see more" clicks.
      setDomScraperUrl(finalUrl);
      setDomScraperVisible(true);
      bringHudToFront(); // 🧒 tell the HUD to hop back on top
      domScraperResolverRef.current = (payload: any) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          setDomScraperVisible(false);
          resolve(payload || null);
        }
      };
    });
  }, [bringHudToFront]);

  // 📸 snap TikTok for preview/OCR (embed is ok for a *picture*)
  const autoSnapTikTok = useCallback(async (rawUrl: string, maxAttempts = SNAP_ATTEMPTS) => {
    const { embedUrl, finalUrl } = await resolveTikTokEmbedUrl(rawUrl);
    const target = embedUrl || ensureHttps(rawUrl);
    lastResolvedUrlRef.current = finalUrl || rawUrl;

    snapCancelledRef.current = false;
    setSnapUrl(target);
    setSnapVisible(true);
    bringHudToFront(); // 🧒 HUD back on top when the snapper opens
    setImprovingSnap(true);

    let best: string | null = null;
    for (let i = 1; i <= maxAttempts; i++) {
      if (snapCancelledRef.current) break;
      if (i === 1) setSnapReloadKey((k) => k + 1); else setSnapResnapKey((k) => k + 1);

      const attemptPromise: Promise<string | null> = new Promise((resolve, reject) => {
        snapResolverRef.current = (uri) => resolve(uri);
        snapRejectRef.current = (e) => reject(e);
      }).then((u) => u as string).catch(() => null);

      const timeoutMs = i === 1 ? ATTEMPT_TIMEOUT_FIRST_MS : ATTEMPT_TIMEOUT_SOFT_MS;
      const winner = await Promise.race([attemptPromise, new Promise<string | null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);

      if (winner) {
        gotSomethingForRunRef.current = true;
        const fixed = await validateOrRepairLocal(winner);
        if (fixed) {
          const dims = await getImageDims(fixed);
          if (dims.w >= MIN_IMG_W && dims.h >= MIN_IMG_H) { setGoodPreview(fixed, lastResolvedUrlRef.current); best = fixed; break; }
        }
        const test = await isValidCandidate(winner);
        if (test.ok && test.useUri) { setGoodPreview(test.useUri, lastResolvedUrlRef.current); best = test.useUri; break; }
      }
      if (snapCancelledRef.current) break;
      await new Promise((r) => setTimeout(r, BETWEEN_SHOTS_MS));
    }

    setImprovingSnap(false);
    setTikTokShots([]);
    return best;
  }, [getImageDims, setGoodPreview, validateOrRepairLocal, isValidCandidate, bringHudToFront]);

  const tryImageUrl = useCallback(async (rawUrl: string, originUrl: string) => {
    const absolute = absolutizeImageUrl(rawUrl, originUrl);
    if (!absolute) return false;
    const test = await isValidCandidate(absolute);
    if (test.ok && test.useUri) {
      bumpStage(1);
      if (test.useUri.startsWith("http")) setImg({ kind: "url-og", url: originUrl, resolvedImageUrl: test.useUri });
      else setImg({ kind: "picker", localUri: test.useUri });
      lastGoodPreviewRef.current = test.useUri;
      lastResolvedUrlRef.current = originUrl;
      gotSomethingForRunRef.current = true;
      return true;
    }
    return false;
  }, [isValidCandidate, bumpStage]);

  // ----------------- THE BOSS: unified import -----------------
  const startImport = useCallback(async (url: string) => {
    const runId = ++importRunIdRef.current;
    gotSomethingForRunRef.current = false;

    const watchdog = setTimeout(() => {
      if (importRunIdRef.current !== runId) return;
      if (!gotSomethingForRunRef.current) {
        hardResetImport();
        Alert.alert("Import took too long", "We tried our best. You can try again.");
      }
    }, IMPORT_HARD_TIMEOUT_MS);

    let success = false;
    try {
      lastResolvedUrlRef.current = url;

      // STEP 0: try oEmbed title
      try {
        const best = await getTikTokOEmbedTitle(url);
        if (best && isWeakTitle(title)) setTitle(cleanTitle(best, url));
        dbg("🪪 STEP 0 oEmbed title:", best ? "got" : "none");
      } catch (e) { dbg("⚠️ STEP 0 oEmbed title failed:", safeErr(e)); }

      if (isTikTokLike(url)) {
        dbg("🎯 TikTok detected — unified import path begins");

        // STEP 1: DOM scrape
        let domPayload: { text?: string; caption?: string; comments?: string[]; bestComment?: string; debug?: string } | null = null;
        try {
          bumpStage(1);
          domPayload = await scrapeTikTokDom(url);
          const len = (domPayload?.text || "").length;
          dbg("📄 STEP 1 DOM payload. text length:", len, "comments:", domPayload?.comments?.length || 0);
          // 👇 extra trace to know where it came from and if “see more” was clicked
          if (domPayload?.debug) dbg("🧪 TTDOM DEBUG:", domPayload.debug);
        
          // 👉 NEW: try to set a nice title from the TikTok caption if ours is weak
          try {
            const capTitle = captionToNiceTitle(domPayload?.caption || "");
            if (capTitle && isWeakTitle(title)) {
              setTitle(cleanTitle(capTitle, url));
              dbg("🪪 TITLE from caption:", capTitle);
            }
          } catch {}
} catch (e) { dbg("❌ STEP 1 (DOM scraper) failed:", safeErr(e)); }

        // STEP 2: PARSE — caption first (photos often hold full recipe here)
        try {
          const cap = (domPayload?.caption || "").trim();
          const comments = (domPayload?.comments || []).map((s) => s.trim()).filter(Boolean);

          // A) build clean recipe text from CAPTION
          const capRecipe = captionToRecipeText(cap);

          // B) parse caption text
          let parsed = parseRecipeText(capRecipe);
          dbg("📊 STEP 2A parse(CAPTION) conf:", parsed.confidence, "ing:", parsed.ingredients.length, "steps:", parsed.steps.length);

          // C) if still weak, fuse top comments and reparse
          if ((parsed.ingredients.length < 3 || parsed.steps.length < 1) && comments.length) {
            const fusion = fuseCaptionAndComments(cap, comments, 5);
            const parsed2 = parseRecipeText(fusion);
            dbg("📊 STEP 2B parse(CAPTION+COMMENTS) conf:", parsed2.confidence, "ing:", parsed2.ingredients.length, "steps:", parsed2.steps.length);
            if ((parsed2.ingredients.length + parsed2.steps.length) > (parsed.ingredients.length + parsed.steps.length)) {
              parsed = parsed2;
            }
          }

          if (parsed.ingredients.length >= 2 || parsed.steps.length >= 1) {
            if (parsed.ingredients.length) setIngredients(parsed.ingredients);
            if (parsed.steps.length) setSteps(parsed.steps);
            bumpStage(2);
            dbg("✅ STEP 2 caption-based parse worked");
            success = true;
          } else {
            dbg("ℹ️ STEP 2 caption parse still weak; will try OCR next");
          }
        } catch (e) {
          dbg("❌ STEP 2 (parse) failed:", safeErr(e));
        }

        // STEP 3: OCR fallback
        try {
          if (!success || (ingredients.every(v => !v.trim()))) {
            bumpStage(2);
            dbg("📸 STEP 3 trying screenshot + OCR");
            const shot = await autoSnapTikTok(url, 2);
            if (shot) {
              const ocrText = await ocrImageToText(shot);
              dbg("🔍 STEP 3 OCR text length:", ocrText ? ocrText.length : 0);
              if (ocrText && ocrText.length > 50) {
                const parsed = parseRecipeText(ocrText);
                dbg("📊 STEP 3 OCR parse conf:", parsed.confidence, "ing:", parsed.ingredients.length, "steps:", parsed.steps.length);
                if (parsed.ingredients.length >= 2 || parsed.steps.length >= 1) {
                  if (ingredients.every(v => !v.trim()) && parsed.ingredients.length) setIngredients(parsed.ingredients);
                  if (steps.every(v => !v.trim()) && parsed.steps.length) setSteps(parsed.steps);
                  bumpStage(3);
                  dbg("✅ STEP 3 OCR gave usable content");
                  success = true;
                }
              }
            }
          }
        } catch (e) { dbg("⚠️ STEP 3 (OCR) failed:", safeErr(e)); }

        // STEP 4: OG/Meta as last resort for text
        try {
          if (!success || ingredients.every(v => !v.trim())) {
            bumpStage(3);
            dbg("🌐 STEP 4 trying OG/Meta description");
            const og = await fetchOgForUrl(url);
            if (og?.description) {
              const parsed = parseRecipeText(og.description);
              dbg("📊 STEP 4 OG parse ing:", parsed.ingredients.length, "steps:", parsed.steps.length);
              if (parsed.ingredients.length >= 2 || parsed.steps.length >= 1) {
                if (ingredients.every(v => !v.trim()) && parsed.ingredients.length) setIngredients(parsed.ingredients);
                if (steps.every(v => !v.trim()) && parsed.steps.length) setSteps(parsed.steps);
                dbg("✅ STEP 4 got usable content from OG description");
                success = true;
              }
            }
          }
        } catch (e) { dbg("⚠️ STEP 4 (OG/Meta) failed:", safeErr(e)); }

        // STEP 5: image preview fallback
        try {
          bumpStage(4);
          if (!gotSomethingForRunRef.current) {
            const imgUrl = await getAnyImageFromPage(url);
            if (imgUrl) await tryImageUrl(imgUrl, url);
            dbg("🖼️ STEP 5 image fallback:", !!imgUrl);
          }
        } catch (e) { dbg("⚠️ STEP 5 (image fallback) failed:", safeErr(e)); }

      } else {
        // non-TikTok path
        const og = await fetchOgForUrl(url);
        if (og?.title && isWeakTitle(title)) setTitle(cleanTitle(og.title, url));
        if (og?.image) await tryImageUrl(og.image, url);
      }

    } catch (e: any) {
      const msg = safeErr(e);
      dbg("❌ Import error:", msg);
      if (!gotSomethingForRunRef.current) setImg({ kind: "none" });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Import error", msg || "Could not read that webpage.");
    } finally {
      clearTimeout(watchdog);
      if (success || gotSomethingForRunRef.current) {
        setHudPhase("acquired");
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await new Promise((r) => setTimeout(r, 800));
      }
      setHudVisible(false);
      setDomScraperVisible(false);
      setSnapVisible(false);
    }
  }, [title, autoSnapTikTok, scrapeTikTokDom, tryImageUrl, ingredients, steps, dbg, safeErr, bumpStage, hardResetImport]);

  // -------------- import button flow --------------
  const resolveOg = useCallback(async () => {
    hardResetImport();
    const candidateInput = (pastedUrl?.trim() || "") || (sharedRaw?.trim() || "");
    const url = extractFirstUrl(candidateInput);
    if (!url || !/^https?:\/\//i.test(url)) {
      setImg({ kind: "none" });
      return Alert.alert("Link error", "Please paste a full link that starts with http(s)://");
    }
    const isDup = await checkDuplicateSourceUrl(url);
    if (isDup) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAbortVisible(true);
      setTimeout(() => setAbortVisible(false), 1700);
      return;
    }
    setStageIndex(0);
    setHudPhase("scanning");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHudVisible(true);
    setPendingImportUrl(url);
  }, [pastedUrl, sharedRaw, hardResetImport]);

  const onPaste = useCallback(async () => {
    const t = await Clipboard.getStringAsync();
    if (t) setPastedUrl(t.trim());
  }, []);

  const pickOrCamera = useCallback(async () => {
    Alert.alert("Add Photo", "Choose where to get your picture", [
      { text: "Camera", onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") return Alert.alert("Camera permission is required.");
          const r = await ImagePicker.launchCameraAsync({ quality: 0.92, allowsEditing: true, aspect: [4, 3] });
          if (!r.canceled && r.assets?.[0]?.uri) setImg({ kind: "camera", localUri: r.assets[0].uri });
        } },
      { text: "Gallery", onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") return Alert.alert("Photo permission is required.");
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.92, allowsEditing: true, aspect: [4, 3] });
          if (!r.canceled && r.assets?.[0]?.uri) setImg({ kind: "picker", localUri: r.assets[0].uri });
        } },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  const previewUri = useMemo(() => currentPreviewUri(), [currentPreviewUri]);

  const onSave = useCallback(async () => {
    if (!title.trim()) return Alert.alert("Please add a title");
    setSaving(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const cleanedSourceUrl = lastResolvedUrlRef.current ? canonicalizeUrl(lastResolvedUrlRef.current) : null;

      const { data: created, error: createErr } = await supabase
        .from("recipes")
        .insert({ title: title.trim(), minutes: timeMinutes ? Number(timeMinutes) : null, servings: servings ? Number(servings) : null, source_url: cleanedSourceUrl })
        .select("id")
        .single();

      if (createErr) throw createErr;
      const recipeId = created?.id as string;
      if (!recipeId) throw new Error("Could not create recipe.");

      let uploadUri = previewUri;
      if (uploadUri && uploadUri.startsWith("http")) {
        const local = await downloadRemoteToLocalImage(uploadUri, lastResolvedUrlRef.current || undefined);
        if (!local) throw new Error("Failed to download remote image");
        uploadUri = local;
      }

      if (uploadUri) {
        const path = `recipes/${recipeId}/images/${Date.now()}.jpg`;
        const publicUrl = await uploadFromUri({ uri: uploadUri, storageBucket: "recipe-images", path, contentType: "image/jpeg" });
        await supabase.from("recipes").update({ image_url: publicUrl }).eq("id", recipeId);
      }

      const ing = ingredients.map((s) => (s || "").trim()).filter(Boolean);
      if (ing.length) {
        await supabase.from("recipe_ingredients").insert(
          ing.map((text, i) => ({ recipe_id: recipeId, pos: i + 1, text }))
        );
      }

      const stp = steps.map((s) => (s || "").trim()).filter(Boolean);
      if (stp.length) {
        await supabase.from("recipe_steps").insert(
          stp.map((text, i) => ({ recipe_id: recipeId, pos: i + 1, text, seconds: null }))
        );
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOkModalVisible(true);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Save failed", e?.message ?? "Please try again.");
    } finally { setSaving(false); }
  }, [title, timeMinutes, servings, ingredients, steps, previewUri]);

  const renderRightActions = (onDelete: () => void) => (
    <View style={styles.swipeRightActionContainer}>
      <RectButton onPress={onDelete} style={styles.swipeDeleteButton}>
        <Text style={styles.swipeDeleteText}>Delete</Text>
      </RectButton>
    </View>
  );

  const resetForm = useCallback(() => {
    setPastedUrl(""); setTitle(""); setTimeMinutes(""); setServings("");
    setIngredients([""]); setSteps([""]); setImg({ kind: "none" });
    hardResetImport();
  }, [hardResetImport]);
  useFocusEffect(useCallback(() => { return () => { resetForm(); }; }, [resetForm]));

  // -------------- RENDER --------------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900", marginBottom: 16 }}>Add Recipe</Text>

          <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="My Tasty Pizza" placeholderTextColor="#64748b" style={{ color: "white", backgroundColor: COLORS.sunken, borderRadius: 12, padding: 12, marginBottom: 12 }} />

          <View style={{ backgroundColor: COLORS.card, borderRadius: 14, borderColor: COLORS.border, borderWidth: 1, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Import from a link (YouTube/TikTok/blog)…</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TextInput
                value={pastedUrl}
                onChangeText={setPastedUrl}
                placeholder="Paste page URL…"
                placeholderTextColor={COLORS.sub}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ flex: 1, color: COLORS.text, backgroundColor: COLORS.sunken, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginRight: 8 }}
              />
              <TouchableOpacity onPress={onPaste} disabled={hudVisible} style={{ backgroundColor: COLORS.sunken, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginRight: 8, opacity: hudVisible ? 0.6 : 1 }}>
                <Text style={{ color: COLORS.text, fontWeight: "600" }}>Paste</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={resolveOg} disabled={hudVisible} style={{ backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, opacity: hudVisible ? 0.6 : 1 }}>
                <Text style={{ color: "#0B1120", fontWeight: "700" }}>{hudVisible ? "Importing…" : "Import"}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setShowDebug((v)=>!v)} style={{ marginTop: 8, alignSelf: "flex-end" }}>
              <Text style={{ color: COLORS.sub, textDecorationLine: "underline" }}>{showDebug ? "Hide debug" : "Show debug"}</Text>
            </TouchableOpacity>
            {showDebug && (
              <View style={{ marginTop: 8, backgroundColor: "#0f172a", borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, padding: 8 }}>
                <Text style={{ color: "#94a3b8", fontSize: 12 }} selectable numberOfLines={16}>{debugLog || "No debug yet."}</Text>
              </View>
            )}

            <View style={{ marginTop: 10 }}>
              {(() => {
                const uri = currentPreviewUri();
                return uri ? (
                  <>
                    <Image source={{ uri }} style={{ width: "100%", height: 220, borderRadius: 12 }} contentFit="cover" />
                    {improvingSnap && <Text style={{ color: COLORS.sub, marginTop: 6, textAlign: "center" }}>Improving image…</Text>}
                  </>
                ) : (
                  <View style={{ height: 220, borderRadius: 12, backgroundColor: COLORS.sunken, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: COLORS.sub }}>No imported image yet</Text>
                  </View>
                );
              })()}
            </View>
          </View>

          <TouchableOpacity onPress={pickOrCamera} style={{ backgroundColor: COLORS.card, padding: 12, borderRadius: 12, alignItems: "center", marginBottom: 12 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>Add/Choose Photo…</Text>
          </TouchableOpacity>

          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>Ingredients</Text>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 }}>
            {ingredients.map((ing, i) => (
              <Swipeable key={`ing-${i}`} renderRightActions={() => renderRightActions(() => setIngredients((a) => a.filter((_, idx) => idx !== i)))} overshootRight={false} friction={2}>
                <View style={styles.row}>
                  <Text style={styles.rowIndex}>{i + 1}.</Text>
                  <TextInput value={ing} onChangeText={(v) => setIngredients((a) => a.map((x, idx) => (idx === i ? v : x)))} placeholder="1 lb sausage…" placeholderTextColor="#64748b" style={styles.rowInput} />
                </View>
                {i !== ingredients.length - 1 && <View style={styles.thinLine} />}
              </Swipeable>
            ))}
          </View>
          <TouchableOpacity onPress={() => setIngredients((a) => [...a, ""])} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center", marginBottom: 16 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Ingredient</Text>
          </TouchableOpacity>

          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>Steps</Text>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 }}>
            {steps.map((st, i) => (
              <Swipeable key={`step-${i}`} renderRightActions={() => renderRightActions(() => setSteps((a) => a.filter((_, idx) => idx !== i)))} overshootRight={false} friction={2}>
                <View style={styles.row}>
                  <Text style={styles.rowIndex}>{i + 1}.</Text>
                  <TextInput value={st} onChangeText={(t) => setSteps((a) => a.map((x, idx) => (idx === i ? t : x)))} placeholder="Brown sausage, then…" placeholderTextColor="#64748b" multiline style={[styles.rowInput, { minHeight: 60 }]} />
                </View>
                {i !== steps.length - 1 && <View style={styles.thinLine} />}
              </Swipeable>
            ))}
          </View>
          <TouchableOpacity onPress={() => setSteps((a) => [...a, ""])} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center", marginBottom: 24 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Step</Text>
          </TouchableOpacity>
        </ScrollView>

        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: COLORS.bg, borderTopWidth: 1, borderColor: COLORS.border }}>
          <TouchableOpacity onPress={onSave} disabled={saving} style={{ backgroundColor: saving ? "#475569" : COLORS.green, paddingVertical: 14, borderRadius: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: saving ? 0.7 : 1 }}>
            {saving && <ActivityIndicator size="small" color="#fff" />}
            <Text style={{ color: "#fff", fontWeight: "800" }}>{saving ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>

        {/* TikTok snapper (embed is fine only for screenshots) */}
        <TikTokSnap
          url={snapUrl}
          visible={snapVisible}
          reloadKey={snapReloadKey}
          resnapKey={snapResnapKey}
          zoom={snapZoom}
          focusY={snapFocusY}
          captureDelayMs={CAPTURE_DELAY_MS}
          onCancel={() => {
            snapCancelledRef.current = true;
            setSnapVisible(false);
            setImprovingSnap(false);
            setTikTokShots([]);
            if (snapRejectRef.current) { snapRejectRef.current(new Error("snap-cancelled")); snapRejectRef.current = null; }
          }}
          onFound={async (uri) => {
            setTikTokShots((prev)=> (prev.includes(uri) ? prev : [...prev, uri]));
            console.log("📸 snap onFound", uri);
            gotSomethingForRunRef.current = true;
            const fixed = await validateOrRepairLocal(uri);
            if (fixed) setGoodPreview(fixed, lastResolvedUrlRef.current);
            else {
              const test = await isValidCandidate(uri);
              if (test.ok && test.useUri) setGoodPreview(test.useUri, lastResolvedUrlRef.current);
            }
          }}
        />

        {/* DOM Scraper — returns caption + comments */}
        <TTDomScraper
          visible={domScraperVisible}
          url={domScraperUrl}
          onClose={() => setDomScraperVisible(false)}
          onResult={(payload) => { domScraperResolverRef.current?.(payload); setDomScraperVisible(false); }}
        />

        {/* HUD — key={hudZKey} means “remount on demand” so it’s ALWAYS on top */}
        <MilitaryImportOverlay
          key={hudZKey}
          visible={hudVisible}
          phase={hudPhase}
          stageIndex={stageIndex}
          steps={IMPORT_STEPS}
          headline="SCANNING… STAND BY"
        />

        {/* duplicate popup */}
        <MissionAbortedPopup visible={abortVisible} onRequestClose={() => setAbortVisible(false)} text="MISSION ABORTED" />

        {/* success dialog */}
        <ThemedDialog visible={okModalVisible} title="Saved!" message="Your recipe is safely stored." onClose={() => setOkModalVisible(false)} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// -------------- styles for list rows --------------
const styles = StyleSheet.create({
  swipeRightActionContainer: { justifyContent: "center", alignItems: "flex-end" },
  swipeDeleteButton: { backgroundColor: COLORS.red, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", minWidth: 88, borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  swipeDeleteText: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 10 },
  rowIndex: { color: COLORS.sub, width: 22, textAlign: "right", marginRight: 6 },
  rowInput: { flex: 1, color: COLORS.text, backgroundColor: COLORS.sunken, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, borderWidth: 1, borderColor: COLORS.border },
  thinLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginHorizontal: 10 },
});

// -------------- HUD + dialogs (unchanged visuals) --------------
function useLoop(duration = 1200, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: duration / 2, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start(); return () => loop.stop();
  }, [v, duration, delay]);
  return v;
}
function useBlipAnims(count: number, baseDelay = 200) {
  const animsRef = useRef<Animated.Value[]>([]);
  if (animsRef.current.length !== count) animsRef.current = Array.from({ length: count }, () => new Animated.Value(0));
  useEffect(() => {
    const loops = animsRef.current.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * baseDelay),
        Animated.timing(v, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 800, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.delay(300),
      ]))
    );
    loops.forEach((l) => l.start()); return () => loops.forEach((l) => l.stop());
  }, [count, baseDelay]);
  return animsRef.current;
}
function useSpin(duration = 1800) {
  const v = useRef<Animated.Value | null>(null);
  if (!v.current) v.current = new Animated.Value(0);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v.current!, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    loop.start(); return () => loop.stop();
  }, [duration]);
  const deg = v.current!.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return { transform: [{ rotate: deg }] } as const;
}
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const RADAR_SIZE = Math.min(SCREEN_W * 0.95, 460);
const BLIP_COUNT = 7;
const HUD_CARD_MIN_H = Math.min(SCREEN_H * 0.86, 760);
type HUDPhase = "scanning" | "acquired";

function MilitaryImportOverlay({
  visible,
  phase = "scanning",
  stageIndex,
  steps = ["Importing photo", "Reading title", "Parsing ingredients", "Parsing steps"],
  headline = "SCANNING… STAND BY"
}: {
  visible: boolean; phase?: HUDPhase; stageIndex: number; steps?: string[]; headline?: string;
}) {
  const spinStyle = useSpin(2000);
  const centerPulse = useLoop(1400, 0);
  const blipAnims = useBlipAnims(BLIP_COUNT, 200);
  const acquiredAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible && phase === "acquired") {
      acquiredAnim.setValue(0);
      Animated.sequence([
        Animated.timing(acquiredAnim, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(acquiredAnim, { toValue: 0, duration: 640, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [visible, phase, acquiredAnim]);
  const acquiredScale = acquiredAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.06] });
  const acquiredOpacity = acquiredAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  if (!visible) return null;
  return (
    <Modal visible animationType="none" transparent statusBarTranslucent presentationStyle="overFullScreen" hardwareAccelerated>
      <View style={hudBackdrop.backdrop}>
        <View style={hudBackdrop.card}>
          <Text style={hudBackdrop.headline}>{phase === "acquired" ? "LOCK CONFIRMED" : headline}</Text>
          <View style={hudBackdrop.radarWrap}>
            <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.48} stroke="rgba(47,174,102,0.18)" strokeWidth={1} fill="none" />
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.34} stroke="rgba(47,174,102,0.18)" strokeWidth={1} fill="none" />
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.20} stroke="rgba(47,174,102,0.18)" strokeWidth={1} fill="none" />
              <Line x1={RADAR_SIZE * 0.1} y1={RADAR_SIZE / 2} x2={RADAR_SIZE * 0.9} y2={RADAR_SIZE / 2} stroke="rgba(47,174,102,0.18)" strokeWidth={1} />
              <Line x1={RADAR_SIZE / 2} y1={RADAR_SIZE * 0.1} x2={RADAR_SIZE / 2} y2={RADAR_SIZE * 0.9} stroke="rgba(47,174,102,0.18)" strokeWidth={1} />
            </Svg>
            <Animated.View style={[hudBackdrop.beamPivot, spinStyle]}>
              <View style={hudBackdrop.beamArm} />
              <View style={hudBackdrop.beamGlow} />
            </Animated.View>
            {Array.from({ length: BLIP_COUNT }).map((_, i) => {
              const r = (RADAR_SIZE / 2) * (0.22 + (i / BLIP_COUNT) * 0.65);
              const theta = (Math.PI * 2 * (i + 1)) / BLIP_COUNT;
              const x = RADAR_SIZE / 2 + r * Math.cos(theta);
              const y = RADAR_SIZE / 2 + r * Math.sin(theta);
              const a = blipAnims[i % blipAnims.length];
              const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.4] });
              const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
              return (<Animated.View key={`blip-${i}`} style={{ position: "absolute", left: x - 6, top: y - 6, width: 12, height: 12, borderRadius: 6, backgroundColor: "rgba(47,174,102,0.9)", opacity, transform: [{ scale }] }} />);
            })}
            <Animated.View style={[hudBackdrop.centerDot, { transform: [{ scale: centerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] }) }] }]} />
            {phase === "acquired" && (
              <Animated.View style={[hudBackdrop.acquiredWrap, { opacity: acquiredOpacity, transform: [{ scale: acquiredScale }] }]}>
                <Text style={hudBackdrop.acquiredText}>TARGET ACQUIRED</Text>
              </Animated.View>
            )}
          </View>
          <View style={hudBackdrop.stepsBox}>
            {steps.map((label, i) => {
              const done = i < stageIndex, active = i === stageIndex;
              return (
                <View key={label} style={hudBackdrop.stepRow}>
                  <View style={[hudBackdrop.checkbox, done && { backgroundColor: "rgba(46,204,113,0.2)", borderColor: MESSHALL_GREEN }, active && { borderColor: "#a7f3d0" }]}>
                    {done ? <Text style={{ color: "#a7f3d0", fontSize: 14, fontWeight: "700" }}>✓</Text> : active ? <Text style={{ color: MESSHALL_GREEN, fontSize: 18, lineHeight: 18 }}>•</Text> : null}
                  </View>
                  <Text style={[hudBackdrop.stepText, done && { color: "#a7f3d0" }, active && { color: "#e2e8f0", fontWeight: "600" }]}>{label}</Text>
                </View>
              );
            })}
          </View>
          <View style={hudBackdrop.progressOuter}><View style={[hudBackdrop.progressInner, { width: `${Math.max(0, Math.min(stageIndex / steps.length, 1)) * 100}%` }]} /></View>
        </View>
      </View>
    </Modal>
  );
}
const hudBackdrop = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: {
    width: "100%",
    maxWidth: 540,
    backgroundColor: COLORS.bg,
    borderRadius: 16,
    padding: 20,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: "rgba(147,197,114,0.15)",
    minHeight: HUD_CARD_MIN_H, // 👈 gives the card extra height
  },
  headline: { color: "#d1fae5", fontSize: 18, textAlign: "center", letterSpacing: 1, marginBottom: 12 },
  radarWrap: {
    alignSelf: "center",
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 16,        // 👈 was marginBottom: 12
    overflow: "hidden",
    borderRadius: RADAR_SIZE / 2,
    backgroundColor: "rgba(20,31,25,0.35)",
  },
  beamPivot: { position: "absolute", left: 0, top: 0, width: RADAR_SIZE, height: RADAR_SIZE },
  beamArm: { position: "absolute", left: RADAR_SIZE / 2, top: RADAR_SIZE / 2 - 1, width: RADAR_SIZE / 2, height: 2, backgroundColor: "rgba(47,174,102,0.9)" },
  beamGlow: { position: "absolute", left: RADAR_SIZE / 2, top: RADAR_SIZE / 2 - 8, width: RADAR_SIZE / 2, height: 16, backgroundColor: "rgba(47,174,102,0.12)" },
  centerDot: { position: "absolute", width: 10, height: 10, borderRadius: 6, backgroundColor: MESSHALL_GREEN },
  acquiredWrap: { position: "absolute", top: "42%", alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)" },
  acquiredText: { color: "#fef08a", fontSize: 22, fontWeight: "900", letterSpacing: 1.2 },
  stepsBox: { backgroundColor: "rgba(46,204,113,0.06)", borderColor: "rgba(46,204,113,0.15)", borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 12 },
  stepRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: "rgba(46,204,113,0.35)", marginRight: 8, alignItems: "center", justifyContent: "center" },
  stepText: { color: "#cbd5e1", fontSize: 14 },
  progressOuter: { height: 10, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(46,204,113,0.1)", borderWidth: 1, borderColor: "rgba(46,204,113,0.2)" },
  progressInner: { height: "100%", backgroundColor: MESSHALL_GREEN },
});

// mini red pill
function MissionAbortedPopup({ visible, text = "MISSION ABORTED", onRequestClose }: { visible: boolean; text?: string; onRequestClose: () => void; }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 180, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.96, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, scale]);
  if (!visible) return null;
  return (
    <Modal transparent statusBarTranslucent animationType="none">
      <TouchableWithoutFeedback onPress={onRequestClose}>
        <View style={abortStyles.backdrop}>
          <Animated.View style={[abortStyles.pillWrap, { opacity, transform: [{ scale }] }]}>
            <Text style={abortStyles.pillText}>{text}</Text>
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
const abortStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 24 },
  pillWrap: { paddingVertical: 14, paddingHorizontal: 24, borderRadius: 999, backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: COLORS.red, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  pillText: { color: COLORS.red, fontSize: 18, fontWeight: "900", letterSpacing: 1.2, textAlign: "center" },
});

// success dialog
function ThemedDialog({
  visible,
  title = "Saved!",
  message = "Your recipe is safely stored.",
  onClose,
}: { visible: boolean; title?: string; message?: string; onClose: () => void; }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 160, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.98, duration: 100, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, scale]);
  if (!visible) return null;
  return (
    <Modal transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <Animated.View style={[dialogStyles.backdrop, { opacity }]}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <Animated.View style={[dialogStyles.card, { transform: [{ scale }] }]}>
              <View style={dialogStyles.checkCircle}><Text style={{ color: "#0B1120", fontWeight: "900", fontSize: 18 }}>✓</Text></View>
              <Text style={dialogStyles.title}>{title}</Text>
              {!!message && <Text style={dialogStyles.message}>{message}</Text>}
              <TouchableOpacity onPress={onClose} style={dialogStyles.okBtn}><Text style={dialogStyles.okText}>OK</Text></TouchableOpacity>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
const dialogStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "92%", maxWidth: 420, backgroundColor: COLORS.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: "rgba(47,174,102,0.25)", shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 12, alignItems: "center" },
  checkCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: MESSHALL_GREEN, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { color: "#e2e8f0", fontSize: 20, fontWeight: "900", marginTop: 2, textAlign: "center" },
  message: { color: "#b6c2d0", fontSize: 14, marginTop: 6, textAlign: "center" },
  okBtn: { marginTop: 14, backgroundColor: MESSHALL_GREEN, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 22 },
  okText: { color: "#0B1120", fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },
});

// -------------- duplicate detection --------------
async function buildDuplicateCandidatesFromRaw(raw: string): Promise<string[]> {
  const ensured = ensureHttps(raw.trim());
  const finalResolved = await resolveFinalUrl(ensured);
  let tiktokFinal = finalResolved;
  if (isTikTokLike(finalResolved)) {
    const { finalUrl } = await resolveTikTokEmbedUrl(finalResolved);
    if (finalUrl) tiktokFinal = finalUrl;
  }
  const candidates = [ensured, finalResolved, tiktokFinal, canonicalizeUrl(ensured), canonicalizeUrl(finalResolved), canonicalizeUrl(tiktokFinal)].filter(Boolean) as string[];
  return Array.from(new Set(candidates));
}
async function checkDuplicateSourceUrl(rawUrl: string): Promise<boolean> {
  try {
    const candidates = await buildDuplicateCandidatesFromRaw(rawUrl);
    if (!candidates.length) return false;
    const { data, error } = await supabase.from("recipes").select("id, title, source_url").in("source_url", candidates).limit(1);
    if (error) return false;
    return !!(data && data.length);
  } catch { return false; }
}
