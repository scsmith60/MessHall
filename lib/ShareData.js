// lib/shareData.js
// Helpers for parsing OS share-intent payloads into { url, text, images }

const URL_CANDIDATE = /^(https?:\/\/|www\.)/i;

export function extractUrl(candidate) {
  if (!candidate || typeof candidate !== 'string') return '';
  try {
    // Accept things like "www.example.com/..." by prefixing https
    const raw = candidate.trim();
    const normalized = URL_CANDIDATE.test(raw) && !/^https?:\/\//i.test(raw)
      ? `https://${raw}`
      : raw;
    const u = new URL(normalized);
    return u.href;
  } catch {
    return '';
  }
}

// Some apps put the link in extras or arrays; unify that here.
export function parseSharePayload(payload = {}) {
  // react-native-share-menu gives: { mimeType, data, extras }
  const { mimeType, data, extras } = payload;

  // 1) Images (array of content URIs)
  if (mimeType && mimeType.startsWith('image/')) {
    if (Array.isArray(data)) return { url: '', text: '', images: data };
    if (typeof data === 'string') return { url: '', text: '', images: [data] };
  }

  // 2) Text or ambiguous: try to pull a URL from common spots
  const candidates = []
    .concat(data ?? [])
    .concat(extras?.['android.intent.extra.TEXT'] ?? [])
    .concat(extras?.['android.intent.extra.STREAM'] ?? []);
  const flat = candidates.flat().filter(Boolean);

  // First valid URL wins
  for (const c of flat) {
    const hit = extractUrl(String(c));
    if (hit) return { url: hit, text: '', images: [] };
  }

  // If no URL, fold to plain text (if any)
  if (typeof data === 'string') return { url: '', text: data, images: [] };

  return { url: '', text: '', images: [] };
}
