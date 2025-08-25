// lib/extractTitle.ts
export type ExtractedMeta = {
  title?: string;
  canonicalUrl?: string;
};

const BAD_TITLES = new Set([
  'TikTok – Make Your Day',
  'TikTok - Make Your Day',
  'TikTok',
  'YouTube',
  'Instagram',
  'Login • Instagram',
]);

function text(el?: Element | null) {
  return (el?.getAttribute('content') || el?.textContent || '').trim();
}

function safeJSON<T = any>(str?: string | null): T | undefined {
  if (!str) return;
  try { return JSON.parse(str); } catch { return; }
}

// Basic DOM loader for RN/JS (no browser): use a tiny HTML parser.
// If you already have one, swap this out.
function domFromHTML(html: string) {
  // Very light DOM via JSDOM-like interface isn’t available in RN; instead,
  // use regex selects for the few tags we need.
  // For reliability, we’ll do simple selectors by hand below.
  return { html };
}

function pickMeta(html: string, name: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=[\\"']${name}[\\"'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return '';
  const tag = m[0];
  const cm = tag.match(/content=["']([^"']+)["']/i);
  return cm?.[1]?.trim() || '';
}

function pickLink(html: string, rel: string) {
  const re = new RegExp(`<link[^>]+rel=[\\"']${rel}[\\"'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return '';
  const tag = m[0];
  const hm = tag.match(/href=["']([^"']+)["']/i);
  return hm?.[1]?.trim() || '';
}

function pickTitleTag(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1]?.replace(/\s+/g, ' ').trim() || '';
}

// --- Platform helpers ---

function extractFromJSONLD(html: string) {
  // Prefer Recipe or VideoObject name
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    const json = safeJSON<any>(s[1]);
    if (!json) continue;

    const arr = Array.isArray(json) ? json : [json];
    for (const node of arr) {
      const ctxType = (node['@type'] || node.type || '').toString();
      if (/Recipe/i.test(ctxType) || /VideoObject/i.test(ctxType) || node.name) {
        const name = (node.name || '').toString().trim();
        if (name) return name;
      }
      // Some sites nest graph
      if (node['@graph']) {
        for (const g of node['@graph']) {
          const name = (g?.name || '').toString().trim();
          const t = (g?.['@type'] || '').toString();
          if (name && (/Recipe|VideoObject|Article/i.test(t) || t)) return name;
        }
      }
    }
  }
  return '';
}

function extractFromTikTok(html: string) {
  // TikTok hides real data in SIGI_STATE
  const m = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
  const json = safeJSON<any>(m?.[1]);
  if (!json) return '';
  // ItemModule:{<videoId>:{desc: "..."}}
  const itemModule = json?.ItemModule;
  if (itemModule && typeof itemModule === 'object') {
    const first = Object.values<any>(itemModule)[0];
    const desc = (first?.desc || '').toString().trim();
    if (desc) return desc;
  }
  return '';
}

function cleanTitle(t: string) {
  // strip site suffixes like " | Site" or " - Site"
  let out = t.replace(/\s*[|–-]\s*(TikTok|YouTube|Instagram|Food Network|Allrecipes|Pinterest).*/i, '');
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

export function extractTitle(html: string, url: string): ExtractedMeta {
  const result: ExtractedMeta = {};

  // Canonical
  const canonical = pickLink(html, 'canonical') || pickMeta(html, 'og:url');
  if (canonical) result.canonicalUrl = canonical;

  // High-confidence: JSON-LD
  let title =
    extractFromJSONLD(html) ||
    pickMeta(html, 'og:title') ||
    pickMeta(html, 'twitter:title') ||
    pickTitleTag(html);

  // TikTok specific fallback
  if (!title || BAD_TITLES.has(title)) {
    const tk = extractFromTikTok(html);
    if (tk) title = tk;
  }

  // As last resort, use page title cleaned
  title = cleanTitle(title || pickTitleTag(html));

  if (!title || BAD_TITLES.has(title)) {
    // nothing decent; leave undefined so caller can fallback to filename/slug
    return result;
  }

  result.title = title;
  return result;
}
