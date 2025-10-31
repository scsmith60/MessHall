// lib/extractTitle.ts
// Like I'm 5: this file finds a nice title for a page.
// We look in many places (H1, JSON-LD, OG meta, TikTok JSON) and pick the best.

export type ExtractedMeta = {
  title?: string;
  canonicalUrl?: string;
  // If true, caller should run a client-render (WebView) scraper and retry
  needsClientRender?: boolean;
};

/* --------------------------- tiny string helpers --------------------------- */

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");
const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // numeric entities (hex & decimal) -> characters
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
const textify = (html: string) =>
  decodeEntities(stripTags(String(html))).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

const BAD_TITLES = new Set([
  "TikTok – Make Your Day",
  "TikTok - Make Your Day",
  "TikTok",
  "YouTube",
  "Instagram",
  "Login • Instagram",
  "Today's top videos",
  "Today’s top videos",
]);

const isTikTok = (url: string) => /tiktok\.com\/@/i.test(url);
const isInstagram = (url: string) => /instagram\.com\//i.test(url);

/* ------------------------------- meta helpers ------------------------------ */

function pickMeta(html: string, name: string): string {
  // <meta property="og:title" ...> or <meta name="twitter:title" ...>
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
  const m = html.match(re);
  if (!m) return "";
  const cm = m[0].match(/content=["']([^"']+)["']/i);
  return (cm?.[1] || "").trim();
}

function pickTitleTag(html: string): string {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m?.[1] ? textify(m[1]) : "";
}

function pickGenericH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = m?.[1] ? textify(m[1]) : "";
  if (!h1) return "";
  // Avoid headings that are just "Ingredients" etc.
  if (/^\s*(ingredients?|directions?|steps?|method)\s*$/i.test(h1)) return "";
  return h1;
}

function cleanTitle(t: string): string {
  if (!t) return "";
  let out = t;
  // remove long site suffixes
  out = out.replace(
    /\s*[|–-]\s*(TikTok|YouTube|Instagram|Facebook|Pinterest|Allrecipes|Food Network|Yummly|Google).*$/i,
    ""
  );
  // trim “ by @user”
  out = out.replace(/\s*by\s*@[\w.\-]+$/i, "");
  // collapse spaces
  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}

function fromCanonicalLink(html: string): string {
  const m =
    html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/i);
  return (m?.[1] || "").trim();
}

/* ---------------------------- JSON-LD extraction --------------------------- */

function safeJSON<T = any>(s?: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function fromJsonLdTitle(html: string): string {
  const scripts = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  let best = "";
  let bestScore = -1;

  for (const s of scripts) {
    const json = safeJSON<any>(s[1]);
    if (!json) continue;

    const nodes: any[] = Array.isArray(json) ? json : json["@graph"] ? json["@graph"] : [json];

    for (const node of nodes) {
      const t = node?.["@type"];
      const title = String(node?.name || node?.headline || "").trim();
      if (!title) continue;

      const isRecipe =
        typeof t === "string"
          ? /Recipe/i.test(t)
          : Array.isArray(t) && t.some((x: any) => /Recipe/i.test(String(x)));
      const isMedia =
        typeof t === "string"
          ? /(VideoObject|ImageObject|SocialMediaPosting|WebPage|Article)/i.test(t)
          : Array.isArray(t) &&
            t.some((x: any) =>
              /(VideoObject|ImageObject|SocialMediaPosting|WebPage|Article)/i.test(String(x))
            );

      let score = title.length;
      if (isRecipe) score += 500;
      else if (isMedia) score += 200;

      if (score > bestScore) {
        bestScore = score;
        best = title;
      }
    }
  }
  return best;
}

/* ------------------------- Instagram shared-data ------------------------- */
// Parse window._sharedData or meta description to extract a short caption/title.
function fromInstagramSharedData(html: string): string {
  // 1) Try window._sharedData = {...};
  const sharedMatch = html.match(/window\._sharedData\s*=\s*(\{[\s\S]*?\})\s*;?/i);
  if (sharedMatch?.[1]) {
    const json = safeJSON<any>(sharedMatch[1]);
    if (json) {
      try {
        const post =
          json?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media ||
          json?.entry_data?.ProfilePage?.[0]?.graphql?.user;
        const caption =
          post?.edge_media_to_caption?.edges?.[0]?.node?.text || post?.caption || "";
        if (caption) return extractShortCaption(String(caption));
      } catch (e) {
        // fall through
      }
    }
  }

  // 2) Fallback to OG / meta description
  const metaDesc = pickMeta(html, "og:description") || pickMeta(html, "description") || pickMeta(html, "twitter:description");
  if (metaDesc) return extractShortCaption(metaDesc);

  return "";
}

function extractShortCaption(s: string): string {
  if (!s) return "";
  // normalize whitespace and decode entities
  let c = textify(s);
  // take first non-empty line
  const lines = c.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let first = lines[0] || c;
  // If there's an emoji-wrapped short title anywhere (e.g. 🍃Title🍃), capture it
  const emojiAnywhere = c.match(/\p{Extended_Pictographic}+\s*(.*?)\s*\p{Extended_Pictographic}+/u);
  if (emojiAnywhere?.[1]) {
    first = emojiAnywhere[1].trim();
  } else {
    // If caption begins/ends with an emoji pair like 🍃Title🍃, try to capture inside as fallback
    const emojiWrap = first.match(/^\p{Extended_Pictographic}+(.*?)\p{Extended_Pictographic}+$/u);
    if (emojiWrap?.[1]) first = emojiWrap[1].trim();
  }
  // Remove common trailing signals (e.g. "Get the #recipe", "Please Follow", hashtags)
  first = first.replace(/\b(Get the|Please Follow|Follow me|#recipe|#recipes|#recipe)\b[\s\S]*$/i, "");
  // Clip to 100 chars on a word boundary
  if (first.length > 100) {
    const clipped = first.slice(0, 100);
    const lastSpace = clipped.lastIndexOf(" ");
    first = clipped.slice(0, lastSpace > 40 ? lastSpace : 100) + "...";
  }
  return first.trim();
}

/* --------------------------- TikTok special DOM H1 ------------------------- */
// Your screenshot showed: <h1 class="... H1PhotoTitle ...">Texas Roadhouse ...</h1>
// TikTok also uses "H1VideoTitle". We read those directly.

function fromTikTokDomH1(html: string): string {
  // any <h1> whose class contains H1PhotoTitle / H1VideoTitle / PhotoTitle or similar tokens
  const h1Regexes = [
    /<h1[^>]+class=["'][^"']*\bH1PhotoTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]+class=["'][^"']*\bH1VideoTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]+class=["'][^"']*\bPhotoTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  ];
  let m: RegExpMatchArray | null = null;
  for (const r of h1Regexes) {
    m = html.match(r);
    if (m?.[1]) break;
  }
  return m?.[1] ? textify(m[1]) : "";
}

/* ------------------------------ TikTok SIGI ------------------------------- */
// Fallback caption/title from the state JSON (works for both photos & videos)

function collectTikTokItemStructs(node: any, bag: any[], seen: Set<any>, depth: number) {
  if (!node || typeof node !== "object") return;
  if (seen.has(node) || depth > 6) return;
  seen.add(node);

  if (node.itemStruct && typeof node.itemStruct === "object") {
    bag.push(node.itemStruct);
  }
  if (node.itemInfo && typeof node.itemInfo === "object") {
    collectTikTokItemStructs(node.itemInfo, bag, seen, depth + 1);
  }
  if (node.state && typeof node.state === "object") {
    collectTikTokItemStructs(node.state, bag, seen, depth + 1);
  }
  if (node.preload && typeof node.preload === "object") {
    collectTikTokItemStructs(node.preload, bag, seen, depth + 1);
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      collectTikTokItemStructs(value, bag, seen, depth + 1);
    }
  }
}

function pushTikTokCandidates(
  value: any,
  primary: string[],
  fallback: string[],
  seen: Set<string>,
  preferDesc = false
) {
  if (!value) return;
  const list = Array.isArray(value) ? value : [value];
  for (const entry of list) {
    if (entry == null) continue;
    let text: string | null = null;
    if (typeof entry === "string" || typeof entry === "number") {
      text = String(entry);
    } else if (typeof entry === "object") {
      if (typeof entry.title === "string") text = entry.title;
      else if (typeof entry.caption === "string") text = entry.caption;
      else if (typeof entry.text === "string") text = entry.text;
    }
    if (!text) continue;
    const cleaned = textify(text).trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    if (preferDesc) fallback.push(cleaned);
    else primary.push(cleaned);
  }
}

export function extractTikTokTitleFromState(state: any): string | null {
  if (!state || typeof state !== "object") return null;

  const primary: string[] = [];
  const fallback: string[] = [];
  const seen = new Set<string>();

  // 1) Classic ItemModule payload (legacy videos/photos)
  if (state.ItemModule && typeof state.ItemModule === "object") {
    const items = Object.values(state.ItemModule);
    if (items.length) {
      const first: any = items[0];
      if (first && typeof first === "object") {
        pushTikTokCandidates(first?.imagePost?.title, primary, fallback, seen);
        pushTikTokCandidates(first?.imagePost?.caption, primary, fallback, seen);
        pushTikTokCandidates(first?.video?.title, primary, fallback, seen);
        pushTikTokCandidates(first?.title, primary, fallback, seen);
        pushTikTokCandidates(first?.shareInfo?.shareTitle, primary, fallback, seen);
        pushTikTokCandidates(first?.shareMeta?.title, primary, fallback, seen);
        pushTikTokCandidates(first?.desc, primary, fallback, seen, true);
      }
    }
  }

  // 2) New universal data scope (photo mode & refreshed desktop)
  const scope = state.__DEFAULT_SCOPE__;
  if (scope && typeof scope === "object") {
    const structs: any[] = [];
    const visited = new Set<any>();
    for (const node of Object.values(scope)) {
      collectTikTokItemStructs(node, structs, visited, 0);
    }
    for (const itemStruct of structs) {
      if (!itemStruct || typeof itemStruct !== "object") continue;
      pushTikTokCandidates(itemStruct?.imagePost?.title, primary, fallback, seen);
      pushTikTokCandidates(itemStruct?.imagePost?.caption, primary, fallback, seen);
      pushTikTokCandidates(itemStruct?.imagePost?.cover?.title, primary, fallback, seen);
      pushTikTokCandidates(itemStruct?.video?.title, primary, fallback, seen);
      pushTikTokCandidates(itemStruct?.title, primary, fallback, seen);
      pushTikTokCandidates(itemStruct?.descTitle, primary, fallback, seen);
      if (itemStruct?.shareMeta) {
        pushTikTokCandidates(itemStruct.shareMeta?.title, primary, fallback, seen);
      }
      if (itemStruct?.collectionInfo) {
        pushTikTokCandidates(itemStruct.collectionInfo?.title, primary, fallback, seen);
      }
      pushTikTokCandidates(itemStruct?.desc, primary, fallback, seen, true);
    }
  }

  // 3) Some payloads expose a lighter "item" node
  if (state.item && typeof state.item === "object") {
    pushTikTokCandidates(state.item?.title, primary, fallback, seen);
    pushTikTokCandidates(state.item?.shareMeta?.title, primary, fallback, seen);
    pushTikTokCandidates(state.item?.desc, primary, fallback, seen, true);
  }

  // 4) SEO/share metadata objects
  const metaSources = [state.SEOMeta, state.SEOState, state.ShareMeta, state.app, state];
  for (const source of metaSources) {
    if (!source || typeof source !== "object") continue;
    pushTikTokCandidates(source?.metaParams?.title, primary, fallback, seen);
    pushTikTokCandidates(source?.shareMeta?.title, primary, fallback, seen);
    pushTikTokCandidates(source?.ogMeta?.title, primary, fallback, seen);
    pushTikTokCandidates(source?.metaParams?.description, primary, fallback, seen, true);
    pushTikTokCandidates(source?.shareMeta?.description, primary, fallback, seen, true);
  }

  const ordered = [...primary, ...fallback];
  for (const candidate of ordered) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (BAD_TITLES.has(trimmed)) continue;
    if (/^https?:\/\//i.test(trimmed)) continue;
    if (trimmed.length > 200) continue;
    return trimmed;
  }

  return null;
}

function fromTikTokSigi(html: string): string {
  // Try several variants of embedded JSON: id=SIGI_STATE, window['SIGI_STATE'], or a script that includes "SIGI_STATE"
  let jsonText: string | null = null;
  const m1 = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
  if (m1?.[1]) jsonText = m1[1];
  else {
    const m2 = html.match(/window\[['"]SIGI_STATE['"]\]\s*=\s*(\{[\s\S]*?\})\s*;?/i);
    if (m2?.[1]) jsonText = m2[1];
    else {
      const m3 = html.match(/<script[^>]*>([\s\S]*?SIGI_STATE[\s\S]*?)<\/script>/i);
      if (m3?.[1]) {
        // try to extract a JSON object inside
        const objMatch = m3[1].match(/(\{[\s\S]*\})/);
        if (objMatch?.[1]) jsonText = objMatch[1];
      }
    }
  }
  const json = safeJSON<any>(jsonText);
  if (!json) return "";
  return extractTikTokTitleFromState(json) || "";
}

/* --------------------------------- main ------------------------------------ */

export function extractTitle(html: string, url: string): ExtractedMeta {
  const out: ExtractedMeta = {};
  const canonical = fromCanonicalLink(html) || undefined;

  // 0) TikTok DOM H1 (photo/video pages) — this is the spot you highlighted.
  if (isTikTok(url)) {
    const domH1 = fromTikTokDomH1(html);
    if (domH1 && !BAD_TITLES.has(domH1)) {
      out.title = cleanTitle(domH1);
      out.canonicalUrl = canonical;
      return out;
    }
  }

  // 1) JSON-LD (prefer Recipe, then media/article/social/webpage)
  const ld = fromJsonLdTitle(html);
  if (ld && !BAD_TITLES.has(ld)) {
    out.title = cleanTitle(ld);
    out.canonicalUrl = canonical;
    return out;
  }

  // Instagram: try shared-data / meta caption extraction
  if (isInstagram(url)) {
    const ig = fromInstagramSharedData(html);
    if (ig && !BAD_TITLES.has(ig)) {
      out.title = cleanTitle(ig);
      out.canonicalUrl = canonical;
      return out;
    }
  }

  // 2) OG / Twitter meta
  const ogt = pickMeta(html, "og:title") || pickMeta(html, "twitter:title");
  if (ogt && !BAD_TITLES.has(ogt)) {
    out.title = cleanTitle(ogt);
    out.canonicalUrl = canonical;
    return out;
  }

  // 3) TikTok SIGI_STATE (caption as title)
  if (isTikTok(url)) {
    const sigi = fromTikTokSigi(html);
    if (sigi && !BAD_TITLES.has(sigi)) {
      out.title = cleanTitle(sigi);
      out.canonicalUrl = canonical;
      return out;
    }
  }

  // 4) Generic <h1>
  const h1 = pickGenericH1(html);
  if (h1 && !BAD_TITLES.has(h1)) {
    out.title = cleanTitle(h1);
    out.canonicalUrl = canonical;
    return out;
  }

  // 5) Last resort: <title>
  const t = pickTitleTag(html);
  if (t && !BAD_TITLES.has(t)) {
    out.title = cleanTitle(t);
    out.canonicalUrl = canonical;
    return out;
  }

  // If this is a TikTok URL and we couldn't find a useful title from static HTML,
  // it's likely the page is client-side rendered — signal the caller to run the
  // WebView-based DOM scraper.
  if (isTikTok(url)) {
    const tTag = pickTitleTag(html);
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
    const bodyLen = body.length;
    if ((BAD_TITLES.has(tTag) || /^TikTok/i.test(tTag) || !tTag) && bodyLen < 5000) {
      return { title: undefined, canonicalUrl: canonical, needsClientRender: true };
    }
  }

  return { title: undefined, canonicalUrl: canonical };
}
