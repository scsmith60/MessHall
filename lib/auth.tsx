// lib/auth.tsx
// 🧸 Like I'm 5: This is the brain that tells the app if you're logged in.
// What’s new here:
// - After ANY auth event, we re-check getSession() to grab the freshest session.
// - We briefly set loading=true during flips so screens don't run early.
// - We NEVER report isLoggedIn=true while loading is true.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  PropsWithChildren,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { d } from "./debug";

type AuthContextType = {
  loading: boolean;       // ⏳ still checking?
  isLoggedIn: boolean;    // ✅ only true when loading=false AND user exists
  session: Session | null;
  user: User | null;
};

const AuthContext = createContext<AuthContextType>({
  loading: true,
  isLoggedIn: false,
  session: null,
  user: null,
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const user = session?.user ?? null;

  // ✅ never true while loading
  const isLoggedIn = !loading && !!user?.id;

  // 1) first snapshot on mount
  useEffect(() => {
    let alive = true;

    (async () => {
      const withTimeout = <T,>(p: Promise<T>, ms: number) =>
        new Promise<T>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("auth getSession timeout")), ms);
          p.then((v) => {
            clearTimeout(t);
            resolve(v);
          }).catch((e) => {
            clearTimeout(t);
            reject(e);
          });
        });

      try {
        // Increase timeout to 15s for mobile devices (AsyncStorage can be slow)
        const { data } = (await withTimeout(supabase.auth.getSession(), 15000)) as any;
        if (!alive) return;
        setSession(data.session ?? null);

        d.log("[auth-hook]", "initial getSession()", {
          hasSession: !!data?.session,
          userId: data?.session?.user?.id ?? null,
          email: data?.session?.user?.email ?? null,
        });
      } catch (e) {
        if (!alive) return;
        // On timeout, try one more time with longer timeout as fallback
        // This handles slow devices/AsyncStorage reads
        try {
          d.log("[auth-hook]", "initial getSession timeout, retrying with longer timeout");
          const { data } = (await withTimeout(supabase.auth.getSession(), 20000)) as any;
          if (!alive) return;
          setSession(data.session ?? null);
          d.log("[auth-hook]", "retry getSession() succeeded", {
            hasSession: !!data?.session,
            userId: data?.session?.user?.id ?? null,
          });
        } catch (retryError) {
          // Only treat as signed-out if retry also fails
          // This prevents users from being logged out due to slow device/network
          d.log("[auth-hook]", "initial getSession failed after retry", String(retryError));
          // Don't set to null - let the persisted session in AsyncStorage be checked by onAuthStateChange
          // This preserves session persistence behavior
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    // 2) react to auth flips
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, nextFromEvent) => {
      // 🔒 hold navigation while we settle the new truth
      setLoading(true);

      // 🆕 re-check the REAL session (prevents "half-ready" states) with timeout
      let freshest: Session | null = null;
      try {
        const withTimeout = <T,>(p: Promise<T>, ms: number) =>
          new Promise<T>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("auth getSession timeout")), ms);
            p.then((v) => {
              clearTimeout(t);
              resolve(v);
            }).catch((e) => {
              clearTimeout(t);
              reject(e);
            });
          });
        // Increase timeout to 10s for state changes (should be faster than initial load)
        const { data } = (await withTimeout(supabase.auth.getSession(), 10000)) as any;
        freshest = nextFromEvent ?? data?.session ?? null;
      } catch (e) {
        // On timeout, prefer the session from the auth event (nextFromEvent) if available
        // This is the most reliable source during state changes
        // Only fall back to null if we have no event session AND timeout occurred
        freshest = nextFromEvent ?? null;
        if (!nextFromEvent) {
          d.log("[auth-hook]", "onAuthStateChange getSession failed", String(e));
          // Try one retry to preserve session persistence
          try {
            d.log("[auth-hook]", "onAuthStateChange retrying getSession after timeout");
            const { data } = (await withTimeout(supabase.auth.getSession(), 15000)) as any;
            freshest = data?.session ?? null;
            if (freshest) {
              d.log("[auth-hook]", "onAuthStateChange retry succeeded, session preserved");
            }
          } catch (retryError) {
            d.log("[auth-hook]", "onAuthStateChange retry also failed", String(retryError));
          }
        }
      }

      setSession(freshest);

      // Only log non-routine events (skip TOKEN_REFRESHED to reduce log noise)
      // TOKEN_REFRESHED happens automatically every ~1 hour and is expected behavior
      if (event !== "TOKEN_REFRESHED") {
        await d.log("[auth-hook]", `onAuthStateChange: ${event}`, {
          fromEvent: !!nextFromEvent,
          hasSession: !!freshest,
          userId: freshest?.user?.id ?? null,
          email: freshest?.user?.email ?? null,
        });
      }

      // 🧘 small micro-wait lets React commit state before guards read it
      await new Promise((r) => setTimeout(r, 0));

      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({ loading, isLoggedIn, session, user }),
    [loading, isLoggedIn, session, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function useUserId() {
  const { user, loading } = useAuth();
  return { userId: user?.id ?? null, loading };
}
