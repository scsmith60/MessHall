// lib/share-intake.ts
// 🧸 "like I'm 5": this little helper listens for things other apps share.
// When TikTok (or any app) shares a link, we grab the first URL we find
// and send the user to your Capture screen with ?sharedUrl=... so it auto-imports.

import { router } from "expo-router";
import * as Linking from "expo-linking";
// Optional dependency; load dynamically to avoid type/build errors when not installed
let ShareMenu: any = null;
type ShareData = any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ShareMenu = require("react-native-share-menu");
} catch {}

// Tiny helper to find the first http(s) link in a text blob
function extractFirstUrl(s?: string | null): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

function pickUrlFromShare(data?: ShareData | null): string | null {
  if (!data) return null;

  // 1) Some apps put the URL in 'data'
  if (typeof data.data === "string") {
    const u1 = extractFirstUrl(data.data);
    if (u1) return u1;
  }

  // 2) Some apps put text in 'extra' or 'subject'
  const maybeText = [data.extra, data.subject, data.title]
    .map((x) => (typeof x === "string" ? x : null))
    .filter(Boolean)
    .join(" ");
  const u2 = extractFirstUrl(maybeText);
  if (u2) return u2;

  // 3) Some share as files with a web URL path (rare)
  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      if (typeof item.data === "string") {
        const u3 = extractFirstUrl(item.data);
        if (u3) return u3;
      }
    }
  }
  return null;
}

/**
 * call this ONCE when your app starts (e.g., in app/_layout.tsx)
 */
export function registerShareIntake() {
  // A) If the app was opened from a share (cold start), handle it
  ShareMenu?.getInitialShare?.().then((share: ShareData) => {
    const url = pickUrlFromShare(share);
    if (url) {
      // go to Capture with the URL so it can auto-import
      setTimeout(() => {
        router.push({ pathname: "/(tabs)/capture", params: { sharedUrl: url } });
      }, 0);
    }
  });

  // B) If the app is already open when a user shares, handle that too
  ShareMenu?.addNewShareListener?.((share: ShareData) => {
    const url = pickUrlFromShare(share);
    if (url) {
      router.push({ pathname: "/(tabs)/capture", params: { sharedUrl: url } });
    }
  });

  // C) (nice extra) handle deep links like messhall://import?url=...
  Linking.addEventListener("url", ({ url }) => {
    try {
      const u = new URL(url);
      if (u.hostname === "import") {
        const sharedUrl = u.searchParams.get("url");
        if (sharedUrl) {
          router.push({ pathname: "/(tabs)/capture", params: { sharedUrl } });
        }
      }
    } catch {}
  });
}
