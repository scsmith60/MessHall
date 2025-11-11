// lib/fetch_meta.ts
// Like I'm 5: we look EVERYWHERE for recipe bits (title, ingredients, steps).
// If one place doesn't have it, we try the next place.
//
// Order we try:
// 0) Blog Recipe JSON-LD / Microdata
// 1) TikTok caption paths (DOM, SIGI_STATE, alt JSON blobs, oEmbed, mobile UA)
// 2) Generic JSON-LD caption (VideoObject / SocialMediaPosting / WebPage)
// 3) OG/Twitter description
// 4) Visible “Ingredients:” text ANYWHERE in the HTML (loose capture)
// Fallbacks: <title> tag and OG image

import { normalizeIngredientLines } from './ingredientExtract';
import { extractTitle } from './extractTitle';

export type RecipeMeta = {
  url: string;
  title?: string;
  image?: string;
  needsClientRender?: boolean;
  ingredients: string[];
  steps: string[];
  rawCaption?: string; // Raw caption text for further parsing
};

const DEBUG = true;
const d = (...a: any[]) => DEBUG && console.log('[IMPORT]', ...a);

export async function fetchMeta(url: string): Promise<RecipeMeta> {
  d('fetchMeta url =', url);

  // 0) First pull the HTML (desktop UA)
  let html = await fetchHtmlDesktop(url);
  d('html length', html.length);

  // 0b) If this is TikTok and we didn't see any obvious data,
  //     try again with a **mobile** UA (TikTok sometimes hides desktop data).
  if (isTikTok(url) && !/\bSIGI_STATE\b|\bItemModule\b/i.test(html)) {
    d('retrying with MOBILE UA for TikTok…');
    const mobile = await fetchHtmlMobile(url);
    if (mobile && mobile.length > html.length * 0.5) html = mobile;
    d('mobile html length', mobile.length);
  }

  // 0c) If this is Instagram and we didn't see obvious data, try mobile UA
  if (isInstagram(url) && !/\bwindow\._sharedData\b|\b"edge_media_to_caption"\b/i.test(html)) {
    d('retrying with MOBILE UA for Instagram…');
    const mobile = await fetchHtmlMobile(url);
    if (mobile && mobile.length > html.length * 0.5) {
      html = mobile;
      d('mobile html length', mobile.length);
    }
  }

  // 1) Blog structured data first (instant win when present)
  let fallbackPartial: PartialPick = {};

  const fromLdRecipe = parseJsonLdRecipe(html);
  if (fromLdRecipe) {
    fallbackPartial = { ...fallbackPartial, ...fromLdRecipe };
    const hasSteps = (fromLdRecipe.steps?.length ?? 0) > 0;
    const canReturnEarly = hasMeaningfulRecipeData(fromLdRecipe) && (!/gordonramsay\.com/i.test(url) || hasSteps);
    if (canReturnEarly) {
      return finalize(url, fromLdRecipe, html, 'json-ld:Recipe');
    }
  }

  const fromMicro = parseMicrodata(html);
  if (fromMicro) {
    fallbackPartial = { ...fallbackPartial, ...fromMicro };
    const hasSteps = (fromMicro.steps?.length ?? 0) > 0;
    const canReturnEarly = hasMeaningfulRecipeData(fromMicro) && (!/gordonramsay\.com/i.test(url) || hasSteps);
    if (canReturnEarly) {
      return finalize(url, fromMicro, html, 'microdata');
    }
  }

  if (/gordonramsay\.com/i.test(url)) {
    const gr = parseGordonRamsay(html, url);
    if (gr) {
      fallbackPartial = { ...fallbackPartial, ...gr };
      if (hasMeaningfulRecipeData(gr)) {
        return finalize(url, fallbackPartial, html, 'gordonramsay');
      }
    }
  }

  if (/aroundmyfamilytable\.com/i.test(url)) {
    d('aroundmyfamilytable: calling parser');
    const amft = parseAroundMyFamilyTable(html, url);
    d('aroundmyfamilytable: parser returned', { 
      hasResult: !!amft, 
      ingredients: amft?.ingredients?.length || 0, 
      steps: amft?.steps?.length || 0 
    });
    if (amft) {
      fallbackPartial = { ...fallbackPartial, ...amft };
      const isMeaningful = hasMeaningfulRecipeData(amft);
      d('aroundmyfamilytable: isMeaningful?', isMeaningful);
      if (isMeaningful) {
        d('aroundmyfamilytable: returning early with meaningful data');
        return finalize(url, fallbackPartial, html, 'aroundmyfamilytable');
      } else {
        d('aroundmyfamilytable: data not meaningful yet, continuing...');
      }
    } else {
      d('aroundmyfamilytable: parser returned null');
    }
  }

  // 2) Instagram focused paths (similar to TikTok - extract from server-side HTML)
  if (isInstagram(url)) {
    d('Instagram path - extracting from server-side HTML');
    d('HTML preview (first 2000 chars):', html.slice(0, 2000));
    d('Has _sharedData:', /\bwindow\._sharedData\b/i.test(html));
    d('Has og:description:', !!pickMeta(html, 'og:description'));
    d('Has JSON-LD:', /<script[^>]+type=["']application\/ld\+json["']/i.test(html));
    
    // 2a) Try window._sharedData (Instagram's embedded data)
    const fromSharedData = extractInstagramFromSharedData(html);
    if (fromSharedData) {
      d('Instagram _sharedData found, length:', fromSharedData.length);
      d('_sharedData preview:', fromSharedData.slice(0, 300));
      const pick = smartExtractFromCaption(fromSharedData);
      d('_sharedData parsed - ingredients:', pick.ingredients?.length || 0, 'steps:', pick.steps?.length || 0);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'instagram:shared-data');
      }
    } else {
      d('Instagram _sharedData extraction returned null');
    }

    // 2b) Try JSON-LD (Instagram sometimes embeds caption here)
    const fromJsonLd = parseJsonLdBestCaption(html);
    if (fromJsonLd && fromJsonLd.length > 100) {
      d('Instagram JSON-LD caption found, length:', fromJsonLd.length);
      d('JSON-LD preview:', fromJsonLd.slice(0, 300));
      const pick = smartExtractFromCaption(fromJsonLd);
      d('JSON-LD parsed - ingredients:', pick.ingredients?.length || 0, 'steps:', pick.steps?.length || 0);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'instagram:json-ld');
      }
    } else {
      d('Instagram JSON-LD extraction returned:', fromJsonLd ? `length ${fromJsonLd.length}` : 'null');
    }

    // 2c) Try OG/Twitter description (often contains full caption)
    const fromMeta = pickMeta(html, 'og:description') || pickMeta(html, 'twitter:description');
    if (fromMeta && fromMeta.length > 100) {
      d('Instagram meta description found, length:', fromMeta.length);
      d('Meta preview:', fromMeta.slice(0, 300));
      const pick = smartExtractFromCaption(fromMeta);
      d('Meta parsed - ingredients:', pick.ingredients?.length || 0, 'steps:', pick.steps?.length || 0);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        // Pass the raw meta description so it can be re-parsed more thoroughly
        return finalize(url, pick, html, 'instagram:meta', fromMeta);
      }
    } else {
      d('Instagram meta description:', fromMeta ? `length ${fromMeta.length}` : 'not found');
    }

    // 2d) Try visible HTML text (extract from page content)
    const fromVisible = extractInstagramFromVisibleHtml(html);
    if (fromVisible && fromVisible.length > 100) {
      d('Instagram visible HTML found, length:', fromVisible.length);
      d('Visible HTML preview:', fromVisible.slice(0, 300));
      const pick = smartExtractFromCaption(fromVisible);
      d('Visible HTML parsed - ingredients:', pick.ingredients?.length || 0, 'steps:', pick.steps?.length || 0);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'instagram:visible-html');
      }
    } else {
      d('Instagram visible HTML extraction returned:', fromVisible ? `length ${fromVisible.length}` : 'null');
    }

    // 2e) Fuzzy search for "description"/"caption" keys in raw HTML/JS (like TikTok)
    const fromDescKey = extractFromDescriptionKey(html);
    if (fromDescKey) {
      d('Instagram description key found, length:', fromDescKey.length);
      d('Desc key preview:', fromDescKey.slice(0, 300));
      const pick = smartExtractFromCaption(fromDescKey);
      d('Desc key parsed - ingredients:', pick.ingredients?.length || 0, 'steps:', pick.steps?.length || 0);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'instagram:desc-key');
      }
    } else {
      d('Instagram description key extraction returned null');
    }

    // 2f) Last resort: try to extract ANY text that looks like a recipe from the entire HTML
    d('Instagram: Trying loose extraction from entire HTML...');
    const visible = htmlToTextWithBreaks(html);
    const loose = extractIngredientsAndStepsNearKeyword(visible);
    d('Loose extraction - ingredients:', loose.ingredients.length, 'steps:', loose.steps.length);
    if (loose.ingredients.length >= 2) {
      return finalize(url, loose, html, 'instagram:loose-extraction');
    }

    // 2g) If we found ANY data from any source, return it even if it doesn't pass strict ingredient checks
    // This is a last resort - Instagram might have the data but in a format we're not recognizing
    const allAttempts = [
      { data: fromSharedData, name: 'sharedData' },
      { data: fromJsonLd, name: 'jsonLd' },
      { data: fromMeta, name: 'meta' },
      { data: fromVisible, name: 'visible' },
      { data: fromDescKey, name: 'descKey' }
    ].filter(a => a.data && a.data.length > 50);

    if (allAttempts.length > 0) {
      // Pick the longest one
      allAttempts.sort((a, b) => (b.data?.length || 0) - (a.data?.length || 0));
      const bestAttempt = allAttempts[0];
      d('Instagram: Using best attempt from', bestAttempt.name, 'length:', bestAttempt.data?.length);
      const pick = smartExtractFromCaption(bestAttempt.data!);
      d('Best attempt parsed - ingredients:', pick.ingredients?.length || 0, 'steps:', pick.steps?.length || 0);
      
      // Return even if ingredients don't pass strict check, as long as we have something
      if ((pick.ingredients && pick.ingredients.length > 0) || (pick.steps && pick.steps.length > 0)) {
        return finalize(url, pick, html, `instagram:${bestAttempt.name}-fallback`);
      }
    }

    d('Instagram: All extraction methods failed - no data found');
  }

  // 3) TikTok focused paths (videos AND photos)
  if (isTikTok(url)) {
    // 3a) Server-rendered caption spans
    const fromCaptionSpans = extractTikTokCaptionFromDom(html);
    if (fromCaptionSpans) {
      const pick = smartExtractFromCaption(fromCaptionSpans);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'tiktok:DOM');
      }
    }

    // 3b) ANY TikTok data JSON we can find (SIGI_STATE or friends)
    const anyState = extractAnyTikTokDataJSON(html);
    const fromAny = captionFromAnyTikTokJSON(anyState);
    if (fromAny) {
      const pick = smartExtractFromCaption(fromAny);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'tiktok:any-json');
      }
    }

    // 3c) Fuzzy search for "description"/"desc" keys in the raw HTML/JS
    const fromDescKey = extractFromDescriptionKey(html);
    if (fromDescKey) {
      const pick = smartExtractFromCaption(fromDescKey);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'tiktok:desc-key');
      }
    }

    // 3d) oEmbed fallback (TikTok API — returns caption as "title")
    const oCap = await fetchTikTokOEmbedCaption(url);
    if (oCap) {
      const pick = smartExtractFromCaption(oCap);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'tiktok:oembed');
      }
    }
  }

  // 4) Generic JSON-LD caption (video/article/social posts) - skip if already tried for Instagram
  if (!isInstagram(url)) {
    const ldCaption = parseJsonLdBestCaption(html);
    if (ldCaption) {
      d('json-ld caption sample', ldCaption.slice(0, 120));
      const pick = smartExtractFromCaption(ldCaption);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'json-ld:caption');
      }
    }
  }

  // 5) OG/Twitter description - skip if already tried for Instagram
  if (!isInstagram(url)) {
    const metaDesc = pickMeta(html, 'og:description') || pickMeta(html, 'twitter:description');
    if (metaDesc) {
      const pick = smartExtractFromCaption(metaDesc);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'og-description');
      }
    }
  }

  // 6) Visible "Ingredients:" ANYWHERE in the page text (loose)
  const visible = htmlToTextWithBreaks(html);
  const loose = extractIngredientsAndStepsNearKeyword(visible);
  if (loose.ingredients.length >= 2) {
    return finalize(url, loose, html, 'visible-ingredients-loose');
  }

  // 7) fallback basics
  const extracted = extractTitle(html, url);
  return finalize(url, fallbackPartial, html, "fallback");
}

/* --------------------------- normalize + finalize --------------------------- */

type PartialPick = { title?: string; image?: string; ingredients?: string[]; steps?: string[] };

function finalize(url: string, p: PartialPick, html: string, source: string, rawCaption?: string): RecipeMeta {
  d('finalize from', source);

  // 1) robust title pass (JSON-LD/OG/Twitter/TikTok desc → cleaned)
  const extracted = extractTitle(html, url);
  const t = extracted?.title;
  const title = (p.title && p.title.trim()) || (t && t.trim()) || guessTitle(html) || undefined;

  // 2) image from OG/Twitter (unless caller already sent one)
  const image = p.image || pickOgImage(html) || undefined;
  if (image) {
    d('finalize: image found:', image);
  } else {
    d('finalize: no image found in p.image or pickOgImage');
  }

  // 3) ingredients → cleaned strings (UI will later parse into qty/unit)
  const rawIng = Array.isArray(p.ingredients) ? p.ingredients : [];
  const canonical = normalizeIngredientLines(rawIng);

  // 4) steps → trimmed strings
  const steps = Array.isArray(p.steps) ? p.steps.map(s => String(s).trim()).filter(Boolean) : [];

  // 5) Decode HTML entities in raw caption if provided
  let cleanedRawCaption = rawCaption;
  if (cleanedRawCaption) {
    cleanedRawCaption = decodeHtmlEntities(cleanedRawCaption);
    // Remove Instagram boilerplate from the start - more aggressive pattern
    // Pattern: "43K likes, 17 comments - username on date:"
    cleanedRawCaption = cleanedRawCaption.replace(/^\s*\d+[KkMmBb]?\s+likes?,?\s*\d+\s+comments?\s*-\s*[^:]+(?:\s+on\s+[^:]+)?:\s*/i, "");
    // Also handle patterns like "17 comments 8, July 2024 :"
    cleanedRawCaption = cleanedRawCaption.replace(/^\s*\d+\s+comments?\s+\d+[,\s]+\w+\s+\d{4}\s*:\s*/i, "");
    // Remove quoted wrapper if present (but keep the content)
    cleanedRawCaption = cleanedRawCaption.replace(/^[""']\s*([^""']+)\s*[""']$/i, "$1");
    // Remove leading/trailing whitespace
    cleanedRawCaption = cleanedRawCaption.trim();
  }

  return { url, title, image, ingredients: canonical, steps, rawCaption: cleanedRawCaption };
}

function hasMeaningfulRecipeData(p: PartialPick): boolean {
  const ingCount = p.ingredients?.length ?? 0;
  const stepCount = p.steps?.length ?? 0;
  // Lower the bar - even 1 ingredient might be useful if we have steps, or vice versa
  return ingCount >= 1 || stepCount >= 1;
}

// Like I'm 5: lines look "real" if they have numbers/units ("1 cup").
// If not, we can still accept them if they look food-y and there are a few.
function looksRealIngredients(
  lines: string[],
  { allowSoft = false }: { allowSoft?: boolean } = {}
): boolean {
  if (!lines || lines.length < 2) return false;

  // hard signals (numbers/units/fractions)
  const unitish = /(cup|cups|tsp|tsps|tbsp|tbsps|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|g|kg|ml|l|\d\/\d|\d|½|¼|¾)/i;
  const hasHard = lines.some(l => unitish.test(l));
  if (hasHard) return true;

  if (!allowSoft) return false;

  // soft signals: short food-y words across multiple lines
  const foodish = /\b(salt|pepper|flour|sugar|butter|oil|garlic|onion|egg|cheese|cream|milk|vanilla|baking|chicken|beef|pork|tomato|lemon|lime|rice|pasta|jalapeno|jalapeño|oregano|seasoning|powder|jam|broth|basil|thyme)\b/i;
  const shortLines = lines.filter(l => l.length <= 80);
  const softHits = shortLines.filter(l => foodish.test(l)).length;
  return softHits >= 2 && shortLines.length >= 3;
}

/* ------------------------------ HTML helpers ------------------------------ */

async function fetchHtmlDesktop(url: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  try {
    const r = await fetch(url, { headers, redirect: 'follow' });
    return await r.text();
  } catch {
    const r = await fetch(url);
    return await r.text();
  }
}

// Mobile UA fetch: sometimes TikTok exposes more with mobile headers
async function fetchHtmlMobile(url: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  try {
    const r = await fetch(url, { headers, redirect: 'follow' });
    return await r.text();
  } catch {
    const r = await fetch(url);
    return await r.text();
  }
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');
const decodeEntities = (s: string) =>
  s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
   .replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const textify = (html: string) => decodeEntities(stripTags(html)).replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();

function htmlToTextWithBreaks(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|ul|ol|section|article|h\d)\s*>/gi, '\n')
    .replace(/<\/\s*span\s*>/gi, '\n');
  const noTags = withBreaks.replace(/<[^>]*>/g, '');
  return decodeEntities(noTags).replace(/\u00A0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function splitLines(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  return String(v).replace(/\r/g,'').split(/\n|[\u2022•·▪▫►▶]/g).map(s=>s.trim()).filter(Boolean);
}

const pickMeta = (h: string, name: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const m = h.match(re); if (!m) return '';
  const cm = m[0].match(/content=["']([^"']+)["']/i);
  return cm?.[1]?.trim() || '';
};
const pickOgImage = (h: string) => pickMeta(h, 'og:image') || pickMeta(h, 'twitter:image');
const guessTitle = (h: string) => {
  const t = h.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g,' ').trim() || '';
  return /^TikTok\b/i.test(t) ? '' : t;
};

/* ---------------------- Blog recipe (JSON-LD/Microdata) ---------------------- */

function parseJsonLdRecipe(html: string): PartialPick | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    try {
      const json = JSON.parse(s[1]);
      const nodes: any[] = Array.isArray(json) ? json : (json['@graph'] ? json['@graph'] : [json]);
      for (const node of nodes) {
        const t = node?.['@type'];
        const isRecipe =
          typeof t === 'string' ? /Recipe/i.test(t) :
          Array.isArray(t) && t.some((x:any)=>/Recipe/i.test(String(x)));
        if (!isRecipe) continue;
        const title = (node?.name || node?.headline || '').toString().trim();
        const ingredients = splitLines(node?.recipeIngredient || node?.ingredients);
        let steps: string[] = [];
        const inst = node?.recipeInstructions;
        if (Array.isArray(inst)) {
          for (const it of inst) {
            if (typeof it === 'string') steps.push(it);
            else if (it?.text) steps.push(String(it.text));
            else if (it?.itemListElement) {
              for (const step of (Array.isArray(it.itemListElement) ? it.itemListElement : [it.itemListElement])) {
                if (typeof step === 'string') steps.push(step);
                else if (step?.text) steps.push(String(step.text));
              }
            }
          }
        } else if (typeof inst === 'string') {
          steps = splitLines(inst);
        }
        return { title, ingredients, steps };
      }
    } catch { /* keep trying */ }
  }
  return null;
}

function parseMicrodata(html: string): PartialPick | null {
  const ing = [...html.matchAll(/itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const st  = [...html.matchAll(/itemprop=["']recipeInstructions["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const name = html.match(/itemprop=["']name["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (ing.length || st.length) {
    return {
      title: name ? textify(name[1]) : undefined,
      ingredients: ing.map(m => textify(m[1])).filter(Boolean),
      steps: st.map(m => textify(m[1])).filter(Boolean),
    };
  }
  return null;
}

/* --------------------------- TikTok utilities --------------------------- */

// If the link has tiktok.com/@ — it's TikTok!
const isTikTok = (u: string) => /tiktok\.com\/@/i.test(u);
const isInstagram = (u: string) => /instagram\.com\//i.test(u);

// 1) Try to read the visible caption container (when server renders it)
function extractTikTokCaptionFromDom(html: string): string | null {
  const cont =
    html.match(/<div[^>]+data-e2e=["']browse-video-desc["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<div[^>]+data-e2e=["']video-desc["'][^>]*>([\s\S]*?)<\/div>/i) ||
    html.match(/<div[^>]+data-e2e=["']new-desc-span["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!cont) return null;
  const raw = stripTags(cont[1] || '').trim();
  return raw || null;
}

// 2) Grab ANY TikTok data blob we can find (SIGI_STATE or similar)
function extractAnyTikTokDataJSON(html: string): any | null {
  // classic
  const sigi = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
  if (sigi) { try { return JSON.parse(sigi[1]); } catch {} }
  // sometimes inline on window
  const w = html.match(/window\[['"]SIGI_STATE['"]]\s*=\s*({[\s\S]*?});\s*<\/script>/i);
  if (w) { try { return JSON.parse(w[1]); } catch {} }
  // universal rehydration-ish
  const uni = html.match(/<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (uni) { try { return JSON.parse(uni[1]); } catch {} }
  // last resort: pull just the ItemModule object
  const r = html.match(/"ItemModule"\s*:\s*({[\s\S]*?})\s*(,["}])/i);
  if (r) { try { return { ItemModule: JSON.parse(r[1]) }; } catch {} }
  return null;
}

// 3) Turn that JSON into a caption (works for videos AND photos)
function collectTikTokStructs(node: any, out: any[], seen: Set<any>, depth: number) {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node) || depth > 6) return;
  seen.add(node);
  if (node.itemStruct && typeof node.itemStruct === 'object') {
    out.push(node.itemStruct);
  }
  if (node.itemInfo && typeof node.itemInfo === 'object') {
    collectTikTokStructs(node.itemInfo, out, seen, depth + 1);
  }
  if (node.state && typeof node.state === 'object') {
    collectTikTokStructs(node.state, out, seen, depth + 1);
  }
  if (node.preload && typeof node.preload === 'object') {
    collectTikTokStructs(node.preload, out, seen, depth + 1);
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === 'object') {
      collectTikTokStructs(val, out, seen, depth + 1);
    }
  }
}

function parseGordonRamsay(html: string, url: string): { title?: string; ingredients: string[]; steps: string[]; image?: string } | null {
  d('gordonramsay parse', url);
  const clean = (s: string) =>
    decodeHtmlEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
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
      for (const p of paragraphs) {
        const text = clean(p);
        if (!text) continue;
        if (/^serves\b/i.test(text)) continue;
        if (/^watch\b/i.test(text)) continue;
        if (seenSteps.has(text)) continue;
        seenSteps.add(text);
        steps.push(text);
      }
    }
  }

  d('gordonramsay counts', { ingredients: ingredients.length, steps: steps.length });
  if (!ingredients.length && !steps.length) return null;

  let image: string | undefined;
  const heroMatch = html.match(/<img[^>]+src=["']([^"']*CroppedFocusedImage[^"']+)["'][^>]*>/i);
  if (heroMatch?.[1]) {
    const src = heroMatch[1].startsWith("http")
      ? heroMatch[1]
      : `https://www.gordonramsay.com${heroMatch[1]}`;
    image = src;
  }

  return {
    ingredients,
    steps,
    image,
  };
}

function parseAroundMyFamilyTable(html: string, url: string): { title?: string; ingredients: string[]; steps: string[]; image?: string } | null {
  d('aroundmyfamilytable parse START', url, 'html length:', html.length);
  const clean = (s: string) =>
    decodeHtmlEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .replace(/\u00A0/g, " ")
      .replace(/\uFFFD/g, "")
      .trim();

  const ingredients: string[] = [];
  const steps: string[] = [];

  // First, let's try the visible text extraction - it's the most reliable
  d('aroundmyfamilytable step 1: trying visible text extraction');
  const visible = htmlToTextWithBreaks(html);
  d('aroundmyfamilytable visible text length:', visible.length);
  
  // Search for "Ingredients" anywhere in the visible text (case insensitive, flexible)
  const ingTextMatch = visible.match(/ingredients?\s*:?[\s\S]{0,5000}/i);
  const instTextMatch = visible.match(/(?:instructions?|directions?|steps?)\s*:?[\s\S]{0,10000}/i);
  
  d('aroundmyfamilytable found in visible text:', { 
    hasIngredients: !!ingTextMatch, 
    hasInstructions: !!instTextMatch,
    ingMatchLength: ingTextMatch?.[0]?.length || 0,
    instMatchLength: instTextMatch?.[0]?.length || 0
  });
  
  const loose = extractIngredientsAndStepsNearKeyword(visible);
  d('aroundmyfamilytable visible extraction results:', { 
    ingredients: loose.ingredients.length, 
    steps: loose.steps.length 
  });
  
  if (loose.ingredients.length >= 2) {
    ingredients.push(...loose.ingredients);
  }
  if (loose.steps.length >= 1) {
    steps.push(...loose.steps);
  }

  // Step 2: Search HTML structure more aggressively
  d('aroundmyfamilytable step 2: searching HTML structure');
  
  // Look for "Ingredients" and "Instructions" headings anywhere in the HTML
  // Try many patterns - the content might be far down
  const ingPatterns = [
    /<h[1-6][^>]*>\s*ingredients?\s*:?\s*<\/h[1-6]>/i,
    /<h[1-6][^>]*>\s*ingredients?\s*<\/h[1-6]>/i,
    /<(?:h[1-6]|p|div|span|strong|b)[^>]*>\s*ingredients?\s*:?\s*<\/(?:h[1-6]|p|div|span|strong|b)>/i,
    /<[^>]*class=["'][^"']*ingredient[^"']*["'][^>]*>/i,
    /ingredients?\s*:/i
  ];
  
  const instructionsPatterns = [
    /<h[1-6][^>]*>\s*(?:instructions?|directions?|steps?)\s*:?\s*<\/h[1-6]>/i,
    /<h[1-6][^>]*>\s*(?:instructions?|directions?|steps?)\s*<\/h[1-6]>/i,
    /<(?:h[1-6]|p|div|span|strong|b)[^>]*>\s*(?:instructions?|directions?|steps?)\s*:?\s*<\/(?:h[1-6]|p|div|span|strong|b)>/i,
    /<[^>]*class=["'][^"']*(?:instruction|direction|step)[^"']*["'][^>]*>/i,
    /(?:instructions?|directions?|steps?)\s*:/i
  ];

  let ingredientsIndex = -1;
  let instructionsIndex = -1;

  // Find the position of Ingredients heading - search from END to handle content far down
  for (const pattern of ingPatterns) {
    const matches = [...html.matchAll(pattern)];
    for (const match of matches) {
      const idx = match.index ?? -1;
      if (idx >= 0 && (ingredientsIndex < 0 || idx < ingredientsIndex)) {
        ingredientsIndex = idx;
      }
    }
  }

  // Find the position of Instructions heading
  for (const pattern of instructionsPatterns) {
    const matches = [...html.matchAll(pattern)];
    for (const match of matches) {
      const idx = match.index ?? -1;
      if (idx >= 0 && (instructionsIndex < 0 || idx < instructionsIndex)) {
        instructionsIndex = idx;
      }
    }
  }

  d('aroundmyfamilytable found HTML indices', { ingredientsIndex, instructionsIndex, htmlLength: html.length });

  // Extract ingredients section (between Ingredients and Instructions headings)
  if (ingredientsIndex >= 0) {
    d('aroundmyfamilytable extracting ingredients section starting at index', ingredientsIndex);
    const start = ingredientsIndex;
    const end = instructionsIndex > ingredientsIndex ? instructionsIndex : Math.min(ingredientsIndex + 15000, html.length);
    const ingredientsSection = html.slice(start, end);
    d('aroundmyfamilytable ingredients section length:', ingredientsSection.length);

    // Extract list items - try both <ul> and <ol>
    const listItems = [...ingredientsSection.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    d('aroundmyfamilytable found list items:', listItems.length);
    
    for (const item of listItems) {
      let text = clean(item[1]);
      text = text.replace(/^[•\-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
      if (text && text.length > 2 && !/^(servings?|yield|prep time|cook time|total time)/i.test(text)) {
        ingredients.push(text);
      }
    }

    // If no list items, try extracting from text lines
    if (ingredients.length === 0) {
      d('aroundmyfamilytable no list items, trying text extraction');
      const textOnly = ingredientsSection.replace(/<[^>]+>/g, '\n');
      const lines = textOnly.split('\n').map(l => l.trim()).filter(l => l.length > 5 && l.length < 200);
      for (const line of lines) {
        if (/\d/.test(line) && !/^(servings?|yield|prep time|cook time|total time)/i.test(line)) {
          ingredients.push(line);
        }
      }
      d('aroundmyfamilytable extracted from text lines:', ingredients.length);
    }
  }

  // Extract instructions section (after Instructions heading)
  if (instructionsIndex >= 0) {
    d('aroundmyfamilytable extracting instructions section starting at index', instructionsIndex);
    const start = instructionsIndex;
    const end = Math.min(start + 20000, html.length);
    const instructionsSection = html.slice(start, end);
    d('aroundmyfamilytable instructions section length:', instructionsSection.length);

    // Extract numbered list items (steps)
    const stepListItems = [...instructionsSection.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    d('aroundmyfamilytable found step list items:', stepListItems.length);
    
    for (const item of stepListItems) {
      let text = clean(item[1]);
      text = text.replace(/^\d+[.)]\s+/, "").replace(/^[•\-*]\s+/, "").trim();
      if (text && text.length > 5 && !/^(servings?|yield|prep time|cook time|total time|notes?)/i.test(text)) {
        steps.push(text);
      }
    }

    // If no list items, try paragraphs
    if (steps.length === 0) {
      d('aroundmyfamilytable no step list items, trying paragraphs');
      const paragraphs = [...instructionsSection.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
      d('aroundmyfamilytable found paragraphs:', paragraphs.length);
      
      for (const p of paragraphs) {
        let text = clean(p[1]);
        if (text && text.length > 10 && !/^(servings?|yield|prep time|cook time|total time|notes?)/i.test(text)) {
          // Split on numbered steps if present
          const parts = text.split(/\s+(\d+[.)]\s+)/).filter(Boolean);
          if (parts.length > 1) {
            for (let i = 1; i < parts.length; i += 2) {
              const stepText = (parts[i] + (parts[i + 1] || "")).replace(/^\d+[.)]\s+/, "").trim();
              if (stepText.length > 5) steps.push(stepText);
            }
          } else if (/\b(combine|mix|heat|preheat|add|cook|bake|simmer|boil|whisk|stir)/i.test(text)) {
            steps.push(text);
          }
        }
      }
      d('aroundmyfamilytable extracted steps from paragraphs:', steps.length);
    }
  }

  // Step 3: If we still don't have enough, do one more aggressive search through the entire visible text
  if (ingredients.length < 2 || steps.length < 1) {
    d('aroundmyfamilytable step 3: final aggressive search, current counts:', { ingredients: ingredients.length, steps: steps.length });
    
    // Re-get visible text in case we need it fresh
    const visibleText = htmlToTextWithBreaks(html);
    
    // Find all occurrences of "Ingredients" in the visible text and extract everything after it
    const allIngMatches = [...visibleText.matchAll(/ingredients?\s*:?/gi)];
    d('aroundmyfamilytable found "Ingredients" text occurrences:', allIngMatches.length);
    
    if (allIngMatches.length > 0 && ingredients.length < 2) {
      // Take the last match (most likely the actual recipe, not navigation)
      const lastMatch = allIngMatches[allIngMatches.length - 1];
      const afterIng = visibleText.slice(lastMatch.index || 0);
      const untilInst = afterIng.match(/([\s\S]{0,3000}?)(?=(?:instructions?|directions?|steps?)\s*:?|$)/i);
      const ingText = untilInst ? untilInst[1] : afterIng.slice(0, 3000);
      
      const ingLines = ingText.split(/\n+/).map(l => l.trim()).filter(l => {
        return l.length > 5 && 
               l.length < 200 && 
               /\d/.test(l) && 
               !/^(servings?|yield|prep time|cook time|total time|instructions?|directions?)/i.test(l);
      });
      
      if (ingLines.length >= 2) {
        ingredients.length = 0;
        ingredients.push(...ingLines);
        d('aroundmyfamilytable extracted from aggressive text search:', ingredients.length);
      }
    }
    
    // Same for instructions
    const allInstMatches = [...visibleText.matchAll(/(?:instructions?|directions?|steps?)\s*:?/gi)];
    d('aroundmyfamilytable found "Instructions" text occurrences:', allInstMatches.length);
    
    if (allInstMatches.length > 0 && steps.length < 1) {
      const lastMatch = allInstMatches[allInstMatches.length - 1];
      const afterInst = visibleText.slice(lastMatch.index || 0);
      const instLines = afterInst.split(/\n+/).slice(1, 50).map(l => l.trim()).filter(l => {
        return l.length > 10 && 
               !/^(servings?|yield|prep time|cook time|total time|notes?)/i.test(l) &&
               (/\b(combine|mix|heat|preheat|add|cook|bake|simmer|boil|whisk|stir|remove|transfer|let|rest|serve)/i.test(l) ||
                /^\d+[.)]\s/.test(l));
      });
      
      if (instLines.length >= 1) {
        steps.length = 0;
        steps.push(...instLines);
        d('aroundmyfamilytable extracted steps from aggressive text search:', steps.length);
      }
    }
  }

  // Step 4: Nuclear option - extract ANY text that looks like ingredients/steps from the entire HTML
  // This is for when the normal extraction completely fails
  if (ingredients.length < 2 || steps.length < 1) {
    d('aroundmyfamilytable step 4: NUCLEAR OPTION - extracting from entire HTML');
    
    // Get ALL text from HTML, strip tags but keep structure
    const allText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
    
    d('aroundmyfamilytable all text length:', allText.length);
    
    // Find ingredients section - look for patterns like "1 cup", "2 tsp", etc.
    const ingredientPattern = /(?:^|\s)(\d+(?:\s+\d+\/\d+)?\s+(?:cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|kg|ml|l)\s+[\w\s]+)/gi;
    const allIngMatches = [...allText.matchAll(ingredientPattern)];
    
    if (allIngMatches.length >= 2 && ingredients.length < 2) {
      const found = allIngMatches.slice(0, 20).map(m => m[1].trim()).filter(Boolean);
      ingredients.length = 0;
      ingredients.push(...found);
      d('aroundmyfamilytable NUCLEAR: found ingredients via pattern:', ingredients.length);
    }
    
    // Find instructions - look for numbered steps or action verbs
    const stepPattern = /(\d+[.)]\s+[^0-9]{10,200}|(?:combine|mix|heat|preheat|add|cook|bake|simmer|boil|whisk|stir|remove|transfer|let|rest|serve|chill|refrigerate|cool|cut|slice|garnish)[^.!?]{10,200})/gi;
    const allStepMatches = [...allText.matchAll(stepPattern)];
    
    if (allStepMatches.length >= 1 && steps.length < 1) {
      const found = allStepMatches.slice(0, 20).map(m => m[1]?.trim() || m[0]?.trim()).filter(Boolean);
      steps.length = 0;
      steps.push(...found);
      d('aroundmyfamilytable NUCLEAR: found steps via pattern:', steps.length);
    }
    
    // Last resort: if we found "Ingredients:" and "Instructions:" in the text, extract everything between them
    if ((ingredients.length < 2 || steps.length < 1) && allText.includes('Ingredients') && allText.includes('Instructions')) {
      d('aroundmyfamilytable NUCLEAR: trying between-section extraction');
      const ingIdx = allText.toLowerCase().lastIndexOf('ingredients');
      const instIdx = allText.toLowerCase().lastIndexOf('instructions');
      
      if (ingIdx >= 0 && instIdx > ingIdx) {
        const between = allText.slice(ingIdx + 10, instIdx);
        const lines = between.split(/[.,;]\s+|\n+/).map(l => l.trim()).filter(l => {
          return l.length > 10 && l.length < 200 && /\d/.test(l);
        });
        
        if (lines.length >= 2 && ingredients.length < 2) {
          ingredients.length = 0;
          ingredients.push(...lines.slice(0, 15));
          d('aroundmyfamilytable NUCLEAR: extracted ingredients from between sections:', ingredients.length);
        }
      }
      
      if (instIdx >= 0) {
        const afterInst = allText.slice(instIdx + 12);
        const stepLines = afterInst.split(/\d+[.)]\s+|(?:combine|mix|heat|preheat|add|cook|bake|simmer|boil)/i)
                                  .map(l => l.trim())
                                  .filter(l => l.length > 10 && l.length < 300);
        
        if (stepLines.length >= 1 && steps.length < 1) {
          steps.length = 0;
          steps.push(...stepLines.slice(0, 15));
          d('aroundmyfamilytable NUCLEAR: extracted steps from after instructions:', steps.length);
        }
      }
    }
  }


  d('aroundmyfamilytable final counts', { ingredients: ingredients.length, steps: steps.length });
  
  // ALWAYS return something - even if it's minimal data
  // The caller will check if it's "meaningful" but we should try to extract whatever we can
  const result = {
    ingredients: ingredients.length > 0 ? ingredients : undefined,
    steps: steps.length > 0 ? steps : undefined,
  };
  
  d('aroundmyfamilytable RETURNING', result);
  return result;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&deg;/gi, "°")
    // Decode numeric HTML entities (decimal and hex)
    .replace(/&#(\d+);/gi, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function captionFromAnyTikTokJSON(json: any): string | null {
  if (!json) return null;

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: any) => {
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
    }
  };

  // classic module
  const im = json?.ItemModule;
  if (im && typeof im === 'object') {
    const first: any = Object.values(im)[0];
    if (first && typeof first === 'object') {
      push(first?.desc);
      push(first?.shareInfo?.shareTitle);
      push(first?.title);
    }
  }

  // universal data scopes (photo mode etc.)
  const scope = json?.__DEFAULT_SCOPE__;
  if (scope && typeof scope === 'object') {
    const structs: any[] = [];
    const visited = new Set<any>();
    for (const node of Object.values(scope)) {
      collectTikTokStructs(node, structs, visited, 0);
    }
    for (const itemStruct of structs) {
      push(itemStruct?.desc);
      push(itemStruct?.imagePost?.caption);
      push(itemStruct?.imagePost?.title);
      push(itemStruct?.video?.desc);
      push(itemStruct?.video?.title);
    }
  }

  // SEO/share spots (photo pages sometimes use these)
  const metaSources = [json?.SEOState, json?.ShareMeta, json?.app, json?.SEOMeta];
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
    const s = JSON.stringify(json);
    const m = s.match(/"(?:description|desc)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    if (m) {
      return JSON.parse(`"${m[1]}"`);
    }
  } catch {}
  return null;
}

// 4) If all else fails: TikTok oEmbed (their API gives the caption as "title")
async function fetchTikTokOEmbedCaption(url: string): Promise<string> {
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  try {
    const r = await fetch(endpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/plain,*/*',
      },
    });
    if (!r.ok) return '';
    const j = await r.json();
    return (j?.title || '').toString().trim();
  } catch { return ''; }
}

// Searches raw HTML for any "description" / "desc" fields and picks the longest good one
function unescapeJsonish(s: string) {
  return s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}
function extractFromDescriptionKey(html: string): string | null {
  const hits = html.match(/"(?:description|desc)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi) || [];
  let best: string | null = null, score = 0;
  for (const h of hits) {
    const m = h.match(/"(?:description|desc)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
    if (!m) continue;
    const s = unescapeJsonish(m[1]);
    if (s.length < 20) continue;
    if (/seo_|pcWeb_|webLIVE_|This might interest|scan the QR code/i.test(s)) continue;
    const sc = s.length + (/\bingredients?\b/i.test(s) ? 400 : 0);
    if (sc > score) { score = sc; best = s; }
  }
  return best;
}

/* -------- Instagram extraction functions -------- */

// Extract caption from window._sharedData (Instagram's embedded JSON)
function extractInstagramFromSharedData(html: string): string | null {
  try {
    // Try to find window._sharedData = {...};
    // Use brace counting to extract the full JSON object (similar to wprm_recipes)
    const sharedPattern = /window\._sharedData\s*=\s*\{/;
    const startMatch = html.match(sharedPattern);
    
    if (startMatch && startMatch.index !== undefined) {
      const startPos = startMatch.index + startMatch[0].length - 1; // Position of the opening {
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      
      for (let i = startPos; i < html.length; i++) {
        const char = html[i];
        
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        
        if (char === '"' && !escapeNext) {
          inString = !inString;
          continue;
        }
        
        if (inString) continue;
        
        if (char === '{') braceCount++;
        if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            const endPos = i + 1;
            const jsonStr = html.substring(startPos, endPos).trim();
            try {
              const json = JSON.parse(jsonStr);
              // Navigate to caption: entry_data.PostPage[0].graphql.shortcode_media.edge_media_to_caption.edges[0].node.text
              const post = json?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
              if (post) {
                const caption = post?.edge_media_to_caption?.edges?.[0]?.node?.text || 
                               post?.caption || 
                               '';
                if (caption && typeof caption === 'string' && caption.length > 10) {
                  return String(caption);
                }
              }
            } catch (e) {
              // Fall through
            }
            break;
          }
        }
      }
    }
    
    // Fallback: try simpler regex match (may not get full object but might work)
    const simpleMatch = html.match(/window\._sharedData\s*=\s*(\{[\s\S]{0,50000}?\})\s*;?/);
    if (simpleMatch?.[1]) {
      try {
        const json = JSON.parse(simpleMatch[1]);
        const post = json?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
        if (post) {
          const caption = post?.edge_media_to_caption?.edges?.[0]?.node?.text || 
                         post?.caption || 
                         '';
          if (caption && typeof caption === 'string' && caption.length > 10) {
            return String(caption);
          }
        }
      } catch (e) {
        // Fall through
      }
    }
  } catch (e) {
    // Fall through
  }
  
  return null;
}

// Extract caption from visible HTML text (article, span elements, etc.)
function extractInstagramFromVisibleHtml(html: string): string | null {
  try {
    // Remove script and style tags
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
    
    // Try to find article or main content area
    const articleMatch = cleanHtml.match(/<article[^>]*>([\s\S]{0,20000}?)<\/article>/i);
    if (articleMatch) {
      const articleContent = articleMatch[1];
      // Look for span elements with dir="auto" (Instagram's caption containers)
      const spanMatches = [...articleContent.matchAll(/<span[^>]*dir=["']auto["'][^>]*>([\s\S]*?)<\/span>/gi)];
      if (spanMatches.length > 0) {
        // Get the longest span (likely the caption)
        const spans = spanMatches.map(m => {
          const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          return text;
        }).filter(t => t.length > 50);
        
        if (spans.length > 0) {
          spans.sort((a, b) => b.length - a.length);
          return spans[0];
        }
      }
      
      // Fallback: extract all text from article
      const articleText = articleContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (articleText.length > 100) {
        return articleText;
      }
    }
    
    // Try h1 with dir="auto"
    const h1Match = cleanHtml.match(/<h1[^>]*dir=["']auto["'][^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      const text = h1Match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length > 50) {
        return text;
      }
    }
  } catch (e) {
    // Fall through
  }
  
  return null;
}

/* -------- Generic JSON-LD caption finder (non-Recipe nodes) -------- */
function parseJsonLdBestCaption(html: string): string | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let best: string | null = null;
  let bestScore = 0;

  for (const s of scripts) {
    let json: any;
    try { json = JSON.parse(s[1]); }
    catch { continue; }

    const nodes = Array.isArray(json) ? json : (json['@graph'] ? json['@graph'] : [json]);

    for (const node of nodes) {
      // skip pure Recipe (handled earlier)
      const t = node?.['@type'];
      const isRecipe =
        typeof t === 'string' ? /Recipe/i.test(t) :
        Array.isArray(t) && t.some((x:any)=>/Recipe/i.test(String(x)));
      if (isRecipe) continue;

      // Walk the object tree, collect likely text fields.
      const candidates = collectCaptionStrings(node);
      for (const c of candidates) {
        if (!c || c.length < 20) continue;
        if (/TikTok - Make Your Day/i.test(c)) continue;
        if (/scan the QR code/i.test(c)) continue;
        // score: prefer ingredient-y with numbers/units
        const score = c.length + (/\bingredients?\b/i.test(c) ? 500 : 0) +
                      (/\d/.test(c) ? 200 : 0);
        if (score > bestScore) { bestScore = score; best = c; }
      }
    }
  }

  return best;
}

function collectCaptionStrings(obj: any): string[] {
  const out: string[] = [];
  const visit = (v: any) => {
    if (!v) return;
    if (typeof v === 'string') return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (typeof val === 'string') {
          if (/^(description|headline|caption|articleBody|name|text|about)$/i.test(k)) {
            out.push(val);
          }
        } else if (val && typeof val === 'object') {
          visit(val);
        }
      }
    }
  };
  visit(obj);
  return out;
}

/* --------------------------- visible (loose) capture --------------------------- */

// STRICT version (kept; needs a clean "Ingredients" heading)
function extractIngredientsFromVisibleText(fullText: string): string[] {
  const lines = fullText.replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
  const start = lines.findIndex(l => /^ingredients(?:\s+needed)?\:?$/i.test(l));
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    const nextHeading =
      /^(directions?|steps?|method|instructions?)\s*:?$/i.test(line) ||
      (/^[A-Z][A-Z \-]{2,30}$/.test(line) && !/[a-z]/.test(line));
    if (nextHeading) break;
    const cleaned = line.replace(/^[•\-–\u2022>\s]+/,'').trim();
    if (cleaned && !/^(more|less|scan|qr)$/i.test(cleaned)) out.push(cleaned);
  }
  return out;
}

// LOOSE version: find any "Ingredients:" then pick bullets/short lines until we hit directions.
function extractIngredientsAndStepsNearKeyword(fullText: string): { ingredients: string[]; steps: string[] } {
  const text = fullText.replace(/\r/g, '');
  const idx = text.search(/ingredients?\s*:/i);
  if (idx < 0) return { ingredients: [], steps: [] };

  const tail = text.slice(idx);
  const lines = tail.split('\n').map(l => l.trim());

  // Find where directions start
  const dirIndex = lines.findIndex(l => /^(directions?|steps?|method|instructions?)\s*:?$/i.test(l));
  const ingLinesRaw = (dirIndex > 0 ? lines.slice(1, dirIndex) : lines.slice(1, 25)) // cap so we don't run away
    .map(s => s.replace(/^[•\-–\u2022>\s]+/,'').trim())
    .filter(Boolean)
    .filter(s => !/^http/i.test(s) && !/^@/i.test(s) && !/^#\w/.test(s));
  const ingredients = normalizeIngredientLines(ingLinesRaw);

  // Steps, if we saw a directions header
  let steps: string[] = [];
  if (dirIndex > 0) {
    const after = lines.slice(dirIndex + 1, dirIndex + 50).join('\n');
    steps = splitDirectionsText(after);
  }

  return { ingredients, steps };
}

/* --------------------------- title helpers --------------------------- */
// IMPORTANT: Only ONE pickBestTitle exists in this file.
function pickBestTitle(html: string, url: string): string | undefined {
  const t = extractTitle(html, url)?.title;
  return t || guessTitle(html) || undefined;
}

/* --------------------------- tiny “AI-ish” caption parser --------------------------- */
/**
 * smartExtractFromCaption:
 * - Finds the Ingredients section (if present) and splits cleanly (bullets, dashes, commas).
 * - Detects the Directions/Steps section and splits into numbered steps or sentence steps.
 * - Filters out hashtags, links, and long prose so ingredients stay clean, one per line.
 */
function smartExtractFromCaption(cap: string): { ingredients: string[]; steps: string[] } {
  if (!cap) return { ingredients: [], steps: [] };

  // 0) normalize spaces + strip hashtags/links
  let t = String(cap)
    .replace(/\r/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[A-Za-z0-9_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1) try to split by sections first: Ingredients -> Directions/Steps/Method
  const sect = t.match(/ingredients?\s*:?\s*([\s\S]*?)(?:\b(directions?|steps?|method|instructions?)\b\s*:?\s*([\s\S]*))?$/i);
  if (sect) {
    const ingBlock = (sect[1] || '').trim();
    const dirBlock = (sect[3] || '').trim();

    const ingredients = cleanIngredientBlock(ingBlock);
    const steps = splitDirectionsText(dirBlock);

    if (ingredients.length >= 2) return { ingredients, steps };
  }

  // 2) if no clear sections, infer: first bullet-like chunk = ingredients, then numbers/sentences = steps
  const chunks = capChunks(t);
  const { ingredients, steps } = inferIngredientsThenSteps(chunks);
  return { ingredients, steps };
}

// Split a directions text into steps using numbers/bullets/sentences.
function splitDirectionsText(txt: string): string[] {
  if (!txt) return [];
  const cleaned = txt
    .replace(/\r/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[A-Za-z0-9_]+/g, ' ')
    .trim();

  // Prefer numbered "1. ..." blocks
  const numbered = cleaned.split(/\s*\b(?:\d+[\.)]|step\s*\d+[\.)]?)\s*/gi).map(s => s.trim()).filter(Boolean);
  if (numbered.length > 1) return numbered.map(s => trimTrailingPunct(s));

  // Fallback: split on newlines or sentence periods (keep short-ish, action-y lines)
  const maybe = cleaned.split(/\n|[•\-–\u2022]|(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);
  const verbs = /\b(preheat|heat|mix|stir|combine|whisk|bake|sear|cook|transfer|add|pour|let|rest|serve|season|fold|press|slice|cut|boil|simmer|broil|grill|cool)\b/i;
  const steps = maybe.filter(s => s.length >= 6 && (verbs.test(s) || /\d+(-|–|—| to )\d+ (min|minutes|secs|seconds)/i.test(s)));
  return steps.map(s => trimTrailingPunct(s));
}

// Turn a messy ingredient paragraph into lines, then clean + dedupe.
function cleanIngredientBlock(block: string): string[] {
  if (!block) return [];
  // 1) cut off if a directions word sneaks in
  block = block.replace(/\b(directions?|steps?|method|instructions?)\b[\s\S]*$/i, '').trim();

  // 2) split on new lines, bullets, or " - "
  const rough = block
    .replace(/\r/g, '')
    .split(/\n|;|[|]|(?<!\w)-\s|[\u2022•·▪▫►▶]/g)
    .map(s => s.replace(/^[\s\-–•·\u2022>\.]+/,'').trim());

  // 3) if still too few, split on commas — but only when short-ish (avoid breaking sentences)
  const boosted = rough.length >= 2 ? rough : block.split(/,(?![^()]*\))/g).map(s => s.trim());

  // 4) remove junk: hashtags, links, long prose, bare conjunctions
  const junk = /^(?:and|or|with|plus)$/i;
  let lines = boosted
    .filter(Boolean)
    .filter(s => !/^http/i.test(s) && !/^@/i.test(s) && !/^#\w/.test(s))
    .filter(s => s.length <= 120 && !/[.!?]\s*[A-Z]/.test(s)) // long sentences likely directions
    .filter(s => !junk.test(s));

  // 5) fix split “salt / pepper” cases: join if two adjacent lines are “salt” + “pepper…”
  lines = mergeSaltPepper(lines);

  // 6) final tidy + dedupe
  return normalizeIngredientLines(lines);
}

// If list contains "... salt" followed by "pepper ..." merge into "Salt and pepper to taste"
function mergeSaltPepper(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (/^salt$/i.test(cur) && next && /^pepper\b/i.test(next)) {
      out.push('Salt and pepper to taste');
      i++; // skip next
      continue;
    }
    out.push(cur);
  }
  return out;
}

// Break caption into bullet-like chunks (used when no clear headings exist)
function capChunks(t: string): string[] {
  return t
    .replace(/\r/g, '')
    .split(/\n|[•\u2022]| - |\u00b7|·|;/g)
    .map(s => s.trim())
    .filter(Boolean);
}

// Given chunks, guess which are ingredients (short/food-y) until we hit a directions-y chunk.
function inferIngredientsThenSteps(chunks: string[]): { ingredients: string[]; steps: string[] } {
  const ingredients: string[] = [];
  const steps: string[] = [];
  const foodish = /\b(salt|pepper|flour|sugar|butter|oil|garlic|onion|egg|cheese|cream|milk|vanilla|baking|chicken|beef|pork|tomato|lemon|lime|rice|pasta|jalapeno|jalapeño|oregano|seasoning|powder|jam|olive oil|broth|buttermilk)\b/i;
  const unitish = /(cup|cups|tsp|tsps|tbsp|tbsps|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|g|kg|ml|l|\d\/\d|\d|½|¼|¾)/i;
  const verbish = /\b(preheat|heat|mix|stir|combine|whisk|bake|sear|cook|transfer|add|pour|let|rest|serve|season|fold|press|slice|cut|boil|simmer|broil|grill|cool)\b/i;

  let inIngredients = true;
  for (const c of chunks) {
    const hasVerb = verbish.test(c);
    const looksIng = (foodish.test(c) || unitish.test(c)) && c.length <= 90 && !/[.!?]\s*[A-Z]/.test(c);

    if (inIngredients && looksIng && !hasVerb) {
      ingredients.push(c.replace(/^[\-\u2022•\s]+/, ''));
    } else {
      inIngredients = false; // once we see a non-ingredienty chunk, switch to steps
      if (c.length >= 6) steps.push(c);
    }
  }

  return { ingredients: normalizeIngredientLines(ingredients), steps: steps.map(s => trimTrailingPunct(s)) };
}

function trimTrailingPunct(s: string): string {
  return s.replace(/\s*([.,;:])?\s*$/, (_, p) => (p ? p : '')).trim();
}
