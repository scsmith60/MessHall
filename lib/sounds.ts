// lib/sounds.ts
// Tiny helper to play fun sound bites without crashing if the asset/env is missing.
// Prefers a local bundled asset if present, otherwise tries an env URL.

// lazy import to avoid adding a hard dependency at startup
async function tryPlayWithExpoAV(source: any): Promise<boolean> {
  let sound: any = null;
  try {
    // dynamic import so this file is safe even if expo-av isn't installed yet
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AV = require("expo-av");
    const { Audio } = AV as typeof import("expo-av");
    
    // make sure sound plays even if device is on silent (iOS/Android)
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: 1, // DuckOthers
        interruptionModeAndroid: 1, // DuckOthers
        shouldDuckAndroid: true,
      } as any);
    } catch {}
    
    sound = new Audio.Sound();
    
    // Set up cleanup when playback finishes - keep sound alive until done
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (status?.didJustFinish || (status?.isLoaded === false && status?.error)) {
        // Only unload when playback actually finishes or errors
        sound?.unloadAsync().catch(() => {});
      }
    });
    
    // Load and play the sound in one go - this is more reliable
    await sound.loadAsync(source, { 
      shouldPlay: true, 
      volume: 1.0,
      isMuted: false,
    });
    
    // Verify it loaded and started playing
    const loadStatus = await sound.getStatusAsync();
    if (!loadStatus.isLoaded) {
      await sound.unloadAsync().catch(() => {});
      return false;
    }
    
    // Verify playback started - wait a moment for it to begin
    await new Promise(resolve => setTimeout(resolve, 50));
    const playStatus = await sound.getStatusAsync();
    
    if (playStatus.isLoaded && playStatus.isPlaying) {
      // Success! Sound is playing. Don't unload - let it finish naturally via the callback
      console.log('[sounds] Audio playing successfully');
      return true;
    } else {
      // Failed to start playing
      console.warn('[sounds] Audio failed to play. Status:', {
        isLoaded: playStatus.isLoaded,
        isPlaying: playStatus.isPlaying,
        error: playStatus.error,
      });
      await sound.unloadAsync().catch(() => {});
      return false;
    }
  } catch (error) {
    // Clean up on any error
    console.warn('[sounds] Audio playback error:', error);
    if (sound) {
      await sound.unloadAsync().catch(() => {});
    }
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
}


// New easter eggs
export async function playLiverEasterEgg(): Promise<void> {
  // Try local asset → env URL
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
}


