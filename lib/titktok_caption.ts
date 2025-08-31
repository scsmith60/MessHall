// lib/tiktok_caption.ts
// LIKE I'M 5: we fetch the TikTok page, peek inside its hidden JSON (SIGI_STATE),
// and also look at the visible HTML. We return the best caption we can find.

const ONLY_TEXT = (s?: string) => (s || '').replace(/\s+/g, ' ').trim();

// soft JSON parser
function safeJSON<T = any>(str?: string | null): T | undefined {
  if (!str) return;
  try { return JSON.parse(str); } catch { return; }
}

function stripTags(s: string) { return s.replace(/<[^>]*>/g, ''); }
function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}

// “caption → compact titleish text” (re-used from your screens, simplified)
export function cleanCaption(raw?: string) {
  if (!raw) return '';
  let s = raw.replace(/\r|\t/g,' ').replace(/ +/g,' ').trim();
  s = s.replace(/https?:\/\/\S+/gi,'')
       .replace(/[#@][\w_]+/g,'')
       .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,'') // emojis
       .replace(/\s{2,}/g,' ')
       .trim();
  // drop long “Ingredients/Steps/…” tails for title-ness but keep enough for ingredient scan
  return s;
}

/** Pull caption from SIGI_STATE JSON block. */
function fromSIGI(html: string): string {
  const m = html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i);
  const json = safeJSON<any>(m?.[1]);
  if (!json) return '';
  const itemModule = json?.ItemModule;
  if (itemModule && typeof itemModule === 'object') {
    const first: any = Object.values(itemModule)[0];
    const desc = ONLY_TEXT(first?.desc);
    return desc || '';
  }
  return '';
}

/** Pull a visible caption from common TikTok data-e2e nodes. */
function fromVisible(html: string): string {
  const keys = ['new-desc-span','browse-video-desc','video-desc','search-video-desc','search-video-title'];
  for (const k of keys) {
    const re = new RegExp(`<([a-z0-9]+)([^>]*?data-e2e=["']${k}["'][^>]*)>([\\s\\S]*?)<\\/\\1>`,'i');
    const m = html.match(re);
    if (m?.[3]) {
      return ONLY_TEXT(decodeEntities(stripTags(m[3])));
    }
  }
  return '';
}

/** Main: fetch a TikTok URL and return the best caption we can. */
export async function fetchTikTokCaption(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  const html = await res.text();

  // try visible first (often less noisy), then SIGI
  const visible = fromVisible(html);
  if (visible) return cleanCaption(visible);

  const sigi = fromSIGI(html);
  if (sigi) return cleanCaption(sigi);

  return '';
}
