// lib/extractTitle.ts
// Like I'm 5: this file finds a nice title for a page.
// We look in many places (H1, JSON-LD, OG meta, TikTok JSON) and pick the best.

export type ExtractedMeta = {
  title?: string;
  canonicalUrl?: string;
};

/* --------------------------- tiny string helpers --------------------------- */

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "");
const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const textify = (html: string) =>
  decodeEntities(stripTags(String(html))).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

const BAD_TITLES = new Set([
  "TikTok – Make Your Day",
  "TikTok - Make Your Day",
  "TikTok",
  "YouTube",
  "Instagram",
  "Login • Instagram",
]);

const isTikTok = (url: string) => /tiktok\.com\/@/i.test(url);

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

/* --------------------------- TikTok special DOM H1 ------------------------- */
// Your screenshot showed: <h1 class="... H1PhotoTitle ...">Texas Roadhouse ...</h1>
// TikTok also uses "H1VideoTitle". We read those directly.

function fromTikTokDomH1(html: string): string {
  // any <h1> whose class contains H1PhotoTitle / H1VideoTitle / PhotoTitle
  const m =
    html.match(/<h1[^>]+class=["'][^"']*\bH1PhotoTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1[^>]+class=["'][^"']*\bH1VideoTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1[^>]+class=["'][^"']*\bPhotoTitle\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  return m?.[1] ? textify(m[1]) : "";
}

/* ------------------------------ TikTok SIGI ------------------------------- */
// Fallback caption/title from the state JSON (works for both photos & videos)

function fromTikTokSigi(html: string): string {
  const m = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
  const json = safeJSON<any>(m?.[1]);
  if (!json) return "";

  const im = json?.ItemModule;
  if (im && typeof im === "object") {
    const first: any = Object.values(im)[0];
    const desc = (first?.desc || first?.shareInfo?.shareTitle || first?.title || "")
      .toString()
      .trim();
    if (desc) return desc;
  }

  const seo = json?.SEOState || json?.ShareMeta || json?.app || {};
  const maybe = (
    seo?.metaParams?.title ||
    seo?.shareMeta?.title ||
    seo?.ogMeta?.title ||
    ""
  )
    .toString()
    .trim();
  return maybe || "";
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

  return { title: undefined, canonicalUrl: canonical };
}
