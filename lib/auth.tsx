// lib/auth.tsx
// LIKE I'M 5: this file keeps track of "who is logged in".
// We only say "yes, logged in" if Supabase's getUser() confirms a real user.
// If storage lies (old/stale session), we sign out so we stay clean + safe.

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// 🧠 What we share with the app
// - session: whatever is in storage (can be null)
// - loading: true while we are checking with the server
// - isLoggedIn: only true if server says we have a real user
// - userId: the confirmed user id (or null)
type AuthContextType = {
  session: Session | null;
  loading: boolean;
  isLoggedIn: boolean;
  userId: string | null;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  isLoggedIn: false,
  userId: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // 🗃️ This is “what storage says” (might be stale)
  const [session, setSession] = useState<Session | null>(null);

  // ⏳ Are we busy checking with the server?
  const [loading, setLoading] = useState(true);

  // ✅ This is the only truth we trust for "who am I"
  const [confirmedUserId, setConfirmedUserId] = useState<string | null>(null);

  // 🔍 Step 1: read whatever is in storage (may be stale)
  useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setSession(data.session ?? null);
    })();

    // 👂 Listen for future auth changes (login/logout/refresh)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
      // when auth changes, Step 2 (below) runs again to re-validate
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ✅ Step 2: server-validate: only trust a session if getUser() returns a user
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);

      // 🧑‍⚖️ Ask the server: "Who am I?"
      // If tokens are expired/invalid, this gives us no user.
      const { data, error } = await supabase.auth.getUser();

      if (!alive) return;

      if (error || !data?.user?.id) {
        // 🧹 Stale or invalid session → hard sign out to clear storage
        try {
          await supabase.auth.signOut();
        } catch {
          // ignore sign-out errors; goal is to ensure a clean state
        }
        setConfirmedUserId(null);
      } else {
        setConfirmedUserId(data.user.id);
      }

      setLoading(false);

      // 🪵 Helpful log during debugging
      // (Remove or guard in production if you like)
      console.log("[Auth] validated", {
        hasStoredSession: !!session,
        confirmedUserId: data?.user?.id ?? null,
        error: error?.message,
      });
    })();

    // 🔁 Re-validate whenever the stored session object changes
  }, [session]);

  // 🎁 What we give to the rest of the app
  const value = useMemo<AuthContextType>(
    () => ({
      session,
      loading,
      isLoggedIn: !!confirmedUserId, // 👈 only true after validation
      userId: confirmedUserId,
    }),
    [session, loading, confirmedUserId]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// 🪙 useAuth(): grab the whole auth package (loading, isLoggedIn, userId, session)
export function useAuth() {
  return useContext(AuthContext);
}

// 🧩 useUserId(): tiny helper hook if you only need the id + loading flag
export function useUserId() {
  const { userId, loading } = useAuth();
  return { userId, loading };
}

// 🧰 getCurrentUserId(): utility for places outside React (data layer, actions)
// LIKE I'M 5: ask Supabase who I am right now, give me my id or null.
export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

// 🧰 requireUserId(): strict version (throws if not logged in)
// Handy in the data layer when you *must* have a user.
export async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  const id = data?.user?.id ?? null;
  if (error || !id) throw new Error("Not logged in");
  return id;
}
