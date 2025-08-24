// lib/tiktokThumb.ts
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36';

export const isTikTokUrl = (u: string) =>
  /(^(https?:\/\/)?(www\.)?tiktok\.com\/)|(^https?:\/\/(vt|vm)\.tiktok\.com\/)/i.test(u);

async function resolveFinalUrl(u: string): Promise<string> {
  // Some shares are vt/vm shortlinks; follow redirects to canonical URL.
  try {
    const r = await fetch(u, { method: 'GET', redirect: 'follow' as any });
    return r.url || u;
  } catch {
    return u;
  }
}

async function fetchText(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow' as any,
    });
    if (!res.ok) return undefined;
    return await res.text();
  } catch {
    return undefined;
  }
}

function extractOgImage(html?: string): string | undefined {
  if (!html) return undefined;
  const m1 = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (m1?.[1]) return m1[1];
  const m2 = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  return m2?.[1];
}

/** Robust: oEmbed → noembed → og:image parse */
export async function fetchTikTokThumbRobust(videoUrl: string): Promise<string | undefined> {
  const canonical = await resolveFinalUrl(videoUrl);

  // 1) TikTok oEmbed
  try {
    const o = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(canonical)}`);
    if (o.ok) {
      const j = await o.json();
      if (j?.thumbnail_url) return j.thumbnail_url as string;
    }
  } catch {}

  // 2) noembed fallback
  try {
    const n = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(canonical)}`);
    if (n.ok) {
      const j = await n.json();
      if (j?.thumbnail_url) return j.thumbnail_url as string;
    }
  } catch {}

  // 3) Parse page for og:image
  const html = await fetchText(canonical);
  return extractOgImage(html);
}
