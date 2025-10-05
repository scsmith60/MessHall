// lib/blocking.ts
// 🧱 Helpers to block/unblock users, list who you've blocked,
// and resolve avatar URLs from Supabase Storage.
// We keep it tiny and dependency-free (no router imports here).

import { supabase } from "./supabase";

/* ──────────────────────────────────────────────────────────────
   Types (little shapes so TypeScript knows what's inside)
   ────────────────────────────────────────────────────────────── */
export type BlockedUser = {
  id: string;                 // the blocked user's id
  username: string | null;    // their name to show
  avatar_url: string | null;  // fully-resolved, ready for <Image uri=... />
  since: string;              // when I blocked them
};

/* ──────────────────────────────────────────────────────────────
   Avatar bucket settings (edit these to match your project)
   - If your "avatars" bucket is PUBLIC, set IS_PUBLIC = true.
   - If it's PRIVATE, set IS_PUBLIC = false (we'll sign URLs).
   - If your column isn't "avatar_url" but "avatar_path", change
     the select + mapping below where noted.
   ────────────────────────────────────────────────────────────── */
const AVATAR_BUCKET = "avatars";
const AVATARS_BUCKET_IS_PUBLIC = true;

/* ──────────────────────────────────────────────────────────────
   Tiny helper: turn a storage path into a URL for <Image>
   - If it's already a full URL (starts with http), return it.
   - If it's a path like "user-123/avatar.png", build URL:
       • public bucket → getPublicUrl
       • private bucket → createSignedUrl (1 hour)
   ────────────────────────────────────────────────────────────── */
async function resolveAvatarUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;

  // already a full URL? just use it.
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  // looks like a storage path – resolve from Storage
  if (AVATARS_BUCKET_IS_PUBLIC) {
    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(pathOrUrl);
    return data?.publicUrl ?? null;
  } else {
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(pathOrUrl, 60 * 60); // 1 hour
    if (error) return null;
    return data?.signedUrl ?? null;
  }
}

/* ──────────────────────────────────────────────────────────────
   BLOCK / UNBLOCK
   - blockUser: adds (me → target) row; safe to call again (upsert)
   - unblockUser: removes my row for that target
   - isBlocked: do *I* currently block target?
   ────────────────────────────────────────────────────────────── */
export async function blockUser(targetId: string): Promise<boolean> {
  if (!targetId) return false;

  // who am I?
  const { data: auth } = await supabase.auth.getUser();
  const me = auth?.user?.id;
  if (!me || me === targetId) return false; // no self-blocks

  // upsert so it's idempotent (no dupes)
  const { error } = await supabase
    .from("user_blocks")
    .upsert(
      { blocker_id: me, blocked_id: targetId },
      { onConflict: "blocker_id,blocked_id" }
    );

  return !error;
}

export async function unblockUser(targetId: string): Promise<boolean> {
  if (!targetId) return false;
  // RLS ensures you can only delete your own block rows
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocked_id", targetId);
  return !error;
}

export async function isBlocked(targetId: string): Promise<boolean> {
  if (!targetId) return false;
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocked_id", targetId)
    .maybeSingle();
  return !error && !!data;
}

/* ──────────────────────────────────────────────────────────────
   LIST: who have I blocked?
   - Pull my block rows (RLS lets me see only my rows).
   - Fetch those users' profiles.
   - Resolve each avatar to a URL that <Image> can render.
   NOTE: If your profiles column is "avatar_path" instead of
         "avatar_url", update the select & mapping below.
   ────────────────────────────────────────────────────────────── */
export async function listBlockedUsers(): Promise<BlockedUser[]> {
  const { data: rows, error } = await supabase
    .from("user_blocks")
    .select("blocked_id, created_at")
    .order("created_at", { ascending: false });

  if (error || !rows?.length) return [];

  const ids = Array.from(new Set(rows.map((r: any) => String(r.blocked_id))));

  // ⬇️ If your column name differs, change the select here
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, username, avatar_url") // e.g. change to "avatar_path" if that's your schema
    .in("id", ids);

  const byId = new Map((profs ?? []).map((p: any) => [String(p.id), p]));

  // resolve each avatar (path → URL)
  const out = await Promise.all(
    rows.map(async (r: any) => {
      const p = byId.get(String(r.blocked_id));
      // ⬇️ If your schema uses avatar_path, change p?.avatar_url to p?.avatar_path
      const resolved = await resolveAvatarUrl(p?.avatar_url ?? null);
      return {
        id: String(r.blocked_id),
        username: p?.username ?? null,
        avatar_url: resolved,
        since: r.created_at,
      } as BlockedUser;
    })
  );

  return out;
}

/* ──────────────────────────────────────────────────────────────
   OPTIONAL: quick helpers you may want
   - getMyBlockedIds(): handy for client-side filtering so
     blocked users disappear instantly without a refetch.
   - canViewProfile(userId): check if a profile is viewable to me.
     This relies on your RLS "hide when blocked" policy on profiles.
   ────────────────────────────────────────────────────────────── */
export async function getMyBlockedIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id");
  if (error || !data) return [];
  return data.map((r: any) => String(r.blocked_id));
}

export async function canViewProfile(userId: string): Promise<boolean> {
  if (!userId) return false;
  // RLS will return 0 rows if either side is blocked (or user doesn't exist)
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  return !error && !!data;
}
