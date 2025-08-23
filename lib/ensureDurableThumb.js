// lib/ensureDurableThumb.ts
// MessHall — Durable thumbnail helper for Supabase Storage
// - Accepts http(s)://, file://, or data: URIs
// - Downloads if needed, enforces a minimum byte size (to avoid tiny "oops" images)
// - Uploads to Supabase Storage (bucket: recipe-thumbs)
// - Auto-cleans older uploads with the same hash prefix
//
// Usage:
//   const { publicUrl, bucketPath } = await ensureDurableThumb(srcUri);
//
// Notes:
// - Requires `expo-file-system` and your configured Supabase client.
// - Public URL assumes your storage bucket policy allows public read or
//   you use `getPublicUrl` via Supabase.

import * as FileSystem from 'expo-file-system';
import { supabase } from './supabaseClient';

const BUCKET = 'recipe-thumbs';
const MIN_BYTES = 12_000;

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

function guessExt(uri: string): string {
  const m = uri.match(/\.(jpe?g|png|webp|gif)(?:\?|#|$)/i);
  return (m?.[1]?.toLowerCase() || 'jpg').replace('jpeg', 'jpg');
}

function pickContentType(uri: string): string {
  const ext = guessExt(uri);
  return CONTENT_TYPES[ext] || 'image/jpeg';
}

function isLocal(uri: string) {
  return /^file:|^data:/i.test(uri);
}

async function dataUriToFile(dataUri: string): Promise<string> {
  // Writes a data: URI to a temp file
  const m = dataUri.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('Invalid data URI');
  const ext = (m[1].split('/')[1] || 'jpg').replace('jpeg', 'jpg').toLowerCase();
  const dest = `${FileSystem.cacheDirectory}thumb_${Date.now()}.${ext}`;
  await FileSystem.writeAsStringAsync(dest, m[2], { encoding: FileSystem.EncodingType.Base64 });
  return dest;
}

async function toLocalFile(src: string): Promise<string> {
  if (/^file:/i.test(src)) return src;
  if (/^data:/i.test(src)) return dataUriToFile(src);

  // http(s) → download to cache
  const ext = guessExt(src);
  const dest = `${FileSystem.cacheDirectory}thumb_${Date.now()}.${ext}`;
  const { uri } = await FileSystem.downloadAsync(src, dest);
  return uri;
}

async function getSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return (info.size as number) || 0;
}

function safeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^\-+|\-+$/g, '')
    .slice(0, 80);
}

async function sha1(input: string): Promise<string> {
  // Lightweight SHA-1 via subtle crypto (Hermes has it)
  // @ts-ignore
  const crypto = globalThis.crypto || (global as any).crypto;
  if (!crypto?.subtle) {
    // Fallback: hash-like slug
    return safeSlug(input).slice(0, 16) + '-' + Date.now().toString(36);
  }
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-1', enc.encode(input));
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deleteOlderWithPrefix(prefix: string) {
  const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000, search: prefix });
  if (error || !data?.length) return;
  // Keep most recent by timestamp suffix; delete others
  const groups = data
    .filter((o) => o.name.startsWith(prefix))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  // Keep first, delete the rest
  const toDelete = groups.slice(1).map((o) => o.name);
  if (toDelete.length) {
    await supabase.storage.from(BUCKET).remove(toDelete);
  }
}

export async function ensureDurableThumb(src: string): Promise<{ publicUrl: string; bucketPath: string }> {
  if (!src) throw new Error('No image src');
  const local = await toLocalFile(src);
  const bytes = await getSize(local);
  if (bytes < MIN_BYTES) {
    throw new Error(`Image too small (${bytes} bytes)`);
  }

  // Build a stable-ish prefix so repeated enriches for the same remote URL
  // will clean up older versions automatically.
  const prefix = await sha1(src);
  const ext = guessExt(src);
  const filename = `${prefix}_${Date.now()}.${ext}`;
  const path = `u/${filename}`;

  // Upload
  const fileBase64 = await FileSystem.readAsStringAsync(local, { encoding: FileSystem.EncodingType.Base64 });
  const contentType = pickContentType(src);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, Buffer.from(fileBase64, 'base64'), {
      contentType,
      upsert: true,
    } as any); // RN typing workaround

  if (upErr) throw upErr;

  // Cleanup older siblings (best-effort)
  deleteOlderWithPrefix(prefix).catch(() => {});

  // Public URL
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl || '';

  if (!publicUrl) {
    // As a fallback, construct from your Supabase URL (requires anon policy or signed URLs)
    // @ts-ignore
    const base = supabase?.storageUrl || '';
    if (!base) throw new Error('No public URL available');
    return { publicUrl: `${base}/${BUCKET}/${path}`, bucketPath: path };
  }

  return { publicUrl, bucketPath: path };
}

export default ensureDurableThumb;
