// lib/ensureDurableThumb.ts
// MessHall — Durable thumbnail helper for Supabase Storage (Expo/React Native safe)
// - Accepts http(s)://, file://, content://, data: URIs, and bare tmp paths
// - On Android, copies content:// to a real file:// in cache
// - Normalizes bare tmp paths by prefixing file://
// - Downloads remote URLs if needed, enforces a minimum byte size
// - Uploads to Supabase Storage (bucket: recipe-thumbs)
// - Returns a **signed URL** (TTL configurable) so it works with private buckets
// - Cleans older uploads with the same hash prefix
//
// Usage:
//   const { publicUrl, bucketPath } = await ensureDurableThumb(srcUri);
//   // publicUrl is a signed URL suitable for <Image source={{ uri: publicUrl }} />

import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

const BUCKET = 'recipe-thumbs';
const FOLDER = 'u'; // keep everything under a folder
const MIN_BYTES = 12_000; // sanity guard for black/empty files
const SIGN_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

function guessExt(uri: string): string {
  const clean = uri.split('?')[0].split('#')[0];
  const m = clean.match(/\.(jpe?g|png|webp|gif|heic|heif)$/i);
  const ext = (m?.[1]?.toLowerCase() || 'jpg').replace('jpeg', 'jpg');
  return ext;
}

function pickContentType(uri: string): string {
  const ext = guessExt(uri);
  return CONTENT_TYPES[ext] || 'image/jpeg';
}

function hasScheme(u: string) {
  return /^[a-z]+:\/\//i.test(u);
}

async function dataUriToFile(dataUri: string): Promise<string> {
  const m = dataUri.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('Invalid data URI');
  const ext = (m[1].split('/')[1] || 'jpg').replace('jpeg', 'jpg').toLowerCase();
  const dest = `${FileSystem.cacheDirectory}thumb_${Date.now()}.${ext}`;
  await FileSystem.writeAsStringAsync(dest, m[2], {
    encoding: FileSystem.EncodingType.Base64,
  });
  return dest;
}

/**
 * Normalize any src into a local file:// URI we can read.
 * Handles:
 * - file:// (returns as-is)
 * - data:    (writes to cache)
 * - http(s): (downloads to cache)
 * - content:// (Android only; copies to cache)
 * - bare path like /data/... (prefixes file://)
 */
async function toLocalFile(src: string): Promise<string> {
  if (!src) throw new Error('no-src');
  let u = src.trim();

  // Bare tmp path (from view-shot) → prefix to file://
  if (!hasScheme(u) && u.startsWith('/')) u = `file://${u}`;

  if (/^file:\/\//i.test(u)) return u;
  if (/^data:/i.test(u)) return dataUriToFile(u);

  if (Platform.OS === 'android' && /^content:\/\//i.test(u)) {
    const ext = guessExt(u) || 'jpg';
    const dest = `${FileSystem.cacheDirectory}thumb_${Date.now()}.${ext}`;
    await FileSystem.copyAsync({ from: u, to: dest });
    return dest;
  }

  if (/^https?:\/\//i.test(u)) {
    const ext = guessExt(u);
    const dest = `${FileSystem.cacheDirectory}thumb_${Date.now()}.${ext}`;
    const { uri } = await FileSystem.downloadAsync(u, dest);
    return uri;
  }

  if (!hasScheme(u)) return `file://${u}`;
  throw new Error('Unsupported URI scheme');
}

async function getSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return (info as any)?.size ? Number((info as any).size) : 0;
}

function safeSlug(input: string): string {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function sha1(input: string): Promise<string> {
  try {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, input);
  } catch {
    return safeSlug(input).slice(0, 16) + '-' + Date.now().toString(36);
  }
}

/**
 * Delete older objects whose names start with the given prefix.
 */
async function deleteOlderWithPrefix(prefix: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(FOLDER, {
      limit: 1000,
      search: prefix,
      sortBy: { column: 'created_at', order: 'desc' },
    });

  if (error || !data?.length) return;

  // Keep most recent (index 0), delete the rest
  const toDelete = data.slice(1).map((o) => `${FOLDER}/${o.name}`);
  if (toDelete.length) await supabase.storage.from(BUCKET).remove(toDelete);
}

/**
 * Convert local file:// to a Blob. If fetch(file://) fails or returns empty, fall back to base64.
 */
async function fileUriToBlob(localFileUri: string, fallbackContentType = 'image/jpeg'): Promise<Blob> {
  try {
    const res = await fetch(localFileUri);
    const blob = await res.blob();
    // @ts-ignore size is available at runtime
    if (blob && (typeof blob.size !== 'number' || blob.size > 0)) return blob;
    throw new Error('empty-blob');
  } catch {
    const base64 = await FileSystem.readAsStringAsync(localFileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const byteChars = globalThis.atob
      ? globalThis.atob(base64)
      : Buffer.from(base64, 'base64').toString('binary');
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: fallbackContentType });
  }
}

export async function ensureDurableThumb(
  src: string
): Promise<{
  publicUrl: string;        // ⟵ will be a SIGNED URL for private buckets
  bucketPath: string;
  uri?: string;             // local file uri (for debugging)
  signed?: boolean;         // true when publicUrl is signed
}> {
  if (!src) throw new Error('No image src');

  // Normalize to local file
  const local = await toLocalFile(src);

  // Enforce minimum size
  const bytes = await getSize(local);
  if (bytes < MIN_BYTES) {
    throw new Error(`Image too small (${bytes} bytes)`);
  }

  // Stable-ish prefix based on original src
  const prefix = await sha1(src);
  const ext = guessExt(src) || 'jpg';
  const filename = `${prefix}_${Date.now()}.${ext}`;
  const path = `${FOLDER}/${filename}`;

  // Prepare Blob
  const contentType = pickContentType(src);
  const blob =
    /^https?:\/\//i.test(src)
      ? await (await fetch(src)).blob()
      : await fileUriToBlob(local, contentType);

  // Upload
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType, upsert: true });

  if (upErr) {
    throw new Error(`upload-failed: ${upErr.message || String(upErr)}`);
  }

  // Best-effort cleanup of older siblings
  deleteOlderWithPrefix(prefix).catch(() => {});

  // Prefer a **signed** URL (works with private buckets)
  let signedUrl = '';
  try {
    const { data: signedData, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGN_TTL_SECONDS);

    if (signErr) throw signErr;
    signedUrl = signedData?.signedUrl || '';
  } catch {
    // Fallback for public buckets: getPublicUrl
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    signedUrl = pub?.publicUrl || '';
  }

  if (!signedUrl) {
    throw new Error('No accessible URL returned from Supabase');
  }

  return {
    publicUrl: signedUrl, // keep field name for backwards compatibility
    bucketPath: path,
    uri: local,
    signed: true,
  };
}

export default ensureDurableThumb;
