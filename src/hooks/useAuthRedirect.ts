// src/hooks/useAuthRedirect.ts
// 🧸 This tiny helper moves people to /login one time if they aren't logged in.
// It stops the scary "Maximum update depth" error by avoiding repeat redirects.

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "expo-router";

type Options = {
  isLoggedIn: boolean;      // You tell us: true or false
  loginPath?: string;       // Where is your login page? default "/login"
  afterLoginPath?: string;  // Where to go after login? default "/"
};

export function useAuthRedirect({
  isLoggedIn,
  loginPath = "/login",
  afterLoginPath = "/",
}: Options) {
  const router = useRouter();
  const pathname = usePathname();

  // 👇 This flag says "we already redirected once"
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (hasRedirectedRef.current) return; // do nothing if we already moved

    // 🔒 Not logged in and not already on login? → go to login ONCE
    if (!isLoggedIn && pathname !== loginPath) {
      hasRedirectedRef.current = true;
      router.replace(loginPath); // replace = no back stack spam
      return;
    }

    // ✅ Logged in but stuck on login screen? → go to home ONCE
    if (isLoggedIn && pathname === loginPath) {
      hasRedirectedRef.current = true;
      router.replace(afterLoginPath);
    }
  }, [isLoggedIn, pathname, router, loginPath, afterLoginPath]);
}
