// lib/uploads.ts
// Safe uploader for Expo + Supabase Storage
// - Accepts either a string URI or an asset-like object { uri, mimeType, fileName }
// - Handles Android content:// by copying to a cache file first
// - Guesses extension from mimeType, fileName, or URI (in that order)
// - Returns a PUBLIC URL you can use in <Image source={{ uri }} />

import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';

type MaybeAsset = string | { uri?: string | null; mimeType?: string | null; fileName?: string | null };

const isNonEmptyString = (v: any): v is string => typeof v === 'string' && v.length > 0;

const getExtFromMime = (mime?: string | null) =>
  isNonEmptyString(mime) && mime.includes('/') ? mime.split('/')[1].toLowerCase() : '';

const getExtFromName = (name?: string | null) =>
  isNonEmptyString(name) && name.includes('.') ? (name.split('.').pop() || '').toLowerCase() : '';

const getExtFromUri = (uri?: string | null) =>
  isNonEmptyString(uri) ? (uri.split('?')[0].split('.').pop() || '').toLowerCase() : '';

/** Normalize input into a usable { uri, ext } pair */
const normalizeInput = (input: MaybeAsset): { uri: string; ext: string } => {
  const uri = typeof input === 'string' ? input : (input?.uri || '');
  if (!isNonEmptyString(uri)) throw new Error('No image URI provided');

  // Prefer mimeType > fileName > uri
  const ext =
    getExtFromMime(typeof input === 'string' ? null : input?.mimeType) ||
    getExtFromName(typeof input === 'string' ? null : input?.fileName) ||
    getExtFromUri(uri) ||
    'jpg';

  return { uri, ext };
};

/** Copy content:// to a cache file so fetch() can read it. file:// just passes through */
const uriToFetchableFileUri = async (uri: string, extFallback: string) => {
  if (uri.startsWith('file://')) return uri;
  // Copy to a temp file we can fetch
  const ext = getExtFromUri(uri) || extFallback || 'jpg';
  const dest = `${FileSystem.cacheDirectory}upload-${Date.now()}.${ext}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    // For http(s):// we can still try to fetch it directly
    return uri;
  }
};

const getBlobSafe = async (uri: string, extFallback: string) => {
  const fetchable = await uriToFetchableFileUri(uri, extFallback);
  const resp = await fetch(fetchable);
  if (!resp.ok) throw new Error(`Image read failed (${resp.status})`);
  return await resp.blob();
};

/** MAIN: upload and return a PUBLIC URL */
export const uploadRecipeImage = async (userId: string, input: MaybeAsset) => {
  if (!isNonEmptyString(userId)) throw new Error('Missing user id for upload');

  const { uri, ext } = normalizeInput(input);
  const blob = await getBlobSafe(uri, ext);
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error } = await supabase
    .storage
    .from('recipe-images')
    .upload(path, blob, {
      upsert: true,
      contentType: (blob as any)?.type || undefined,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from('recipe-images').getPublicUrl(path);
  return data.publicUrl;
};
