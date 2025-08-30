// lib/uploads.ts
// ELI5: we take your picture and push it straight into your Supabase bucket.
// This version is Android-proof by using Expo FileSystem.uploadAsync.
// - Works for local photos (content://, file://)
// - Works for remote images (http/https) by first downloading to a temp file
// - Returns a PUBLIC URL you can save on your recipe row
// NEW: helpers to delete old images, clean folders, and replace a recipe image safely.

import { supabase } from "./supabase";
import * as FileSystem from "expo-file-system";

// 1) we need your Supabase URL to hit the Storage REST endpoint
//    In Expo, this is typically set in app config as EXPO_PUBLIC_SUPABASE_URL
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
if (!SUPABASE_URL) {
  console.warn(
    "[uploads] Missing EXPO_PUBLIC_SUPABASE_URL. Set it in your Expo env or hardcode your project url here."
  );
}

// tiny random id helper
function uid() {
  return Math.random().toString(36).slice(2);
}

// pick a file extension from a URI (default jpg)
function pickExt(uri: string) {
  const clean = uri.split("?")[0];
  const maybe = clean.split(".").pop() || "";
  return (maybe.length <= 4 ? maybe : "") || "jpg";
}

// make a REST URL for: POST /storage/v1/object/<bucket>/<path>
function storageObjectUrl(bucket: string, path: string) {
  // NOTE: we must not double-encode slashes in path, so join carefully
  return `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

// Try to turn a public URL back into a storage path for a given bucket.
// Example: https://xyz.supabase.co/storage/v1/object/public/recipe-images/user/abc.jpg
//  -> returns "user/abc.jpg"
function publicUrlToPath(publicUrl: string, bucket: string): string | null {
  try {
    const u = new URL(publicUrl);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(u.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

/**
 * Universal uploader that works for:
 * - file:// and content:// (local) → uploadAsync directly
 * - http(s):// (remote) → download to cache → uploadAsync
 *
 * Returns: PUBLIC URL string.
 */
export async function uploadFromUri(opts: {
  uri: string;
  storageBucket: string; // e.g., "recipe-images"
  path?: string;         // e.g., "<user>/<recipeId>/images/<time>.jpg"
  contentType?: string;  // e.g., "image/jpeg"
}): Promise<string> {
  const { uri, storageBucket } = opts;
  if (!uri) throw new Error("No image URI to upload");
  if (!storageBucket) throw new Error("Missing storage bucket name");
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL env (EXPO_PUBLIC_SUPABASE_URL)");

  // who’s logged in (we use their id in the path) + auth token for REST call
  const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessionRes?.session) throw new Error("Not signed in");
  const token = sessionRes.session.access_token;

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id || "anon";
  const ext = pickExt(uri);
  const path = opts.path || `${userId}/${Date.now()}-${uid()}.${ext}`;

  // decide the Content-Type
  let contentType = opts.contentType || (ext === "png" ? "image/png" : "image/jpeg");

  // 1) ensure we have a LOCAL FILE we can stream via uploadAsync
  let localFileUri = uri;
  if (uri.startsWith("http")) {
    // download remote image into cache first
    const dest = `${FileSystem.cacheDirectory}dl-${Date.now()}-${uid()}.${ext}`;
    const dl = await FileSystem.downloadAsync(uri, dest);
    if (dl.status !== 200) throw new Error(`Failed to download remote image (status ${dl.status})`);
    localFileUri = dl.uri;
    // try to guess better contentType from headers if present
    const hdrType = dl.headers && (dl.headers["Content-Type"] || dl.headers["content-type"]);
    if (typeof hdrType === "string" && hdrType.includes("/")) contentType = hdrType;
  }

  // 2) POST the bytes straight to the Storage REST endpoint
  //    Route: POST /storage/v1/object/<bucket>/<path>
  const url = storageObjectUrl(storageBucket, path);
  const res = await FileSystem.uploadAsync(url, localFileUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
  });

  if (res.status !== 200) {
    // Supabase returns JSON error; surface it to help debugging
    throw new Error(`Storage upload failed (${res.status}): ${res.body?.slice(0, 200)}`);
  }

  // 3) turn that path into a public URL
  const { data } = supabase.storage.from(storageBucket).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("No public URL returned from storage");
  return data.publicUrl;
}

/** Shortcut that always uses "recipe-images" for local photos */
export async function uploadRecipeImage(localUri: string): Promise<string> {
  return uploadFromUri({
    uri: localUri,
    storageBucket: "recipe-images",
    contentType: "image/jpeg",
  });
}

/** Keep your sponsor uploader (uses a different bucket) */
export async function uploadAdImage(userId: string, file: any): Promise<string> {
  const uri = typeof file === "string" ? file : file?.uri || file;
  if (!uri) throw new Error("No image URI");
  const ext =
    (typeof file?.mimeType === "string" && file.mimeType.split("/")[1]) ||
    (String(uri).split("?")[0].split(".").pop() || "jpg");
  const path = `${userId}/${Date.now()}.${ext}`;
  return uploadFromUri({
    uri,
    storageBucket: "sponsored-images",
    path,
    contentType: ext === "png" ? "image/png" : "image/jpeg",
  });
}

/* ========================= NEW CLEANUP HELPERS ========================= */

/** Delete a single storage path (best-effort). Accepts a storage path or a public URL. */
export async function removeStoragePath(bucket: string, pathOrUrl: string): Promise<void> {
  if (!pathOrUrl) return;
  // If it looks like an http(s) URL, try to map it back to a path
  let path = pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const maybe = publicUrlToPath(pathOrUrl, bucket);
    if (!maybe) return; // can't map → skip
    path = maybe;
  }
  // Guard: don't pass empty or slash-only
  const clean = path.replace(/^\/+/, "");
  if (!clean) return;
  await supabase.storage.from(bucket).remove([clean]).catch(() => {});
}

/** Recursively delete everything under a prefix (folder), e.g. "user/recipeId/". */
export async function removeFolderRecursive(bucket: string, prefix: string): Promise<void> {
  if (!prefix) return;
  const s = supabase.storage.from(bucket);
  const base = prefix.replace(/^\/+/, "").replace(/\/+$/, "");

  // list files at this level
  const { data: entries } = await s.list(base, { limit: 1000, offset: 0, search: "" });
  if (entries?.length) {
    const files = entries
      .filter((e: any) => e?.id) // files have an id
      .map((e: any) => `${base}/${e.name}`);
    if (files.length) await s.remove(files).catch(() => {});
  }

  // list subfolders and recurse
  const dirs = (entries || []).filter((e: any) => !e?.id); // folders have no id
  for (const d of dirs) {
    await removeFolderRecursive(bucket, `${base}/${d.name}`);
  }
}

/**
 * Replace a recipe's image:
 * 1) Upload the new image to recipe-images at <owner>/<recipeId>/images/timestamp.ext
 * 2) Update recipes.image_url to the NEW public URL
 * 3) Delete the OLD file (path derived from previous value if possible)
 *
 * Returns: NEW public URL (string)
 */
export async function replaceRecipeImage(recipeId: string, sourceUri: string): Promise<string> {
  if (!recipeId) throw new Error("Missing recipe id");
  if (!sourceUri) throw new Error("Missing image source");

  // who is doing this? (auth check)
  const me = (await supabase.auth.getUser()).data.user;
  if (!me) throw new Error("Not signed in");

  // fetch current row to get owner and current image
  const cur = await supabase
    .from("recipes")
    .select("user_id, image_url")
    .eq("id", recipeId)
    .maybeSingle();
  if (cur.error) throw cur.error;
  if (!cur.data) throw new Error("Recipe not found");

  const ownerId = cur.data.user_id as string;
  const oldImage = (cur.data.image_url as string | null) || null;

  // pick extension and build path (keeps your Capture path style)
  const ext = pickExt(sourceUri).toLowerCase();
  const path = `${ownerId}/${recipeId}/images/${Date.now()}-${uid()}.${ext}`;

  // upload new
  const newPublicUrl = await uploadFromUri({
    uri: sourceUri,
    storageBucket: "recipe-images",
    path,
    contentType: ext === "png" ? "image/png" : "image/jpeg",
  });

  // update row to the NEW url first (so the app points at the new file instantly)
  const upd = await supabase.from("recipes").update({ image_url: newPublicUrl }).eq("id", recipeId);
  if (upd.error) throw upd.error;

  // best-effort delete of the OLD file (we try to convert old public URL → path if needed)
  if (oldImage) await removeStoragePath("recipe-images", oldImage);

  return newPublicUrl;
}

/**
 * Best-effort cleanup for an entire recipe folder, e.g., before/after deleting a recipe row.
 * Prefix pattern: <ownerId>/<recipeId>
 */
export async function deleteRecipeAssets(ownerId: string, recipeId: string): Promise<void> {
  if (!ownerId || !recipeId) return;
  await removeFolderRecursive("recipe-images", `${ownerId}/${recipeId}`).catch(() => {});
}
