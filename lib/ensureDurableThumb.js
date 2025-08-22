// lib/ensureDurableThumb.js
// Creates a durable, 16:9 thumbnail for a recipe, uploads to Supabase Storage,
// and auto-cleans older thumbs for the same recipe.
//
// Implements Step 4 (smarter cropping) and Step 5 (auto-cleanup).
//
// Requirements:
// - expo-file-system
// - expo-image-manipulator
// - expo-crypto
// - Supabase client (supabase-js v2) configured in ./supabaseClient
//
// Notes:
// - Put this in your shared lib. Call from Add flow and elsewhere to keep thumbs consistent.
// - Bucket can be public or private. If private, we return a signed URL.

import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabaseClient';

const BUCKET = 'recipe-thumbs';
const MIN_BYTES = 12_000; // ignore tiny/empty images
const DEFAULT_TARGET_W = 1200;
const DEFAULT_SIGNED_SECONDS = 60 * 60 * 24 * 365; // 1 year

const CONTENT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

function pickContentType(uriOrName) {
  const ext = (uriOrName.match(/\.(jpe?g|png|webp|gif)(?:\?|#|$)/i)?.[1] || 'jpg').toLowerCase();
  return CONTENT_TYPES[ext] || 'image/jpeg';
}

async function toLocalUri(src) {
  if (!src) return null;
  if (/^file:|^data:/i.test(src)) return src;

  // Remote: download to cache
  try {
    const name = src.split(/[?#]/)[0].split('/').pop() || `dl-${Date.now()}.bin`;
    const target = `${FileSystem.cacheDirectory}messhall/${name}`;
    await FileSystem.makeDirectoryAsync(`${FileSystem.cacheDirectory}messhall/`, { intermediates: true });
    const { uri, status } = await FileSystem.downloadAsync(src, target);
    if (status >= 200 && status < 300) return uri;
  } catch {}
  return null;
}

function computeOriginY(mode, scaledHeight, cropH) {
  if (mode === 'center') return Math.max(0, Math.round((scaledHeight - cropH) / 2));
  if (mode === 'third')  return Math.max(0, Math.round((scaledHeight - cropH) / 3));
  // default/top
  return 0;
}

function extFromContentType(ct) {
  if (!ct) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * Generate a deterministic-ish storage path.
 * We prefer a folder per recipe for easy listing/cleanup:
 *   recipeId/thumb_<hash>[_keyHint].jpg
 */
async function buildStoragePath({ recipeId, keyHint, srcSignature, contentType }) {
  const base = srcSignature || `${Date.now()}`;
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, base);
  const ext = extFromContentType(contentType);
  const safeHint = keyHint ? `_${String(keyHint).replace(/[^a-z0-9_-]+/gi, '').slice(0, 32)}` : '';
  const folder = recipeId ? `${recipeId}` : `_misc`;
  return `${folder}/thumb_${hash}${safeHint}.${ext}`;
}

/**
 * Upload a Blob or File to Supabase Storage.
 * In Expo RN, we typically create a Blob via fetch(file://...).
 */
async function uploadBlobToStorage(path, blob, contentType) {
  const { data, error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType,
    upsert: false, // keep versions unique per hash
  });
  if (error) throw error;
  return data;
}

/**
 * Create a long-lived URL (signed for private buckets; publicUrl otherwise).
 */
async function getUrlForPath(path, signedSeconds = DEFAULT_SIGNED_SECONDS) {
  // Try signed URL first (works even if bucket is public)
  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(path, signedSeconds);

  if (!error && data?.signedUrl) {
    return data.signedUrl;
  }

  // Fallback to public URL (if the bucket is public)
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return pub?.publicUrl || null;
}

/**
 * Remove older thumbs for the same recipe folder, keeping only `keepPath`.
 */
async function cleanupOldThumbs(recipeId, keepPath) {
  if (!recipeId) return;
  const folder = `${recipeId}`;
  const { data: list, error } = await supabase.storage.from(BUCKET).list(folder, {
    limit: 100,
    sortBy: { column: 'created_at', order: 'desc' },
  });
  if (error || !Array.isArray(list)) return;

  const toDelete = list
    .filter((obj) => {
      const full = `${folder}/${obj.name}`;
      return full !== keepPath && /^thumb_/i.test(obj.name);
    })
    .map((obj) => `${folder}/${obj.name}`);

  if (toDelete.length) {
    // best-effort; ignore errors
    await supabase.storage.from(BUCKET).remove(toDelete);
  }
}

/**
 * Ensure a durable 16:9 thumbnail exists for this source image.
 * Returns { path, url, width, height, bytes }
 */
export async function ensureDurableThumb(src, opts = {}) {
  const {
    recipeId,           // string (recommended) for auto-cleanup
    keyHint,            // optional logical key (e.g., "main")
    cropMode = 'third', // 'top' | 'third' | 'center'
    targetWidth = DEFAULT_TARGET_W,
    signedUrlSeconds = DEFAULT_SIGNED_SECONDS,
  } = opts;

  // 1) Resolve to a local file
  const localUri = await toLocalUri(src);
  if (!localUri) {
    return { path: null, url: null, width: 0, height: 0, bytes: 0 };
  }

  // 2) Quick sanity on file size
  const info = await FileSystem.getInfoAsync(localUri, { size: true });
  if (!info.exists || !info.size || info.size < MIN_BYTES) {
    return { path: null, url: null, width: 0, height: 0, bytes: info.size || 0 };
  }

  // 3) Build a signature for path hashing
  const sigParts = [String(src), String(info.size || ''), String(info.modificationTime || '')].join('|');

  // 4) Scale to target width
  const scaled = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: targetWidth } }],
    { compress: 1 }
  );

  // 5) 16:9 crop with smarter originY (Step 4)
  const cropH = Math.round((targetWidth * 9) / 16);
  const originY = computeOriginY(cropMode, scaled.height, cropH);

  const cropped = await ImageManipulator.manipulateAsync(
    scaled.uri,
    [{ crop: { originX: 0, originY, width: targetWidth, height: cropH } }],
    { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
  );

  // Guard: if something went wrong and image too small, bail
  const finalInfo = await FileSystem.getInfoAsync(cropped.uri, { size: true });
  if (!finalInfo.exists || !finalInfo.size || finalInfo.size < MIN_BYTES) {
    return { path: null, url: null, width: targetWidth, height: cropH, bytes: finalInfo.size || 0 };
  }

  // 6) Prepare upload
  const contentType = pickContentType(cropped.uri);
  const storagePath = await buildStoragePath({
    recipeId,
    keyHint,
    srcSignature: sigParts,
    contentType,
  });

  // Convert local file to Blob for supabase-js
  const blob = await (await fetch(cropped.uri)).blob();

  // 7) Upload to Supabase
  await uploadBlobToStorage(storagePath, blob, contentType);

  // 8) Get URL (signed or public)
  const url = await getUrlForPath(storagePath, signedUrlSeconds);

  // 9) Auto-cleanup old thumbs in this recipe folder (Step 5)
  if (recipeId) {
    cleanupOldThumbs(recipeId, storagePath).catch(() => {});
  }

  return {
    path: storagePath,
    url,
    width: targetWidth,
    height: cropH,
    bytes: finalInfo.size || 0,
  };
}

export default ensureDurableThumb;
