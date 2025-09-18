// profile.ts
// PURPOSE: small helper functions the Profile screen can call.
//
// LIKE I'M 5:
// • Buttons call these helpers.
// • Helpers talk to Supabase for you.
// • No magic. Just: click → do thing.

import { supabase } from "./supabase";

/** Make sure my profile row exists (you already had this). */
export async function ensureMyProfile(): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Not signed in");

  const id = u.user.id;
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (existing) return id;

  const username = "user_" + id.slice(0, 6);
  const { error } = await supabase.from("profiles").insert({
    id,
    username,
    display_name: username,
  });
  if (error) throw error;
  return id;
}

/** Save units preference to profile: "us" | "metric" */
export async function updateUnitsPreference(units: "us" | "metric") {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({ units_preference: units })
    .eq("id", u.user.id);
  if (error) throw error;
}

/** Save optional location pieces on profile */
export async function updateLocation(
  patch: { state?: string | null; country?: string | null }
) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("profiles")
    .update({
      state: patch.state ?? null,
      country: patch.country ?? null,
    })
    .eq("id", u.user.id);
  if (error) throw error;
}

/** Ask the backend to mark my account for deletion in 30 days. */
export async function requestAccountDeletion() {
  // OPTION A: simple table flag on profiles (works without Edge Function)
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Not signed in");

  const requestedAt = new Date().toISOString();
  const effectiveAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("profiles")
    .update({
      deletion_requested_at: requestedAt,
      deletion_effective_at: effectiveAt,
    })
    .eq("id", u.user.id);
  if (error) throw error;

  // OPTION B (optional): if you have an Edge Function to enqueue background cleanup:
  // const token = (await supabase.auth.getSession()).data.session?.access_token;
  // await fetch(process.env.EXPO_PUBLIC_SUPABASE_URL + "/functions/v1/request-account-deletion", {
  //   method: "POST",
  //   headers: { Authorization: `Bearer ${token}` }
  // });

  return { requestedAt, effectiveAt };
}

/** Grab a small subset of my recipes for quick self-serve export. */
export async function fetchMyRecipesForQuickExport(limit = 100) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Not signed in");

  // Keep payload small & safe for "Share"
  const { data, error } = await supabase
    .from("recipe_export_v1")
    .select("*")
    .eq("user_id", u.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/** Ask the server to build a full export and email it. */
export async function requestRecipesExport() {
  // If you made an Edge Function for export:
  // POST /functions/v1/export-my-recipes
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(
    process.env.EXPO_PUBLIC_SUPABASE_URL + "/functions/v1/export-my-recipes",
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "Export request failed");
  }
  return true;
}

/** Create a support ticket; returns ticket id. */
export async function submitSupportTicket(input: {
  subject: string;
  message: string;
  screenshotUrls: string[]; // public URLs after upload
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: u.user.id,
      subject: input.subject,
      message: input.message,
      screenshots: input.screenshotUrls,
      status: "open",
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/** Upload one screenshot to 'support' storage and return a public URL. */
export async function uploadSupportScreenshot(fileUri: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Not signed in");

  const fileName = `${u.user.id}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.jpg`;

  // Convert local file → Uint8Array
  const bin = await (await fetch(fileUri)).arrayBuffer();
  const bytes = new Uint8Array(bin);

  const { error } = await supabase.storage
    .from("support")
    .upload(fileName, bytes, { contentType: "image/jpeg", upsert: false });

  if (error) throw error;

  const { data: pub } = supabase.storage.from("support").getPublicUrl(fileName);
  return pub.publicUrl;
}
