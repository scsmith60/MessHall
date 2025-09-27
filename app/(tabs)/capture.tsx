// app/(tabs)/capture.tsx
// 🧒 “Like I’m 5” notes:
// You were seeing “Save failed – Failed to download remote image (status 403)”.
// That happens when the image URL (like Food Network’s sndimg.com) blocks
// hot-link downloading during the *save* step.
// Fix: before uploading, if the preview image is a web URL, we quietly
// download it **locally** with a friendly mobile User-Agent + Referer,
// then upload that local file. Everything else stays the same.
//
// I DID NOT remove any of your features (HUD, TikTok, imports, etc.).
// I only added a tiny helper `downloadRemoteToLocalImage` and used it in `onSave`.
// The Food Network image logic from earlier is still here.

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, Alert,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
  Image as RNImage, Animated, Easing, Dimensions, Modal, StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router"; // 🆕 we use useLocalSearchParams

import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable, RectButton } from "react-native-gesture-handler";
import { useFocusEffect } from "@react-navigation/native";

import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";

import { supabase } from "@/lib/supabase";
import { fetchOgForUrl } from "@/lib/og";
import { uploadFromUri } from "@/lib/uploads";
import { fetchMeta } from "@/lib/fetch_meta";
import { normalizeIngredientLines } from "@/lib/ingredients";
import { captionToIngredientLines } from "@/lib/caption_to_ingredients";

import TikTokSnap, { tiktokOEmbedThumbnail } from "@/lib/tiktok";
import TitleSnap from "@/lib/TitleSnap";

import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import Svg, { Line, Circle } from "react-native-svg";

// Public image proxy helper (last-resort for hotlink blocks)
function makeProxiedUrl(u: string): string | null {
  try {
    const noScheme = u.replace(/^https?:\/\//i, "");
    return `https://images.weserv.nl/?url=${encodeURIComponent(noScheme)}&w=1280&output=jpg`;
  } catch { return null; }
}

/* ---------------------------- colors ---------------------------- */
const COLORS = {
  bg: "#0B1120",
  card: "#111827",
  sunken: "#1F2937",
  text: "#E5E7EB",
  sub: "#9CA3AF",
  accent: "#60A5FA",
  green: "#22c55e",
  red: "#EF4444",
  border: "#243042",
};
const MESSHALL_GREEN = "#2FAE66";

/* ---------------------------- timing & sizes ---------------------------- */
const CAPTURE_DELAY_MS = 700;
const BETWEEN_SHOTS_MS = 120;
const SNAP_ATTEMPTS = 2;

const IMPORT_HARD_TIMEOUT_MS = 20000;
const ATTEMPT_TIMEOUT_FIRST_MS = 8000;
const ATTEMPT_TIMEOUT_SOFT_MS = 2200;

const MIN_IMG_W = 600, MIN_IMG_H = 600;
const SOFT_MIN_W = 360, SOFT_MIN_H = 360;
const MIN_LOCAL_BYTES = 30_000;
const IMPROVEMENT_FACTOR = 1.12;

const FOCUS_Y_DEFAULT = 0.4;

/* ---------------------------- tiny helpers ---------------------------- */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
function extractFirstUrl(s: string): string | null {
  const m = (s || "").match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}
function ensureHttps(u: string) { return /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`; }
async function resolveFinalUrl(u: string) { try { const r = await fetch(u); if ((r as any)?.url) return (r as any).url as string; } catch {} return u; }
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

/* ---------------------------- title helpers ---------------------------- */
type JsonLike = Record<string, any>;
function decodeEntities(s: string) {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function extractMetaContent(html: string, nameOrProp: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const m = html.match(re);
  return m?.[1]?.trim() || null;
}
function extractTagText(html: string, tag: "h1" | "title"): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  if (!m) return null;
  const txt = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return txt || null;
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
  const splitters = [" | ", " - ", " • ", " — "];
  for (const sp of splitters) {
    const parts = s.split(sp);
    if (parts.length > 1) {
      const last = parts[parts.length - 1].trim().toLowerCase();
      if (brand && (last === brand || last.includes(brand))) { s = parts.slice(0, -1).join(sp).trim(); break; }
    }
  }
  s = s.replace(/\s+[\-\|•—]\s*(tiktok|food\s*network|allrecipes|youtube)\s*$/i, "").trim();
  s = s.replace(/\b\(?video\)?\b\s*$/i, "").trim();
  return s;
}
function isTikTokJunkTitle(s?: string | null) {
  const t = (s || "").toLowerCase().replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (t === "tiktok") return true;
  if (t === "make your day") return true;
  if (t === "tiktok - make your day" || t === "tiktok | make your day") return true;
  if (t.includes("tiktok") && t.includes("make your day")) return true;
  return false;
}
function isWeakTitle(t?: string | null) {
  const s = (t || "").trim();
  if (!s) return true;
  if (isTikTokJunkTitle(s)) return true;
  const lower = s.toLowerCase();
  if (lower === "food network" || lower === "allrecipes" || lower === "youtube") return true;
  if (s.length < 4) return true;
  if (/^\d{6,}$/.test(s)) return true;
  return false;
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
    const j: JsonLike = await fetchWithUA(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, 7000, "json");
    const t = j?.title && String(j.title).trim();
    return t && !isTikTokJunkTitle(t) ? t : null;
  } catch { return null; }
}
async function getTikTokEmbedTitle(id: string, canonicalUrlForClean: string) {
  try {
    const html = (await fetchWithUA(`https://www.tiktok.com/embed/v2/${id}`, 7000, "text")) as string;
    const cand = extractMetaContent(html, "og:title") || extractMetaContent(html, "twitter:title");
    if (!cand) return null;
    const clean = cleanTitle(cand, canonicalUrlForClean);
    return !isTikTokJunkTitle(clean) && !isWeakTitle(clean) ? clean : null;
  } catch { return null; }
}
function unescapeJsonString(s: string) {
  return s.replace(/\\u([\dA-Fa-f]{4})/g, (_, g1) => String.fromCharCode(parseInt(g1, 16))).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}
async function getTikTokFromMainPage(canonicalUrl: string): Promise<string | null> {
  try {
    const html = (await fetchWithUA(canonicalUrl, 8000, "text")) as string;
    const h1 = extractTagText(html, "h1");
    if (h1) {
      const clean = cleanTitle(h1, canonicalUrl);
      if (!isTikTokJunkTitle(clean) && !isWeakTitle(clean)) return clean;
    }
    const match = html.match(/"ItemModule"\s*:\s*\{[\s\S]*?"(\d{6,})"\s*:\s*\{[\s\S]*?"desc"\s*:\s*"([^"]*?)"/);
    const raw = match?.[2];
    if (raw) {
      const desc = unescapeJsonString(raw).trim();
      if (desc) {
        const clean = cleanTitle(desc, canonicalUrl);
        if (!isTikTokJunkTitle(clean) && !isWeakTitle(clean)) return clean;
      }
    }
    const ogd = extractMetaContent(html, "og:description") || extractMetaContent(html, "twitter:description");
    if (ogd) {
      const clean = cleanTitle(ogd, canonicalUrl);
      if (!isTikTokJunkTitle(clean) && !isWeakTitle(clean)) return clean;
    }
    return null;
  } catch { return null; }
}
// 🧠 This function picks the best title from a web page.
// 👶 For TikTok: we only try oEmbed, and if that fails we return null so your TitleSnap can fill it in.
async function getBestTitle(url: string): Promise<string | null> {
  const u = ensureHttps(url);

  // ✅ TIKTOK: keep it simple so it doesn't break other stuff
  if (isTikTokLike(u)) {
    // 1) Ask TikTok for the final/canonical URL (same as before, just no "id" path)
    const { finalUrl } = await resolveTikTokEmbedUrl(u);

    // 2) Use the canonical URL if we got one
    const canonical = finalUrl || u;

    // 3) Try oEmbed once for the caption/title
    const fromOembed = await getTikTokOEmbedTitle(canonical);
    if (fromOembed) return cleanTitle(fromOembed, canonical);

    // 4) If oEmbed fails, return null so TitleSnap shows and sets the title
    return null;
  }

  // 🌐 Everything below is unchanged — normal pages: OG/Twitter/H1/Title tags
  try {
    const html = (await fetchWithUA(u, 7000, "text")) as string;
    const host = (() => { try { return new URL(u).hostname; } catch { return ""; } })();

    const cands: string[] = [];
    const og = extractMetaContent(html, "og:title"); if (og) cands.push(og);
    const tw = extractMetaContent(html, "twitter:title"); if (tw) cands.push(tw);
    const h1 = extractTagText(html, "h1"); if (h1) cands.push(h1);
    const tt = extractTagText(html, "title"); if (tt) cands.push(tt);

    const seen = new Set<string>();
    const cleaned = cands
      .map((x) => cleanTitle(x, u))
      .map((x) => decodeEntities(x))
      .filter((x) =>
        x &&
        !seen.has(x) &&
        !isWeakTitle(x) &&
        x.length >= 4 &&
        x.length <= 140 &&
        x.toLowerCase() !== hostToBrand(host)
      )
      .filter((x) => { seen.add(x); return true; });

    if (!cleaned.length) return null;

    const score = (s: string) => {
      const len = s.length, words = s.split(/\s+/).length;
      let sc = 0;
      if (len >= 6 && len <= 90) sc += 5;     // nice length
      sc += Math.min(words, 8);               // more words = slightly better
      if (/[A-Z]/.test(s) && /[a-z]/.test(s)) sc += 2;  // has casing variety
      if (/[|–—\-•]/.test(s)) sc -= 2;               // ding separators
      return sc;
    };

    cleaned.sort((a, b) => score(b) - score(a));
    return cleaned[0] || null;
  } catch {
    return null;
  }
}


/* ---------------------------- image helpers ---------------------------- */
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
function parseSrcset(srcset: string): { url: string; w: number }[] {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map(part => part.trim())
    .map(part => {
      const m = part.match(/(\S+)\s+(\d+)w$/);
      if (!m) return null;
      return { url: m[1], w: parseInt(m[2], 10) };
    })
    .filter(Boolean) as { url: string; w: number }[];
}
function pickLargestFromSrcset(srcset: string): string | null {
  const items = parseSrcset(srcset);
  if (!items.length) return null;
  items.sort((a,b) => b.w - a.w);
  return items[0].url;
}
// gently upgrade Food Network CDN sizes
function maybeUpgradeSndimg(u: string): string {
  try {
    const url = new URL(u);
    if (!url.hostname.endsWith("sndimg.com")) return u;
    url.pathname = url.pathname.replace(
      /\/upload\/[^/]+\/v1\//,
      "/upload/f_auto,q_auto,w_1280/v1/"
    );
    return url.toString();
  } catch {
    return u;
  }
}
function extractJsonLdImages(html: string): string[] {
  const out: string[] = [];
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    try {
      const block = JSON.parse(m[1]);
      const push = (v: any) => {
        if (!v) return;
        if (typeof v === "string") out.push(v);
        else if (Array.isArray(v)) v.forEach(push);
        else if (typeof v === "object") {
          if (typeof v.url === "string") out.push(v.url);
          if (typeof v.contentUrl === "string") out.push(v.contentUrl);
        }
      };
      const nodes = Array.isArray(block) ? block : [block];
      nodes.forEach(node => {
        if (node && node.image) push(node.image);
        if (node && node["@type"] === "ImageObject" && (node.url || node.contentUrl)) push(node.url || node.contentUrl);
      });
    } catch {}
  }
  return out;
}
function extractAllImageCandidatesFromHtml(html: string, baseUrl: string): string[] {
  const cands: string[] = [];

  const grabMeta = (nameOrProp: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
    const m = html.match(re);
    return m?.[1]?.trim() || null;
  };
  const metaKeys = [
    "og:image", "og:image:url", "og:image:secure_url",
    "twitter:image", "twitter:image:src",
    "parsely-image-url", "thumbnail", "sailthru.image.full"
  ];
  for (const k of metaKeys) {
    const v = grabMeta(k);
    if (v) cands.push(v);
  }

  const linkRe = /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i;
  const lm = html.match(linkRe);
  if (lm?.[1]) cands.push(lm[1]);

  extractJsonLdImages(html).forEach(x => cands.push(x));

  const imgRe = /<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/ig;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    const src = m[1];
    if (src) cands.push(src);
  }

  const imgSetRe = /<img[^>]+srcset=["']([^"']+)["'][^>]*>/ig;
  while ((m = imgSetRe.exec(html))) {
    const ss = m[1];
    const big = pickLargestFromSrcset(ss);
    if (big) cands.push(big);
  }

  const sourceSetRe = /<source[^>]+srcset=["']([^"']+)["'][^>]*>/ig;
  while ((m = sourceSetRe.exec(html))) {
    const ss = m[1];
    const big = pickLargestFromSrcset(ss);
    if (big) cands.push(big);
  }

  const seen = new Set<string>();
  const abs = cands
    .map(x => absolutizeImageUrl(x, baseUrl))
    .filter((x): x is string => !!x)
    .map(x => maybeUpgradeSndimg(x))
    .filter(x => { if (seen.has(x)) return false; seen.add(x); return true; });

  const looksBig = (u: string) => /\b(\d{3,}w|\d{3,}x\d{3,}|[._-]\d{3,}p)\b/i.test(u) ? 1 : 0;
  const isFN = (u: string) => /foodnetwork|sndimg\.com/i.test(u) ? 1 : 0;
  abs.sort((a,b) => (isFN(b) - isFN(a)) || (looksBig(b) - looksBig(a)));

  return abs;
}
async function getAnyImageFromPage(url: string): Promise<string | null> {
  try {
    const html = await fetchWithUA(url, 12000, "text");
    const cands = extractAllImageCandidatesFromHtml(html, url);
    const looksBig = (u: string) => /\b(w[_=]?\d{3,}|[._-](\d{3,}x\d{3,}|\d{3,}p)\b)/i.test(u) ? 1 : 0;
    cands.sort((a, b) => looksBig(b) - looksBig(a));
    return cands[0] || null;
  } catch {
    return null;
  }
}

/* ---------------------------- ⭐ FOOD NETWORK SMART FETCH (AMP + optional proxy) ---------------------------- */
const FOODNETWORK_PROXY_URL =
  ""; // e.g., "https://YOUR_PROJECT_REF.functions.supabase.co/fn_foodnetwork_fetch"

function isFoodNetworkUrl(u: string): boolean {
  try { return new URL(u).hostname.replace(/^www\./, "").endsWith("foodnetwork.com"); }
  catch { return /foodnetwork\.com/i.test(u); }
}
function buildFNAmpCandidates(input: string): string[] {
  const out: string[] = [];
  try {
    const u = new URL(ensureHttps(input));
    const ampRef = new URL(u); ampRef.searchParams.set("ref", "amp"); out.push(ampRef.toString());
    const ampDot = new URL(u);
    if (ampDot.pathname.endsWith(".html")) ampDot.pathname = ampDot.pathname.replace(/\.html$/, ".amp");
    else if (!ampDot.pathname.endsWith(".amp") && !/\.[a-z]{2,5}$/i.test(ampDot.pathname)) ampDot.pathname += ".amp";
    out.push(ampDot.toString());
  } catch {}
  return out;
}
async function fetchFoodNetworkHtmlSmart(pageUrl: string): Promise<{ html: string; from: string } | null> {
  const tries = [pageUrl, ...buildFNAmpCandidates(pageUrl)];
  for (const href of tries) {
    try {
      const html = await fetchWithUA(href, 12000, "text");
      if (html && !/Access Denied/i.test(html)) return { html, from: href };
    } catch {}
  }
  if (FOODNETWORK_PROXY_URL) {
    for (const href of tries) {
      try {
        const prox = `${FOODNETWORK_PROXY_URL}?url=${encodeURIComponent(href)}`;
        const res = (await withTimeout(fetch(prox), 12000)) as Response;
        if (res.ok) {
          const html = await res.text();
          if (html && !/Access Denied/i.test(html)) return { html, from: href };
        }
      } catch {}
    }
  }
  try {
    const mirror = `https://r.jina.ai/http://www.foodnetwork.com${new URL(pageUrl).pathname}`;
    const res = (await withTimeout(fetch(mirror), 12000)) as Response;
    if (res.ok) {
      const html = await res.text();
      if (html) return { html, from: "mirror" };
    }
  } catch {}
  return null;
}
function parseRecipeLdFromHtml(html: string) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const objs: any[] = [];
  for (const m of blocks) {
    try {
      const json = JSON.parse(m[1]);
      const list = Array.isArray(json) ? json : [json];
      for (const node of list) {
        const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node];
        for (const item of graph) objs.push(item);
      }
    } catch {}
  }
  const recipe = objs.find((n) => {
    const t = n?.['@type'];
    return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
  });
  if (!recipe) return null;

  const rawInstr = recipe.recipeInstructions ?? [];
  const steps: string[] = Array.isArray(rawInstr)
    ? rawInstr.map((s: any) =>
        typeof s === "string" ? s :
        typeof s?.text === "string" ? s.text :
        typeof s?.name === "string" ? s.name : ""
      ).filter(Boolean)
    : [];

  const imgVal = recipe.image;
  let image: string | null = null;
  if (typeof imgVal === "string") image = imgVal;
  else if (Array.isArray(imgVal)) image = imgVal.find((v: any) => typeof v === "string") || null;
  else if (imgVal && typeof imgVal === "object") image = imgVal.url || imgVal['@id'] || null;

  return {
    title: (recipe.name ?? "").toString(),
    image,
    ingredients: Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient.filter(Boolean) : [],
    steps
  };
}
async function getFoodNetworkBits(pageUrl: string) {
  const fetched = await fetchFoodNetworkHtmlSmart(pageUrl);
  if (!fetched) return null;

  const parsed = parseRecipeLdFromHtml(fetched.html);
  if (!parsed) {
    const title = cleanTitle(
      extractMetaContent(fetched.html, "og:title") || extractMetaContent(fetched.html, "twitter:title") || "",
      pageUrl
    );
    const image = absolutizeImageUrl(
      extractMetaContent(fetched.html, "og:image") || extractMetaContent(fetched.html, "twitter:image") || "",
      pageUrl
    );
    return { title, image, ingredients: [], steps: [] };
  }
  return {
    title: parsed.title ? cleanTitle(parsed.title, pageUrl) : "",
    image: parsed.image ? absolutizeImageUrl(parsed.image, pageUrl) : null,
    ingredients: parsed.ingredients || [],
    steps: parsed.steps || [],
  };
}
async function getFoodNetworkBestImage(pageUrl: string): Promise<string | null> {
  const fetched = await fetchFoodNetworkHtmlSmart(pageUrl);
  if (!fetched) return null;

  const node = parseRecipeLdFromHtml(fetched.html);
  if (node?.image) {
    const u = absolutizeImageUrl(node.image, pageUrl);
    if (u) return maybeUpgradeSndimg(u);
  }
  const og = extractMetaContent(fetched.html, "og:image") || extractMetaContent(fetched.html, "twitter:image");
  if (og) {
    const u = absolutizeImageUrl(og, pageUrl);
    if (u) return maybeUpgradeSndimg(u);
  }
  const all = extractAllImageCandidatesFromHtml(fetched.html, pageUrl);
  if (all.length) return all[0];
  return null;
}

/* ---------------------------- local image helpers ---------------------------- */
async function getLocalDimensions(uri: string): Promise<{ w: number; h: number }> {
  try { const r = await ImageManipulator.manipulateAsync(uri, [], { compress: 0, format: ImageManipulator.SaveFormat.JPEG }); return { w: r.width ?? 0, h: r.height ?? 0 }; }
  catch { return { w: 0, h: 0 }; }
}
async function ensureMinLocalImage(uri: string, wantW = MIN_IMG_W, wantH = MIN_IMG_H): Promise<string | null> {
  const { w, h } = await getLocalDimensions(uri);
  if (!w || !h) return null;
  if (w >= wantW && h >= wantH) return uri;
  if (w >= SOFT_MIN_W && h >= SOFT_MIN_H) {
    const scale = Math.max(wantW / w, wantH / h);
    const newW = Math.round(w * scale), newH = Math.round(h * scale);
    try {
      const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: newW, height: newH } }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      return out.uri || null;
    } catch { return null; }
  }
  return null;
}

/* ---------------------------- ⭐ NEW: safe remote → local download for uploads ---------------------------- */
// 🧒 Simple idea: if the preview is an http(s) URL, we first save it to device cache
// using a friendly mobile UA + a helpful Referer (the page we imported from).
// That avoids 403 hotlink blocks during the final upload step.

async function downloadRemoteToLocalImage(url: string, referer?: string): Promise<string | null> {
  // stronger FN-safe downloader: headers → fetch→file → optional proxy → public proxy
  const bufToB64 = (ab: ArrayBuffer) => {
    const cs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const by = new Uint8Array(ab);
    let out = "";
    for (let i = 0; i < by.length; i += 3) {
      const a = by[i], b = i + 1 < by.length ? by[i + 1] : 0, c = i + 2 < by.length ? by[i + 2] : 0;
      const t = (a << 16) | (b << 8) | c;
      out += cs[(t >> 18) & 63] + cs[(t >> 12) & 63] + (i + 1 < by.length ? cs[(t >> 6) & 63] : "=") + (i + 2 < by.length ? cs[t & 63] : "=");
    }
    return out;
  };
  const isFN = (u: string) => {
    try { const h = new URL(u).hostname.toLowerCase(); return h.includes("sndimg.com") || h.includes("foodnetwork.com"); }
    catch { return /sndimg\.com|foodnetwork\.com/i.test(u); }
  };
  const stripQuery = (u: string) => { try { const x = new URL(u); x.search = ""; return x.toString(); } catch { return u; } };
  const stripRendSuffix = (u: string) => u.replace(/(\.(?:jpg|jpeg|png))(?:\.rend\.[^/?#]+\.suffix\/[^/?#]+)$/i, "$1");

  const candidates: string[] = [];
  candidates.push(url);
  const sr = stripRendSuffix(url); if (!candidates.includes(sr)) candidates.push(sr);
  const qless = stripQuery(url); if (!candidates.includes(qless)) candidates.push(qless);
  const qless2 = stripQuery(sr); if (!candidates.includes(qless2)) candidates.push(qless2);

  const origin = (() => { try { return referer ? new URL(referer).origin : undefined; } catch { return undefined; } })();
  const headerSets: Record<string, string>[] = [
    {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
      "Accept": "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...(referer ? { Referer: referer } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "image/*,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.foodnetwork.com/",
      "Origin": "https://www.foodnetwork.com",
    },
    { "User-Agent": "Mozilla/5.0", "Accept": "image/*,*/*;q=0.8" },
  ];

  // Try with FileSystem.downloadAsync first
  for (const cand of candidates) {
    for (const headers of headerSets) {
      const dst = FileSystem.cacheDirectory + `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.img`;
      try {
        const res = await FileSystem.downloadAsync(cand, dst, { headers });
        if (res.status >= 200 && res.status < 300) {
          const out = await ImageManipulator.manipulateAsync(res.uri, [], { compress: 0.96, format: ImageManipulator.SaveFormat.JPEG });
          const ok = await ensureMinLocalImage(out.uri, MIN_IMG_W, MIN_IMG_H);
          return ok || out.uri;
        }
      } catch {}
      try { await FileSystem.deleteAsync(dst, { idempotent: true }); } catch {}
    }
  }

  // Fetch → write file fallback
  for (const cand of candidates) {
    for (const headers of headerSets) {
      try {
        const r = await fetch(cand, { headers });
        if (!r.ok) continue;
        const ab = await r.arrayBuffer();
        const dst = FileSystem.cacheDirectory + `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`;
        await FileSystem.writeAsStringAsync(dst, bufToB64(ab), { encoding: FileSystem.EncodingType.Base64 });
        const out = await ImageManipulator.manipulateAsync(dst, [], { compress: 0.96, format: ImageManipulator.SaveFormat.JPEG });
        const ok = await ensureMinLocalImage(out.uri, MIN_IMG_W, MIN_IMG_H);
        return ok || out.uri;
      } catch {}
    }
  }

  // Public proxy (last resort, FN only)
  if (isFN(url)) {
    for (const cand of candidates) {
      const alt = makeProxiedUrl(cand);
      if (!alt) continue;
      try {
        const dst = FileSystem.cacheDirectory + `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.img`;
        const res = await FileSystem.downloadAsync(alt, dst);
        if (res.status >= 200 && res.status < 300) {
          const out = await ImageManipulator.manipulateAsync(dst, [], { compress: 0.96, format: ImageManipulator.SaveFormat.JPEG });
          const ok = await ensureMinLocalImage(out.uri, MIN_IMG_W, MIN_IMG_H);
          return ok || out.uri;
        }
      } catch {}
    }
  }

  return null;
}


/* ---------------------------- screen state & UI ---------------------------- */
type ImageSourceState =
  | { kind: "none" }
  | { kind: "url-og"; url: string; resolvedImageUrl: string }
  | { kind: "picker"; localUri: string }
  | { kind: "camera"; localUri: string };

export default function CaptureScreen() {
  const [pastedUrl, setPastedUrl] = useState("");
  const [title, setTitle] = useState("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState<string[]>([""]);
  const [steps, setSteps] = useState<string[]>([""]);
  const [img, setImg] = useState<ImageSourceState>({ kind: "none" });

  // HUD
  const [hudVisible, setHudVisible] = useState(false);
  const [hudPhase, setHudPhase] = useState<"scanning" | "acquired">("scanning");
  const IMPORT_STEPS = ["Importing photo", "Reading title", "Parsing ingredients", "Parsing steps"];
  const [stageIndex, setStageIndex] = useState(0);
  const bumpStage = useCallback((n: number) => setStageIndex((s) => (n > s ? n : s)), []);
  const [saving, setSaving] = useState(false);

  // TikTok snapper
  const [snapVisible, setSnapVisible] = useState(false);
  const [snapUrl, setSnapUrl] = useState("");
  const [snapReloadKey, setSnapReloadKey] = useState(0);
  const [snapResnapKey, setSnapResnapKey] = useState(0);
  const [improvingSnap, setImprovingSnap] = useState(false);

  // TitleSnap (optional)
  const [titleSnapVisible, setTitleSnapVisible] = useState(false);
  const [queuedTitleSnapUrl, setQueuedTitleSnapUrl] = useState<string | null>(null);

  // import control
  const [pendingImportUrl, setPendingImportUrl] = useState<string | null>(null);
  const [abortVisible, setAbortVisible] = useState(false);

  // pretty success dialog
  const [okModalVisible, setOkModalVisible] = useState(false);

  // refs
  const snapResolverRef = useRef<null | ((uri: string) => void)>(null);
  const snapRejectRef = useRef<null | ((e: any) => void)>(null);
  const snapCancelledRef = useRef(false);
  const importRunIdRef = useRef(0);
  const gotSomethingForRunRef = useRef(false);
  const lastResolvedUrlRef = useRef<string>("");
  const lastGoodPreviewRef = useRef<string>("");

  // 🆕 ELI5: when we arrive from "Share → MessHall", we get a gift in the mail.
  // Normalize sharedUrl to a plain string (handles string | string[] from router).
  const { sharedUrl: sharedParam } = useLocalSearchParams<{ sharedUrl?: string | string[] }>();
  const sharedRaw = React.useMemo(
    () => (Array.isArray(sharedParam) ? sharedParam[0] : sharedParam) || "",
    [sharedParam]
  );

  // If we see a good http(s) link, we:
  // - put it into the paste box (if it’s empty)
  // - press your Import button for you (call resolveOg)
  useEffect(() => {
    if (sharedRaw && /^https?:\/\//i.test(sharedRaw)) {
      setPastedUrl((prev) => (prev?.trim() ? prev : sharedRaw.trim()));
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        resolveOg();
      }, 0);
    }
    // only when a new share arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (!resaved?.uri) return null;
        uri = resaved.uri;
      }
    } catch { return null; }
    return await ensureMinLocalImage(uri, MIN_IMG_W, MIN_IMG_H);
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

  const maybeUpgradePreview = useCallback(async (candidate: string, originUrl: string) => {
    const test = await isValidCandidate(candidate);
    if (!test.ok || !test.useUri) return;
    const cur = currentPreviewUri();
    if (!cur) return setGoodPreview(test.useUri, originUrl);
    const [a, b] = await Promise.all([getImageDims(cur), getImageDims(test.useUri)]);
    if (b.w * b.h > a.w * a.h * IMPROVEMENT_FACTOR) setGoodPreview(test.useUri, originUrl);
  }, [currentPreviewUri, getImageDims, isValidCandidate, setGoodPreview]);

  const hardResetImport = useCallback(() => {
    snapCancelledRef.current = false;
    snapResolverRef.current = null;
    snapRejectRef.current = null;
    setHudVisible(false);
    setHudPhase("scanning");
    setSnapVisible(false);
    setTitleSnapVisible(false);
    setQueuedTitleSnapUrl(null);
    setImprovingSnap(false);
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

  const autoSnapTikTok = useCallback(async (rawUrl: string, maxAttempts = SNAP_ATTEMPTS) => {
    const { embedUrl, finalUrl } = await resolveTikTokEmbedUrl(rawUrl);
    const target = embedUrl || ensureHttps(rawUrl);
    lastResolvedUrlRef.current = finalUrl || rawUrl;

    snapCancelledRef.current = false;
    setSnapUrl(target);
    setSnapVisible(true);
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
    return best;
  }, [getImageDims, setGoodPreview, validateOrRepairLocal, isValidCandidate]);

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

      const best = await getBestTitle(url);
      if (best && isWeakTitle(title)) setTitle(best);

      if (isTikTokLike(url)) {
        const shot = await autoSnapTikTok(url, SNAP_ATTEMPTS);
        if (shot) success = true;
      }

      const metaP = fetchMeta(url);
      const ogP = fetchOgForUrl(url);
      setStageIndex((s) => Math.max(s, 2));

      const [metaRes, ogRes] = await Promise.allSettled([metaP, ogP]);
      const meta = metaRes.status === "fulfilled" ? metaRes.value : null;
      const og   = ogRes.status === "fulfilled" ? ogRes.value   : null;

      const candidate = cleanTitle((meta?.title || og?.title || ""), url);
      if (candidate && !isTikTokJunkTitle(candidate) && isWeakTitle(title)) setTitle(candidate);

      if (meta?.ingredients?.length) {
        const parsed = normalizeIngredientLines(meta.ingredients);
        const canon = parsed.map((p) => p.canonical).filter(Boolean);
        if (canon.length) setIngredients(canon);
      } else if (meta?.caption) {
        const guess = captionToIngredientLines(meta.caption);
        if (guess.length) setIngredients(guess);
      }
      setStageIndex((s) => Math.max(s, 3));

      if (meta?.steps?.length) setSteps(meta.steps.filter(Boolean));
      setStageIndex((s) => Math.max(s, 4));

      if (isFoodNetworkUrl(url)) {
        try {
          const fn = await getFoodNetworkBits(url);
          if (fn) {
            if (fn.title && isWeakTitle(title)) setTitle(fn.title);

            const haveIngredients = !!(meta?.ingredients?.length || ingredients.some((v) => (v || "").trim()));
            if (!haveIngredients && fn.ingredients?.length) {
              const parsed = normalizeIngredientLines(fn.ingredients);
              const canon = parsed.map((p) => p.canonical).filter(Boolean);
              if (canon.length) setIngredients(canon);
            }

            const haveSteps = !!(meta?.steps?.length || steps.some((v) => (v || "").trim()));
            if (!haveSteps && fn.steps?.length) {
              setSteps(fn.steps);
            }

            if (!gotSomethingForRunRef.current && fn.image) {
              const used = await tryImageUrl(fn.image, url);
              if (used) success = true;
            }
          }

          if (!success && !gotSomethingForRunRef.current) {
            const bestImg = await getFoodNetworkBestImage(url);
            if (bestImg) {
              const used = await tryImageUrl(bestImg, url);
              if (used) success = true;
            }
          }
        } catch {}
      }

      if (!success && !gotSomethingForRunRef.current) {
        let used = false;

        if (meta?.image) used = await tryImageUrl(meta.image, url);
        if (!used && Array.isArray((meta as any)?.images)) {
          for (const u of (meta as any).images) { if (await tryImageUrl(u, url)) { used = true; break; } }
        }
        if (!used && og?.image) used = await tryImageUrl(og.image, url);

        if (!used && isTikTokLike(url)) {
          const thumb = await withTimeout(tiktokOEmbedThumbnail(url), 2000).catch(() => null);
          if (thumb) used = await tryImageUrl(thumb, url);
        }

        if (!used && isFoodNetworkUrl(url)) {
          const fnImg = await getAnyImageFromPage(url);
          if (fnImg) used = await tryImageUrl(fnImg, url);
        }

        if (!used) {
          const fromPage = await getAnyImageFromPage(url);
          if (fromPage) used = await tryImageUrl(fromPage, url);
        }

        if (used) success = true;
      }
    } catch (e: any) {
      if (!gotSomethingForRunRef.current) setImg({ kind: "none" });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Import error", e?.message || "Could not read that webpage.");
    } finally {
      clearTimeout(watchdog);
      if (success || gotSomethingForRunRef.current) {
        setHudPhase("acquired");
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await new Promise((r) => setTimeout(r, 800));
      }
      setHudVisible(false);
      setTitleSnapVisible(false);
      setSnapVisible(false);
    }
  }, [autoSnapTikTok, tryImageUrl, title, hardResetImport, ingredients, steps]);

  // 🧸 CHANGE: resolveOg now falls back to sharedRaw if the text box is empty.
  const resolveOg = useCallback(async () => {
    hardResetImport();

    // Use whatever we have first: typed box, otherwise the shared URL from TikTok
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

    if (isTikTokLike(url) && isWeakTitle(title)) {
      setQueuedTitleSnapUrl(url);
      setTitleSnapVisible(true);
    }
    if (isTikTokLike(url)) {
      const { embedUrl } = await resolveTikTokEmbedUrl(url);
      setSnapUrl(embedUrl || ensureHttps(url));
      setSnapVisible(true);
    }

    setHudVisible(true);
    setPendingImportUrl(url);
  }, [title, hardResetImport, pastedUrl, sharedRaw]);

  const onPaste = useCallback(async () => { const t = await Clipboard.getStringAsync(); if (t) setPastedUrl(t.trim()); }, []);
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

      // ⭐ FN-SAFE SAVE: stronger downloader with fetch+proxy fallbacks
      let uploadUri = previewUri;
      if (uploadUri && uploadUri.startsWith("http")) {
        const local =
          (await ((globalThis as any).__MH_dlV2 ?? downloadRemoteToLocalImage)(uploadUri, lastResolvedUrlRef.current || undefined));
        if (!local) throw new Error("Failed to download remote image (status 403)");
        uploadUri = local;
      }

      if (uploadUri) {
        const path = `recipes/${recipeId}/images/${Date.now()}.jpg`;
        const publicUrl = await uploadFromUri({ uri: uploadUri, storageBucket: "recipe-images", path, contentType: "image/jpeg" });
        await supabase.from("recipes").update({ image_url: publicUrl }).eq("id", recipeId);
      }

      const ing = ingredients.map((s) => (s || "").trim()).filter(Boolean);
      if (ig.length) await supabase.from("recipe_ingredients").insert(ing.map((text, i) => ({ recipe_id: recipeId, pos: i + 1, text })));

      const stp = steps.map((s) => (s || "").trim()).filter(Boolean);
      if (stp.length) await supabase.from("recipe_steps").insert(stp.map((text, i) => ({ recipe_id: recipeId, pos: i + 1, text, seconds: null })));

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900", marginBottom: 16 }}>Add Recipe</Text>

          {/* Title */}
          <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="My Tasty Pizza" placeholderTextColor="#64748b" style={{ color: "white", backgroundColor: COLORS.sunken, borderRadius: 12, padding: 12, marginBottom: 12 }} />

          {/* Import */}
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

            {/* Preview */}
            <View style={{ marginTop: 10 }}>
              {!hudVisible ? (() => {
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
              })() : null}
            </View>
          </View>

          {/* Add your own photo */}
          <TouchableOpacity onPress={pickOrCamera} style={{ backgroundColor: COLORS.card, padding: 12, borderRadius: 12, alignItems: "center", marginBottom: 12 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>Add/Choose Photo…</Text>
          </TouchableOpacity>

          {/* Ingredients */}
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>Ingredients</Text>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 }}>
            {ingredients.map((ing, i) => (
              <Swipeable key={`ing-${i}`} renderRightActions={() => renderRightActions(() => setIngredients((a) => a.filter((_, idx) => idx !== i)))} overshootRight={false} friction={2}>
                <View style={styles.row}>
                  <Text style={styles.rowIndex}>{i + 1}.</Text>
                  <TextInput value={ing} onChangeText={(v) => setIngredients((a) => a.map((x, idx) => (idx === i ? v : x)))} placeholder="2 cups flour…" placeholderTextColor="#64748b" style={styles.rowInput} />
                </View>
                {i !== ingredients.length - 1 && <View style={styles.thinLine} />}
              </Swipeable>
            ))}
          </View>
          <TouchableOpacity onPress={() => setIngredients((a) => [...a, ""])} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center", marginBottom: 16 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Ingredient</Text>
          </TouchableOpacity>

          {/* Steps */}
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>Steps</Text>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 }}>
            {steps.map((st, i) => (
              <Swipeable key={`step-${i}`} renderRightActions={() => renderRightActions(() => setSteps((a) => a.filter((_, idx) => idx !== i)))} overshootRight={false} friction={2}>
                <View style={styles.row}>
                  <Text style={styles.rowIndex}>{i + 1}.</Text>
                  <TextInput value={st} onChangeText={(t) => setSteps((a) => a.map((x, idx) => (idx === i ? t : x)))} placeholder="Mix everything…" placeholderTextColor="#64748b" multiline style={[styles.rowInput, { minHeight: 60 }]} />
                </View>
                {i !== steps.length - 1 && <View style={styles.thinLine} />}
              </Swipeable>
            ))}
          </View>
          <TouchableOpacity onPress={() => setSteps((a) => [...a, ""])} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center", marginBottom: 24 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Step</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Save bar */}
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: COLORS.bg, borderTopWidth: 1, borderColor: COLORS.border }}>
          <TouchableOpacity onPress={onSave} disabled={saving} style={{ backgroundColor: saving ? "#475569" : COLORS.green, paddingVertical: 14, borderRadius: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: saving ? 0.7 : 1 }}>
            {saving && <ActivityIndicator size="small" color="#fff" />}
            <Text style={{ color: "#fff", fontWeight: "800" }}>{saving ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>

        {/* TikTok snapper */}
        <TikTokSnap
          url={snapUrl}
          visible={snapVisible}
          reloadKey={snapReloadKey}
          resnapKey={snapResnapKey}
          zoom={1.2}
          focusY={FOCUS_Y_DEFAULT}
          captureDelayMs={CAPTURE_DELAY_MS}
          onCancel={() => {
            snapCancelledRef.current = true;
            setSnapVisible(false);
            setImprovingSnap(false);
            if (snapRejectRef.current) { snapRejectRef.current(new Error("snap-cancelled")); snapRejectRef.current = null; }
          }}
          onFound={async (uri) => {
            gotSomethingForRunRef.current = true;
            const fixed = await validateOrRepairLocal(uri);
            if (fixed) setGoodPreview(fixed, lastResolvedUrlRef.current);
            else {
              const test = await isValidCandidate(uri);
              if (test.ok && test.useUri) setGoodPreview(test.useUri, lastResolvedUrlRef.current);
            }
          }}
        />

        {/* TitleSnap (optional) */}
        <TitleSnap
          visible={titleSnapVisible}
          url={queuedTitleSnapUrl || ""}
          onFound={(good) => {
            if (good && !isTikTokJunkTitle(good) && isWeakTitle(title)) setTitle(cleanTitle(good, queuedTitleSnapUrl || ""));
            setTitleSnapVisible(false); setQueuedTitleSnapUrl(null);
          }}
          onClose={() => { setTitleSnapVisible(false); setQueuedTitleSnapUrl(null); }}
        />

        {/* HUD */}
        <MilitaryImportOverlay visible={hudVisible} phase={hudPhase} stageIndex={stageIndex} steps={IMPORT_STEPS} headline="SCANNING… STAND BY" />

        {/* duplicate popup */}
        <MissionAbortedPopup visible={abortVisible} onRequestClose={() => setAbortVisible(false)} text="MISSION ABORTED" />

        {/* success dialog */}
        <ThemedDialog visible={okModalVisible} title="Saved!" message="Your recipe is safely stored." onClose={() => setOkModalVisible(false)} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------------------- list row styles ---------------------------- */
const styles = StyleSheet.create({
  swipeRightActionContainer: { justifyContent: "center", alignItems: "flex-end" },
  swipeDeleteButton: { backgroundColor: COLORS.red, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", minWidth: 88, borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  swipeDeleteText: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 10 },
  rowIndex: { color: COLORS.sub, width: 22, textAlign: "right", marginRight: 6 },
  rowInput: { flex: 1, color: COLORS.text, backgroundColor: COLORS.sunken, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, borderWidth: 1, borderColor: COLORS.border },
  thinLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginHorizontal: 10 },
});

/* ---------------------------- HUD + dialogs (unchanged) ---------------------------- */
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
const { width: SCREEN_W } = Dimensions.get("window");
const RADAR_SIZE = Math.min(SCREEN_W * 0.8, 340);
const BLIP_COUNT = 7;
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
  const progressPct = Math.max(0, Math.min(stageIndex / steps.length, 1)) * 100;

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

          <View style={[hudBackdrop.stepsBox, phase === "acquired" && { opacity: 0.5 }]}>
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
          <View style={hudBackdrop.progressOuter}><View style={[hudBackdrop.progressInner, { width: `${progressPct}%` }]} /></View>
        </View>
      </View>
    </Modal>
  );
}
const hudBackdrop = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 540, backgroundColor: COLORS.bg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "rgba(147,197,114,0.15)" },
  headline: { color: "#d1fae5", fontSize: 18, textAlign: "center", letterSpacing: 1, marginBottom: 12 },
  radarWrap: { alignSelf: "center", width: RADAR_SIZE, height: RADAR_SIZE, alignItems: "center", justifyContent: "center", marginBottom: 12, overflow: "hidden", borderRadius: RADAR_SIZE / 2, backgroundColor: "rgba(20,31,25,0.35)" },
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

/* ---------------------------- mini red "aborted" pill ---------------------------- */
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

/* ---------------------------- pretty success dialog ---------------------------- */
function ThemedDialog({
  visible,
  title = "Saved!",
  message = "Your recipe is safely stored.",
  onClose,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  onClose: () => void;
}) {
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
          <TouchableWithoutFeedback onPress={() => { /* block taps inside card */ }}>
            <Animated.View style={[dialogStyles.card, { transform: [{ scale }] }]}>
              <View style={dialogStyles.checkCircle}>
                <Text style={{ color: "#0B1120", fontWeight: "900", fontSize: 18 }}>✓</Text>
              </View>

              <Text style={dialogStyles.title}>{title}</Text>
              {!!message && <Text style={dialogStyles.message}>{message}</Text>}

              <TouchableOpacity onPress={onClose} style={dialogStyles.okBtn}>
                <Text style={dialogStyles.okText}>OK</Text>
              </TouchableOpacity>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
const dialogStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "92%",
    maxWidth: 420,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(47,174,102,0.25)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
    alignItems: "center",
  },
  checkCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: MESSHALL_GREEN, alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  title: { color: "#e2e8f0", fontSize: 20, fontWeight: "900", marginTop: 2, textAlign: "center" },
  message: { color: "#b6c2d0", fontSize: 14, marginTop: 6, textAlign: "center" },
  okBtn: { marginTop: 14, backgroundColor: MESSHALL_GREEN, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 22 },
  okText: { color: "#0B1120", fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },
});

/* ---------------------------- duplicate detection ---------------------------- */
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
