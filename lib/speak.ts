// PURPOSE: small wrapper around expo-speech so we can start/stop safely.
import * as Speech from 'expo-speech';

export function speak(text: string) {
  // stop anything already speaking, then say it
  Speech.stop();
  Speech.speak(text, { rate: 1.0, pitch: 1.0 });
}

export function stopSpeak() {
  Speech.stop();
}
