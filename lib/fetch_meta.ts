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
};

const DEBUG = true;
const d = (...a: any[]) => DEBUG && console.log('[IMPORT]', ...a);

export async function fetchMeta(url: string): Promise<RecipeMeta> {
  d('fetchMeta url =', url);

  // 0) First pull the HTML (desktop UA)
  let html = await fetchHtmlDesktop(url);
  d('html length', html.length);

  // 0b) If this is TikTok and we didn’t see any obvious data,
  //     try again with a **mobile** UA (TikTok sometimes hides desktop data).
  if (isTikTok(url) && !/\bSIGI_STATE\b|\bItemModule\b/i.test(html)) {
    d('retrying with MOBILE UA for TikTok…');
    const mobile = await fetchHtmlMobile(url);
    if (mobile && mobile.length > html.length * 0.5) html = mobile;
    d('mobile html length', mobile.length);
  }

  // 1) Blog structured data first (instant win when present)
  let fallbackPartial: PartialPick = {};

  const fromLdRecipe = parseJsonLdRecipe(html);
  if (fromLdRecipe) {
    fallbackPartial = { ...fallbackPartial, ...fromLdRecipe };
    if (hasMeaningfulRecipeData(fromLdRecipe)) {
      return finalize(url, fromLdRecipe, html, 'json-ld:Recipe');
    }
  }

  const fromMicro = parseMicrodata(html);
  if (fromMicro) {
    fallbackPartial = { ...fallbackPartial, ...fromMicro };
    if (hasMeaningfulRecipeData(fromMicro)) {
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

  // 2) TikTok focused paths (videos AND photos)
  if (isTikTok(url)) {
    // 2a) Server-rendered caption spans
    const fromCaptionSpans = extractTikTokCaptionFromDom(html);
    if (fromCaptionSpans) {
      const pick = smartExtractFromCaption(fromCaptionSpans);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'tiktok:DOM');
      }
    }

    // 2b) ANY TikTok data JSON we can find (SIGI_STATE or friends)
    const anyState = extractAnyTikTokDataJSON(html);
    const fromAny = captionFromAnyTikTokJSON(anyState);
    if (fromAny) {
      const pick = smartExtractFromCaption(fromAny);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'tiktok:any-json');
      }
    }

    // 2c) Fuzzy search for "description"/"desc" keys in the raw HTML/JS
    const fromDescKey = extractFromDescriptionKey(html);
    if (fromDescKey) {
      const pick = smartExtractFromCaption(fromDescKey);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'tiktok:desc-key');
      }
    }

    // 2d) oEmbed fallback (TikTok API — returns caption as "title")
    const oCap = await fetchTikTokOEmbedCaption(url);
    if (oCap) {
      const pick = smartExtractFromCaption(oCap);
      if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
        return finalize(url, pick, html, 'tiktok:oembed');
      }
    }
  }

  // 3) Generic JSON-LD caption (video/article/social posts)
  const ldCaption = parseJsonLdBestCaption(html);
  if (ldCaption) {
    d('json-ld caption sample', ldCaption.slice(0, 120));
    const pick = smartExtractFromCaption(ldCaption);
    if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
      return finalize(url, pick, html, 'json-ld:caption');
    }
  }

  // 4) OG/Twitter description
  const metaDesc = pickMeta(html, 'og:description') || pickMeta(html, 'twitter:description');
  if (metaDesc) {
    const pick = smartExtractFromCaption(metaDesc);
    if (looksRealIngredients(pick.ingredients, { allowSoft: true })) {
      return finalize(url, pick, html, 'og-description');
    }
  }

  // 5) Visible “Ingredients:” ANYWHERE in the page text (loose)
  const visible = htmlToTextWithBreaks(html);
  const loose = extractIngredientsAndStepsNearKeyword(visible);
  if (loose.ingredients.length >= 2) {
    return finalize(url, loose, html, 'visible-ingredients-loose');
  }

  // 6) fallback basics
  const extracted = extractTitle(html, url);
  return finalize(url, fallbackPartial, html, "fallback");
}

/* --------------------------- normalize + finalize --------------------------- */

type PartialPick = { title?: string; image?: string; ingredients?: string[]; steps?: string[] };

function finalize(url: string, p: PartialPick, html: string, source: string): RecipeMeta {
  d('finalize from', source);

  // 1) robust title pass (JSON-LD/OG/Twitter/TikTok desc → cleaned)
  const extracted = extractTitle(html, url);
  const t = extracted?.title;
  const title = (p.title && p.title.trim()) || (t && t.trim()) || guessTitle(html) || undefined;

  // 2) image from OG/Twitter (unless caller already sent one)
  const image = p.image || pickOgImage(html) || undefined;

  // 3) ingredients → cleaned strings (UI will later parse into qty/unit)
  const rawIng = Array.isArray(p.ingredients) ? p.ingredients : [];
  const canonical = normalizeIngredientLines(rawIng);

  // 4) steps → trimmed strings
  const steps = Array.isArray(p.steps) ? p.steps.map(s => String(s).trim()).filter(Boolean) : [];

  return { url, title, image, ingredients: canonical, steps };
}

function hasMeaningfulRecipeData(p: PartialPick): boolean {
  const ingCount = p.ingredients?.length ?? 0;
  const stepCount = p.steps?.length ?? 0;
  return ingCount >= 2 || stepCount >= 1;
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
  const articleMatch = html.match(/<article[^>]*class=["'][^"']*recipe-instructions[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);

  if (!asideMatch && !articleMatch) return null;

  const ingredients: string[] = [];
  if (asideMatch) {
    const section = asideMatch[1];
    for (const item of section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      let text = clean(item[1]);
      text = text.replace(/^\d+\.\s*/, "");
      if (text) ingredients.push(text);
    }
  }

  const steps: string[] = [];
  if (articleMatch) {
    const section = articleMatch[1];
    for (const item of section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = clean(item[1]);
      if (text) steps.push(text);
    }
    if (!steps.length) {
      const paragraphs = section.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      for (const p of paragraphs) {
        const text = clean(p);
        if (text) steps.push(text);
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

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&deg;/gi, "°");
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
