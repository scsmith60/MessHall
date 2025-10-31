// lib/sounds.ts
// Tiny helper to play fun sound bites without crashing if the asset/env is missing.
// Prefers a local bundled asset if present, otherwise tries an env URL, and finally falls back to TTS.

import { speak } from "./speak";

// lazy import to avoid adding a hard dependency at startup
async function tryPlayWithExpoAV(source: any): Promise<boolean> {
  try {
    // dynamic import so this file is safe even if expo-av isn't installed yet
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AV = require("expo-av");
    const { Audio } = AV as typeof import("expo-av");
    const sound = new Audio.Sound();
    await sound.loadAsync(source, { shouldPlay: true, volume: 1.0 });
    sound.setOnPlaybackStatusUpdate((st: any) => {
      if (st?.didJustFinish || st?.isLoaded === false) {
        sound.unloadAsync().catch(() => {});
      }
    });
    return true;
  } catch {
    return false;
  }
}

export async function playDonutEasterEgg(): Promise<void> {
  // 1) try local asset if you add it to assets/sounds/
  try {
    // If the file does not exist, require() will throw — we catch and keep going.
    // Replace the filename with your actual asset if you add one.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const local = require("../assets/sounds/lee-ermey-what-have-we-got-here.mp3");
    const ok = await tryPlayWithExpoAV(local);
    if (ok) return;
  } catch {}

  // 2) try remote URL from env (EXPO_PUBLIC_DONUT_SFX_URL)
  const url = process.env.EXPO_PUBLIC_DONUT_SFX_URL;
  if (url && /^https?:\/\//i.test(url)) {
    const ok = await tryPlayWithExpoAV({ uri: url });
    if (ok) return;
  }

  // 3) fallback: say the line via TTS so the moment still lands
  try { speak("What have we got here?"); } catch {}
}


