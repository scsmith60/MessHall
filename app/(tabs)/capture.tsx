// app/(tabs)/capture.tsx
// =��� ELI5: We paste a TikTok link, our robot opens it,
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
import ThemedNotice from "../../components/ui/ThemedNotice";
import { playDonutEasterEgg } from "@/lib/sounds";
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
import { parseRecipeText, type IngredientSection } from "@/lib/unified_parser";
import { recognizeImageText } from "@/lib/ocr";

import TikTokSnap from "@/lib/tiktok";
import TTDomScraper from "@/components/TTDomScraper";
import ImageFocalPointEditor from "@/components/ImageFocalPointEditor";

import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import Svg, { Line, Circle } from "react-native-svg";
import InstagramDomScraper from "@/components/InstagramDomScraper";
import { detectSiteType, extractRecipeFromJsonLd, extractRecipeFromMicrodata, extractRecipeFromHtml, discoverRecipeSiteIfNeeded } from "@/lib/recipeSiteHelpers";
import { isFoodNetworkUrl, getFoodNetworkBits, getFoodNetworkBestImage } from "@/lib/parsers/foodnetwork";
import { fetchMeta } from "@/lib/fetch_meta";
import { parseSocialCaption } from "@/lib/parsers/instagram";
import { dedupeNormalized } from "@/lib/parsers/types";
import { extractTikTokTitleFromState } from "@/lib/extractTitle";
import { logImportAttempt, markImportCorrected, getParserConfig } from "@/lib/parsers/versioning";
import type { SiteType, ParserVersion, StrategyName } from "@/lib/parsers/versioning";

import { COLORS } from "@/lib/theme";
import { logDebug } from "@/lib/logger";
import { Ionicons } from "@expo/vector-icons";

// -------------- timings --------------
const CAPTURE_DELAY_MS = 700;
const BETWEEN_SHOTS_MS = 120;
const SNAP_ATTEMPTS = 2;
const IMPORT_HARD_TIMEOUT_MS = 60000; // Increased to 60 seconds to allow time for image capture
const ATTEMPT_TIMEOUT_FIRST_MS = 8000;
const ATTEMPT_TIMEOUT_SOFT_MS = 2200;
const MIN_IMG_W = 600, MIN_IMG_H = 600;
const SOFT_MIN_W = 360, SOFT_MIN_H = 360;
const MIN_LOCAL_BYTES = 30_000;
const FOCUS_Y_DEFAULT = 0.40;

type RecipeExtraction = {
  title?: string;
  ingredients?: string[];
  steps?: string[];
  image?: string;
};

function hasMeaningfulRecipeData(data?: RecipeExtraction | null): boolean {
  if (!data) return false;
  const ingCount = data.ingredients?.length ?? 0;
  const stepCount = data.steps?.length ?? 0;
  return ingCount >= 2 || stepCount >= 1;
}

function decodeHtmlEntitiesLite(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function parseGordonRamsayRecipe(html: string, url: string): RecipeExtraction | null {
  const clean = (raw: string) =>
    decodeHtmlEntitiesLite(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .replace(/\u00A0/g, " ")
      .replace(/\uFFFD/g, "")
      .trim();

  const asideMatch = html.match(/<aside[^>]*class=["'][^"']*recipe-ingredients[^"']*["'][^>]*>([\s\S]*?)<\/aside>/i);
  const stepSections: string[] = [];
  const primarySection = html.match(/<article[^>]*class=["'][^"']*recipe-instructions[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
  if (primarySection?.[1]) stepSections.push(primarySection[1]);

  const altSectionRe =
    /<(?:article|section|div)[^>]*class=["'][^"']*(?:recipe-(?:instructions|method)|method|directions?)[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|section|div)>/gi;
  for (const match of html.matchAll(altSectionRe)) {
    if (match[1]) stepSections.push(match[1]);
  }

  if (!stepSections.length) {
    const headingRe =
      /<h[2-4][^>]*>\s*(?:Method|Methods|Directions?|Cooking\s+Instructions?|Cooking\s+Method|Instructions?)\s*<\/h[2-4]>([\s\S]{0,4000}?)(?=<h[2-4][^>]*>|<\/(?:section|article|div)>|$)/gi;
    let headingMatch: RegExpExecArray | null;
    while ((headingMatch = headingRe.exec(html))) {
      if (headingMatch[1]) stepSections.push(headingMatch[1]);
    }
  }

  if (!asideMatch && !stepSections.length) return null;

  const ingredients: string[] = [];
  if (asideMatch) {
    const section = asideMatch[1];
    for (const item of section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      let text = clean(item[1]);
      text = text.replace(/^(\d+)[.)]\s+/, "$1 ");
      if (text) ingredients.push(text);
    }
  }

  const steps: string[] = [];
  const seenSteps = new Set<string>();
  for (const section of stepSections) {
    if (!section) continue;

    let localAdded = false;
    for (const item of section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = clean(item[1]);
      if (!text || seenSteps.has(text)) continue;
      seenSteps.add(text);
      steps.push(text);
      localAdded = true;
    }

    if (!localAdded) {
      const paragraphs = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      for (const paragraph of paragraphs) {
        const text = clean(paragraph);
        if (!text) continue;
        if (/^serves\b/i.test(text)) continue;
        if (/^watch\b/i.test(text)) continue;
        if (seenSteps.has(text)) continue;
        seenSteps.add(text);
        steps.push(text);
      }
    }
  }

  if (!ingredients.length && !steps.length) return null;

  let image: string | undefined;
  const heroMatch = html.match(/<img[^>]+src=["']([^"']*CroppedFocusedImage[^"']+)["'][^>]*>/i);
  if (heroMatch?.[1]) {
    image = heroMatch[1].startsWith("http") ? heroMatch[1] : `https://www.gordonramsay.com${heroMatch[1]}`;
  }

  return { ingredients, steps, image };
}

function parseAroundMyFamilyTableRecipe(html: string, url: string): RecipeExtraction | null {
  dbg('[RECIPE] Around My Family Table parsing', url);
  const clean = (raw: string) =>
    decodeHtmlEntitiesLite(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .replace(/\u00A0/g, " ")
      .replace(/\uFFFD/g, "")
      .trim();

  const ingredients: string[] = [];
  const steps: string[] = [];

  // Get visible text first - most reliable
  const visible = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                       .replace(/<[^>]+>/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim();

  // Find "Ingredients" and "Instructions" in the visible text
  const ingIdx = visible.toLowerCase().lastIndexOf('ingredients');
  const instIdx = visible.toLowerCase().lastIndexOf('instructions');

  dbg('[RECIPE] Around My Family Table - found indices', { ingIdx, instIdx, visibleLength: visible.length });

  // Extract ingredients section
  if (ingIdx >= 0) {
    const start = ingIdx;
    const end = instIdx > ingIdx ? instIdx : Math.min(ingIdx + 5000, visible.length);
    const ingSection = visible.slice(start + 10, end); // +10 to skip "Ingredients"

    // Split into lines and filter for ingredient-like content
    const lines = ingSection.split(/[.,;]\s+|\n+/).map(l => l.trim()).filter(l => {
      return l.length > 5 && 
             l.length < 200 && 
             /\d/.test(l) && 
             !/^(servings?|yield|prep time|cook time|total time|instructions?|directions?)/i.test(l);
    });

    if (lines.length >= 2) {
      ingredients.push(...lines.slice(0, 20));
      dbg('[RECIPE] Around My Family Table - extracted ingredients:', ingredients.length);
    }
  }

  // Extract instructions section
  if (instIdx >= 0) {
    const start = instIdx;
    const afterInst = visible.slice(start + 12); // +12 to skip "Instructions"

    // Split on numbered steps or action verbs
    const stepLines = afterInst.split(/\d+[.)]\s+|(?:combine|mix|heat|preheat|add|cook|bake|simmer|boil|whisk|stir|remove|transfer|let|rest|serve)/i)
                               .map(l => l.trim())
                               .filter(l => {
                                 return l.length > 10 && 
                                        l.length < 300 && 
                                        !/^(servings?|yield|prep time|cook time|total time|notes?)/i.test(l);
                               });

    if (stepLines.length >= 1) {
      steps.push(...stepLines.slice(0, 20));
      dbg('[RECIPE] Around My Family Table - extracted steps:', steps.length);
    }
  }

  // Also try HTML structure parsing
  if (ingredients.length < 2 || steps.length < 1) {
    // Look for list items in HTML
    const allListItems = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    
    if (allListItems.length > 0) {
      const allTexts = allListItems.map(item => {
        let text = clean(item[1]);
        text = text.replace(/^[�\-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
        return text;
      }).filter(t => t.length > 3);

      // If we have list items, try to categorize them
      const hasIngPattern = (txt: string) => /(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|lb|pound|\d+\s*\/\s*\d+)/i.test(txt);
      const hasStepPattern = (txt: string) => /\b(combine|mix|heat|preheat|add|cook|bake|simmer|boil|whisk|stir|remove|transfer|let|rest|serve)/i.test(txt);

      if (ingredients.length < 2) {
        const ingredientItems = allTexts.filter(t => hasIngPattern(t) || (t.length < 150 && /\d/.test(t)));
        if (ingredientItems.length >= 2) {
          ingredients.length = 0;
          ingredients.push(...ingredientItems.slice(0, 20));
        }
      }

      if (steps.length < 1) {
        const stepItems = allTexts.filter(t => hasStepPattern(t) || /^\d+[.)]\s/.test(t) || (t.length > 15 && t.length < 300));
        if (stepItems.length >= 1) {
          steps.length = 0;
          steps.push(...stepItems.slice(0, 20));
        }
      }
    }
  }

  dbg('[RECIPE] Around My Family Table - final counts', { ingredients: ingredients.length, steps: steps.length });

  if (!ingredients.length && !steps.length) return null;

  return { ingredients, steps };
}

function parseCopyKatRecipe(html: string, url: string): RecipeExtraction | null {
  dbg('[RECIPE] CopyKat parsing', url);
  const clean = (raw: string) =>
    decodeHtmlEntitiesLite(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .replace(/\u00A0/g, " ")
      .replace(/\uFFFD/g, "")
      .trim();

  const ingredients: string[] = [];
  const steps: string[] = [];

  // CopyKat uses a structured recipe format - look for "Ingredients" heading and list items
  // Try to find the ingredients section - look for "Ingredients" heading followed by list items
  const ingredientsHeading = html.match(/<h[23][^>]*>\s*ingredients?\s*<\/h[23]>/i);
  if (ingredientsHeading) {
    dbg('[RECIPE] CopyKat - found ingredients heading');
    // Find content after heading until we hit Instructions
    const afterHeading = html.slice(html.indexOf(ingredientsHeading[0]) + ingredientsHeading[0].length);
    const untilInstructions = afterHeading.match(/([\s\S]{0,10000}?)(?=<h[23][^>]*>\s*(?:instructions?|directions?|steps?|method)\s*<\/h[23]|$)/i);
    const ingredientsSection = untilInstructions ? untilInstructions[1] : afterHeading.slice(0, 10000);

    // Extract list items
    const listItems = [...ingredientsSection.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    dbg('[RECIPE] CopyKat - found list items:', listItems.length);
    
    for (const item of listItems) {
      let text = clean(item[1]);
      text = text.replace(/^[�\-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
      if (text && text.length > 2 && !/^(servings?|yield|prep time|cook time|total time)/i.test(text)) {
        ingredients.push(text);
      }
    }

    // If no list items, try extracting from text that looks like ingredients
    if (ingredients.length === 0) {
      const textOnly = ingredientsSection.replace(/<[^>]+>/g, '\n');
      const lines = textOnly.split('\n').map(l => l.trim()).filter(l => {
        return l.length > 5 && l.length < 200 && /\d/.test(l) && 
               !/^(servings?|yield|prep time|cook time|total time|instructions?|directions?)/i.test(l);
      });
      if (lines.length >= 2) {
        ingredients.push(...lines.slice(0, 25));
        dbg('[RECIPE] CopyKat - extracted from text lines:', ingredients.length);
      }
    }
  }

  // Try to find instructions section
  const instructionsHeading = html.match(/<h[23][^>]*>\s*(?:instructions?|directions?|steps?|method)\s*<\/h[23]>/i);
  if (instructionsHeading) {
    dbg('[RECIPE] CopyKat - found instructions heading');
    const afterHeading = html.slice(html.indexOf(instructionsHeading[0]) + instructionsHeading[0].length);
    const untilNext = afterHeading.match(/([\s\S]{0,20000}?)(?=<h[23][^>]*>|<\/(?:article|section|div|main)>|$)/i);
    const instructionsSection = untilNext ? untilNext[1] : afterHeading.slice(0, 20000);

    // Extract numbered list items (ol) - these are typically the steps
    const stepListItems = [...instructionsSection.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    dbg('[RECIPE] CopyKat - found step list items:', stepListItems.length);
    
    for (const item of stepListItems) {
      let text = clean(item[1]);
      text = text.replace(/^\d+[.)]\s+/, "").replace(/^[�\-*]\s+/, "").trim();
      if (text && text.length > 5 && !/^(servings?|yield|prep time|cook time|total time|notes?)/i.test(text)) {
        steps.push(text);
      }
    }

    // If no list items, try paragraphs with numbered content
    if (steps.length === 0) {
      const paragraphs = [...instructionsSection.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
      for (const p of paragraphs) {
        let text = clean(p[1]);
        if (text && text.length > 10 && !/^(servings?|yield|prep time|cook time|total time|notes?)/i.test(text)) {
          // Split on numbers if it's a multi-step paragraph like "1. First step. 2. Second step."
          const parts = text.split(/\s+(\d+[.)]\s+)/).filter(Boolean);
          if (parts.length > 1) {
            for (let i = 1; i < parts.length; i += 2) {
              const stepText = (parts[i] + (parts[i + 1] || "")).replace(/^\d+[.)]\s+/, "").trim();
              if (stepText.length > 5) steps.push(stepText);
            }
          } else if (/\b(preheat|heat|mix|combine|add|place|cook|bake|simmer|stir|remove|turn|add|serve)/i.test(text)) {
            steps.push(text);
          }
        }
      }
      dbg('[RECIPE] CopyKat - extracted steps from paragraphs:', steps.length);
    }
  }

  // Fallback: extract from visible text if structured parsing didn't work
  if (ingredients.length < 2 || steps.length < 1) {
    dbg('[RECIPE] CopyKat - trying visible text extraction as fallback');
    const visible = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

    // Find "Ingredients" and "Instructions" in visible text
    const ingIdx = visible.toLowerCase().lastIndexOf('ingredients');
    const instIdx = visible.toLowerCase().lastIndexOf('instructions');

    if (ingIdx >= 0 && ingredients.length < 2) {
      const afterIng = visible.slice(ingIdx + 10);
      const untilInst = instIdx > ingIdx ? afterIng.slice(0, instIdx - ingIdx - 10) : afterIng.slice(0, 5000);
      const ingLines = untilInst.split(/[.,;]\s+|\n+/).map(l => l.trim()).filter(l => {
        return l.length > 5 && l.length < 200 && /\d/.test(l) && 
               !/^(servings?|yield|prep time|cook time|total time|instructions?|directions?)/i.test(l);
      });
      if (ingLines.length >= 2) {
        ingredients.length = 0;
        ingredients.push(...ingLines.slice(0, 25));
      }
    }

    if (instIdx >= 0 && steps.length < 1) {
      const afterInst = visible.slice(instIdx + 12);
      const stepLines = afterInst.split(/\d+[.)]\s+|(?:preheat|heat|mix|combine|add|place|cook|bake|simmer|stir|remove|turn|serve)/i)
                                 .map(l => l.trim())
                                 .filter(l => {
                                   return l.length > 10 && l.length < 300 && 
                                          !/^(servings?|yield|prep time|cook time|total time|notes?)/i.test(l);
                                 });
      if (stepLines.length >= 1) {
        steps.length = 0;
        steps.push(...stepLines.slice(0, 25));
      }
    }
  }

  dbg('[RECIPE] CopyKat - final counts', { ingredients: ingredients.length, steps: steps.length });

  if (!ingredients.length && !steps.length) return null;

  return { ingredients, steps };
}

// -------------- screen state --------------
type ImageSourceState =
  | { kind: "none" }
  | { kind: "url-og"; url: string; resolvedImageUrl: string }
  | { kind: "picker"; localUri: string }
  | { kind: "camera"; localUri: string };

export default function CaptureScreen() {
  // -------------- tiny utils --------------
  // wait || give up
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
    try { const r = await fetch(u); if ((r as any)?.url) return (r as any).url as string; } catch (e) { try { dbg('G�� try-block failed:', safeErr(e));  } catch {} }
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
    } catch (e) { return u.trim(); try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
  }
  function isTikTokLike(url: string): boolean {
    try { const h = new URL(url).hostname.toLowerCase(); return h === "www.tiktok.com" || h.endsWith(".tiktok.com") || h === "tiktok.com" || h === "vm.tiktok.com"; } catch (e) { return /tiktok\.com/i.test(url); }
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
      } catch (e) { try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
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
    const host = (() => { try { return new URL(url).hostname; } catch (e) { return ""; } })();
    const brand = host ? hostToBrand(host) : "";
    const splitters = [" | ", " - ", " \u2022 ", " - "];
    for (const sp of splitters) {
      const parts = s.split(sp);
      if (parts.length > 1) {
        const last = parts[parts.length - 1].trim().toLowerCase();
        if (brand && (last === brand || last.includes(brand))) { s = parts.slice(0, -1).join(sp).trim(); break; }
      }
    }
    s = s.replace(/\s+[\-\|\u2022-]\s*(tiktok|food\s*network|allrecipes|youtube)\s*$/i, "").trim();
    s = s.replace(/\b\(?video\)?\b\s*$/i, "").trim();
    return s;
  }
  // ------------------------------
  // =�� Title helpers (fixed)
  // ------------------------------

  /** Turn a TikTok caption into a short, pretty recipe title */

  const TITLE_ING_TOKEN = /(\b(?:cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|clove|cloves|stick|sticks|tablespoons?)\b)/i;
  const TITLE_SERVING_TOKEN = /\b(serves?|servings?|serving size|makes|feeds|yield|yields)\b/i;
  const TITLE_STEP_TOKEN = /\b(step\s*\d+|steps?|instructions?|directions?|method)\b/i;
  const TITLE_NUMBER_WORD = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i;
  function looksLikeDishTitle(line: string): boolean {
    const s = (line || "").trim();
    if (!s) return false;
    if (s.length < 3 || s.length > 80) return false;
    if (/^[\d\u2022*\-]/.test(s)) return false;
    if (TITLE_STEP_TOKEN.test(s)) return false;
    if (/https?:\/\//i.test(s)) return false;
    if (/[#@]/.test(s)) return false;
    const words = s.split(/\s+/).filter(Boolean);
    if (!words.length) return false;
    const hasLetters = /[A-Za-z]/.test(s);
    if (!hasLetters) return false;
    if (/\b(see more|open app|global|video|community|watch now|follow us|follow me|follow for)\b/i.test(s)) return false;
    // Reject "Follow us for" explicitly
    if (/^follow\s+us\s+for/i.test(s)) return false;
    const hasUnits = TITLE_ING_TOKEN.test(s);
    const hasQty = /\d/.test(s);
    if (hasUnits && hasQty) return false;
    if (hasUnits && TITLE_NUMBER_WORD.test(s)) return false;
    if (TITLE_SERVING_TOKEN.test(s)) return false;
    if (/^for\b/i.test(s)) return false;
    if (words.length === 1) return /^[A-Z][A-Za-z'()-]{3,}$/.test(s);
    return true;
  }
function findDishTitleFromText(source: string, url: string): string | null {
  const lines = (source || "")
    .split(/\n+/)
    .map((line) => normalizeDishTitle(cleanTitle(line, url)))
    .map((line) => line.replace(/^[\s\-\u2022.]+/, "").trim())
    .filter(Boolean);
  for (const line of lines) {
    if (looksLikeDishTitle(line)) return line;
  }
  return null;
}

  function isBadTitleCandidate(s: string): boolean {
    if (!s) return true;
    if (TITLE_STEP_TOKEN.test(s)) return true;
    if (/[\u2022]/.test(s)) return true;
    if (TITLE_SERVING_TOKEN.test(s)) return true;
    if (TITLE_ING_TOKEN.test(s) && (/\d/.test(s) || TITLE_NUMBER_WORD.test(s))) return true;
    if (/^for\b/i.test(s)) return true;
    if (s.length > 120) return true;
    if (/\b(see more|open app|global video community|watch now|watch video)\b/i.test(s)) return true;
    // Reject ingredient phrases - these are ingredients, not titles
    if (/\b(to taste|pinch|dash|salt and pepper|salt & pepper)\b/i.test(s.toLowerCase())) return true;
    if (/^(salt|pepper|garlic|onion)/i.test(s) && /(and|&|to taste)/i.test(s.toLowerCase())) return true;
    return false;
  }
  function scoreTitleCandidate(line: string): number {
    const s = line.trim();
    if (!s) return -Infinity;
    let score = 0;
    const lengthTarget = 22;
    score += Math.max(0, 24 - Math.abs(s.length - lengthTarget));
    const wordCount = s.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 2 && wordCount <= 6) score += 8;
    if (wordCount === 1) score += 4;
    if (!/[,:;]/.test(s)) score += 3;
    if (!/[()]/.test(s)) score += 1;
    if (/^[A-Z]/.test(s)) score += 2;
    if (/\bwith\b/i.test(s)) score -= 2;
    if (/\bfor\b/i.test(s)) score -= 4;
    if (TITLE_NUMBER_WORD.test(s)) score -= 3;
    return score;
  }
  // Turns a TikTok caption into a short, neat title candidate (kid-friendly)
  // Turns a TikTok caption into a short, neat title candidate (kid-friendly)
  // Turns a TikTok caption into a short, neat title candidate (kid-friendly)
  function captionToNiceTitle(raw?: string): string {
    if (!raw) return "";
    const original = String(raw);
    const stripUiPrompts = (value: string) =>
      String(value || "")
        .replace(/^(?:\s*(?:see more|see less|open in app|open app|view more|watch now|watch video|read more|show more|continue reading|more|global video community)\b[:\-\s]*)+/i, "")
        .trim();
    const stripCountPrefix = (value: string) =>
      value
        .replace(/^\s*\d[\d,.\s]*\s+likes?,?\s*\d[\d,.\s]*\s+comments?\s*[-�:]?\s*/i, "")
        .replace(/^\s*\d[\d,.\s]*\s+likes?\s*[-�:]?\s*/i, "")
        .replace(/^\s*\d[\d,.\s]*\s+comments?\s*[-�:]?\s*/i, "");
    const stripAuthorPrefix = (value: string) =>
      value.replace(/^[^:]*\d[^:]*:\s*(?=["�']|$)/, "");

    let s = stripCountPrefix(stripUiPrompts(original)).replace(/^[\s\n\r]+/, "");

    s = s
      .replace(/\r|\t/g, " ")
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/[#@][\w_]+/g, "")
      .replace(/(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    s = stripAuthorPrefix(stripCountPrefix(stripUiPrompts(s)));

    const cutWords = /(ingredients?|directions?|instructions?|method|prep\s*time|cook\s*time|total\s*time|servings?|yields?|calories?|kcal|for\s+the\b|you'?ll\s+need)/i;
    const cutIdx = s.search(cutWords);
    if (cutIdx >= 0) {
      s = cutIdx > 0 ? s.slice(0, cutIdx).trim() : "";
    }

    if (/^ingredients?\b/i.test(s)) s = "";

    const firstLine = (s.split(/\n/)[0] || s).trim();
    const firstSentence = firstLine.split(/(?<=\.)\s+/)[0];
    s = stripAuthorPrefix(stripCountPrefix(stripUiPrompts(firstSentence && firstSentence.length >= 6 ? firstSentence.trim() : firstLine)));

    if (!s || /^ingredients?\b/i.test(s)) {
      const lines = original
        .split(/\r?\n/)
        .map((line) =>
          stripAuthorPrefix(
            stripCountPrefix(
              stripUiPrompts(
                line
                  .replace(/^[\s\u2022*\-]+/, "")
                  .replace(/[#@][\w_]+/g, "")
                  .replace(/https?:\/\/\S+/gi, "")
                  .trim()
              )
            )
          )
        )
        .filter((line) => line && !/^(see more|open app|global video community)$/i.test(line));
      const alt = lines.find((line) => !/^(ingredients?|directions?|instructions?|method)\b/i.test(line) && !/^for\b/i.test(line) && !/^to\b/i.test(line));
      if (alt) s = alt;
    }

    s = stripAuthorPrefix(
      stripCountPrefix(
        stripUiPrompts(
          s.replace(/\s*[|\u2022\u2013-]\s*(TikTok|YouTube|Instagram|Pinterest|Allrecipes|Food\s*Network|NYT\s*Cooking).*/i, "")
           .replace(/\s*\.$/, "")
           .replace(/[\u2013-]/g, "-")
           .replace(/\s+/g, " ")
        )
      )
    )
      .replace(/^[\"�']+/, "")
      .replace(/[\"�']+$/, "");

    if (/^ingredients?\b/i.test(s) || isBadTitleCandidate(s)) return "";

    return s;
  }
  /** =��+ normalizeDishTitle: trim hype and keep only the dish name.
   *  Example: "Smoky Poblano Chicken & Black Bean Soup Dive into..." 
   *           -> "Smoky Poblano Chicken and Black Bean Soup"
   */
  function normalizeDishTitle(input: string): string {
    if (!input) return "";
    let s = String(input);

    // Friendlier: replace ampersand
    s = s.replace(/&/g, " and ");
    // Strip common emoji/pictographs that can wrap Instagram/TikTok titles
    s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ");
    s = s.replace(/\uFE0F/g, " ");

    // Cut off common promo/lead-in phrases that come after the dish name
    // Only match when these phrases appear AFTER a substantial dish name (at least 10 chars)
    // This prevents removing "The best" when it's part of the actual title at the start
    s = s.replace(/(.{10,}?)\s+(?:Dive into|Try|Make|Learn|Watch|How to|This|These|Perfect for|Great for|So easy|Super easy|You'?ll love|You will love|Crave|Craving|Best ever|Incredible|Amazing)\b.*$/i, "$1");

    // Remove anything after exclamation || question marks
    s = s.replace(/\s*[!?].*$/, "");

    // Remove site tails like " | TikTok"
    s = s.replace(/\s*[|\u2022\u2013-]\s*(?:tiktok|youtube|instagram|pinterest).*$/i, "");

    // If multiple sentences, keep just the first
    const firstSentence = s.split(/(?<=\.)\s+/)[0];
    s = firstSentence || s;

    // Tidy whitespace and trailing dot; strip quotes
  s = s.replace(/["""']/g, "");
  // Remove invisible / zero-width characters that sometimes survive scraping
  s = s.replace(/[\u200B-\u200F\uFEFF\u2060-\u2064]/g, "");
    s = s.replace(/\s{2,}/g, " ").replace(/\s+\.$/, "").trim();

    return s;
  }
  /** =���n+� safeSetTitle: only accept strong, cleaned titles and remember strongest. */
  function safeSetTitle(
    candidate: string | null | undefined,
    url: string,
    current: string,
    dbg?: (...args:any[])=>void,
    source = "candidate"
  ) {
    const raw = (candidate ?? "").trim();
    if (!raw) return;
    const cleaned = normalizeDishTitle(cleanTitle(raw, url));
    if (isWeakTitle(cleaned)) { dbg?.("=���n+� TITLE rejected (weak):", source, JSON.stringify(cleaned)); return; }
    // Don't allow junk TikTok titles to override good ones
    if (isTikTokJunkTitle(cleaned)) { dbg?.("=���n+� TITLE rejected (junk):", source, JSON.stringify(cleaned)); return; }
    const prev = (strongTitleRef.current || "").trim();
    if (!prev || cleaned.length > prev.length) {
      strongTitleRef.current = cleaned;
      dbg?.("=���n+� TITLE strongest updated:", source, JSON.stringify(cleaned));
    }
    // If we already have a good title, don't let weaker/later ones override it
    if (!isWeakTitle(current) && !isTikTokJunkTitle(current) && current.trim().length > 0) {
      // Only override if the new title is significantly better (longer and not junk)
      if (!(cleaned.length > current.length * 1.2 && !isTikTokJunkTitle(cleaned))) {
        dbg?.("=���n+� TITLE kept existing:", JSON.stringify(current), "over", JSON.stringify(cleaned), "from", source);
        return;
      }
    }
    setTitle(cleaned);
    dbg?.("=���n+� TITLE set:", source, JSON.stringify(cleaned));
  }




  /** Decide if a TikTok-ish title is junk */
  function isTikTokJunkTitle(s?: string | null) {
    const t = (s || "").toLowerCase().trim();
    if (!t) return true;
    if (t === "tiktok") return true;
    if (t === "make your day") return true;
    if (t === "tiktok - make your day" || t === "tiktok | make your day") return true;
    if (t.startsWith("tiktok -") || t.startsWith("tiktok |") || t.startsWith("tiktok �")) return true;
    if (t.includes("tiktok") && t.includes("make your day")) return true;
    if (/^original (sound|audio)\b/.test(t)) return true;
    if (/today'?s top videos?/.test(t)) return true;
    return false;
  }

  /** Decide if current title is too weak to keep */
  function isWeakTitle(t?: string | null) {
    const s = (t || "").trim();
    if (!s) return true;
    if (isTikTokJunkTitle(s)) return true;
    const lower = s.toLowerCase();
    if (lower === "instagram" || lower === "see more" || lower === "global video community" || lower === "continue on web") return true;
    if (/^(?:\d+|[���????????????])/.test(s.trim())) return true;
    if (/\b(likes?|views?|comments?|followers?|shares?)\b/.test(lower)) return true;
    if (/@/.test(s)) return true;
    if (/\b on (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/.test(lower)) return true;
    if (/\bjuice of\b/.test(lower)) return true;
    if (/\d/.test(s) && /\b(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|clove|cloves|garlic|lemon|salt|pepper|stick|sticks|ml|g|gram|kg)\b/i.test(s)) return true;
    // Reject obvious ingredient-only phrases like "salt and pepper"
    try {
      const ingredientToken = /\b(?:salt|pepper|garlic|onion|butter|sugar|oil|vinegar|soy sauce|olive oil|lemon|lime|parsley|cilantro|basil|tomato|cream|cheese)\b/i;
      if (ingredientToken.test(s)) {
        const words = s.split(/\s+/).filter(Boolean);
        const ingredientCount = words.filter((w) => ingredientToken.test(w)).length;
        const nonIngredientCount = words.length - ingredientCount;
        if (words.length <= 3 && ingredientCount >= 2) return true;
        if (nonIngredientCount <= 1 && words.length <= 4) return true;
      }
    } catch {}
    if (lower === "food network" || lower === "allrecipes" || lower === "youtube") return true;
    // reject generic, non-dish phrases
    if (/^(delicious|tasty|yummy|good|amazing)\s+(food|recipe|dish)$/i.test(s)) return true;
    if (/(^|\b)(delicious|tasty|yummy|good|amazing)\b/.test(lower) && /(\bfood\b|\brecipe\b|\bdish\b)/.test(lower) && s.length <= 24) return true;
    if (s.length < 4) return true;
    if (/^\d{6,}$/.test(s)) return true;
    // If it starts directly with "Ingredients:" it's not a real title
    if (/^\s*ingredients?:/i.test(s)) return true;
    // Reject ingredient phrases - "Salt and pepper to taste" is ALWAYS an ingredient, never a title
    if (/\b(to taste|pinch|dash|salt and pepper|salt & pepper)\b/i.test(lower)) return true;
    if (/^(salt|pepper|garlic|onion)/i.test(s) && /(and|&|to taste)/i.test(lower)) return true;
    return false;
  }

  // =��� Find "Ingredients" and "Steps" inside one long TikTok caption
  function sectionizeCaption(raw: string) {
    const s = (raw || "").replace(/\r/g, "\n");
    const low = s.toLowerCase();
    // find anchors
    const iIdx = low.search(/\bingredients?\b/);
    const sIdx = low.search(/\b(steps?|directions?|method|instructions?)\b/);

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
      // Extract consecutive bullet/number lines after the Ingredients header as the ingredient block.
      const after = s.slice(iIdx).replace(/^\s*ingredients?:?\s*/i, "");
      const lines = after.split(/\n+/);
      const ingLines: string[] = [];
      let cut = lines.length;
      let inIngredientSection = true;
      for (let i = 0; i < lines.length; i++) {
        const l = (lines[i] || '').trim();
        if (!l) { // blank line - check if next lines look like steps and cut
          const next = (lines.slice(i+1).find(x => x.trim().length>0) || '').trim();
          if (/^(steps?|directions?|method|instructions?)\b/i.test(next) || /^(Melt|Add|Heat|Cook|Whisk|Stir|Bring|Simmer|Boil|Turn up|Combine|Once|Preheat|Mix)\b/i.test(next)) { cut = i+1; break; }
          continue;
        }
        // Check if this is a section header like "For the Cake:" - keep it but continue collecting ingredients
        const isSectionHeader = /^For\s+(?:the\s+)?[^:]+:\s*$/i.test(l);
        if (isSectionHeader) {
          ingLines.push(l);
          inIngredientSection = true;
          continue;
        }
        // Check if line looks like an ingredient (has quantity/unit, or starts with bullet/number)
        const hasQuantityUnit = /(\d+(?:\/\d+)?(?:\.\d+)?|(?:�|�|�))\s*(?:cup|cups|tsp|tsps|tbsp|tbsps|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|liter|litre|clove|cloves|egg|eggs|stick|sticks|slice|slices|can|cans|package|packages|bunch|bunches|head|heads|piece|pieces|fillet|fillets|strip|strips|stalk|stalks|bottle|bottles|jar|jars|box|boxes|bag|bags|container|containers)\b/i.test(l);
        if (/^(?:[\-\*\u2022]\s+|\d+[\.)]\s+)/.test(l) || hasQuantityUnit) { 
          ingLines.push(l); 
          inIngredientSection = true;
          continue; 
        }
        // If we're in an ingredient section and this line has common ingredient words, keep it
        if (inIngredientSection && /(cup|tsp|tbsp|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|liter|litre|salt|pepper|cheese|butter|flour|sugar|vanilla|cream|mascarpone)/i.test(l)) { 
          ingLines.push(l); 
          continue; 
        }
        // If we've collected ingredients and this doesn't look like one, stop
        if (ingLines.length > 0 && !isSectionHeader) {
          cut = i;
          break;
        }
      }
      ing = ingLines.join("\n");
      steps = lines.slice(cut).join("\n");
    } else if (sIdx >= 0) {
      steps = s.slice(sIdx);
    } else {
      // No explicit headers found - try to detect ingredients by looking for quantity+unit patterns
      // This handles cases like "See more\n1 lb beef 3 cups broth..."
      const quantityUnitPattern = /(\d+(?:\/\d+)?(?:\.\d+)?|(?:�|�|�))\s*(?:cup|cups|tsp|tsps|tbsp|tbsps|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|liter|litre|clove|cloves|egg|eggs|stick|sticks|slice|slices|can|cans|package|packages|bunch|bunches|head|heads|piece|pieces|fillet|fillets|strip|strips|stalk|stalks|bottle|bottles|jar|jars|box|boxes|bag|bags|container|containers)\b/i;
      const firstIngMatch = s.search(quantityUnitPattern);
      
      if (firstIngMatch >= 0) {
        // Found a quantity+unit pattern - this likely starts the ingredients
        // Look for where ingredients end (steps start or end of meaningful content)
        const afterIng = s.slice(firstIngMatch);
        const lines = afterIng.split(/\n+/);
        const ingLines: string[] = [];
        let cut = lines.length;
        
        // Also check for ingredients in the same line (space-separated)
        const firstLine = lines[0] || '';
        if (firstLine && quantityUnitPattern.test(firstLine)) {
          // This line likely contains multiple ingredients separated by spaces
          // We'll let explodeIngredientsBlock handle splitting them
          ingLines.push(firstLine);
        }
        
        for (let i = 1; i < lines.length; i++) {
          const l = (lines[i] || '').trim();
          if (!l) {
            const next = (lines.slice(i+1).find(x => x.trim().length>0) || '').trim();
            if (/^(steps?|directions?|method|instructions?)\b/i.test(next) || /^(Melt|Add|Heat|Cook|Whisk|Stir|Bring|Simmer|Boil|Turn up|Combine|Once|Preheat|Mix|Season|Place|Remove|Serve|Garnish)\b/i.test(next)) {
              cut = i+1;
              break;
            }
            continue;
          }
          // Check if this line looks like an ingredient (has quantity+unit or common ingredient words)
          if (quantityUnitPattern.test(l) || /^(?:[\-\*\u2022]\s+|\d+[\.)]\s+)/.test(l) || 
              /(cup|tsp|tbsp|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|liter|litre|salt|pepper|diced|sliced|minced|chopped|beef|chicken|pork|fish|onion|garlic|pepper|bell pepper|tomato|cheese|butter|oil|flour|sugar)/i.test(l)) {
            ingLines.push(l);
            continue;
          }
          // Check if this line looks like a step (action verbs)
          if (/^(Melt|Add|Heat|Cook|Whisk|Stir|Bring|Simmer|Boil|Turn up|Combine|Once|Preheat|Mix|Season|Place|Remove|Serve|Garnish|In a|Pour|Drizzle|Sprinkle|Top|Layer)\b/i.test(l)) {
            cut = i;
            break;
          }
          // If we've collected some ingredients and this line doesn't look ingredient-like, stop
          if (ingLines.length > 0) {
            cut = i;
            break;
          }
        }
        
        if (ingLines.length > 0) {
          ing = ingLines.join("\n");
          steps = lines.slice(cut).join("\n");
          before = s.slice(0, firstIngMatch).trim();
        }
      }
    }

    if (!ing && !steps) return { before, ing: "", steps: "" };
    
    // Calculate before - everything before ingredients/steps, but stop at "Ingredients:" if it appears in the title area
    const beforeEnd = Math.min(...[iIdx, sIdx].filter(x => x >= 0));
    let beforeText = before || (beforeEnd >= 0 ? s.slice(0, beforeEnd).trim() : s.trim());
    
    // If "Ingredients:" appears in the before text, cut it off there (title shouldn't include ingredients)
    const ingInBefore = beforeText.toLowerCase().search(/\bingredients?\s*:/);
    if (ingInBefore >= 0) {
      beforeText = beforeText.slice(0, ingInBefore).trim();
    }
    
    // Also remove "See more" and similar TikTok UI text from the beginning
    beforeText = beforeText.replace(/^(see\s+more|less|more|show\s+more)\s*/i, "").trim();
    
    return { before: beforeText, ing, steps };
  }

  // =��� Turn "Ingredients 1 lb chicken 1 cup panko ..." into line items
  function explodeIngredientsBlock(block: string) {
    if (!block) return "";

    let txt = block
      .replace(/^\s*ingredients?:?/i, "")    // drop the heading
      .replace(/[\u2022\u25CF\u25CB]/g, "\u2022") // normalize bullets
      .replace(/\u200B/g, "") // remove zero-width spaces
      .replace(/\s{2,}/g, " ")
      .trim();
    
    // Handle section headers like "For the Cake:" - split them onto separate lines
    // so they don't get merged with ingredients
    txt = txt.replace(/\b(For the [^:]+:)\s+/gi, "\n$1\n");

    // rule A: split on explicit bullets
    txt = txt.replace(/\s*\u2022\s*/g, "\n\u2022 ");

    // Expanded unit pattern for better matching
    const unitPattern = "(?:cup|cups|tsp|tsps|tbsp|tbsps|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|liter|litre|clove|cloves|egg|eggs|stick|sticks|slice|slices|can|cans|package|packages|bunch|bunches|head|heads|piece|pieces|fillet|fillets|strip|strips|stalk|stalks|bottle|bottles|jar|jars|box|boxes|bag|bags|container|containers)";

    // rule B: split on ", " || "; " **when** there's a quantity/unit before it
    txt = txt.replace(
      new RegExp(`(\\d+(?:\\.\\d+)?|(?:�|�|�))\\s*${unitPattern}\\b\\s*[,;]\\s*`, "gi"),
      "$&\n"
    );

    // rule C: split when a new quantity+unit appears without punctuation
    txt = txt.replace(
      new RegExp(`\\s(?=(\\d+(?:\\/\\d+)?(?:\\.\\d+)?|(?:�|�|�))\\s*${unitPattern}\\b)`, "gi"),
      "\n"
    );

    const lines = txt
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (/^[-*\u2022]/.test(l) ? l : `\u2022 ${l}`));

    return ["Ingredients:", ...lines].join("\n");
  }
  // G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��
// ELI5: make the words easy for our parser
// - turn fancy fractions (-+) into normal " 1/2"
// - put a space between numbers and units ("1lb" -> "1 lb", "1 1/2lb" -> "1 1/2 lb")
// - we do this BEFORE we call parseRecipeText
// G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��G��

function normalizeUnicodeFractions(s: string): string {
  return (s || "")
    .replace(/-+/g, " 1/4")
    .replace(/-+/g, " 1/2")
    .replace(/-+/g, " 3/4");
}

function preCleanIgCaptionForParsing(s: string): string {
  // 1) Remove Instagram metadata prefix: "898 likes, 11 comments - username on date:"
  let out = String(s || "");
  out = out.replace(/^\s*\d+[\d,.\s]*\s+likes?,?\s*\d+[\d,.\s]*\s+comments?\s*-\s*[^:]+(?:\s+on\s+[^:]+)?:\s*/i, "");
  // Also handle quoted title pattern: "metadata: "Recipe Title" -> Recipe Title
  out = out.replace(/^[^"]*["'\u201c\u201d]\s*([^"'\u201d\u201c]+)["'\u201d\u201c]/i, "$1");
  
  // 2) make fractions friendly
  out = normalizeUnicodeFractions(out);

  // 3) add a space between quantity (with optional mixed fraction) and unit
  //    examples: "1lb" -> "1 lb", "1 1/2lb" -> "1 1/2 lb", "12oz" -> "12 oz"
  //    units we care about here; extend if you like
  out = out.replace(
    /\b(\d+(?:\s+\d+\/\d+)?)(?=(lb|lbs|pound|pounds|oz|ounce|ounces|g|kg|ml|l)\b)/gi,
    "$1 "
  );

  // 4) tame ellipses so they do not leak as garbled characters
  out = out.replace(/\u2026/g, "...");

  // 5) drop naked likes/comments counters (standalone lines)
  out = out.replace(/^\s*\d+[\d,.\s]*\s+likes?.*$/gim, "");
  out = out.replace(/^\s*\d+[\d,.\s]*\s+comments?.*$/gim, "");

  return out.trim();
}

const TEXT_NUMBER_PATTERN = /\b(one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|third|couple|few|handful)\b/i;
const STEP_INSTRUCTION_VERB = /^(add|mix|combine|stir|whisk|fold|pour|drizzle|layer|spread|cook|bake|heat|preheat|melt|fry|pan\s*fry|air\s*fry|saute|saut[�e]|sear|brown|season|toss|press|arrange|place|roll|wrap|serve|garnish|top|spoon|transfer|beat|blend|chop|mince|dice|slice|toast|grill|broil|roast|simmer|boil|knead|marinate|let|allow|rest|cover|refrigerate|chill)/i;
const STEP_INSTRUCTION_ANYWHERE = /\b(add|mix|combine|stir|whisk|fold|pour|drizzle|layer|spread|cook|bake|heat|preheat|melt|fry|pan\s*fry|air\s*fry|saute|saut[�e]|sear|brown|season|toss|press|arrange|place|roll|wrap|serve|garnish|top|spoon|transfer|beat|blend|chop|mince|dice|slice|toast|grill|broil|roast|simmer|boil|knead|marinate|enjoy|garnish|sprinkle)\b/i;
const STEP_INSTRUCTION_CUE = /\b(minutes?|seconds?|hour|hours|until|meanwhile|once|then|next|after|before|finally|gradually|cook|bake|stir)\b/i;
const ING_AMOUNT_CLUE = /(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|[\u00BC-\u00BE\u2150-\u215E])/i;
const ING_UNIT_CLUE = /\b(cups?|cup|tsp|teaspoon|teaspoons|tbsp|tablespoon|tablespoons|oz|ounce|ounces|lb|pound|pounds|g|gram|grams|kg|ml|milliliter|milliliters|l|liter|litre|pinch|dash|clove|cloves|stick|sticks|sprig|sprigs|can|cans|head|heads|slice|slices|package|pack|packs|sheet|sheets|bag|bags|bunch|bunches|egg|eggs)\b/i;
const ING_NOTE_START = /^(enough|serve|garnish|enjoy|store|keep|makes|yield|transfer|pour)\b/i;
const SERVINGS_KEYWORD_ANYWHERE = /(\bservings?\b|\bper\s+person\b)/i;
const ING_DUPLICATE_SANITIZE = /[^a-z0-9]+/gi;

function partitionIngredientRows(rows: string[], existingSteps: string[]): { ingredients: string[]; steps: string[] } {
  const extraSteps: string[] = [];
  const kept: string[] = [];
  const keyCounts = new Map<string, number>();

  const sanitize = (value: string) =>
    (value || "")
      .toLowerCase()
      .replace(ING_DUPLICATE_SANITIZE, " ")
      .replace(/\s+/g, " ")
      .trim();

  for (const raw of rows) {
    const trimmed = (raw || "").trim();
    if (!trimmed) continue;
    const normalized = trimmed.replace(/^\d{4}:\s*/, "").trim();
    if (!normalized) continue;
    const key = sanitize(normalized);
    if (!key) continue;
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }

  const seen = new Set<string>();

  for (const raw of rows) {
    const original = (raw || "").trim();
    if (!original) continue;

    let trimmed = original.replace(/^\d{4}:\s*/, "").replace(/^["']+|["']+$/g, "").trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();

    if (/^(?:https?:\/\/|@)/i.test(trimmed)) continue;
    if (/\b(likes?|views?|comments?|followers?|shares?)\b/.test(lower)) continue;
    if (/\b on (jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b/.test(lower)) continue;
    // Drop serving/yield notes that slipped into ingredients
    if (SERVINGS_KEYWORD_ANYWHERE.test(lower) || /^[)\s]*ervings?\b/i.test(trimmed)) continue;
    // Drop dangling fragments like "2 to" or "2-" that are usually part of a servings line
    if (/^\d+\s*(?:to|-)?\s*$/i.test(trimmed)) continue;

    const key = sanitize(trimmed);
    const hasMeasurement =
      ING_AMOUNT_CLUE.test(trimmed) || ING_UNIT_CLUE.test(trimmed) || TEXT_NUMBER_PATTERN.test(trimmed);

    const looksInstruction =
      STEP_INSTRUCTION_ANYWHERE.test(lower) ||
      STEP_INSTRUCTION_CUE.test(lower) ||
      ING_NOTE_START.test(lower);

    if (looksInstruction) {
      if (ING_NOTE_START.test(lower) || lower.startsWith("serves ")) {
        continue;
      }
      extraSteps.push(trimmed);
      continue;
    }

    if (!hasMeasurement && /(to taste|pinch|dash)/i.test(trimmed)) {
      kept.push(trimmed);
      continue;
    }

    if (key && seen.has(key)) {
      continue;
    }

    if (key) {
      seen.add(key);
    }

    kept.push(trimmed);
  }

  return {
    ingredients: kept,
    steps: dedupeNormalized([...existingSteps, ...extraSteps]),
  };
}

function mergeStepFragments(lines: string[]): string[] {
  const merged: string[] = [];
  let fragment: string | null = null;
  const isFragment = (input: string) => {
    const trimmed = input.trim();
    const wordCount = trimmed.split(/\s+/).length;
    return trimmed.length <= 15 || wordCount <= 3;
  };

  for (const raw of lines) {
    const trimmed = (raw || "").trim();
    if (!trimmed) continue;
    if (isFragment(trimmed)) {
      fragment = fragment ? `${fragment} ${trimmed}`.trim() : trimmed;
      continue;
    }
    if (fragment) {
      merged.push(`${fragment} ${trimmed}`.replace(/\s{2,}/g, " ").trim());
      fragment = null;
    } else {
      merged.push(trimmed);
    }
  }
  if (fragment) merged.push(fragment.trim());
  return merged;
}

function stitchBrokenSteps(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const current = (raw || "").trim();
    if (!current) continue;
    const prev = out[out.length - 1] || "";
    const prevLooksOpen = prev && !/[.!?]$/.test(prev);
    const nextLooksContinuation = /^[a-z]/.test(current) && current.length <= 80;
    if (prevLooksOpen && nextLooksContinuation) {
      out[out.length - 1] = `${prev} ${current}`.replace(/\s{2,}/g, " ");
    } else {
      out.push(current);
    }
  }
  return out;
}


  // =��� Turn "Steps 1. Mix 2. Bake ..." into numbered lines
  function explodeStepsBlock(block: string) {
    if (!block) return "";

    let txt = block
      .replace(/^\s*(steps?|directions?|method):?/i, "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();

    // split on "1." "2)" "3 -" etc
    txt = txt.replace(/(?:\s*)(\d+)[\.\)\-]\s*/g, "\n$1. ");
    // also split on bullets
    txt = txt.replace(/\s*\u2022\s*/g, "\n\u2022 ");

    const lines = txt
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l, i) => (/^\d+\./.test(l) ? l : `${i + 1}. ${l}`));

    return ["Steps:", ...lines].join("\n");
  }

  // =��� Build a recipe-looking text purely from CAPTION
  function captionToRecipeText(caption: string) {
    const { before, ing, steps } = sectionizeCaption(caption);
    const ingBlock = explodeIngredientsBlock(ing);
    const stepBlock = explodeStepsBlock(steps);
    const beforeBlock = before ? `Title/Captions:\n${before.trim()}` : "";
    return [beforeBlock, ingBlock, stepBlock].filter(Boolean).join("\n\n").trim();
  }

  // Extract full caption from TikTok SIGI_STATE JSON
  function extractCaptionFromSigi(sigi: any, dbg?: (m: string) => void): string | null {
    if (!sigi || typeof sigi !== 'object') {
      dbg?.("extractCaptionFromSigi: sigi is null or not an object");
      return null;
    }
    
    const candidates: string[] = [];
    const seen = new Set<string>();
    const push = (value: any, source?: string) => {
      if (!value) return;
      const str = Array.isArray(value) ? value : [value];
      for (const entry of str) {
        if (entry == null) continue;
        const text =
          typeof entry === 'string'
            ? entry
            : typeof entry === 'number'
            ? String(entry)
            : typeof entry === 'object' && entry !== null && typeof entry.desc === 'string'
            ? entry.desc
            : typeof entry === 'object' && entry !== null && typeof entry.caption === 'string'
            ? entry.caption
            : typeof entry === 'object' && entry !== null && typeof entry.title === 'string'
            ? entry.title
            : null;
        if (!text) continue;
        const cleaned = text.toString().trim();
        if (!cleaned || seen.has(cleaned)) continue;
        seen.add(cleaned);
        candidates.push(cleaned);
        dbg?.(`Found caption candidate from ${source || 'unknown'} (length: ${cleaned.length}): ${cleaned.slice(0, 100)}...`);
      }
    };

    // classic module
    const im = sigi?.ItemModule;
    if (im && typeof im === 'object') {
      dbg?.("Checking ItemModule...");
      const first: any = Object.values(im)[0];
      if (first && typeof first === 'object') {
        push(first?.desc, "ItemModule.desc");
        push(first?.shareInfo?.shareTitle, "ItemModule.shareInfo.shareTitle");
        push(first?.title, "ItemModule.title");
      }
    }

    // universal data scopes (photo mode etc.) - this is the most common structure
    const scope = sigi?.__DEFAULT_SCOPE__;
    if (scope && typeof scope === 'object') {
      dbg?.(`Checking __DEFAULT_SCOPE__ with ${Object.keys(scope).length} keys...`);
      const structs: any[] = [];
      const visited = new Set<any>();
      const collectStructs = (node: any, out: any[], seen: Set<any>, depth: number) => {
        if (!node || typeof node !== 'object') return;
        if (seen.has(node) || depth > 6) return;
        seen.add(node);
        if (node.itemStruct && typeof node.itemStruct === 'object') {
          out.push(node.itemStruct);
        }
        if (node.itemInfo && typeof node.itemInfo === 'object') {
          collectStructs(node.itemInfo, out, seen, depth + 1);
        }
        if (node.state && typeof node.state === 'object') {
          collectStructs(node.state, out, seen, depth + 1);
        }
        if (node.preload && typeof node.preload === 'object') {
          collectStructs(node.preload, out, seen, depth + 1);
        }
        // Also check for direct desc/caption fields
        if (typeof node.desc === 'string') {
          out.push({ desc: node.desc });
        }
        if (typeof node.caption === 'string') {
          out.push({ caption: node.caption });
        }
        for (const val of Object.values(node)) {
          if (val && typeof val === 'object') {
            collectStructs(val, out, seen, depth + 1);
          }
        }
      };
      for (const [key, node] of Object.entries(scope)) {
        dbg?.(`Processing __DEFAULT_SCOPE__ key: ${key}`);
        collectStructs(node, structs, visited, 0);
      }
      dbg?.(`Found ${structs.length} itemStructs in __DEFAULT_SCOPE__`);
      for (const itemStruct of structs) {
        push(itemStruct?.desc, "itemStruct.desc");
        push(itemStruct?.imagePost?.caption, "itemStruct.imagePost.caption");
        push(itemStruct?.imagePost?.title, "itemStruct.imagePost.title");
        push(itemStruct?.video?.desc, "itemStruct.video.desc");
        push(itemStruct?.video?.title, "itemStruct.video.title");
      }
    }

    // SEO/share spots (photo pages sometimes use these)
    const metaSources = [sigi?.SEOState, sigi?.ShareMeta, sigi?.app, sigi?.SEOMeta];
    for (const source of metaSources) {
      if (!source || typeof source !== 'object') continue;
      push(source?.metaParams?.title);
      push(source?.metaParams?.description);
      push(source?.shareMeta?.title);
      push(source?.shareMeta?.description);
    }

    if (candidates.length) {
      candidates.sort((a, b) => b.length - a.length);
      return candidates[0];
    }

    // Generic hunt in the object
    try {
      const s = JSON.stringify(sigi);
      const m = s.match(/"(?:description|desc)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      if (m) {
        return JSON.parse(`"${m[1]}"`);
      }
    } catch {}
    return null;
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
    } catch (e) { return null; try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
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
    } catch (e) { return null; try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
  }
  async function getAnyImageFromPage(url: string): Promise<string | null> {
    try {
      const html = await fetchWithUA(url, 12000, "text");
      const og = extractMetaContent(html, "og:image") || extractMetaContent(html, "twitter:image");
      if (og) return absolutizeImageUrl(og, url);
      return null;
    } catch (e) { return null; try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
  }
  async function getLocalDimensions(uri: string): Promise<{ w: number; h: number }> {
    return await new Promise((resolve) => {
      RNImage.getSize(
        uri,
        (w, h) => resolve({ w: w ?? 0, h: h ?? 0 }),
        () => resolve({ w: 0, h: 0 })
      );
    });
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
      } catch (e) { return null; try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
    }
    return null;
  }
  async function downloadRemoteToLocalImage(url: string, referer?: string): Promise<string | null> {
    const stripQuery = (u: string) => { try { const x = new URL(u); x.search = ""; return x.toString(); } catch (e) { return u; } };
    const candidates: string[] = [url, stripQuery(url)];
    const origin = (() => { try { return referer ? new URL(referer).origin : undefined; } catch (e) { return undefined; } })();
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
        } catch (e) { try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
        try { await FileSystem.deleteAsync(dst, { idempotent: true }); } catch (e) { try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
      }
    }
    return null;
  }

  // -------------- OCR --------------
  async function ocrImageToText(localUri: string): Promise<string | null> {
    try {
      // Preprocess image: compress and ensure it's in a format OCR can handle
      const prepped = await ImageManipulator.manipulateAsync(localUri, [], { 
        compress: 0.96, 
        format: ImageManipulator.SaveFormat.JPEG 
      });
      
      // Use the OCR helper with the preprocessed image
      const { text } = await recognizeImageText(prepped.uri);
      return text?.trim() || null;
    } catch (e) { 
      return null; 
      try { dbg('OCR failed:', safeErr(e)); } catch {} 
    }
  }

  // -------------- NEW: comment scoring & fusion --------------
  // =��� score how "ingredienty/stepy" a comment looks
  function scoreRecipeComment(s: string) {
    let sc = 0;
    const low = s.toLowerCase();
    if (/ingredients?|what you need|for the (?:dough|sauce|filling)|shopping list/.test(low)) sc += 600;
    if (/directions?|steps?|method|how to/.test(low)) sc += 320;
    if (/[0-9-+-+-+]/.test(s)) sc += 160;
    if (/(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|liter|litre)/i.test(s)) sc += 220;
    if (/^(\s*[-*\u2022]|\s*\d+\.)/m.test(s)) sc += 120;
    const lines = s.split(/\r?\n/).length; sc += Math.min(lines, 40) * 6;
    const L = s.length; if (L > 80) sc += 40; if (L > 240) sc += 30; if (L > 900) sc -= 120;
    return sc;
  }
  // =��+ clean up comments (strip "log in/open app" cruft)
  function isJunkComment(s: string) {
    const low = s.toLowerCase();
    if (low.length < 8) return true;
    return /log\s*in|sign\s*in|open app|download|scan the qr|p_search_score|search_video/.test(low);
  }
  function normalizeLines(s: string) {
    // turn inline "1) mix 2) bake" into newline list, keep bullets
    let t = s
      .replace(/\r/g, "\n")
      .replace(/[\u2022\u25CF\u25CB]/g, "\u2022")
      .replace(/(?:\s*[,;]\s*)(?=(?:\d+[\.)]|[-*\u2022]))/g, "\n")
      .replace(/(\d+)[\)\.]\s*/g, "$1. ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return t;
  }
  // =�� build a "recipe-like" text from caption + top comments
  function fuseCaptionAndComments(caption: string, comments: string[], topN = 5) {
    const good = comments.filter((c) => c && !isJunkComment(c)).map((c) => normalizeLines(c));
    const ranked = good.sort((a, b) => scoreRecipeComment(b) - scoreRecipeComment(a));
    const picked = ranked.slice(0, Math.min(topN, ranked.length));
    // separate likely ingredients from likely steps
    const ing: string[] = [], stp: string[] = [];
    for (const c of picked) {
      const lower = c.toLowerCase();
      const looksIng = /ingredients?|what you need|cups?|tsp|tbsp|oz|gram|ml|^[-*\u2022]|\d+\s*(?:cup|tsp|tbsp|oz|g|ml)/im.test(lower);
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

  const [debugLog, setDebugLog] = useState<string>("");
  const [pastedUrl, setPastedUrl] = useState("");
  const [title, setTitle] = useState("");
  // =���n+� strongest good title during this import run
  const strongTitleRef = useRef<string>("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState<string[]>([""]);
  const [ingredientSections, setIngredientSections] = useState<IngredientSection[] | null>(null);
  const [steps, setSteps] = useState<string[]>([""]);
  const [img, setImg] = useState<ImageSourceState>({ kind: "none" });
  
  // Track original import data to detect user corrections
  const originalImportDataRef = useRef<{
    ingredients: string[];
    steps: string[];
    url: string;
    attemptId?: string;
  } | null>(null);
  const ingredientSwipeRefs = useRef<Array<Swipeable | null>>([]);
  const stepSwipeRefs = useRef<Array<Swipeable | null>>([]);
  
  // Helper to track successful imports
  const trackSuccessfulImport = useCallback(async (
    url: string,
    ingredients: string[],
    steps: string[],
    strategy: StrategyName = 'server-html-meta'
  ) => {
    try {
      const siteType = await detectSiteType(url);
      const config = getParserConfig(siteType);
      const attemptId = await logImportAttempt({
        url,
        siteType,
        parserVersion: config.version,
        strategyUsed: strategy,
        success: true,
        confidenceScore: ingredients.length >= 3 ? 'high' : 'medium',
        ingredientsCount: ingredients.length,
        stepsCount: steps.length,
      });
      if (attemptId) {
        console.log(`[TRACKING] Logged successful import: ${attemptId}, strategy: ${strategy}`);
      } else {
        console.warn(`[TRACKING] Failed to log successful import`);
      }
      // Store original import data for correction tracking
      // Canonicalize URL to ensure it matches what we'll compare against in onSave
      const canonicalizedUrl = canonicalizeUrl(url);
      originalImportDataRef.current = {
        ingredients: [...ingredients],
        steps: [...steps],
        url: canonicalizedUrl,
        attemptId: attemptId || undefined,
      };
      console.log(`[TRACKING] Stored original import data for URL: ${canonicalizedUrl}`);
    } catch (err) {
      console.warn('[TRACKING] Error tracking successful import:', err);
      // Silently fail - don't break import flow
    }
  }, []);

  const dbg = useCallback((...args: any[]) => {
    try {
      const line = args
        .map((a) => {
          if (typeof a === "string") return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        })
        .join(" ");
      logDebug("[IMPORT]", line);
    } catch (err) {
      try { logDebug("[IMPORT]", "dbg-failed", String(err)); } catch {}
    }
  }, []);
  const safeErr = useCallback((e: any): string => {
    try {
      if (!e) return "unknown";
      if (typeof e === "string") return e;
      if (e instanceof Error && e.message) return e.message;
      const msg = (e?.message || e?.toString?.() || JSON.stringify(e));
      return typeof msg === "string" ? msg : "unknown";
    } catch {
      return "unknown";
    }
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

  const [instagramScraperVisible, setInstagramScraperVisible] = useState(false);
  const [instagramScraperUrl, setInstagramScraperUrl] = useState("");
  const instagramScraperResolverRef = useRef<((payload: any) => void) | null>(null);

  const [snapFocusY, setSnapFocusY] = useState(FOCUS_Y_DEFAULT);
  const [snapZoom, setSnapZoom] = useState(1.4);
  const [focalPointEditorVisible, setFocalPointEditorVisible] = useState(false);
  const [focalPointEditorImageUri, setFocalPointEditorImageUri] = useState<string>("");

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
    let working = uri;
    const reencode = async (candidate: string) => {
      try {
        const resaved = await ImageManipulator.manipulateAsync(candidate, [], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG });
        return resaved?.uri ?? null;
      } catch (e) { try { dbg('I"A?Ar reencode failed:', safeErr(e)); } catch {} return null; }
    };

    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        const resaved = await reencode(uri);
        if (!resaved) return null;
        working = resaved;
      } else if ((info.size ?? 0) < MIN_LOCAL_BYTES) {
        const resaved = await reencode(uri);
        if (resaved) working = resaved;
      }
    } catch (e) {
      const resaved = await reencode(uri);
      if (!resaved) return null;
      working = resaved;
    }

    let ensured = await ensureMinLocalImage(working);
    if (ensured) return ensured;
    const retry = await reencode(working);
    if (!retry) return null;
    ensured = await ensureMinLocalImage(retry);
    return ensured;
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
      try { await withTimeout(RNImage.prefetch(uri), 1800).catch(() => null); } catch (e) { try { dbg('G�� try-block failed:', safeErr(e));  } catch {} }
      const { w, h } = await getImageDims(uri);
      if ((w >= MIN_IMG_W && h >= MIN_IMG_H) || (w === 0 && h === 0)) return { ok: true, useUri: uri };
      try {
        const dl = await FileSystem.downloadAsync(uri, FileSystem.cacheDirectory + `snap_${Date.now()}.jpg`);
        const fixed = await validateOrRepairLocal(dl.uri);
        if (fixed) return { ok: true, useUri: fixed };
      } catch (e) { try { dbg('G�� try-block failed:', safeErr(e)); } catch {} }
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
    setImprovingSnap(false);
    setTikTokShots([]);
    setAbortVisible(false);
    setStageIndex(0);
    // Reset snapshot and focal point editor states
    setSnapVisible(false);
    setFocalPointEditorVisible(false);
    setFocalPointEditorImageUri("");
    // Reset snap keys to allow fresh snapshot
    setSnapReloadKey((k) => k + 1);
    setSnapResnapKey(0);
  }, []);

  useEffect(() => {
    if (hudVisible && pendingImportUrl) {
      const url = pendingImportUrl;
      setPendingImportUrl(null);
      (async () => {
        bringHudToFront();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await startImport(url);
      })();
    }
  }, [hudVisible, pendingImportUrl, bringHudToFront]);

  // =��� HUD "z-index key" - we bump this whenever a helper modal opens,
  // so the HUD remounts LAST and stays on top like a blanket.
  // Keep a z-index key so we can remount HUD on top of newly opened modals (WebViews)
  const [hudZKey, setHudZKey] = useState(0);
  const bringHudToFront = useCallback(() => setHudZKey((k) => k + 1), []);

  // =��� open tiny web window to read caption + comments
  // G��n+�FIX: DO NOT convert to /embed. Open the real page to expose SIGI/NEXT JSON and allow "see more" clicks.
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
      bringHudToFront(); // =��� tell the HUD to hop back on top
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

  const scrapeInstagramDom = useCallback(async (rawUrl: string): Promise<{
    text?: string; caption?: string; comments?: string[]; bestComment?: string; debug?: string;
  } | null> => {
    const finalUrl = await resolveFinalUrl(ensureHttps(rawUrl.trim()));
    async function runOnce(): Promise<any> {
      return new Promise((resolve) => {
      let resolved = false;
      // Reduced timeout to 10 seconds (fast path should complete in < 1s, full scrape in 3-5s)
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; setInstagramScraperVisible(false); resolve(null); }
      }, 10000);
      
      setInstagramScraperUrl(finalUrl);
      setInstagramScraperVisible(true);
      bringHudToFront();
      
      instagramScraperResolverRef.current = (payload: any) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          setInstagramScraperVisible(false);
          // If payload indicates error, don't retry
          if (payload && (payload.debug?.includes("error:") || payload.debug?.includes("load-error") || payload.debug?.includes("http-error"))) {
            resolve(payload); // Return error payload immediately
          } else {
            resolve(payload || null);
          }
        }
      };
      });
    }

    // First attempt
    let payload: any = await runOnce();
    // Don't retry if we got an error response (including deep link redirects)
    if (payload && (payload.debug?.includes("error:") || payload.debug?.includes("load-error") || 
        payload.debug?.includes("http-error") || payload.debug?.includes("deep-link-redirect"))) {
      return payload; // Return error immediately, don't retry
    }
    const weak = !payload || (!payload.caption && !payload.text);
    // If the first run yielded nothing (but wasn't an error), retry once after a short delay
    if (weak) {
      try { await new Promise(r => setTimeout(r, 400)); } catch {}
      payload = await runOnce();
      // Don't retry again if the second attempt also failed with an error
      if (payload && (payload.debug?.includes("error:") || payload.debug?.includes("load-error") || 
          payload.debug?.includes("http-error") || payload.debug?.includes("deep-link-redirect"))) {
        return payload;
      }
    }
    return payload;
  }, [bringHudToFront]);

  const tryImageUrl = useCallback(async (rawUrl: string, originUrl: string) => {
    const absolute = absolutizeImageUrl(rawUrl, originUrl);
    if (!absolute) {
      dbg("[IMAGE] Invalid image URL:", rawUrl);
      return false;
    }
    dbg("[IMAGE] Trying to download/validate image:", absolute);
    const test = await isValidCandidate(absolute);
    if (test.ok && test.useUri) {
      bumpStage(1);
      if (test.useUri.startsWith("http")) setImg({ kind: "url-og", url: originUrl, resolvedImageUrl: test.useUri });
      else setImg({ kind: "picker", localUri: test.useUri });
      lastGoodPreviewRef.current = test.useUri;
      lastResolvedUrlRef.current = originUrl;
      gotSomethingForRunRef.current = true;
      dbg("[IMAGE] Image successfully set:", test.useUri);
      return true;
    }
    // Relaxed fallback: even if we couldn't pre-download/validate, allow Image to try loading the remote URL.
    try {
      if (/^https?:\/\//i.test(absolute)) {
        bumpStage(1);
        setImg({ kind: "url-og", url: originUrl, resolvedImageUrl: absolute });
        lastGoodPreviewRef.current = absolute;
        lastResolvedUrlRef.current = originUrl;
        gotSomethingForRunRef.current = true;
        dbg("[IMAGE] Image set (fallback, unvalidated):", absolute);
        return true;
      }
    } catch (e) {
      dbg("[IMAGE] Failed to set image:", safeErr(e));
    }
    dbg("[IMAGE] Image download/validation failed");
    return false;
  }, [isValidCandidate, bumpStage, dbg, safeErr]);

  const handleRecipeSite = useCallback(
    async (url: string, html: string) => {
      dbg('[RECIPE] handleRecipeSite called for:', url);
      dbg('[RECIPE] HTML provided, length:', html?.length || 0);
      
      try {
        const host = (() => {
          try {
            return new URL(url).hostname.toLowerCase();
          } catch {
            return "";
          }
        })();
        dbg('[RECIPE] Host detected:', host);
        
        const isGordon = host.includes("gordonramsay.com");
        const isAroundMyFamilyTable = host.includes("aroundmyfamilytable.com");
        const isCopyKat = host.includes("copykat.com");

        const applyExtraction = async (
          data: RecipeExtraction | null | undefined,
          source: string,
          { includeMeta = false }: { includeMeta?: boolean } = {}
        ) => {
          if (!data) return false;
          if (data.title && isWeakTitle(title)) {
            safeSetTitle(data.title, url, title, dbg, source);
          }
          if (data.ingredients && data.ingredients.length >= 2) {
            // Handle ingredient sections - they might come from HTML extraction or JSON-LD
            if (data.ingredientSections && data.ingredientSections.length > 0) {
              // Sections already extracted (from HTML fallback)
              setIngredients(data.ingredients);
              setIngredientSections(data.ingredientSections);
              dbg('[RECIPE] Using ingredient sections from', source, ':', data.ingredientSections.length, 'sections');
            } else if (html && (source === 'jsonld' || source === 'microdata')) {
              // Try to detect sections from HTML if we have it
              // This helps preserve section headers like "For Muffin Batter:" that aren't in JSON-LD
              // IMPORTANT: Use JSON-LD ingredients (they're correct), only use HTML to find section headers
              try {
                // Find section headers in HTML (like "For Muffin Batter:", "For Streusel Topping:")
                const sectionHeaderRegex = /<(?:h[2-4]|p|div|strong|b|li|span)[^>]*>([^<]*(?:For\s+(?:the\s+)?[^:]+:|For\s+[^:]+:)[^<]*)<\/(?:h[2-4]|p|div|strong|b|li|span)>/gi;
                const foundHeaders: Array<{text: string, index: number}> = [];
                let headerMatch;
                while ((headerMatch = sectionHeaderRegex.exec(html)) !== null) {
                  const headerText = headerMatch[1].replace(/<[^>]+>/g, '').trim();
                  if (headerText && /For\s+(?:the\s+)?[^:]+:/i.test(headerText)) {
                    foundHeaders.push({ 
                      text: headerText.replace(/:/g, '').trim(), 
                      index: headerMatch.index || 0 
                    });
                  }
                }
                
                dbg('[RECIPE] Found', foundHeaders.length, 'section headers in HTML:', foundHeaders.map(h => h.text));
                
                if (foundHeaders.length > 0) {
                  // We found section headers! Now count how many list items are in each section
                  // to divide the JSON-LD ingredients accordingly
                  
                  // Find list items between each section header
                  const sectionCounts: number[] = [];
                  
                  for (let i = 0; i < foundHeaders.length; i++) {
                    const headerStart = foundHeaders[i].index;
                    const headerEnd = i < foundHeaders.length - 1 ? foundHeaders[i + 1].index : html.length;
                    const sectionHtml = html.slice(headerStart, headerEnd);
                    
                    // Count list items in this section that look like ingredients
                    const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
                    let count = 0;
                    let liMatch;
                    while ((liMatch = liPattern.exec(sectionHtml)) !== null) {
                      const liText = liMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                      // Only count if it looks like an ingredient (has quantity/unit)
                      if (liText && /\d+\s*(cup|cups|tsp|tbsp|oz|lb|g|kg|ml|l|tablespoon|teaspoon|pound|ounce)/i.test(liText)) {
                        count++;
                      }
                    }
                    sectionCounts.push(count);
                    dbg('[RECIPE] Section', foundHeaders[i].text, 'has', count, 'ingredients');
                  }
                  
                  // Create sections and distribute JSON-LD ingredients
                  const sections: IngredientSection[] = [];
                  let ingredientIndex = 0;
                  
                  for (let i = 0; i < foundHeaders.length && ingredientIndex < data.ingredients.length; i++) {
                    const sectionName = foundHeaders[i].text;
                    const count = sectionCounts[i] || 0;
                    const sectionIngredients: string[] = [];
                    
                    // Take the specified number of ingredients for this section
                    const takeCount = count > 0 ? Math.min(count, data.ingredients.length - ingredientIndex) : 
                                     (i === foundHeaders.length - 1 ? data.ingredients.length - ingredientIndex : 0);
                    
                    for (let j = 0; j < takeCount && ingredientIndex < data.ingredients.length; j++) {
                      sectionIngredients.push(data.ingredients[ingredientIndex]);
                      ingredientIndex++;
                    }
                    
                    if (sectionIngredients.length > 0) {
                      sections.push({ name: sectionName, ingredients: sectionIngredients });
                    }
                  }
                  
                  // Add any remaining ingredients to the last section
                  if (ingredientIndex < data.ingredients.length && sections.length > 0) {
                    while (ingredientIndex < data.ingredients.length) {
                      sections[sections.length - 1].ingredients.push(data.ingredients[ingredientIndex]);
                      ingredientIndex++;
                    }
                  } else if (ingredientIndex < data.ingredients.length) {
                    // No sections created, create ungrouped
                    sections.push({ name: null, ingredients: data.ingredients.slice(ingredientIndex) });
                  }
                  
                  if (sections.length > 0) {
                    // Verify we used all ingredients
                    const totalInSections = sections.reduce((sum, s) => sum + s.ingredients.length, 0);
                    
                    // Determine if sections are actually useful:
                    // 1. All ingredients must be accounted for
                    // 2. We should have at least 2 sections (otherwise why group?)
                    // 3. Each section should have at least 2 ingredients (or it's not really a "section")
                    // 4. At least one section should have 3+ ingredients (shows meaningful grouping)
                    const hasAllIngredients = totalInSections === data.ingredients.length;
                    const hasMultipleSections = sections.length >= 2;
                    const sectionsWithMultipleItems = sections.filter(s => s.ingredients.length >= 2).length;
                    const hasSubstantialSection = sections.some(s => s.ingredients.length >= 3);
                    
                    const shouldUseSections = hasAllIngredients && 
                                             hasMultipleSections && 
                                             sectionsWithMultipleItems >= 2 &&
                                             hasSubstantialSection;
                    
                    if (shouldUseSections) {
                      setIngredients(data.ingredients);
                      setIngredientSections(sections);
                      dbg('[RECIPE] Using', sections.length, 'ingredient sections with', totalInSections, 'total ingredients');
                      bumpStage(2);
                      // Don't return early - continue to handle steps below
                    } else {
                      // Sections don't add value - use flat list
                      const reason = !hasAllIngredients ? 'not all ingredients accounted for' :
                                    !hasMultipleSections ? 'only one section found' :
                                    sectionsWithMultipleItems < 2 ? 'sections too small' :
                                    !hasSubstantialSection ? 'no substantial sections' : 'unknown';
                      dbg('[RECIPE] Not using sections:', reason, '- using flat list');
                      setIngredients(data.ingredients);
                      setIngredientSections(null);
                    }
                  } else {
                    // No sections created, use flat list
                    setIngredients(data.ingredients);
                    setIngredientSections(null);
                  }
                } else {
                  // No sections found, use flat JSON-LD list
                  setIngredients(data.ingredients);
                  setIngredientSections(null);
                }
              } catch (e) {
                dbg('[RECIPE] Error detecting sections from HTML:', safeErr(e));
                // Fallback to flat list if parsing fails
                setIngredients(data.ingredients);
                setIngredientSections(null);
              }
            } else {
              // Not JSON-LD/microdata or no HTML, use flat list
              setIngredients(data.ingredients);
              setIngredientSections(null);
            }
            bumpStage(2);
          }
          if (data.steps && data.steps.length >= 1) {
            setSteps(data.steps);
            bumpStage(3);
          }
          if (data.image) {
            await tryImageUrl(data.image, url);
          }
          if (includeMeta) {
            const anyData = data as any;
            if (anyData?.time && !timeMinutes.trim()) setTimeMinutes(anyData.time);
            if (anyData?.servings && !servings.trim()) setServings(anyData.servings);
          }
          const hasData = hasMeaningfulRecipeData(data);
          // Track successful import if we got meaningful data
          if (hasData && data.ingredients && data.ingredients.length >= 2) {
            await trackSuccessfulImport(url, data.ingredients, data.steps || [], source as StrategyName);
            gotSomethingForRunRef.current = true;
            success = true;
          }
          return hasData;
        };

        const jsonLd = extractRecipeFromJsonLd(html);
        if (jsonLd) {
          dbg('[RECIPE] JSON-LD recipe found');
          dbg('[RECIPE] JSON-LD extracted:', {
            title: jsonLd.title,
            ingredientsCount: jsonLd.ingredients?.length ?? 0,
            stepsCount: jsonLd.steps?.length ?? 0,
            ingredients: jsonLd.ingredients?.slice(0, 3),
            steps: jsonLd.steps?.slice(0, 2),
            debugInfo: (jsonLd as any).__debugInfo,
          });
          // Auto-discover this site if it's not in our list
          await discoverRecipeSiteIfNeeded(url, html);
          const jsonApplied = await applyExtraction(jsonLd, 'jsonld', { includeMeta: true });
          const hasSteps = (jsonLd.steps?.length ?? 0) > 0;
          dbg('[RECIPE] JSON-LD extraction result:', { jsonApplied, hasSteps });
          if (jsonApplied && (!isGordon || hasSteps)) {
            return true;
          }
          if (isGordon) {
            dbg('[RECIPE] Gordon Ramsay HTML fallback after weak JSON-LD');
            const parsed = parseGordonRamsayRecipe(html, url);
            if (await applyExtraction(parsed, 'gordonramsay:html')) {
              return true;
            }
          }
        } else {
          dbg('[RECIPE] No JSON-LD recipe found in HTML');
        }

        const microdata = extractRecipeFromMicrodata(html);
        if (microdata) {
          dbg('[RECIPE] Microdata recipe found');
          dbg('[RECIPE] Microdata extracted:', {
            title: microdata.title,
            ingredientsCount: microdata.ingredients?.length ?? 0,
            stepsCount: microdata.steps?.length ?? 0,
            ingredients: microdata.ingredients?.slice(0, 3),
            steps: microdata.steps?.slice(0, 2),
          });
          // Auto-discover this site if it's not in our list
          await discoverRecipeSiteIfNeeded(url, html);
          const microApplied = await applyExtraction(microdata, 'microdata', { includeMeta: true });
          const hasMicroSteps = (microdata.steps?.length ?? 0) > 0;
          dbg('[RECIPE] Microdata extraction result:', { microApplied, hasMicroSteps });
          if (microApplied && (!isGordon || hasMicroSteps)) {
            return true;
          }
        }

        // Fallback: Try HTML parsing for sites without proper JSON-LD or microdata
        // (e.g., girlcarnivore.com and similar sites)
        // Note: HTML extraction doesn't return title - we use OG title instead
        const htmlExtracted = extractRecipeFromHtml(html);
        if (htmlExtracted) {
          dbg('[RECIPE] HTML fallback extraction found');
          dbg('[RECIPE] HTML extracted:', {
            ingredientsCount: htmlExtracted.ingredients?.length ?? 0,
            stepsCount: htmlExtracted.steps?.length ?? 0,
            ingredients: htmlExtracted.ingredients?.slice(0, 3),
            steps: htmlExtracted.steps?.slice(0, 2),
          });
          // Auto-discover this site if it's not in our list
          await discoverRecipeSiteIfNeeded(url, html);
          // Use OG for title/image, but HTML for ingredients/steps
          const og = await fetchOgForUrl(url);
          if (og?.title && isWeakTitle(title)) {
            safeSetTitle(og.title, url, title, dbg, 'html-fallback:og');
          }
          if (og?.image) {
            await tryImageUrl(og.image, url);
          }
          const htmlApplied = await applyExtraction(htmlExtracted, 'html-fallback', { includeMeta: false });
          const hasHtmlSteps = (htmlExtracted.steps?.length ?? 0) > 0;
          dbg('[RECIPE] HTML fallback extraction result:', { htmlApplied, hasHtmlSteps });
          if (htmlApplied && (!isGordon || hasHtmlSteps)) {
            return true;
          }
        }

        if (isGordon) {
          dbg('[RECIPE] Gordon Ramsay HTML path');
          const parsed = parseGordonRamsayRecipe(html, url);
          if (await applyExtraction(parsed, 'gordonramsay:html')) {
            return true;
          }
        }

        if (isAroundMyFamilyTable) {
          dbg('[RECIPE] Around My Family Table HTML path');
          const parsed = parseAroundMyFamilyTableRecipe(html, url);
          if (parsed && await applyExtraction(parsed, 'aroundmyfamilytable:html')) {
            return true;
          }
        }

        if (isCopyKat) {
          dbg('[RECIPE] CopyKat HTML path');
          const parsed = parseCopyKatRecipe(html, url);
          if (parsed && await applyExtraction(parsed, 'copykat:html')) {
            return true;
          }
        }

        dbg('[RECIPE] handleRecipeSite: All extraction methods exhausted, returning false');
        return false;
      } catch (e) {
        dbg('[RECIPE] handler failed with error:', safeErr(e));
        dbg('[RECIPE] Error stack:', e instanceof Error ? e.stack : 'N/A');
        return false;
      }
    },
    [title, bumpStage, tryImageUrl, dbg, safeErr, timeMinutes, servings]
  );

  

  // =��+ snap TikTok for preview/OCR (embed is ok for a *picture*)
  const autoSnapTikTok = useCallback(async (rawUrl: string, maxAttempts = SNAP_ATTEMPTS) => {
    const { embedUrl, finalUrl } = await resolveTikTokEmbedUrl(rawUrl);
    const target = embedUrl || ensureHttps(rawUrl);
    lastResolvedUrlRef.current = finalUrl || rawUrl;

    snapCancelledRef.current = false;
    setSnapUrl(target);
    setSnapVisible(true);
    bringHudToFront();
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


  // ----------------- THE BOSS: unified import -----------------
  const startImport = useCallback(async (url: string) => {
    const runId = ++importRunIdRef.current;
    // Preserve existing image state - only reset if we don't have one
    const hadExistingImage = img.kind !== "none";
    if (!hadExistingImage) {
      gotSomethingForRunRef.current = false;
    }

    const watchdog = setTimeout(async () => {
      if (importRunIdRef.current !== runId) return;
      if (!gotSomethingForRunRef.current) {
        hardResetImport();
        setNotice({ 
          visible: true, 
          title: "Mission Timeout", 
          message: "Import took too long. The URL might be invalid or the site might be slow. Please check the URL and try again." 
        });
        // Track timeout as failure
        try {
          const siteType = await detectSiteType(url);
          const config = getParserConfig(siteType);
          if (config && config.version) {
            await logImportAttempt({
              url,
              siteType,
              parserVersion: config.version,
              strategyUsed: 'timeout' as StrategyName,
              success: false,
              errorMessage: 'Import timeout - took too long',
            });
          }
        } catch (err) {
          // Silently fail tracking
        }
      }
    }, IMPORT_HARD_TIMEOUT_MS);

    let success = false;
    lastResolvedUrlRef.current = url;
    
    // Track import attempt start (no error message - this is just a tracking marker)
    let attemptTracked = false;
    try {
      const siteType = await detectSiteType(url);
      const config = getParserConfig(siteType);
      const attemptId = await logImportAttempt({
        url,
        siteType,
        parserVersion: config.version,
        strategyUsed: 'attempt-started' as StrategyName,
        success: false, // Will be updated to true when successful
        // No error message - this is just a tracking marker, not an error
      });
      if (attemptId) {
        dbg(`[TRACKING] Logged import attempt start: ${attemptId}`);
        attemptTracked = true;
      } else {
        dbg(`[TRACKING] Failed to log import attempt start`);
      }
    } catch (err) {
      dbg(`[TRACKING] Error logging attempt start:`, err);
      // Silently fail - don't break import flow
    }

    // STEP 0: try oEmbed title
    try {
        const siteType = await detectSiteType(url);
        dbg("=�Ļ Site detected:", siteType);

        if (siteType === "instagram") {
          dbg("[IG] Instagram path begins");
          
          let useWebViewScraper = true; // Flag to determine if we should use WebView scraper
          
          // FIRST: Try server-side HTML extraction (like TikTok) - this works even if Instagram redirects
          try {
            bumpStage(1);
            dbg("[IG] Attempting server-side HTML extraction via fetchMeta...");
            const meta = await fetchMeta(url);
            dbg("[IG] fetchMeta result:", {
              hasTitle: !!meta.title,
              ingredientsCount: meta.ingredients?.length || 0,
              stepsCount: meta.steps?.length || 0,
              hasImage: !!meta.image
            });
            
            // If we got meaningful data from server-side extraction, use it!
            if (meta.ingredients && meta.ingredients.length > 0) {
              dbg("[IG] ? Server-side extraction successful! Using fetchMeta data.");
              
              // Clean the title - remove Instagram boilerplate
              let cleanTitle = meta.title || "";
              if (cleanTitle) {
                // Remove "X likes, Y comments - username on date:" pattern
                cleanTitle = cleanTitle.replace(/^\s*\d+[KkMm]?\s+likes?,?\s*\d+\s+comments?\s*-\s*[^:]+(?:\s+on\s+[^:]+)?:\s*/i, "");
                // Remove quoted title wrapper if present
                cleanTitle = cleanTitle.replace(/^[""']\s*([^""']+)\s*[""']$/i, "$1");
                // Extract just the recipe name (before "Ingredients:" if present)
                cleanTitle = cleanTitle.split(/\s+ingredients?\s*:/i)[0].trim();
                if (cleanTitle && !isWeakTitle(cleanTitle)) {
                  safeSetTitle(cleanTitle, url, title, dbg, "instagram:fetchMeta");
                }
              }
              
              // Parse the full recipe text - use rawCaption if available, otherwise combine ingredients and steps
              // The rawCaption should contain the full recipe text from the meta description
              let fullRecipeText = meta.rawCaption;
              dbg("[IG] rawCaption available:", !!meta.rawCaption, "length:", meta.rawCaption?.length || 0);
              if (!fullRecipeText || fullRecipeText.length < 200) {
                dbg("[IG] rawCaption too short or missing, reconstructing from ingredients/steps");
                // Fallback: try to reconstruct from ingredients and steps
                fullRecipeText = meta.ingredients.join("\n") + "\n\n" + (meta.steps?.join("\n") || "");
              }
              
              // Ensure HTML entities are fully decoded (rawCaption should already be decoded, but double-check)
              // Replace emoji number patterns like "1&#xfe0f;&#x20e3;" with just "1. "
              fullRecipeText = fullRecipeText.replace(/(\d+)&#xfe0f;&#x20e3;/g, "$1. ");
              // Decode any remaining numeric entities
              fullRecipeText = fullRecipeText.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
              fullRecipeText = fullRecipeText.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
              
              dbg("[IG] Final recipe text length:", fullRecipeText.length);
              dbg("[IG] Final recipe text preview (first 500 chars):", fullRecipeText.slice(0, 500));
              const parsed = parseRecipeText(fullRecipeText);
              dbg("[IG] Parsed result - ingredients:", parsed.ingredients.length, "sections:", parsed.ingredientSections?.length || 0, "steps:", parsed.steps.length);
              
              if (parsed.ingredients.length > 0) {
                setIngredients(parsed.ingredients);
                if (parsed.ingredientSections && parsed.ingredientSections.length > 0) {
                  setIngredientSections(parsed.ingredientSections);
                } else {
                  setIngredientSections(null);
                }
              }
              
              // Set steps - prefer parsed steps, fallback to meta.steps
              // Note: steps state is string[], not objects
              let finalSteps: string[] = [];
              if (parsed.steps && parsed.steps.length > 0) {
                dbg("[IG] Using parsed steps:", parsed.steps.length);
                dbg("[IG] First 3 parsed steps:", parsed.steps.slice(0, 3));
                const stepStrings = parsed.steps
                  .filter(s => s && s.trim().length > 0)
                  .map((s: string) => s.trim());
                if (stepStrings.length > 0) {
                  setSteps(stepStrings);
                  finalSteps = stepStrings;
                  dbg("[IG] Set", stepStrings.length, "steps");
                } else {
                  dbg("[IG] All parsed steps were empty after filtering");
                }
              } else if (meta.steps && meta.steps.length > 0) {
                dbg("[IG] Using meta.steps as fallback:", meta.steps.length);
                dbg("[IG] First 3 meta steps:", meta.steps.slice(0, 3));
                const stepStrings = meta.steps
                  .filter(s => s && s.trim().length > 0)
                  .map((s: string) => s.trim());
                if (stepStrings.length > 0) {
                  setSteps(stepStrings);
                  finalSteps = stepStrings;
                  dbg("[IG] Set", stepStrings.length, "steps from meta");
                } else {
                  dbg("[IG] All meta steps were empty after filtering");
                }
              } else {
                dbg("[IG] No steps found in parsed or meta");
                dbg("[IG] parsed.steps:", parsed.steps?.length || 0, "meta.steps:", meta.steps?.length || 0);
              }
              
              // Track successful import and store original data for correction tracking
              if (parsed.ingredients.length > 0 || finalSteps.length > 0) {
                gotSomethingForRunRef.current = true;
                success = true;
                await trackSuccessfulImport(url, parsed.ingredients, finalSteps, 'server-html-meta');
              }
              
              // Set image - try meta.image first, then fetch OG image
              // Decode HTML entities in image URL (e.g., &amp; -> &)
              if (meta.image) {
                let imageUrl = meta.image;
                // Decode HTML entities in the URL
                imageUrl = imageUrl.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                dbg("[IG] Setting image from meta.image (decoded):", imageUrl);
                setImg({ kind: "url-og", url, resolvedImageUrl: imageUrl });
              } else {
                dbg("[IG] No image in meta, attempting to fetch OG image...");
                try {
                  const og = await fetchOgForUrl(url);
                  if (og?.image) {
                    dbg("[IG] Setting image from OG fetch:", og.image);
                    setImg({ kind: "url-og", url, resolvedImageUrl: og.image });
                  } else {
                    dbg("[IG] No OG image found");
                  }
                } catch (imgErr: any) {
                  dbg("[IG] Failed to fetch OG image:", safeErr(imgErr));
                }
              }
              
              gotSomethingForRunRef.current = true;
              useWebViewScraper = false; // Skip WebView scraper
            } else {
              dbg("[IG] Server-side extraction found no ingredients, falling back to WebView scraper...");
            }
          } catch (metaErr: any) {
            dbg("[IG] Server-side extraction failed:", safeErr(metaErr));
            dbg("[IG] Falling back to WebView scraper...");
          }
          
          // FALLBACK: Use WebView scraper (may fail due to redirects) - only if server-side extraction didn't work
          if (useWebViewScraper) {
            let igDom: any = null;
            try {
            bumpStage(1);
            igDom = await scrapeInstagramDom(url);
            
            // Log full Instagram payload structure
            dbg("[IG] Instagram payload keys:", Object.keys(igDom || {}));
            dbg("[IG] Instagram payload full:", JSON.stringify({
              ok: igDom?.ok,
              captionLength: (igDom?.caption || "").length,
              textLength: (igDom?.text || "").length,
              imageUrl: igDom?.imageUrl || igDom?.image_url,
              cleanTitle: igDom?.cleanTitle,
              pageTitle: igDom?.pageTitle,
              commentsCount: Array.isArray(igDom?.comments) ? igDom.comments.length : 0,
              bestComment: igDom?.bestComment,
              debug: igDom?.debug,
              hasSigi: !!(igDom as any)?.sigi,
            }, null, 2));
            
            const rawCaption = (igDom?.caption || "").trim();
            dbg("[IG] Instagram payload length:", rawCaption.length);
            dbg("[IG] Raw caption (first 500 chars):", rawCaption.slice(0, 500));
            dbg("[IG] Raw caption (last 500 chars):", rawCaption.length > 500 ? rawCaption.slice(-500) : "(full content shown above)");
            dbg("[IG] Raw text (first 500 chars):", (igDom?.text || "").slice(0, 500));
            dbg("[IG] Raw text (last 500 chars):", (igDom?.text || "").length > 500 ? (igDom?.text || "").slice(-500) : "(full content shown above)");
            dbg("[IG] Full caption length:", rawCaption.length, "Full text length:", (igDom?.text || "").length);
            
            // collect title candidates but don't set title yet (avoid overwriting while parsing)
            const igTitleCandidates: Array<{ v: string; src: string }> = [];

            const heroFromDom = igDom?.imageUrl || igDom?.image_url || null;
            const articleTextRaw = typeof igDom?.text === "string" ? igDom.text : "";
            // Use raw caption directly - the parser will handle cleaning internally
            // Only do minimal cleaning to remove metadata prefixes
            const minimalClean = (s: string) => {
              let out = String(s || "");
              // Remove Instagram metadata prefix only
              out = out.replace(/^\s*\d+[\d,.\s]*\s+likes?,?\s*\d+[\d,.\s]*\s+comments?\s*-\s*[^:]+(?:\s+on\s+[^:]+)?:\s*/i, "");
              // Remove standalone like/comment lines
              out = out.replace(/^\s*\d+[\d,.\s]*\s+likes?.*$/gim, "");
              out = out.replace(/^\s*\d+[\d,.\s]*\s+comments?.*$/gim, "");
              return out.trim();
            };
            
            const cleanedCaption = minimalClean(rawCaption);
            const cleanedArticle = minimalClean(articleTextRaw);
            const combinedBody = [cleanedCaption, cleanedArticle].filter(Boolean).join("\n\n");
            
            // Debug: Show cleaned caption
            dbg("[IG] Raw caption length:", rawCaption.length);
            dbg("[IG] Cleaned caption length:", cleanedCaption.length);
            dbg("[IG] Cleaned caption (first 500 chars):", cleanedCaption.slice(0, 500));
            dbg("[IG] Cleaned caption (last 300 chars):", cleanedCaption.length > 300 ? cleanedCaption.slice(-300) : cleanedCaption);
            dbg("[IG] Combined body length:", combinedBody.length);
            dbg("[IG] Combined body (first 500 chars):", combinedBody.slice(0, 500));
            
            const captionDishTitle = findDishTitleFromText(combinedBody, url);
            const fallbackDishTitle = captionDishTitle || normalizeDishTitle(cleanTitle(captionToNiceTitle(combinedBody), url));
            const parsedInstagram = parseSocialCaption(combinedBody, {
              fallbackTitle: fallbackDishTitle,
              heroImage: heroFromDom ?? null,
            });
            
            // Debug: Log what was actually parsed
            dbg("[IG] Parsed title:", parsedInstagram.title);
            dbg("[IG] Parsed ingredients count:", parsedInstagram.ingredients.length);
            dbg("[IG] Parsed ingredients:", JSON.stringify(parsedInstagram.ingredients, null, 2));
            dbg("[IG] Parsed steps count:", parsedInstagram.steps.length);
            dbg("[IG] Parsed steps (first 3):", JSON.stringify(parsedInstagram.steps.slice(0, 3), null, 2));
            
            // For Instagram, ONLY use parsedInstagram results - it follows strict section order
            // The unified parser is too generic and mixes things up
            const mergedIngredients = parsedInstagram.ingredients;
            const mergedSteps = parsedInstagram.steps;

            // Prefer DOM-provided cleaned titles (scraper heuristics) before using long captions
            try {
              const domCandidates = [igDom?.cleanTitle, igDom?.pageTitle];
              try { if ((igDom as any)?.sigi && (igDom as any).sigi?.item?.title) domCandidates.push((igDom as any).sigi.item.title); } catch {}
              for (const dc of domCandidates) {
                if (!dc) continue;
                const c = normalizeDishTitle(cleanTitle(String(dc), url));
                if (c && !isWeakTitle(c)) igTitleCandidates.push({ v: c, src: "instagram:dom:cleanTitle" });
              }
            } catch {}

            // Prioritize parsedInstagram.title - it's from the section-aware parser and should be food-related
            if (parsedInstagram.title && !isWeakTitle(parsedInstagram.title)) {
              igTitleCandidates.push({ v: normalizeDishTitle(cleanTitle(parsedInstagram.title, url)), src: "instagram:caption-title" });
            }
            // Only use fallback if it's not junk like "Follow us for" or ingredient phrases - be very strict
            if (captionDishTitle && !isWeakTitle(captionDishTitle) && !/^follow\s+us\s+for/i.test(captionDishTitle.toLowerCase())) {
              const cleaned = normalizeDishTitle(cleanTitle(captionDishTitle, url));
              // Double-check it's not junk or ingredient phrase before adding
              const lower = cleaned.toLowerCase();
              if (cleaned && !isWeakTitle(cleaned) && !/^follow\s+us\s+for/i.test(lower)) {
                // Reject ingredient phrases like "Salt and pepper to taste"
                if (/\b(to taste|pinch|dash|salt and pepper|salt & pepper)\b/i.test(lower)) {
                  // Skip - this is an ingredient, not a title
                } else if (/^(salt|pepper|garlic|onion)/i.test(cleaned) && /(and|&|to taste)/i.test(lower)) {
                  // Skip - ingredient phrase
                } else {
                  igTitleCandidates.push({ v: cleaned, src: "instagram:caption-fallback" });
                }
              }
            }
            // last attempt: try to find a short dish-like title in the scraped page text
            try {
              const txtCandidate = findDishTitleFromText(igDom?.text || rawCaption || "", url);
              if (txtCandidate && !isWeakTitle(txtCandidate) && !/^follow\s+us\s+for/i.test(txtCandidate.toLowerCase())) {
                const lower = txtCandidate.toLowerCase();
                // Reject ingredient phrases
                if (!/\b(to taste|pinch|dash|salt and pepper|salt & pepper)\b/i.test(lower) && !(/^(salt|pepper|garlic|onion)/i.test(txtCandidate) && /(and|&|to taste)/i.test(lower))) {
                  igTitleCandidates.push({ v: txtCandidate, src: "instagram:dom-text" });
                }
              }
            } catch {}

            // For Instagram, we already have clean ingredients and steps from parsedInstagram
            // Don't use partitionIngredientRows - it might move ingredients to steps incorrectly
            const partitioned = { ingredients: mergedIngredients, steps: mergedSteps };
            const normalizedSteps = mergeStepFragments(partitioned.steps);

            // Instagram-only: aggressively clean ingredient noise (attribution and title echoes)
            if (partitioned.ingredients.length) {
              try {
                const monthPattern = /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i;
                const possibleTitles = [parsedInstagram.title, captionDishTitle, fallbackDishTitle]
                  .filter(Boolean)
                  .map((t) => normalizeDishTitle(cleanTitle(String(t), url)));
                const cleanedRows = partitioned.ingredients.filter((row) => {
                  const t = String(row || "").trim();
                  if (!t) return false;
                  const low = t.toLowerCase();
                  // creator/date attributions like "alfskitchen on July 18"
                  if (/^@?\w+\s+on\s+/.test(low) && monthPattern.test(low)) return false;
                  // drop year-prefixed quoted lines that look like a title and not an ingredient
                  const m = t.match(/^\s*\d{4}\s*[:\-]\s*["�'�]?([^"�'�]{3,80})["�'�]?\s*$/);
                  if (m) {
                    const candidate = m[1].trim();
                    const hasMeasure = ING_AMOUNT_CLUE.test(candidate) || ING_UNIT_CLUE.test(candidate);
                    if (!hasMeasure) return false;
                  }
                  // if the row equals a likely title (after removing year/quotes) drop it
                  const normalizedRow = normalizeDishTitle(
                    cleanTitle(
                      t
                        .replace(/^\s*\d{4}\s*[:\-]\s*/, "")
                        .replace(/^['"��]+|['"��]+$/g, ""),
                      url
                    )
                  );
                  if (possibleTitles.includes(normalizedRow)) return false;
                  return true;
                });
                setIngredients(cleanedRows);
              } catch {
                setIngredients(partitioned.ingredients);
              }
            }

            if (normalizedSteps.length) {
              setSteps(normalizedSteps);
            }

            if (parsedInstagram.servings) {
              setServings((prev) => (prev.trim().length > 0 ? prev : parsedInstagram.servings ?? prev));
            }

            if (parsedInstagram.heroImage) {
              await tryImageUrl(parsedInstagram.heroImage, url);
            }

            if (partitioned.ingredients.length >= 2 || normalizedSteps.length >= 1) {
              bumpStage(2);
              success = true;
            }

            // choose best title candidate now that we parsed content (prefer short dish-like titles)
            try {
              if (igTitleCandidates && igTitleCandidates.length) {
                // Sort by score, but prioritize parsedInstagram.title over fallbacks
                igTitleCandidates.sort((a, b) => {
                  // Prioritize caption-title over fallback
                  if (a.src === "instagram:caption-title" && b.src === "instagram:caption-fallback") return -1;
                  if (b.src === "instagram:caption-title" && a.src === "instagram:caption-fallback") return 1;
                  return scoreTitleCandidate(b.v) - scoreTitleCandidate(a.v);
                });
                for (const cand of igTitleCandidates) {
                  if (!cand.v) continue;
                  const cleaned = normalizeDishTitle(cleanTitle(cand.v, url));
                  const cleanedLower = cleaned.toLowerCase();
                  // Reject "Follow us for" explicitly
                  if (/^follow\s+us\s+for/i.test(cleanedLower)) continue;
                  // Reject ingredient phrases - "Salt and pepper to taste" is ALWAYS an ingredient, never a title
                  if (/\b(to taste|pinch|dash|salt and pepper|salt & pepper)\b/i.test(cleanedLower)) continue;
                  if (/^(salt|pepper|garlic|onion)/i.test(cleaned) && /(and|&|to taste)/i.test(cleanedLower)) continue;
                  if (!isWeakTitle(cleaned)) {
                    // Set a strong title for Instagram
                    safeSetTitle(cleaned, url, title, dbg, cand.src);

                    // Instagram-only cleanup: drop attribution and title-duplicate rows
                    try {
                      const monthPattern = /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i;
                      const filtered = (partitioned.ingredients || []).filter((row) => {
                        const t = String(row || "").trim();
                        if (!t) return false;
                        const low = t.toLowerCase();
                        // Creator/date attributions like "alfskitchen on July 18"
                        if (/^@?\w+\s+on\s+/.test(low) && monthPattern.test(low)) return false;
                        // Obvious non-ingredients
                        if (/^@/.test(t)) return false; // handles
                        if (/^(https?:\/\/)/i.test(t)) return false; // links
                        if (/\b(likes?|views?|comments?|followers?|shares?)\b/.test(low)) return false; // social counters

                        // Normalize for title comparison: strip leading 4-digit year + colon/hyphen and surrounding quotes
                        const normalizedRowForCompare = normalizeDishTitle(
                          cleanTitle(
                            t
                              .replace(/^\s*\d{4}\s*[:\-]\s*/, "")
                              .replace(/^['"��]+|['"��]+$/g, ""),
                            url
                          )
                        );
                        if (normalizedRowForCompare === cleaned) return false;

                        return true;
                      });
                      if (filtered.length !== (partitioned.ingredients || []).length) setIngredients(filtered);
                    } catch {}

                    break;
                  }
                }
              }
            } catch {}
            if (!gotSomethingForRunRef.current && heroFromDom) {
              await tryImageUrl(heroFromDom, url);
            }
          } catch (err) {
            dbg("[IG] Instagram scraper failed:", safeErr(err));
          }
          } // End of useWebViewScraper conditional

          // STEP 4: OG metadata fallback
          if (!gotSomethingForRunRef.current) {
            try {
              const og = await fetchOgForUrl(url);
              if (og?.title && isWeakTitle(title)) {
                safeSetTitle(og.title, url, title, dbg, "instagram:og-title");
              }
              if (og?.image) {
                await tryImageUrl(og.image, url);
              }
            } catch (err) {
              dbg("[IG] Instagram image fallback failed:", safeErr(err));
            }
          }


        } else if (siteType === "facebook") {
          // FACEBOOK PATH (similar to Instagram)
          dbg("=��� Facebook path begins");
          
          try {
            const og = await fetchOgForUrl(url);
            
            if (og?.title && isWeakTitle(title)) {
              safeSetTitle(og.title, url, title, dbg, "facebook:og");
            }
            
            if (og?.description) {
              const parsed = parseRecipeText(og.description);
              dbg("=��� Facebook parse ing:", parsed.ingredients.length, "steps:", parsed.steps.length);
              
              if (parsed.ingredients.length >= 2) {
                setIngredients(parsed.ingredients);
                if (parsed.ingredientSections && parsed.ingredientSections.length > 0) {
                  setIngredientSections(parsed.ingredientSections);
                } else {
                  setIngredientSections(null);
                }
              }
              if (parsed.steps.length >= 1) setSteps(parsed.steps);
              
              if (parsed.ingredients.length >= 2 || parsed.steps.length >= 1) {
                bumpStage(2);
                success = true;
              }
            }
            
            if (og?.image) await tryImageUrl(og.image, url);
          } catch (e) {
            dbg("G�� Facebook handler failed:", safeErr(e));
          }

        } else if (siteType === "recipe-site") {
          // RECIPE SITE PATH (AllRecipes, Food Network, etc.)
          dbg("=�� Recipe site path begins");
          
          // Special handling for Food Network (uses smart fetch with AMP fallback)
          if (isFoodNetworkUrl(url)) {
            dbg("[RECIPE] Food Network detected - using smart fetch");
            try {
              const fnRecipe = await getFoodNetworkBits(url, fetchWithUA);
              if (fnRecipe) {
                dbg("[RECIPE] Food Network recipe extracted:", {
                  title: fnRecipe.title,
                  ingredientsCount: fnRecipe.ingredients?.length ?? 0,
                  stepsCount: fnRecipe.steps?.length ?? 0,
                  hasImage: !!fnRecipe.image,
                });
                
                // Apply the extracted data
                if (fnRecipe.title && isWeakTitle(title)) {
                  safeSetTitle(fnRecipe.title, url, title, dbg, "foodnetwork:jsonld");
                }
                
                if (fnRecipe.ingredients && fnRecipe.ingredients.length >= 2) {
                  setIngredients(fnRecipe.ingredients);
                  setIngredientSections(null);
                  bumpStage(2);
                }
                
                if (fnRecipe.steps && fnRecipe.steps.length >= 1) {
                  setSteps(fnRecipe.steps);
                  bumpStage(3);
                }
                
                // Try to get best image
                if (fnRecipe.image) {
                  await tryImageUrl(fnRecipe.image, url);
                } else {
                  // Fallback: try to get best image using smart fetch
                  const bestImage = await getFoodNetworkBestImage(url, fetchWithUA);
                  if (bestImage) {
                    await tryImageUrl(bestImage, url);
                  }
                }
                
                if (fnRecipe.ingredients && fnRecipe.ingredients.length >= 2) {
                  await trackSuccessfulImport(url, fnRecipe.ingredients, fnRecipe.steps || [], 'foodnetwork:jsonld');
                  gotSomethingForRunRef.current = true;
                  success = true;
                  dbg("[RECIPE] Food Network extraction successful");
                  return;
                }
              } else {
                dbg("[RECIPE] Food Network smart fetch returned no data");
              }
            } catch (e) {
              dbg("[RECIPE] Food Network handler failed:", safeErr(e));
              // Fall through to regular handling
            }
          }
          
          // Regular recipe site handling (for non-Food Network or Food Network fallback)
          try {
            const html = await fetchWithUA(url, 12000, "text");
            dbg("[RECIPE] HTML fetched, length:", html?.length || 0);
            
            // Quick check: does HTML contain JSON-LD?
            const hasJsonLd = /type=["']application\/ld\+json["']/i.test(html || "");
            const hasRecipeJsonLd = /"@type"\s*:\s*["']Recipe["']/i.test(html || "");
            dbg("[RECIPE] HTML check:", { hasJsonLd, hasRecipeJsonLd });
            
            const handled = await handleRecipeSite(url, html);
            dbg("[RECIPE] handleRecipeSite returned:", handled);
            
            if (handled) {
              success = true;
              dbg("G�� Recipe site extraction successful");
            } else {
              dbg("[RECIPE] Extraction failed, falling back to OG metadata");
              // Fallback to OG if structured data failed
              const og = await fetchOgForUrl(url);
              if (og?.title && isWeakTitle(title)) {
                safeSetTitle(og.title, url, title, dbg, "recipe-site:og");
              }
              if (og?.image) await tryImageUrl(og.image, url);
            }
          } catch (e) {
            dbg("G�� Recipe site handler failed:", safeErr(e));
          }

        } else if (siteType === "generic") {
          // GENERIC SITE - Try to detect recipe data and auto-discover
          // NOTE: No screenshot/OCR capture for generic sites - uses OG images instead
          dbg("=�� Generic site - checking for recipe data");
          try {
            const html = await fetchWithUA(url, 12000, "text");
            
            // Check if this generic site has recipe data (try all extraction methods)
            const jsonLd = extractRecipeFromJsonLd(html);
            const microdata = extractRecipeFromMicrodata(html);
            const htmlExtracted = extractRecipeFromHtml(html);
            
            if (jsonLd || microdata || htmlExtracted) {
              // Found recipe data! Auto-discover the site and process it
              dbg("=�� Recipe data found on generic site - auto-discovering");
              await discoverRecipeSiteIfNeeded(url, html);
              
              // Now try to extract recipe (same as recipe-site path)
              const handled = await handleRecipeSite(url, html);
              
              if (handled) {
                success = true;
                dbg("G�� Generic site recipe extraction successful (auto-discovered)");
              } else {
                // Fallback to OG if structured data extraction failed
                const og = await fetchOgForUrl(url);
                if (og?.title && isWeakTitle(title)) {
                  safeSetTitle(og.title, url, title, dbg, "generic:og");
                }
                if (og?.image) {
                  dbg("[GENERIC] Attempting to download OG image:", og.image);
                  await tryImageUrl(og.image, url);
                } else {
                  dbg("[GENERIC] No OG image found");
                }
              }
            } else {
              // No recipe data - just try OG fallback
              dbg("=�� No recipe data found on generic site");
              const og = await fetchOgForUrl(url);
              if (og?.title && isWeakTitle(title)) {
                safeSetTitle(og.title, url, title, dbg, "generic:og");
              }
              if (og?.image) {
                dbg("[GENERIC] Attempting to download OG image:", og.image);
                await tryImageUrl(og.image, url);
              } else {
                dbg("[GENERIC] No OG image found");
              }
            }
          } catch (e) {
            dbg("G�� Generic site handler failed:", safeErr(e));
          }

        } else if (siteType === "tiktok") {
          // EXISTING TIKTOK PATH (keep all your existing TikTok code here)
          dbg("=�Ļ TikTok detected - unified import path begins");
          // STEP 1: DOM scrape
          let domPayload: { text?: string; caption?: string; comments?: string[]; bestComment?: string; debug?: string } | null = null;
          // title candidates collected across steps (declare in outer scope so available later)
          let ttTitleCandidates: Array<{ v: string; src: string }> = [];
          let hasTikTokIngredients = ingredients.some((line) => line?.trim());
          let hasTikTokSteps = steps.some((line) => line?.trim());
          try {
            bumpStage(1);
            domPayload = await scrapeTikTokDom(url);
            // Collect TikTok title candidates without setting the title yet
            const len = (domPayload?.text || "").length;
            dbg("=��� STEP 1 DOM payload. text length:", len, "comments:", domPayload?.comments?.length || 0);
            // =��� extra trace to know where it came from and if "see more" was clicked
            if (domPayload?.debug) dbg("=��� TTDOM DEBUG:", domPayload.debug);
            // EXTRA DEBUG: log keys and a small sample of fields so we can see what the WebView actually returned
            try {
              dbg("=�p TTDOM payload keys:", domPayload ? Object.keys(domPayload) : null);
              if (domPayload?.caption) dbg("=�p TTDOM caption (snippet):", (domPayload.caption || "").slice(0, 240));
              if (domPayload?.text) dbg("=�p TTDOM text (snippet):", (domPayload.text || "").slice(0, 240));
              if ((domPayload as any)?.sigi) dbg("=�p TTDOM sigi keys:", Object.keys((domPayload as any).sigi || {}).slice(0, 10));
              if (domPayload?.comments && domPayload.comments.length) dbg("=�p TTDOM first comment:", domPayload.comments[0].slice(0, 160));
            } catch (e) { dbg("=�p TTDOM debug failed:", safeErr(e)); }
          
            // =��� NEW: try to set a nice title from the TikTok caption if ours is weak
            try {
                // Prefer any DOM-provided short title first (cleanTitle/pageTitle/SIGI)
                try {
                  const domT = (domPayload as any)?.cleanTitle || (domPayload as any)?.pageTitle || null;
                  const sigiTitle = extractTikTokTitleFromState((domPayload as any)?.sigi);
                  const domCandidates = [domT, sigiTitle].filter(Boolean);
                  for (const dt of domCandidates) {
                    try {
                      const ct = normalizeDishTitle(cleanTitle(String(dt), url));
                      if (ct && !isWeakTitle(ct)) {
                        safeSetTitle(ct, url, title, dbg, "tiktok:dom:cleanTitle");
                        ttTitleCandidates.push({ v: ct, src: "tiktok:dom:cleanTitle" });
                      }
                    } catch {}
                  }
                } catch {}

                // caption-based title (don't set yet)
                const capTitleRaw = captionToNiceTitle(domPayload?.caption || "");
                const capTitle = normalizeDishTitle(cleanTitle(capTitleRaw, url));
                if (capTitle && !isWeakTitle(capTitle)) ttTitleCandidates.push({ v: capTitle, src: "tiktok:caption" });

                // also try to find a dish-like short title from the DOM text
                // Only add if we don't already have a good title from higher-priority sources
                try {
                  const hasGoodDomTitle = ttTitleCandidates.some(c => 
                    c.src === "tiktok:dom:cleanTitle" && 
                    c.v && 
                    !isWeakTitle(c.v) && 
                    !isTikTokJunkTitle(c.v)
                  );
                  if (!hasGoodDomTitle) {
                    const td = findDishTitleFromText(domPayload?.text || domPayload?.caption || "", url);
                    // Double-check it's not junk before adding to candidates
                    if (td && !isWeakTitle(td) && !isTikTokJunkTitle(td)) {
                      ttTitleCandidates.push({ v: td, src: "tiktok:dom-text" });
                    }
                  }
                } catch {}
            } catch {}
          } catch (e) {
            dbg("G�� STEP 1 (DOM scraper) failed:", safeErr(e));
          }

          // STEP 2: PARSE - caption first (photos often hold full recipe here)
          try {
            let cap = (domPayload?.caption || "").trim();
            const comments = (domPayload?.comments || []).map((s) => s.trim()).filter(Boolean);
            
            // If caption appears truncated (ends with "INGREDIENTS:" but has no actual ingredients, or ends mid-word),
            // try to extract full caption from SIGI_STATE
            const ingMatch = cap.match(/\bingredients?\s*:\s*(.*)$/i);
            // Check if caption ends abruptly (mid-word, no punctuation, or very short word)
            const endsAbruptly = /[a-z][A-Z]$/.test(cap) || // ends mid-word (lowercase followed by uppercase)
                                 (/[a-z]\s*$/.test(cap) && !/[.!?]$/.test(cap)) || // ends with lowercase letter, no punctuation
                                 /\b[a-z]{1,4}\s*$/i.test(cap); // ends with very short word (likely truncated, e.g. "Perf", "mak", etc.)
            const isTruncated = 
              /\bingredients?\s*:\s*$/i.test(cap) || // ends with "INGREDIENTS:" and nothing after
              (ingMatch && ingMatch[1] && ingMatch[1].trim().length < 50) || // very short content after INGREDIENTS:
              (/\bingredients?\s*:/i.test(cap) && cap.length < 500) || // caption with INGREDIENTS: but very short overall
              endsAbruptly; // ends abruptly (mid-word or without punctuation)
            
            // Always try SIGI_STATE if available and caption mentions ingredients (might be truncated)
            if (domPayload?.sigi && (isTruncated || /\bingredients?\s*:/i.test(cap))) {
              dbg("=��� Caption mentions ingredients, trying SIGI_STATE extraction (truncated:", isTruncated, "endsAbruptly:", endsAbruptly, ")");
              try {
                const sigiCaption = extractCaptionFromSigi(domPayload.sigi, dbg);
                if (sigiCaption) {
                  dbg("=��� SIGI_STATE caption length:", sigiCaption.length, "vs DOM caption length:", cap.length);
                  dbg("=��� SIGI_STATE caption preview:", sigiCaption.slice(0, 200));
                  dbg("=��� DOM caption ends with:", cap.slice(-50));
                  
                  // Use SIGI_STATE caption if:
                  // 1. It's longer, OR
                  // 2. DOM caption is truncated AND SIGI_STATE has ingredients, OR
                  // 3. DOM caption ends abruptly AND SIGI_STATE is close in length (within 5%) - prefer complete caption
                  // 4. DOM caption mentions ingredients but SIGI_STATE is significantly longer (more complete)
                  const sigiHasIngredients = sigiCaption.toLowerCase().includes('ingredients');
                  const domHasIngredients = cap.toLowerCase().includes('ingredients');
                  const lengthRatio = sigiCaption.length / cap.length;
                  const shouldUseSigi = sigiCaption.length > cap.length || 
                                        (isTruncated && sigiHasIngredients) ||
                                        (endsAbruptly && lengthRatio >= 0.95) || // DOM ends abruptly, prefer SIGI_STATE if close in length
                                        (domHasIngredients && !sigiHasIngredients && sigiCaption.length > cap.length * 1.1) || // SIGI_STATE much longer
                                        (domHasIngredients && sigiHasIngredients && lengthRatio >= 0.98); // Both have ingredients, prefer longer if close
                  
                  if (shouldUseSigi) {
                    dbg("=��� Using SIGI_STATE caption (length:", sigiCaption.length, "hasIngredients:", sigiHasIngredients, ")");
                    // Log the section around INGREDIENTS: to debug parsing
                    const ingIndex = sigiCaption.toLowerCase().indexOf('ingredients');
                    if (ingIndex >= 0) {
                      const start = Math.max(0, ingIndex - 50);
                      const end = Math.min(sigiCaption.length, ingIndex + 300);
                      dbg("=��� SIGI_STATE caption around INGREDIENTS:", sigiCaption.slice(start, end));
                    }
                    cap = sigiCaption;
                  } else {
                    dbg("=��� Keeping DOM caption (SIGI_STATE not better - length:", sigiCaption.length, "vs", cap.length, "hasIngredients:", sigiHasIngredients, ")");
                  }
                } else {
                  dbg("=��� SIGI_STATE extraction returned null");
                }
              } catch (e) {
                dbg("=��� SIGI_STATE extraction failed:", safeErr(e));
              }
            }
            
            const dishTitleFromCaption = findDishTitleFromText(cap, url);
            // Only set title from caption if it's not junk and we don't already have a good title
            if (dishTitleFromCaption && !isTikTokJunkTitle(dishTitleFromCaption)) {
              // Make sure title doesn't include ingredients
              const cleanTitle = dishTitleFromCaption.split(/\bingredients?\s*:/i)[0].trim();
              if (cleanTitle && !isTikTokJunkTitle(cleanTitle)) {
                safeSetTitle(cleanTitle, url, title, dbg, "tiktok:caption-dish");
              }
            }
            const captionFallbackTitle = normalizeDishTitle(cleanTitle(captionToNiceTitle(cap), url));
            if (captionFallbackTitle) {
              // Make sure title doesn't include ingredients
              const cleanFallback = captionFallbackTitle.split(/\bingredients?\s*:/i)[0].trim();
              if (cleanFallback && !isTikTokJunkTitle(cleanFallback)) {
                safeSetTitle(cleanFallback, url, title, dbg, "tiktok:caption-fallback");
              }
            }

            // A) build clean recipe text from CAPTION
            const capRecipe = captionToRecipeText(cap);
            dbg("=��� capRecipe length:", capRecipe.length, "preview:", capRecipe.slice(0, 300));

            // B) parse caption text
            let parsed = parseRecipeText(capRecipe);
            dbg("=��� STEP 2A parse(CAPTION) conf:", parsed.confidence, "ing:", parsed.ingredients.length, "steps:", parsed.steps.length);
            if (parsed.ingredients.length === 0 && cap.toLowerCase().includes('ingredients')) {
              dbg("=��� WARNING: Caption mentions ingredients but parser found 0. Full caption preview:", cap.slice(0, 500));
            }

            // C) if still weak, fuse top comments and reparse
            if ((parsed.ingredients.length < 3 || parsed.steps.length < 1) && comments.length) {
              const fusion = fuseCaptionAndComments(cap, comments, 5);
              const parsed2 = parseRecipeText(fusion);
              dbg("=��� STEP 2B parse(CAPTION+COMMENTS) conf:", parsed2.confidence, "ing:", parsed2.ingredients.length, "steps:", parsed2.steps.length);
              if ((parsed2.ingredients.length + parsed2.steps.length) > (parsed.ingredients.length + parsed.steps.length)) {
                parsed = parsed2;
              }
            }

            const socialParsed = parseSocialCaption(cap, {
              fallbackTitle: normalizeDishTitle(cleanTitle(captionToNiceTitle(cap), url)),
            });

            if (socialParsed.title) {
              safeSetTitle(socialParsed.title, url, title, dbg, "tiktok:social-title");
            }

            if (socialParsed.servings) {
              setServings((prev) => (prev.trim().length > 0 ? prev : socialParsed.servings ?? prev));
            }

            const mergedIngredients = dedupeNormalized([
              ...parsed.ingredients,
              ...socialParsed.ingredients,
            ]);
            const mergedSteps = dedupeNormalized([
              ...parsed.steps,
              ...socialParsed.steps,
            ]);

            parsed.ingredients = mergedIngredients;
            parsed.steps = mergedSteps;

            const partitioned = partitionIngredientRows(parsed.ingredients, parsed.steps);
            const normalizedSteps = mergeStepFragments(partitioned.steps);

            if (partitioned.ingredients.length >= 2 || normalizedSteps.length >= 1) {
              if (partitioned.ingredients.length) {
                setIngredients(partitioned.ingredients);
                hasTikTokIngredients = hasTikTokIngredients || partitioned.ingredients.some((line) => line && line.trim());
                // Use ingredient sections if available, otherwise use flat list
                if (parsed.ingredientSections && parsed.ingredientSections.length > 0) {
                  setIngredientSections(parsed.ingredientSections);
                } else {
                  setIngredientSections(null);
                }
              }
              if (normalizedSteps.length) {
                setSteps(normalizedSteps);
                hasTikTokSteps = true;
              }
              bumpStage(2);
              dbg("G�� STEP 2 caption-based parse worked");
              success = true;
              gotSomethingForRunRef.current = true;
              // Track successful import from caption parsing
              if (partitioned.ingredients.length >= 2) {
                await trackSuccessfulImport(url, partitioned.ingredients, normalizedSteps, 'tiktok-caption');
              }
            } else {
              dbg("G�n+� STEP 2 caption parse still weak; will try OCR next");
            }

            // Choose best title candidate for TikTok now that parsing is done
            // Only do this if we don't already have a strong title set
            try {
                if (ttTitleCandidates && ttTitleCandidates.length) {
                // Filter out junk titles before sorting
                const filtered = ttTitleCandidates.filter(cand => {
                  if (!cand.v) return false;
                  const cleaned = normalizeDishTitle(cleanTitle(cand.v, url));
                  return !isWeakTitle(cleaned) && !isTikTokJunkTitle(cleaned);
                });
                // Sort by source priority: prefer dom:cleanTitle > caption > dom-text
                const sourcePriority: Record<string, number> = {
                  "tiktok:dom:cleanTitle": 3,
                  "tiktok:caption": 2,
                  "tiktok:dom-text": 1,
                };
                filtered.sort((a: {v:string,src:string}, b: {v:string,src:string}) => {
                  const aPriority = sourcePriority[a.src] || 0;
                  const bPriority = sourcePriority[b.src] || 0;
                  if (aPriority !== bPriority) return bPriority - aPriority;
                  return scoreTitleCandidate(b.v) - scoreTitleCandidate(a.v);
                });
                // Only set if we don't already have a good title
                const currentTitle = title.trim();
                const hasGoodTitle = currentTitle && !isWeakTitle(currentTitle) && !isTikTokJunkTitle(currentTitle);
                if (!hasGoodTitle && filtered.length > 0) {
                  const cand = filtered[0];
                  const cleaned = normalizeDishTitle(cleanTitle(cand.v, url));
                  safeSetTitle(cleaned, url, title, dbg, cand.src);
                }
              }
            } catch {}
          } catch (e) {
            dbg("G�� STEP 2 (parse) failed:", safeErr(e));
          }

          // STEP 3: OCR fallback
          try {
            const needOcr = !hasTikTokIngredients || !hasTikTokSteps;
            bumpStage(2);
            dbg('[TikTok] STEP 3 capturing preview (need OCR:', needOcr, ')');
            const shot = await autoSnapTikTok(url, 2);
            if (needOcr && shot) {
              const ocrText = await ocrImageToText(shot);
              dbg('[TikTok] STEP 3 OCR text length:', ocrText ? ocrText.length : 0);
              if (ocrText && ocrText.length > 50) {
                const parsed = parseRecipeText(ocrText);
                dbg('[TikTok] STEP 3 OCR parse conf:', parsed.confidence, 'ing:', parsed.ingredients.length, 'steps:', parsed.steps.length);
                if (parsed.ingredients.length >= 2 || parsed.steps.length >= 1) {
                  if (!hasTikTokIngredients && parsed.ingredients.length) {
                    setIngredients(parsed.ingredients);
                    hasTikTokIngredients = true;
                    if (parsed.ingredientSections && parsed.ingredientSections.length > 0) {
                      setIngredientSections(parsed.ingredientSections);
                    } else {
                      setIngredientSections(null);
                    }
                  }
                  if (!hasTikTokSteps && parsed.steps.length) {
                    setSteps(parsed.steps);
                    hasTikTokSteps = true;
                  }
                  bumpStage(3);
                  dbg('[TikTok] STEP 3 OCR gave usable content');
                  success = true;
                  gotSomethingForRunRef.current = true;
                  // Track successful import
                  if (parsed.ingredients.length >= 2) {
                    await trackSuccessfulImport(url, parsed.ingredients, parsed.steps || [], 'ocr-screenshot');
                  }
                }
              }
            } else if (needOcr && !shot) {
              dbg('[TikTok] STEP 3 OCR skipped because screenshot failed');
            }
          } catch (e) {
            dbg('=��� STEP 3 (OCR) failed:', safeErr(e));
          }

          // STEP 4: OG/Meta as last resort for text
          try {
            if (!success || ingredients.every(v => !v.trim())) {
              bumpStage(3);
              dbg("=��� STEP 4 trying OG/Meta description");
              const og = await fetchOgForUrl(url);

              /* Title from og:title intentionally ignored for TikTok to avoid 'TikTok -' overwrites */

              if (og?.title && isWeakTitle(title)) {
                safeSetTitle(og.title, url, title, dbg, "tiktok:og:title");
              }

              if (og?.description) {
                const parsed = parseRecipeText(og.description);
                dbg("=��� STEP 4 OG parse ing:", parsed.ingredients.length, "steps:", parsed.steps.length);
                if (parsed.ingredients.length >= 2 || parsed.steps.length >= 1) {
                  if (ingredients.every(v => !v.trim()) && parsed.ingredients.length) {
                    setIngredients(parsed.ingredients);
                    if (parsed.ingredientSections && parsed.ingredientSections.length > 0) {
                      setIngredientSections(parsed.ingredientSections);
                    } else {
                      setIngredientSections(null);
                    }
                  }
                  if (steps.every(v => !v.trim()) && parsed.steps.length) setSteps(parsed.steps);
                  dbg("G�� STEP 4 got usable content from OG description");
                  success = true;
                }
              }
            }
          } catch (e) {
            dbg("G��n+� STEP 4 (OG/Meta) failed:", safeErr(e));
          }
          // STEP 5: image preview fallback
          try {
            bumpStage(4);
            if (!gotSomethingForRunRef.current) {
              const imgUrl = await getAnyImageFromPage(url);
              if (imgUrl) await tryImageUrl(imgUrl, url);
              dbg("=��+n+� STEP 5 image fallback:", !!imgUrl);
            }
          } catch (e) {
            dbg("G��n+� STEP 5 (image fallback) failed:", safeErr(e));
          }

        } else {
          // generic path
          try {
            const og = await fetchOgForUrl(url);
            if (og?.title && isWeakTitle(title)) safeSetTitle(og?.title ?? og.title, url, title, dbg, 'og:title');
            if (og?.description) {
              const parsed = parseRecipeText(og.description);
              if (parsed.ingredients.length >= 2) {
                setIngredients(parsed.ingredients);
                if (parsed.ingredientSections && parsed.ingredientSections.length > 0) {
                  setIngredientSections(parsed.ingredientSections);
                } else {
                  setIngredientSections(null);
                }
              }
              if (parsed.steps.length >= 1) setSteps(parsed.steps);
              // Track successful import
              if (parsed.ingredients.length >= 2) {
                await trackSuccessfulImport(url, parsed.ingredients, parsed.steps || [], 'server-html-meta');
                gotSomethingForRunRef.current = true;
                success = true;
              }
            }
            if (og?.image) await tryImageUrl(og.image, url);
          } catch (e) {
            dbg("G��n+� Generic handler failed:", safeErr(e));
          }
        }
      } catch (e: any) {
        const msg = safeErr(e);
        dbg("G�� Import error:", msg);
        // Only clear image if we got nothing in this run AND there was no existing image
        // This preserves the image from a previous successful import when re-importing
        if (!gotSomethingForRunRef.current && !hadExistingImage) {
          setImg({ kind: "none" });
        }
        // Track import failure
        try {
          const siteType = await detectSiteType(url);
          const config = getParserConfig(siteType);
          await logImportAttempt({
            url,
            siteType,
            parserVersion: config.version,
            strategyUsed: 'error' as StrategyName,
            success: false,
            errorMessage: msg || 'Import failed',
          });
        } catch (err) {
          // Silently fail tracking
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setNotice({ visible: true, title: "Mission Aborted", message: msg || "Could not read that webpage." });
      } finally {
        clearTimeout(watchdog);
        if (success || gotSomethingForRunRef.current) {
          setHudPhase("acquired");
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          await new Promise((r) => setTimeout(r, 800));
        }
        setHudVisible(false);
        setSnapVisible(false);
      }
  }, [title, autoSnapTikTok, scrapeTikTokDom, tryImageUrl, ingredients, steps, dbg, safeErr, bumpStage, hardResetImport, img]);

  // -------------- import button flow --------------
  const resolveOg = useCallback(async () => {
    // Store existing image state before resetting
    const hadImage = img.kind !== "none";
    const existingImage = hadImage ? img : null;
    
    // Reset all import-related state including snapshot and editor
    hardResetImport();
    
    const candidateInput = (pastedUrl?.trim() || "") || (sharedRaw?.trim() || "");
    
    // Check if it's just a TikTok video ID (like "_id=7542000795349976590")
    const tiktokIdMatch = candidateInput.match(/(?:^|_id=)(\d{15,})/);
    if (tiktokIdMatch && !candidateInput.includes('http')) {
      setImg({ kind: "none" });
      return setNotice({ 
        visible: true, 
        title: "Invalid URL", 
        message: "Please paste the full TikTok URL (e.g., https://www.tiktok.com/@user/video/1234567890), not just the video ID." 
      });
    }
    
    const url = extractFirstUrl(candidateInput);
    if (!url || !/^https?:\/\//i.test(url)) {
      // Only reset image if URL is invalid
      setImg({ kind: "none" });
      return setNotice({ 
        visible: true, 
        title: "Invalid URL", 
        message: "Please paste a full link that starts with http:// or https://" 
      });
    }
    const isDup = await checkDuplicateSourceUrl(url);
    if (isDup) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAbortVisible(true);
      setTimeout(() => setAbortVisible(false), 1700);
      return;
    }
    // Restore existing image temporarily - it will be replaced when new import succeeds
    // This prevents the image from disappearing during re-import
    if (existingImage) {
      setImg(existingImage);
    }
    setStageIndex(0);
    setHudPhase("scanning");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHudVisible(true);
    setPendingImportUrl(url);
  }, [pastedUrl, sharedRaw, hardResetImport, img]);

  const onPaste = useCallback(async () => {
    const t = await Clipboard.getStringAsync();
    if (t) setPastedUrl(t.trim());
  }, []);

  const pickOrCamera = useCallback(async () => {
    Alert.alert("Add Photo", "Choose where to get your picture", [
      { text: "Camera", onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") return setNotice({ visible: true, title: "Permission Denied", message: "Camera access required." });
          const r = await ImagePicker.launchCameraAsync({ quality: 0.92, allowsEditing: true, aspect: [4, 3] });
          if (!r.canceled && r.assets?.[0]?.uri) setImg({ kind: "camera", localUri: r.assets[0].uri });
        } },
      { text: "Gallery", onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") return setNotice({ visible: true, title: "Permission Denied", message: "Photo library access required." });
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.92, allowsEditing: true, aspect: [4, 3] });
          if (!r.canceled && r.assets?.[0]?.uri) setImg({ kind: "picker", localUri: r.assets[0].uri });
        } },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  const previewUri = useMemo(() => currentPreviewUri(), [currentPreviewUri]);

  const onSave = useCallback(async () => {
    if (!title.trim()) return setNotice({ visible: true, title: "Mission Brief", message: "Add a title before saving." });
    setSaving(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const cleanedSourceUrl = lastResolvedUrlRef.current ? canonicalizeUrl(lastResolvedUrlRef.current) : null;
      
      // Extract original source user from URL for copyright attribution
      let originalSourceUser: string | null = null;
      if (cleanedSourceUrl) {
        const { extractSourceUserFromUrl } = await import("@/lib/extractSourceUser");
        originalSourceUser = extractSourceUserFromUrl(cleanedSourceUrl);
      }

      // Check if recipe already exists (by source URL or title + first few ingredients)
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.data?.user?.id;
      
      if (userId) {
        // First check by source URL if available
        if (cleanedSourceUrl) {
          const { data: existingByUrl } = await supabase
            .from("recipes")
            .select("id, title")
            .eq("user_id", userId)
            .eq("source_url", cleanedSourceUrl)
            .limit(1)
            .single();
          
          if (existingByUrl) {
            setSaving(false);
            return setNotice({ 
              visible: true, 
              title: "Recipe Already Exists", 
              message: `You already have a recipe "${existingByUrl.title}" from this URL.` 
            });
          }
        }
        
        // Also check by title + first ingredient (fuzzy duplicate detection)
        const trimmedTitle = title.trim().toLowerCase();
        const firstIngredient = (ingredientSections && ingredientSections.length > 0
          ? ingredientSections[0].ingredients[0]
          : ingredients[0])?.toLowerCase().trim();
        
        if (trimmedTitle && firstIngredient) {
          // First find recipes with matching title
          const { data: recipesWithTitle } = await supabase
            .from("recipes")
            .select("id, title")
            .eq("user_id", userId)
            .ilike("title", trimmedTitle)
            .limit(10);
          
          if (recipesWithTitle && recipesWithTitle.length > 0) {
            // Check if any of these recipes have the same first ingredient
            const recipeIds = recipesWithTitle.map(r => r.id);
            const { data: matchingIngredients } = await supabase
              .from("recipe_ingredients")
              .select("recipe_id")
              .in("recipe_id", recipeIds)
              .eq("pos", 0)
              .ilike("text", `%${firstIngredient.substring(0, 30)}%`)
              .limit(1)
              .single();
            
            if (matchingIngredients) {
              const existingRecipe = recipesWithTitle.find(r => r.id === matchingIngredients.recipe_id);
              setSaving(false);
              return setNotice({ 
                visible: true, 
                title: "Similar Recipe Found", 
                message: `You may already have a recipe "${existingRecipe?.title || 'with this title'}" with the same first ingredient.` 
              });
            }
          }
        }
      }

      const { data: created, error: createErr } = await supabase
        .from("recipes")
        .insert({ 
          title: title.trim(), 
          minutes: timeMinutes ? Number(timeMinutes) : null, 
          servings: servings ? Number(servings) : null, 
          source_url: cleanedSourceUrl,
          original_source_user: originalSourceUser
        })
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

      // Use sections if available, otherwise use flat list
      let ingRows: Array<{ recipe_id: string; pos: number; text: string; section_name: string | null }> = [];
      let savedIngredients: string[] = []; // Flat list for tracking/comparison
      
      if (ingredientSections && ingredientSections.length > 0) {
        // Preserve sections when saving
        let pos = 1;
        for (const section of ingredientSections) {
          for (const ing of section.ingredients) {
            const trimmed = (ing || "").trim();
            if (trimmed) {
              ingRows.push({
                recipe_id: recipeId,
                pos: pos++,
                text: trimmed,
                section_name: section.name || null
              });
              savedIngredients.push(trimmed);
            }
          }
        }
      } else {
        // Flat list - no sections
        savedIngredients = ingredients.map((s) => (s || "").trim()).filter(Boolean);
        ingRows = savedIngredients.map((text, i) => ({
          recipe_id: recipeId,
          pos: i + 1,
          text,
          section_name: null
        }));
      }
      
      if (ingRows.length) {
        await supabase.from("recipe_ingredients").insert(ingRows);
      }

      const stp = steps.map((s) => (s || "").trim()).filter(Boolean);
      if (stp.length) {
        await supabase.from("recipe_steps").insert(
          stp.map((text, i) => ({ recipe_id: recipeId, pos: i + 1, text, seconds: null }))
        );
      }

      // Track user corrections - compare saved data against original import
      // First try in-memory ref, then fallback to database lookup
      let shouldTrackCorrection = false;
      let originalIngredients: string[] = [];
      let originalSteps: string[] = [];
      let attemptIdToMark: string | null = null;
      
      if (cleanedSourceUrl) {
        // Normalize saved data for comparison
        const savedIngNormalized = savedIngredients.map(i => i.trim().toLowerCase()).filter(Boolean);
        const savedStepsNormalized = stp.map(s => s.trim().toLowerCase()).filter(Boolean);
        
        console.log(`[TRACKING] Starting correction detection for URL: ${cleanedSourceUrl}`);
        console.log(`[TRACKING] Saved ingredients: ${savedIngNormalized.length}, steps: ${savedStepsNormalized.length}`);
        console.log(`[TRACKING] originalImportDataRef exists: ${!!originalImportDataRef.current}`);
        if (originalImportDataRef.current) {
          console.log(`[TRACKING] originalImportDataRef URL: ${originalImportDataRef.current.url}`);
          console.log(`[TRACKING] URL match: ${originalImportDataRef.current.url === cleanedSourceUrl}`);
        }
        
        // Try in-memory ref first
        if (originalImportDataRef.current && originalImportDataRef.current.url === cleanedSourceUrl) {
          const original = originalImportDataRef.current;
          originalIngredients = original.ingredients.map(i => i.trim().toLowerCase()).filter(Boolean);
          originalSteps = original.steps.map(s => s.trim().toLowerCase()).filter(Boolean);
          attemptIdToMark = original.attemptId || null;
          
          console.log(`[TRACKING] Original import data - ingredients: ${originalIngredients.length}, steps: ${originalSteps.length}`);
          console.log(`[TRACKING] Attempt ID: ${attemptIdToMark}`);
          
          // Compare normalized versions (order-independent for ingredients, order-dependent for steps)
          // More sensitive detection: any difference in count or content is considered a correction
          const ingredientsChanged = 
            originalIngredients.length !== savedIngNormalized.length ||
            !originalIngredients.every(orig => savedIngNormalized.includes(orig)) ||
            !savedIngNormalized.every(saved => originalIngredients.includes(saved));
          
          const stepsChanged = 
            originalSteps.length !== savedStepsNormalized.length ||
            originalSteps.some((origStep, i) => origStep !== savedStepsNormalized[i]);
          
          // Also check if content changed even if counts match (user edited text)
          // Compare each ingredient at same position - if any differ, it's a correction
          const ingredientTextChanged = originalIngredients.length > 0 && savedIngNormalized.length > 0 &&
            originalIngredients.some((orig, idx) => {
              const saved = savedIngNormalized[idx];
              return saved && orig !== saved;
            });
          
          // Also check if order changed (ingredients in different positions)
          const orderChanged = originalIngredients.length === savedIngNormalized.length &&
            originalIngredients.length > 0 &&
            originalIngredients.some((orig, idx) => {
              const saved = savedIngNormalized[idx];
              return saved && orig !== saved; // Different ingredient at same position
            });
          
          shouldTrackCorrection = ingredientsChanged || stepsChanged || ingredientTextChanged || orderChanged;
          
          if (shouldTrackCorrection) {
            console.log(`[TRACKING] ✅ Detected changes using in-memory ref:`);
            console.log(`  Ingredients changed: ${ingredientsChanged} (original: ${originalIngredients.length}, saved: ${savedIngNormalized.length})`);
            console.log(`  Steps changed: ${stepsChanged} (original: ${originalSteps.length}, saved: ${savedStepsNormalized.length})`);
            console.log(`  Text changed: ${ingredientTextChanged}, Order changed: ${orderChanged}`);
          } else {
            console.log(`[TRACKING] ❌ No changes detected - ingredients and steps match exactly`);
          }
        } else {
          // Fallback: Compare against what's in the database from the most recent import attempt
          // This handles cases where the user navigated away and came back
          try {
            // First try to find a successful import
            let { data: attempts } = await supabase
              .from('recipe_import_attempts')
              .select('id, ingredients_count, steps_count, success, strategy_used')
              .eq('url', cleanedSourceUrl)
              .eq('success', true)
              .order('created_at', { ascending: false })
              .limit(1);
            
            // If no successful import, check for any import attempt (including failed ones)
            // This handles cases where import failed but user manually added ingredients
            if (!attempts || attempts.length === 0) {
              const { data: allAttempts } = await supabase
                .from('recipe_import_attempts')
                .select('id, ingredients_count, steps_count, success, strategy_used')
                .eq('url', cleanedSourceUrl)
                .order('created_at', { ascending: false })
                .limit(1);
              
              if (allAttempts && allAttempts.length > 0) {
                attempts = allAttempts;
                // If the attempt failed but we have ingredients/steps now, user definitely corrected it
                if (!(attempts[0] as any).success && (savedIngNormalized.length > 0 || savedStepsNormalized.length > 0)) {
                  attemptIdToMark = attempts[0].id;
                  shouldTrackCorrection = true;
                  console.log(`[TRACKING] Detected correction: Import failed but user added ${savedIngNormalized.length} ingredients, ${savedStepsNormalized.length} steps`);
                }
              }
            }
            
            if (attempts && attempts.length > 0 && !shouldTrackCorrection) {
              const latestAttempt = attempts[0];
              attemptIdToMark = latestAttempt.id;
              
              console.log(`[TRACKING] Comparing against database attempt ${latestAttempt.id}:`);
              console.log(`  Imported ingredients: ${latestAttempt.ingredients_count}, Saved: ${savedIngNormalized.length}`);
              console.log(`  Imported steps: ${latestAttempt.steps_count}, Saved: ${savedStepsNormalized.length}`);
              console.log(`  Strategy: ${latestAttempt.strategy_used}, Success: ${(latestAttempt as any).success ?? 'unknown'}`);
              
              // Compare counts - if saved data differs at all, likely user made changes
              // Be more sensitive: any difference is considered a correction
              const ingredientsCountDiff = Math.abs((latestAttempt.ingredients_count || 0) - savedIngNormalized.length);
              const stepsCountDiff = Math.abs((latestAttempt.steps_count || 0) - savedStepsNormalized.length);
              
              // Consider it a correction if:
              // 1. Counts differ by ANY amount (more sensitive), OR
              // 2. Original had 0 but we have data now (user added everything manually), OR
              // 3. Counts differ by more than 10% (if we have original counts)
              const ingredientsChanged = 
                (latestAttempt.ingredients_count === 0 && savedIngNormalized.length > 0) ||
                ingredientsCountDiff > 0 || // Changed: was > 2, now > 0 (any difference)
                (latestAttempt.ingredients_count && latestAttempt.ingredients_count > 0 && ingredientsCountDiff / latestAttempt.ingredients_count > 0.05); // Changed: was 0.1, now 0.05 (5% threshold)
              
              const stepsChanged = 
                (latestAttempt.steps_count === 0 && savedStepsNormalized.length > 0) ||
                stepsCountDiff > 0 || // Changed: was > 2, now > 0 (any difference)
                (latestAttempt.steps_count && latestAttempt.steps_count > 0 && stepsCountDiff / latestAttempt.steps_count > 0.05); // Changed: was 0.1, now 0.05 (5% threshold)
              
              shouldTrackCorrection = ingredientsChanged || stepsChanged;
              
              if (shouldTrackCorrection) {
                console.log(`[TRACKING] ✅ Detected changes using database comparison:`);
                console.log(`  Ingredients changed: ${ingredientsChanged} (diff: ${ingredientsCountDiff})`);
                console.log(`  Steps changed: ${stepsChanged} (diff: ${stepsCountDiff})`);
              } else {
                console.log(`[TRACKING] ❌ No changes detected - counts match exactly`);
              }
            } else if (!attempts || attempts.length === 0) {
              console.log(`[TRACKING] ⚠️ No import attempts found for URL: ${cleanedSourceUrl}`);
            }
          } catch (err) {
            console.warn('[TRACKING] Error comparing against database:', err);
          }
        }
        
        if (shouldTrackCorrection) {
          // User had to correct the import - mark as corrected
          try {
            const siteType = await detectSiteType(cleanedSourceUrl);
            const config = getParserConfig(siteType);
            
            if (attemptIdToMark) {
              try {
                await markImportCorrected(attemptIdToMark);
                console.log(`[TRACKING] ✅ Successfully marked attempt ${attemptIdToMark} as user-corrected`);
                
                // Verify it was actually updated
                const { data: verify } = await supabase
                  .from('recipe_import_attempts')
                  .select('user_corrected')
                  .eq('id', attemptIdToMark)
                  .single();
                
                if (verify && verify.user_corrected) {
                  console.log(`[TRACKING] ✅ Verified: attempt ${attemptIdToMark} has user_corrected = TRUE`);
                } else {
                  console.warn(`[TRACKING] ⚠️ WARNING: attempt ${attemptIdToMark} still has user_corrected = FALSE after marking!`);
                }
              } catch (markErr) {
                console.error(`[TRACKING] ❌ Error marking attempt ${attemptIdToMark} as corrected:`, markErr);
              }
            } else {
              console.warn(`[TRACKING] ⚠️ Could not find attempt ID to mark as corrected for URL: ${cleanedSourceUrl}`);
              console.warn(`[TRACKING] This means the original import attempt may not have been logged, or URL matching failed`);
            }
            
            // Also log the correction details
            const savedIngNormalized = savedIngredients.map(i => i.trim().toLowerCase()).filter(Boolean);
            const savedStepsNormalized = stp.map(s => s.trim().toLowerCase()).filter(Boolean);
            const ingredientsChanged = originalIngredients.length !== savedIngNormalized.length ||
              !originalIngredients.every(orig => savedIngNormalized.includes(orig));
            const stepsChanged = originalSteps.length !== savedStepsNormalized.length ||
              originalSteps.some((origStep, i) => origStep !== savedStepsNormalized[i]);
            
            const correctionAttemptId = await logImportAttempt({
              url: cleanedSourceUrl,
              siteType,
              parserVersion: config.version,
              strategyUsed: 'user-corrected' as StrategyName,
              success: false, // Technically failed because user had to fix it
              errorMessage: `User corrected: ${ingredientsChanged ? 'ingredients ' : ''}${stepsChanged ? 'steps' : ''}`,
              ingredientsCount: originalIngredients.length || savedIngredients.length,
              stepsCount: originalSteps.length || stp.length,
            });
            
            // Also mark the tracking record itself as user_corrected for clarity
            if (correctionAttemptId) {
              try {
                await markImportCorrected(correctionAttemptId);
                console.log(`[TRACKING] ✅ Also marked tracking record ${correctionAttemptId} as user-corrected`);
              } catch (err) {
                console.warn(`[TRACKING] Could not mark tracking record as corrected:`, err);
              }
            }
            
            console.log(`[TRACKING] ✅ Logged user-corrected attempt`);
          } catch (err) {
            console.warn('[TRACKING] ❌ Error tracking user correction:', err);
            // Silently fail - don't break save flow
          }
        } else {
          console.log(`[TRACKING] No changes detected - import was accurate`);
        }
        
        // Clear original import data after save
        originalImportDataRef.current = null;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // fun easter egg: donuts/doughnuts trigger the drill sergeant clip
      const signal = `${title} \n ${ingredients.join("\n")}`.toLowerCase();
      if (/\b(donut|doughnut|donut\s|doughnut\s)/i.test(signal)) {
        playDonutEasterEgg().catch(() => {});
      }
      setOkModalVisible(true);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setNotice({ visible: true, title: "Save Failed", message: e?.message ?? "Please try again." });
    } finally {
      setSaving(false);
    }
  }, [title, timeMinutes, servings, ingredients, steps, previewUri, ingredientSections]);

  // themed notice modal state
  const [notice, setNotice] = useState<{ visible: boolean; title: string; message: string }>({ visible: false, title: "", message: "" });

  const handleDeleteIngredient = useCallback((index: number) => {
    ingredientSwipeRefs.current[index]?.close();
    ingredientSwipeRefs.current.splice(index, 1);
    
    // If we have ingredient sections, delete from the appropriate section
    if (ingredientSections && ingredientSections.length > 0) {
      let currentIndex = 0;
      for (let sectionIdx = 0; sectionIdx < ingredientSections.length; sectionIdx++) {
        const section = ingredientSections[sectionIdx];
        const sectionStart = currentIndex;
        const sectionEnd = currentIndex + section.ingredients.length;
        
        if (index >= sectionStart && index < sectionEnd) {
          // Found the section containing this ingredient
          const localIndex = index - sectionStart;
          const newSections = [...ingredientSections];
          
          // Remove the ingredient from the section
          newSections[sectionIdx].ingredients = newSections[sectionIdx].ingredients.filter((_, idx) => idx !== localIndex);
          
          // If section is now empty, remove the section
          if (newSections[sectionIdx].ingredients.length === 0) {
            newSections.splice(sectionIdx, 1);
          }
          
          // Update sections
          setIngredientSections(newSections.length > 0 ? newSections : null);
          
          // Update flat list
          const flatList: string[] = [];
          newSections.forEach(s => flatList.push(...s.ingredients));
          setIngredients(flatList);
          
          return;
        }
        
        currentIndex = sectionEnd;
      }
    } else {
      // Flat list mode
      setIngredients((prev) => prev.filter((_, idx) => idx !== index));
    }
  }, [ingredientSections]);

  const handleDeleteStep = useCallback((index: number) => {
    stepSwipeRefs.current[index]?.close();
    stepSwipeRefs.current.splice(index, 1);
    setSteps((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const renderRightActions = (onDelete: () => void) => (
    <View style={styles.swipeRightActionContainer}>
      <RectButton onPress={onDelete} style={styles.swipeDeleteButton}>
        <Text style={styles.swipeDeleteText}>Delete</Text>
      </RectButton>
    </View>
  );

  const resetForm = useCallback(() => {
    setPastedUrl(""); setTitle(""); setTimeMinutes(""); setServings("");
    setIngredients([""]);
    setIngredientSections(null);
    setSteps([""]);
    ingredientSwipeRefs.current = [];
    stepSwipeRefs.current = [];
    setImg({ kind: "none" });
    hardResetImport();
  }, [hardResetImport]);
  
  // Reset form when screen comes into focus (when user navigates back)
  // This ensures fields are cleared if user left without saving
  // Track when user navigates away (abandon) - separate from reset form effect
  useEffect(() => {
    return () => {
      // User is leaving the screen - check if there was an active import
      if (lastResolvedUrlRef.current && !gotSomethingForRunRef.current) {
        // User abandoned import (navigated away before it completed)
        (async () => {
          try {
            const siteType = await detectSiteType(lastResolvedUrlRef.current);
            const config = getParserConfig(siteType);
            await logImportAttempt({
              url: lastResolvedUrlRef.current,
              siteType,
              parserVersion: config.version,
              strategyUsed: 'user-abandoned' as StrategyName,
              success: false,
              errorMessage: 'User navigated away before import completed',
            });
          } catch (err) {
            // Silently fail
          }
        })();
      }
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      // When screen comes into focus, always reset the form
      // This gives user a clean slate when returning to capture screen
      resetForm();
      
      // Cleanup when leaving screen - don't do anything on blur
      return () => {
        // No cleanup needed - we reset on next focus
      };
    }, [resetForm])
  );

  // -------------- RENDER --------------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Themed notice for errors */}
        <ThemedNotice
          visible={notice.visible}
          title={notice.title}
          message={notice.message}
          onClose={() => setNotice({ visible: false, title: "", message: "" })}
          confirmText="OK"
        />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900", marginBottom: 16 }}>Add Recipe</Text>

          <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="My Tasty Pizza" placeholderTextColor={COLORS.subtext} style={{ color: COLORS.text, backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 16 }} />

          <View style={{ backgroundColor: COLORS.card, borderRadius: 14, borderColor: COLORS.border, borderWidth: 1, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Import from a link (TikTok, Instagram, blog)...</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TextInput
                value={pastedUrl}
                onChangeText={setPastedUrl}
                placeholder="Paste page URL..."
                  placeholderTextColor={COLORS.subtext}
                autoCapitalize="none"
                autoCorrect={false}
                  style={{ flex: 1, color: COLORS.text, backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginRight: 8 }}
              />
              <TouchableOpacity onPress={onPaste} disabled={hudVisible} style={{ backgroundColor: COLORS.surface, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginRight: 8, opacity: hudVisible ? 0.6 : 1 }}>
                <Text style={{ color: COLORS.text, fontWeight: "600" }}>Paste</Text>
              </TouchableOpacity>
                <TouchableOpacity onPress={resolveOg} disabled={hudVisible} style={{ backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, opacity: hudVisible ? 0.6 : 1 }}>
                  <Text style={{ color: COLORS.onAccent, fontWeight: "700" }}>{hudVisible ? "Importing..." : "Import"}</Text>
              </TouchableOpacity>
            </View>
            {/* debug output is collected silently; no toggle is rendered for end users */}

            <View style={{ marginTop: 10 }}>
              {(() => {
                const uri = currentPreviewUri();
                return uri ? (
                  <>
                    <Image source={{ uri }} style={{ width: "100%", height: 220, borderRadius: 12 }} contentFit="cover" />
                    {improvingSnap && <Text style={{ color: COLORS.subtext, marginTop: 6, textAlign: "center" }}>Improving image...</Text>}
                  </>
                ) : (
                  <View style={{ height: 220, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: COLORS.subtext }}>No imported image yet</Text>
                  </View>
                );
              })()}
            </View>
          </View>

          <TouchableOpacity onPress={pickOrCamera} style={{ backgroundColor: COLORS.card, padding: 12, borderRadius: 12, alignItems: "center", marginBottom: 12 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>Add/Choose Photo...</Text>
          </TouchableOpacity>

          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>Ingredients</Text>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 }}>
            {ingredientSections && ingredientSections.length > 0 ? (
              // Display grouped by sections
              ingredientSections.map((section, sectionIdx) => (
                <View key={`section-${sectionIdx}`}>
                  <View style={{ paddingHorizontal: 16, paddingTop: sectionIdx > 0 ? 16 : 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {/* Move Up Button */}
                    <TouchableOpacity
                      onPress={() => {
                        if (sectionIdx > 0) {
                          const newSections = [...ingredientSections];
                          [newSections[sectionIdx - 1], newSections[sectionIdx]] = [newSections[sectionIdx], newSections[sectionIdx - 1]];
                          setIngredientSections(newSections);
                          // Also update flat list
                          const flatList: string[] = [];
                          newSections.forEach(s => flatList.push(...s.ingredients));
                          setIngredients(flatList);
                        }
                      }}
                      disabled={sectionIdx === 0}
                      style={{ padding: 6, opacity: sectionIdx === 0 ? 0.3 : 1 }}
                    >
                      <Ionicons name="chevron-up" size={18} color={COLORS.accent} />
                    </TouchableOpacity>
                    {/* Move Down Button */}
                    <TouchableOpacity
                      onPress={() => {
                        if (sectionIdx < ingredientSections.length - 1) {
                          const newSections = [...ingredientSections];
                          [newSections[sectionIdx], newSections[sectionIdx + 1]] = [newSections[sectionIdx + 1], newSections[sectionIdx]];
                          setIngredientSections(newSections);
                          // Also update flat list
                          const flatList: string[] = [];
                          newSections.forEach(s => flatList.push(...s.ingredients));
                          setIngredients(flatList);
                        }
                      }}
                      disabled={sectionIdx === ingredientSections.length - 1}
                      style={{ padding: 6, opacity: sectionIdx === ingredientSections.length - 1 ? 0.3 : 1 }}
                    >
                      <Ionicons name="chevron-down" size={18} color={COLORS.accent} />
                    </TouchableOpacity>
                    <TextInput
                      value={section.name || ''}
                      onChangeText={(t) => {
                        const newSections = [...ingredientSections];
                        newSections[sectionIdx].name = t || null;
                        setIngredientSections(newSections);
                      }}
                      placeholder="Section name (e.g., 'For the Cake:')"
                      placeholderTextColor="#64748b"
                      style={{ flex: 1, color: COLORS.accent, fontSize: 16, fontWeight: "700", backgroundColor: 'transparent', padding: 4 }}
                    />
                    <TouchableOpacity
                      onPress={() => {
                        const newSections = ingredientSections.filter((_, idx) => idx !== sectionIdx);
                        setIngredientSections(newSections.length > 0 ? newSections : null);
                        // Also update flat list
                        const flatList: string[] = [];
                        newSections.forEach(s => flatList.push(...s.ingredients));
                        setIngredients(flatList);
                      }}
                      style={{ padding: 4 }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                  {section.ingredients.map((ing, i) => {
                    const globalIndex = ingredientSections.slice(0, sectionIdx).reduce((sum, s) => sum + s.ingredients.length, 0) + i;
                    return (
                      <Swipeable
                        key={`ing-${sectionIdx}-${i}`}
                        ref={(ref) => {
                          ingredientSwipeRefs.current[globalIndex] = ref;
                        }}
                        renderRightActions={() => renderRightActions(() => handleDeleteIngredient(globalIndex))}
                        overshootRight={false}
                        friction={2}
                      >
                        <View style={styles.row}>
                          <Text style={styles.rowIndex}>{globalIndex + 1}.</Text>
                          <TextInput 
                            value={ing} 
                            onChangeText={(v) => {
                              const newSections = [...ingredientSections];
                              newSections[sectionIdx].ingredients[i] = v;
                              setIngredientSections(newSections);
                              // Also update flat list for backward compatibility
                              const flatList: string[] = [];
                              newSections.forEach(s => flatList.push(...s.ingredients));
                              setIngredients(flatList);
                            }} 
                            placeholder="1 lb sausage..." 
                            placeholderTextColor="#64748b" 
                            style={styles.rowInput} 
                          />
                        </View>
                        {(sectionIdx < ingredientSections.length - 1 || i < section.ingredients.length - 1) && <View style={styles.thinLine} />}
                      </Swipeable>
                    );
                  })}
                </View>
              ))
            ) : (
              // Display flat list (backward compatibility)
              ingredients.map((ing, i) => (
                <Swipeable
                  key={`ing-${i}`}
                  ref={(ref) => {
                    ingredientSwipeRefs.current[i] = ref;
                  }}
                  renderRightActions={() => renderRightActions(() => handleDeleteIngredient(i))}
                  overshootRight={false}
                  friction={2}
                >
                  <View style={styles.row}>
                    <Text style={styles.rowIndex}>{i + 1}.</Text>
                    <TextInput value={ing} onChangeText={(v) => setIngredients((a) => a.map((x, idx) => (idx === i ? v : x)))} placeholder="1 lb sausage..." placeholderTextColor="#64748b" style={styles.rowInput} />
                  </View>
                  {i !== ingredients.length - 1 && <View style={styles.thinLine} />}
                </Swipeable>
              ))
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 16 }}>
            <TouchableOpacity 
              onPress={() => {
                if (ingredientSections && ingredientSections.length > 0) {
                  // Add to the last section if using sections
                  const newSections = [...ingredientSections];
                  if (newSections.length > 0) {
                    newSections[newSections.length - 1].ingredients.push("");
                    setIngredientSections(newSections);
                    // Also update flat list for backward compatibility
                    const flatList: string[] = [];
                    newSections.forEach(s => flatList.push(...s.ingredients));
                    setIngredients(flatList);
                  }
                } else {
                  // Add to flat list
                  setIngredients((a) => [...a, ""]);
                }
              }} 
              style={{ flex: 1, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center" }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Ingredient</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              onPress={() => {
                // Add new section - preserve existing ingredients
                if (ingredientSections && ingredientSections.length > 0) {
                  // Already using sections - just add a new empty one
                  const newSections = [...ingredientSections];
                  newSections.push({ name: null, ingredients: [''] });
                  setIngredientSections(newSections);
                } else if (ingredients.length > 0) {
                  // Convert flat list to sections - put existing ingredients in first section
                  const newSections = [
                    { name: null, ingredients: [...ingredients] },
                    { name: null, ingredients: [''] }
                  ];
                  setIngredientSections(newSections);
                } else {
                  // No ingredients yet - just add empty section
                  setIngredientSections([{ name: null, ingredients: [''] }]);
                }
              }} 
              style={{ flex: 1, backgroundColor: COLORS.accent + '20', paddingVertical: 12, borderRadius: 12, alignItems: "center" }}
            >
              <Text style={{ color: COLORS.accent, fontWeight: "800" }}>+ Add Section</Text>
            </TouchableOpacity>
          </View>

          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>Steps</Text>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 }}>
            {steps.map((st, i) => (
              <Swipeable
                key={`step-${i}`}
                ref={(ref) => {
                  stepSwipeRefs.current[i] = ref;
                }}
                renderRightActions={() => renderRightActions(() => handleDeleteStep(i))}
                overshootRight={false}
                friction={2}
              >
                <View style={styles.row}>
                  <Text style={styles.rowIndex}>{i + 1}.</Text>
                  <TextInput value={st} onChangeText={(t) => setSteps((a) => a.map((x, idx) => (idx === i ? t : x)))} placeholder="Brown sausage, then..." placeholderTextColor="#64748b" multiline style={[styles.rowInput, { minHeight: 60 }]} />
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
          <TouchableOpacity onPress={onSave} disabled={saving} style={{ backgroundColor: saving ? COLORS.muted : COLORS.accent, paddingVertical: 14, borderRadius: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: saving ? 0.7 : 1 }}>
            {saving && <ActivityIndicator size="small" color={COLORS.onAccent} />}
            <Text style={{ color: COLORS.onAccent, fontWeight: "800" }}>{saving ? "Saving..." : "Save"}</Text>
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
          focusCenter={0.2}
          captureDelayMs={CAPTURE_DELAY_MS}
          fullSnapshot={true}
          onCancel={() => {
            snapCancelledRef.current = true;
            setSnapVisible(false);
            setImprovingSnap(false);
            setTikTokShots([]);
            if (snapRejectRef.current) { snapRejectRef.current(new Error("snap-cancelled")); snapRejectRef.current = null; }
          }}
          onFound={async (uri) => {
            setTikTokShots((prev)=> (prev.includes(uri) ? prev : [...prev, uri]));
            logDebug("=��+ snap onFound", uri);
            gotSomethingForRunRef.current = true;
            // Resolve any pending snap promise so autoSnapTikTok can continue.
            try {
              if (snapResolverRef.current) {
                try { snapResolverRef.current(uri); } catch (e) { /* ignore resolver errors */ }
                snapResolverRef.current = null;
                snapRejectRef.current = null;
              }
            } catch {}

            // In full snapshot mode, show the focal point editor instead of directly setting preview
            const fixed = await validateOrRepairLocal(uri);
            if (fixed) {
              setGoodPreview(fixed, lastResolvedUrlRef.current);
              // Show the editor so user can adjust focal point
              setFocalPointEditorImageUri(fixed);
              setFocalPointEditorVisible(true);
              setSnapVisible(false); // Hide the snapshot modal
            } else {
              const test = await isValidCandidate(uri);
              if (test.ok && test.useUri) {
                setGoodPreview(test.useUri, lastResolvedUrlRef.current);
                setFocalPointEditorImageUri(test.useUri);
                setFocalPointEditorVisible(true);
                setSnapVisible(false);
              }
            }
          }}
        />

        {/* Focal Point Editor - allows user to adjust the captured image */}
        <ImageFocalPointEditor
          visible={focalPointEditorVisible}
          imageUri={focalPointEditorImageUri}
          onCancel={() => {
            setFocalPointEditorVisible(false);
            setFocalPointEditorImageUri("");
          }}
          onConfirm={async (croppedUri) => {
            setFocalPointEditorVisible(false);
            setFocalPointEditorImageUri("");
            // Use the cropped image as the preview
            const fixed = await validateOrRepairLocal(croppedUri);
            if (fixed) {
              setGoodPreview(fixed, lastResolvedUrlRef.current);
            } else {
              const test = await isValidCandidate(croppedUri);
              if (test.ok && test.useUri) {
                setGoodPreview(test.useUri, lastResolvedUrlRef.current);
              }
            }
          }}
        />

        {/* DOM Scraper - returns caption + comments */}
        <TTDomScraper
          visible={domScraperVisible}
          url={domScraperUrl}
          onClose={() => setDomScraperVisible(false)}
          onResult={(payload) => {
            try {
              dbg("=�p TTDomScraper onResult payload keys:", payload ? Object.keys(payload) : null);
              if (payload?.caption) dbg("=�p onResult caption snippet:", (payload.caption || "").slice(0, 240));
              if (payload?.text) dbg("=�p onResult text snippet:", (payload.text || "").slice(0, 240));
              if ((payload as any)?.sigi) dbg("=�p onResult sigi keys:", Object.keys((payload as any).sigi || {}).slice(0, 10));
            } catch (e) { dbg("=�p onResult debug failed:", safeErr(e)); }
            domScraperResolverRef.current?.(payload);
            setDomScraperVisible(false);
          }}
        />
        {/* Instagram Scraper */}
        <InstagramDomScraper
          visible={instagramScraperVisible}
          url={instagramScraperUrl}
          onClose={() => setInstagramScraperVisible(false)}
          onResult={(payload) => {
            instagramScraperResolverRef.current?.(payload);
            setInstagramScraperVisible(false);
          }}
        />

        {/* HUD: remount key ensures it is ALWAYS on top of any subsequently opened modals */}
        <MilitaryImportOverlay
          key={hudZKey}
          visible={hudVisible}
          phase={hudPhase}
          stageIndex={stageIndex}
          steps={IMPORT_STEPS}
          headline="SCANNING... STAND BY"
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
  swipeDeleteButton: { backgroundColor: COLORS.danger, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", minWidth: 88, borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  swipeDeleteText: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 10 },
  rowIndex: { color: COLORS.subtext, width: 22, textAlign: "right", marginRight: 6 },
  rowInput: { flex: 1, color: COLORS.text, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, borderWidth: 1, borderColor: COLORS.border },
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
  headline = "SCANNING... STAND BY"
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
                  <View style={[hudBackdrop.checkbox, done && { backgroundColor: "rgba(47,174,102,0.26)", borderColor: "rgba(47,174,102,0.6)" }, active && { borderColor: "#86efac" }]}>
                    {done ? <Text style={{ color: "#065f46", fontSize: 14, fontWeight: "700" }}>●</Text> : active ? <Text style={{ color: COLORS.accent, fontSize: 14, fontWeight: "700" }}>●</Text> : null}
                  </View>
                  <Text style={[hudBackdrop.stepText, done && { color: "#bbf7d0" }, active && { color: COLORS.text, fontWeight: "600" }]}>{label}</Text>
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
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: HUD_CARD_MIN_H, // =��� gives the card extra height
  },
  headline: { color: COLORS.text, fontSize: 18, textAlign: "center", letterSpacing: 1, marginBottom: 12 },
  radarWrap: {
    alignSelf: "center",
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 16,        // =��� was marginBottom: 12
    overflow: "hidden",
    borderRadius: RADAR_SIZE / 2,
    backgroundColor: "rgba(47,174,102,0.12)",
  },
  beamPivot: { position: "absolute", left: 0, top: 0, width: RADAR_SIZE, height: RADAR_SIZE },
  beamArm: { position: "absolute", left: RADAR_SIZE / 2, top: RADAR_SIZE / 2 - 1, width: RADAR_SIZE / 2, height: 2, backgroundColor: COLORS.accent },
  beamGlow: { position: "absolute", left: RADAR_SIZE / 2, top: RADAR_SIZE / 2 - 8, width: RADAR_SIZE / 2, height: 16, backgroundColor: "rgba(47,174,102,0.22)" },
  centerDot: { position: "absolute", width: 10, height: 10, borderRadius: 6, backgroundColor: COLORS.accent },
  acquiredWrap: { position: "absolute", top: "42%", alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(47,174,102,0.18)" },
  acquiredText: { color: "#d1fae5", fontSize: 22, fontWeight: "900", letterSpacing: 1.2 },
  stepsBox: { backgroundColor: "rgba(47,174,102,0.08)", borderColor: "rgba(47,174,102,0.35)", borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 12 },
  stepRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: "rgba(47,174,102,0.45)", marginRight: 8, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  stepText: { color: COLORS.subtext, fontSize: 14 },
  progressOuter: { height: 10, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(47,174,102,0.12)", borderWidth: 1, borderColor: "rgba(47,174,102,0.35)" },
  progressInner: { height: "100%", backgroundColor: COLORS.accent },
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
            <Text style={abortStyles.detailText}>Recipe already exists or you have already completed this mission.</Text>
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
const abortStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 24 },
  pillWrap: { paddingVertical: 16, paddingHorizontal: 28, borderRadius: 28, backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: COLORS.danger, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8, alignItems: "center", maxWidth: 320 },
  pillText: { color: COLORS.danger, fontSize: 18, fontWeight: "900", letterSpacing: 1.2, textAlign: "center" },
  detailText: { color: "rgba(239,68,68,0.85)", fontSize: 13, textAlign: "center", marginTop: 6, lineHeight: 18 },
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
              <View style={dialogStyles.checkCircle}><Text style={{ color: "#0B1120", fontWeight: "900", fontSize: 18 }}>?</Text></View>
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
  checkCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.accent, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { color: "#e2e8f0", fontSize: 20, fontWeight: "900", marginTop: 2, textAlign: "center" },
  message: { color: "#b6c2d0", fontSize: 14, marginTop: 6, textAlign: "center" },
  okBtn: { marginTop: 14, backgroundColor: COLORS.accent, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 22 },
  okText: { color: "#0B1120", fontSize: 14, fontWeight: "900", letterSpacing: 0.3 },
});

// -------------- duplicate detection --------------
async function buildDuplicateCandidatesFromRaw(raw: string): Promise<string[]> {
  const ensureHttps = (u: string) => /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`;
  const canonicalizeUrl = (u: string): string => {
    try {
      const rawUrl = ensureHttps(u.trim());
      const url = new URL(rawUrl);
      url.protocol = "https:"; url.hash = ""; url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
      const kill = ["fbclid", "gclid", "ref"];
      for (const [k] of url.searchParams.entries()) if (k.toLowerCase().startsWith("utm_") || kill.includes(k)) url.searchParams.delete(k);
      url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
      if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
      return url.toString();
    } catch (e) { return u.trim(); }
  };
  const resolveFinalUrl = async (u: string) => {
    try { const r = await fetch(u); if ((r as any)?.url) return (r as any).url as string; } catch (e) { }
    return u;
  };
  const isTikTokLike = (url: string): boolean => {
    try { const h = new URL(url).hostname.toLowerCase(); return h === "www.tiktok.com" || h.endsWith(".tiktok.com") || h === "tiktok.com" || h === "vm.tiktok.com"; } catch (e) { return /tiktok\.com/i.test(url); }
  };
  const resolveTikTokEmbedUrl = async (rawUrl: string) => {
    const start = ensureHttps(rawUrl.trim());
    const final = await resolveFinalUrl(start);
    const extractTikTokIdFromUrl = (u: string): string | null => {
      const m = u.match(/\/(?:video|photo)\/(\d{6,})/);
      return m ? m[1] : null;
    };
    let id = extractTikTokIdFromUrl(final);
    if (!id) {
      try {
        const html = await (await fetch(final)).text();
        const m =
          html.match(/"videoId"\s*:\s*"(\d{6,})"/) ||
          html.match(/"itemId"\s*:\s*"(\d{6,})"/) ||
          html.match(/<link\s+rel="canonical"\s+href="https?:\/\/www\.tiktok\.com\/@[^\/]+\/(?:video|photo)\/(\d{6,})"/i);
        if (m) id = m[1];
      } catch (e) { }
    }
    return { embedUrl: id ? `https://www.tiktok.com/embed/v2/${id}` : null, finalUrl: final, id };
  };
  
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
  } catch (e) { return false; }
}

















