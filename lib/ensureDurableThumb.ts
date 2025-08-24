// lib/ensureDurableThumb.ts
// MessHall — Durable thumbnail helper for Supabase Storage (Expo/React Native safe)
// - Accepts http(s)://, file://, content://, data: URIs, and bare tmp paths
// - On Android, copies content:// to a real file:// in cache
// - Normalizes bare tmp paths by prefixing file://
// - Downloads remote URLs if needed, enforces a minimum byte size
// - Uploads to Supabase Storage (bucket: recipe-thumbs) using Uint8Array (not Blob)
// - Cleans older uploads with the same hash prefix
//
// Usage:
//   const { publicUrl, bucketPath } = await ensureDurableThumb(srcUri);

import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { supabase } from './supabaseClient';

const BUCKET = 'recipe-thumbs';
const FOLDER = 'u';            // keep everything under a folder
const MIN_BYTES = 12_000;

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
  // Writes a data: URI to a temp file
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
  if (!hasScheme(u) && u.startsWith('/')) {
    u = `file://${u}`;
  }

  // file://
  if (/^file:\/\//i.test(u)) return u;

  // data:
  if (/^data:/i.test(u)) return dataUriToFile(u);

  // content:// (Android gallery, docs, etc.)
  if (Platform.OS === 'android' && /^content:\/\//i.test(u)) {
    const ext = guessExt(u) || 'jpg';
    const dest = `${FileSystem.cacheDirectory}thumb_${Date.now()}.${ext}`;
    // FileSystem.copyAsync supports content:// -> file:// on Android
    await FileSystem.copyAsync({ from: u, to: dest });
    return dest;
  }

  // http(s) → download to cache
  if (/^https?:\/\//i.test(u)) {
    const ext = guessExt(u);
    const dest = `${FileSystem.cacheDirectory}thumb_${Date.now()}.${ext}`;
    const { uri } = await FileSystem.downloadAsync(u, dest);
    return uri;
  }

  // Fallback: try to treat as a local path (prefix file:// if missing)
  if (!hasScheme(u)) return `file://${u}`;
  throw new Error('Unsupported URI scheme');
}

async function getSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  // In Expo SDKs, size can be undefined; coerce safely
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
  // Expo-safe hashing
  try {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, input);
  } catch {
    // Fallback: hash-like slug
    return safeSlug(input).slice(0, 16) + '-' + Date.now().toString(36);
  }
}

/**
 * Delete older objects whose names start with the given prefix.
 * We list only under FOLDER and use `search` to keep it efficient.
 */
async function deleteOlderWithPrefix(prefix: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(FOLDER, { limit: 1000, search: prefix, sortBy: { column: 'created_at', order: 'desc' } });

  if (error || !data?.length) return;

  // Keep most recent (already desc) and delete the rest
  const toDelete = data.slice(1).map((o) => `${FOLDER}/${o.name}`);
  if (toDelete.length) {
    await supabase.storage.from(BUCKET).remove(toDelete);
  }
}

/** Convert base64 string to Uint8Array (RN/JS-safe) */
function base64ToUint8Array(base64: string) {
  const binary =
    (globalThis.atob && globalThis.atob(base64)) ||
    Buffer.from(base64, 'base64').toString('binary');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function ensureDurableThumb(
  src: string
): Promise<{ publicUrl: string; bucketPath: string; uri?: string }> {
  if (!src) throw new Error('No image src');

  // Normalize to local file (handles http/https/content/data/bare tmp/etc.)
  const local = await toLocalFile(src);

  // Enforce minimum size (after we have a local file)
  const bytes = await getSize(local);
  if (bytes < MIN_BYTES) {
    throw new Error(`Image too small (${bytes} bytes)`);
  }

  // Stable-ish prefix based on original src
  const prefix = await sha1(src);
  const ext = guessExt(src) || 'jpg';
  const filename = `${prefix}_${Date.now()}.${ext}`;
  const path = `${FOLDER}/${filename}`;

  // Prepare Uint8Array from local file to avoid RN Blob/XHR issues
  const contentType = pickContentType(src);
  const base64 = await FileSystem.readAsStringAsync(local, { encoding: FileSystem.EncodingType.Base64 });
  const uint8 = base64ToUint8Array(base64);

  // Upload (Uint8Array is supported by supabase-js in React Native)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, uint8, {
      contentType,
      upsert: true,
      cacheControl: '31536000',
    });

  if (upErr) {
    throw new Error(`upload-failed: ${upErr.message || String(upErr)}`);
  }

  // Best-effort cleanup of older siblings
  deleteOlderWithPrefix(prefix).catch(() => {});

  // Public URL
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl || '';

  if (!publicUrl) {
    // As a fallback, construct from your Supabase URL (requires anon policy or signed URLs)
    // @ts-ignore
    const base = (supabase as any)?.storageUrl || '';
    if (!base) throw new Error('No public URL available');
    return { publicUrl: `${base}/${BUCKET}/${path}`, bucketPath: path, uri: local };
  }

  return { publicUrl, bucketPath: path, uri: local };
}

export default ensureDurableThumb;
