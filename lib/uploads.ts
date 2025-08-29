// WHAT: take a local photo URI and put it in Supabase storage, then return a public URL.
import { supabase } from './supabase';

function uid() {
  return Math.random().toString(36).slice(2);
}

export async function uploadRecipeImage(localUri: string): Promise<string> {
  // who is logged in?
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes.user) throw new Error('Not signed in');

  const userId = userRes.user.id;
  const resp = await fetch(localUri);
  const blob = await resp.blob();

  const path = `${userId}/${Date.now()}-${uid()}.jpg`;
  const { error: upErr } = await supabase
    .storage
    .from('recipe-images')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

  if (upErr) throw upErr;

  // get a public URL we can save on the recipe row
  const { data } = supabase.storage.from('recipe-images').getPublicUrl(path);
  return data.publicUrl;
}

// --- SPONSOR IMAGE UPLOAD (new) ----------------------------------
// ELI5: this saves the sponsor picture in a separate bucket so we
// don't mix it with recipe photos. It returns a public URL string.

export async function uploadAdImage(userId: string, file: any): Promise<string> {
  if (!userId) throw new Error('Missing user id');
  // normalize like our main uploader:
  const maybe = typeof file === 'string' ? { uri: file } : (file || {});
  const uri = maybe.uri || file?.uri || file;
  if (!uri) throw new Error('No image URI');
  // pick a nice file name
  const extFromName = (n?: string | null) => (n && n.includes('.') ? n.split('.').pop()!.toLowerCase() : '');
  const extFromMime = (m?: string | null) => (m && m.includes('/') ? m.split('/')[1].toLowerCase() : '');
  const ext = extFromMime(maybe.mimeType) || extFromName(maybe.fileName) || (String(uri).split('?')[0].split('.').pop() || 'jpg');
  const filename = `${Date.now()}.${ext}`;
  const path = `${userId}/${filename}`;

  // turn the local file into a Blob (works for file:// and content://)
  const resp = await fetch(uri);
  if (!resp.ok) throw new Error(`Image read failed (${resp.status})`);
  const blob = await resp.blob();

  // upload into 'sponsored-images' bucket
  const { error } = await supabase.storage.from('sponsored-images').upload(path, blob, {
    upsert: false,
    contentType: (blob as any)?.type || undefined,
  });
  if (error) throw error;

  const { data } = supabase.storage.from('sponsored-images').getPublicUrl(path);
  return data.publicUrl;
}
