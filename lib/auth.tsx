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
        const { data } = (await withTimeout(supabase.auth.getSession(), 3500)) as any;
        if (!alive) return;
        setSession(data.session ?? null);

        d.log("[auth-hook]", "initial getSession()", {
          hasSession: !!data?.session,
          userId: data?.session?.user?.id ?? null,
          email: data?.session?.user?.email ?? null,
        });
      } catch (e) {
        if (!alive) return;
        // Treat as signed-out if we can't confirm quickly
        setSession(null);
        d.log("[auth-hook]", "initial getSession failed", String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    // 2) react to auth flips
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, nextFromEvent) => {
      // 🔒 hold navigation while we settle the new truth
      setLoading(true);

      // 🆕 re-check the REAL session (prevents “half-ready” states) with timeout
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
        const { data } = (await withTimeout(supabase.auth.getSession(), 3500)) as any;
        freshest = nextFromEvent ?? data?.session ?? null;
      } catch (e) {
        freshest = nextFromEvent ?? null;
        d.log("[auth-hook]", "onAuthStateChange getSession failed", String(e));
      }

      setSession(freshest);

      await d.log("[auth-hook]", `onAuthStateChange: ${event}`, {
        fromEvent: !!nextFromEvent,
        hasSession: !!freshest,
        userId: freshest?.user?.id ?? null,
        email: freshest?.user?.email ?? null,
      });

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
