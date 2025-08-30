// lib/uploads.ts (only the uploadFromUri has changed)
// ELI5: after we push the picture, we return BOTH the "where it lives" (path)
// and a publicUrl (if bucket is public). The path lets us also make signed URLs.

export async function uploadFromUri(opts: {
  uri: string;
  storageBucket: string;   // e.g. "recipe-images"
  path?: string;           // e.g. "<user>/<recipeId>/images/<time>.jpg"
  contentType?: string;    // e.g. "image/jpeg"
}): Promise<{ path: string; publicUrl: string | null }> {
  const { uri, storageBucket } = opts;
  if (!uri) throw new Error("No image URI to upload");
  if (!storageBucket) throw new Error("Missing storage bucket name");

  const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
  if (!SUPABASE_URL) throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL");

  // who’s logged in (token needed for REST upload)
  const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessionRes?.session) throw new Error("Not signed in");
  const token = sessionRes.session.access_token;

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes?.user?.id || "anon";

  // pick a file extension
  const extFromUri = (u: string) => {
    const clean = u.split("?")[0];
    const maybe = clean.split(".").pop() || "";
    return (maybe.length <= 4 ? maybe : "") || "jpg";
  };
  const ext = extFromUri(uri);

  // choose a storage path if caller didn’t pass one
  const path = opts.path || `${userId}/${Date.now()}.${ext}`;

  // content type guess
  let contentType = opts.contentType || (ext === "png" ? "image/png" : "image/jpeg");

  // ensure we have a local file to stream
  let localFileUri = uri;
  if (uri.startsWith("http")) {
    const dest = `${FileSystem.cacheDirectory}dl-${Date.now()}.${ext}`;
    const dl = await FileSystem.downloadAsync(uri, dest);
    if (dl.status !== 200) throw new Error(`Failed to download remote image (status ${dl.status})`);
    localFileUri = dl.uri;
    const hdrType = (dl.headers && (dl.headers["Content-Type"] || dl.headers["content-type"])) as string | undefined;
    if (hdrType && hdrType.includes("/")) contentType = hdrType;
  }

  // REST upload to /storage/v1/object/<bucket>/<path>
  const restUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(storageBucket)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  const res = await FileSystem.uploadAsync(restUrl, localFileUri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
      "x-upsert": "false",
    },
  });

  if (res.status !== 200) {
    throw new Error(`Storage upload failed (${res.status}): ${res.body?.slice(0, 200)}`);
  }

  // try to build a public URL (will only work if bucket is public)
  const { data: pub } = supabase.storage.from(storageBucket).getPublicUrl(path);
  const publicUrl = pub?.publicUrl || null;

  return { path, publicUrl };
}
