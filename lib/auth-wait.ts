// lib/auth-wait.ts
// 🧸 like I'm 5: this waits patiently for the "user is really here" light.
// We use it after sign-in and sign-out so screens don't jump too early.

import { supabase } from "./supabase";

export async function waitForSignedIn(opts?: { timeoutMs?: number; intervalMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 3000;   // wait up to 3 seconds
  const intervalMs = opts?.intervalMs ?? 100;  // check every 100ms
  const t0 = Date.now();

  while (Date.now() - t0 < timeoutMs) {
    const { data } = await supabase.auth.getSession();
    const ok = !!data.session?.user?.id; // ✅ user exists
    if (ok) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false; // we tried our best
}

export async function waitForSignedOut(opts?: { timeoutMs?: number; intervalMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 2000;
  const intervalMs = opts?.intervalMs ?? 100;
  const t0 = Date.now();

  while (Date.now() - t0 < timeoutMs) {
    const { data } = await supabase.auth.getSession();
    const gone = !data.session; // ✅ no session
    if (gone) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}
