// lib/thumb.ts
// Resolve a DB thumb_path (bucket path or full URL) into a loadable URL.
// - If already http(s), return as-is.
// - If storage path, createSignedUrl from recipe-thumbs (14d TTL).
// Includes a tiny in-memory cache so lists don't hammer storage.

import { supabase } from './supabaseClient';

const DURABLE_BUCKET = 'recipe-thumbs';
const PREVIEW_TTL = 60 * 60 * 24 * 14; // 14 days

const mem: Record<string, { url: string; exp: number }> = {};

function isHttp(s?: string) {
  return !!s && /^https?:\/\//i.test(s);
}

export async function resolveThumbUrl(pathOrUrl?: string | null): Promise<string> {
  if (!pathOrUrl) return '';
  if (isHttp(pathOrUrl)) return pathOrUrl;

  // Cache hit?
  const cached = mem[pathOrUrl];
  const now = Date.now() / 1000;
  if (cached && cached.exp > now + 30) return cached.url;

  // Remove any accidental bucket prefix
  const clean = String(pathOrUrl).replace(new RegExp(`^${DURABLE_BUCKET}/?`, 'i'), '');

  // Prefer signed (works with private buckets)
  const signed = await supabase.storage.from(DURABLE_BUCKET).createSignedUrl(clean, PREVIEW_TTL);
  let url = '';
  if (!signed.error) {
    url = signed.data?.signedUrl || '';
  } else {
    // Fallback for public buckets
    const { data } = supabase.storage.from(DURABLE_BUCKET).getPublicUrl(clean);
    url = data?.publicUrl || '';
  }

  if (url) {
    // naive expiry = now + TTL
    mem[pathOrUrl] = { url, exp: now + PREVIEW_TTL };
  }
  return url;
}
