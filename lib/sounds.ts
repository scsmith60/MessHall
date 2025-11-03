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
    // make sure sound plays even if device is on silent (Android)
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeAndroid: 1,
        shouldDuckAndroid: true,
      } as any);
    } catch {}
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


// New easter eggs
export async function playLiverEasterEgg(): Promise<void> {
  // Try local asset → env URL → TTS
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const local = require("../assets/sounds/ate-his-liver.mp3");
    const ok = await tryPlayWithExpoAV(local);
    if (ok) return;
  } catch {}
  const url = process.env.EXPO_PUBLIC_LIVER_SFX_URL;
  if (url && /^https?:\/\//i.test(url)) {
    const ok = await tryPlayWithExpoAV({ uri: url });
    if (ok) return;
  }
  try { speak("Ate his liver"); } catch {}
}

export async function playRockyMountainOystersEasterEgg(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const local = require("../assets/sounds/do-you-suck-dicks.mp3");
    const ok = await tryPlayWithExpoAV(local);
    if (ok) return;
  } catch {}
  const url = process.env.EXPO_PUBLIC_OYSTERS_SFX_URL;
  if (url && /^https?:\/\//i.test(url)) {
    const ok = await tryPlayWithExpoAV({ uri: url });
    if (ok) return;
  }
  try { speak("Do you suck dicks"); } catch {}
}

export async function playLambEasterEgg(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const local = require("../assets/sounds/what-became-of-your-lamb.mp3");
    const ok = await tryPlayWithExpoAV(local);
    if (ok) return;
  } catch {}
  const url = process.env.EXPO_PUBLIC_LAMB_SFX_URL;
  if (url && /^https?:\/\//i.test(url)) {
    const ok = await tryPlayWithExpoAV({ uri: url });
    if (ok) return;
  }
  try { speak("What became of your lamb"); } catch {}
}


