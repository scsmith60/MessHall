// /app/cook/[id].tsx
// COOK MODE — hands-free voice that NEVER talks over itself 🎤
// kid-simple summary:
// - While the phone is TALKING (TTS), the mic is OFF.
// - When TTS finishes, the mic comes back ON (if Hands-free is ON).
// - This avoids TTS getting cut off by listening.

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  Text,
  View,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { Ionicons } from '@expo/vector-icons';

import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import BigButton from '../../components/ui/BigButton';
import { fmtMMSS, clamp, parseDurationFromText } from '../../lib/timer';

// we’ll still keep your helpers available
import { speak as oldSpeak, stopSpeak as oldStopSpeak } from '../../lib/speak';
import { success, warn } from '../../lib/haptics';
import { dataAPI } from '../../lib/data';

// === voice recognition ==============================================
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

// === text-to-speech with finish callbacks ===========================
// we use expo-speech directly so we know EXACTLY when speaking ends
import * as Speech from 'expo-speech';

// ==== knobs ==========================================================
const BG_SCALE = 1.12;
const BLUR_RADIUS = 3;
const SCRIM_OPACITY = 0.40;
const GRADIENT_TOP = 0.55;
const TIMER_SIZE = 220;
const DEFAULT_STEP_SECONDS = 60;

// === words we understand ============================================
const VOICE_PATTERNS = {
  next: /\b(next|next step|continue|go (on|ahead)|forward|advance|proceed|okay|ok|done)\b/i,
  back: /\b(back|previous|previous step|go back|back up|prior step|backwards)\b/i,
  reread: /\b(read again|repeat|can you repeat|repeat that|say again|one more time|re[- ]?read|read it again|again|what did you say|come again)\b/i,
  exit: /\b(exit|quit|leave|stop cooking|close|cancel)\b/i,
  done: /\b(done|finished|complete|all done|that’s it|that is it|we’re done|we are done)\b/i,
};

export default function CookMode() {
  useKeepAwake();

  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const SAFE_BOTTOM = Platform.select({
    ios: Math.max(insets.bottom, 14),
    android: Math.max(insets.bottom, 28),
    default: Math.max(insets.bottom, 20),
  }) as number;

  // recipe bits
  const [title, setTitle] = useState('Recipe');
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // steps
  const [steps, setSteps] = useState<Array<{ text: string; seconds: number | null }>>([]);
  const [loading, setLoading] = useState(true);

  // timer
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(DEFAULT_STEP_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // exit popup
  const [showExit, setShowExit] = useState(false);

  // voice state
  const [listening, setListening] = useState(false); // mic ON?
  const [alwaysOn, setAlwaysOn] = useState(true);    // hands-free switch
  const [heard, setHeard] = useState('');            // last transcript
  const [voiceReady, setVoiceReady] = useState(true);// device/perm OK?

  // NEW: are we currently TALKING with TTS?
  const [ttsTalking, setTtsTalking] = useState(false);

  // ===== helpers: mic control =======================================
  const requestPerms = async () => {
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      return !!perm?.granted;
    } catch {
      return false;
    }
  };

  // Stop mic hard
  const hardStopVoice = async () => {
    try {
      await ExpoSpeechRecognitionModule.stop?.();
      await ExpoSpeechRecognitionModule.abort?.();
    } catch {}
    setListening(false);
  };

  // Start mic in continuous mode
  const safeStartVoice = async () => {
    // don’t start mic while we’re currently talking
    if (ttsTalking) return;

    const granted = await requestPerms();
    if (!granted) {
      setVoiceReady(false);
      setAlwaysOn(false);
      return;
    }
    try {
      await ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: false,
        continuous: true, // stay on
        maxAlternatives: 3,
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search' },
        iosTaskHint: 'confirmation',
        addsPunctuation: false,
      });
      setVoiceReady(true);
    } catch (e) {
      console.log('Failed to start speech recognition', e);
      setVoiceReady(false);
    }
  };

  // ===== helpers: TTS that pauses mic, then resumes ==================
  const stopAllSpeech = () => {
    // stop any TTS from our wrapper and expo-speech
    try { oldStopSpeak(); } catch {}
    try { Speech.stop(); } catch {}
  };

  /**
   * Speak text out loud, keeping mic OFF during speech.
   * When TTS ends, auto-resume mic if Hands-free is ON.
   */
  const speakBlocking = (text: string) => {
    // 1) cut the mic so it doesn't hear itself
    hardStopVoice();
    // 2) mark that we're talking
    setTtsTalking(true);
    // 3) cancel any previous speech
    stopAllSpeech();
    // 4) speak with TTS callbacks so we know exactly when it ends
    Speech.speak(text, {
      // if you have a preferred voice/rate/pitch, set them here to match your old wrapper
      // voice: 'com.apple.ttsbundle.Samantha-compact', // example
      // rate: 1.0,
      // pitch: 1.0,
      onDone: () => {
        setTtsTalking(false);
        // 5) bring the mic back if hands-free is ON
        if (alwaysOn && voiceReady) {
          // tiny delay avoids rapid start/stop edge cases
          setTimeout(() => safeStartVoice(), 120);
        }
      },
      onStopped: () => {
        setTtsTalking(false);
        if (alwaysOn && voiceReady) {
          setTimeout(() => safeStartVoice(), 120);
        }
      },
      onError: () => {
        setTtsTalking(false);
        if (alwaysOn && voiceReady) {
          setTimeout(() => safeStartVoice(), 200);
        }
      },
    });
  };

  // ===== speech recognition events ==================================
  useSpeechRecognitionEvent('start', () => {
    setListening(true);
  });

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    // only auto-restart if hands-free is ON and we are NOT currently talking
    if (alwaysOn && voiceReady && !ttsTalking) {
      setTimeout(() => safeStartVoice(), 200);
    }
  });

  useSpeechRecognitionEvent('result', (event: any) => {
    const said: string = event?.results?.[0]?.transcript ?? '';
    if (!said) return;
    setHeard(said);

    if (event?.isFinal) {
      handleVoiceCommand(said);
      // NOTE: we no longer abort here; continuous mode keeps listening.
      // If the OS ends it, 'end' will auto-restart (when NOT speaking).
    }
  });

  useSpeechRecognitionEvent('error', (event: any) => {
    console.log('Speech error:', event?.error, event?.message);
    setListening(false);
    const msg = `${event?.error ?? ''} ${event?.message ?? ''}`.toLowerCase();
    if (msg.includes('not-allowed') || msg.includes('permission')) {
      setVoiceReady(false);
      setAlwaysOn(false);
      Alert.alert('Microphone blocked', 'Please allow microphone & speech in Settings.');
    } else {
      if (alwaysOn && voiceReady && !ttsTalking) {
        setTimeout(() => safeStartVoice(), 300);
      }
    }
  });

  // ===== command router =============================================
  const handleVoiceCommand = (raw: string) => {
    const t = raw.toLowerCase().trim();

    if (VOICE_PATTERNS.exit.test(t)) {
      setShowExit(true);
      return;
    }
    if (VOICE_PATTERNS.back.test(t)) {
      goBack();
      return;
    }
    if (VOICE_PATTERNS.reread.test(t)) {
      speakBlocking(steps[idx]?.text || 'No step yet.');
      return;
    }
    if (VOICE_PATTERNS.next.test(t) || VOICE_PATTERNS.done.test(t)) {
      goNext('tap');
      return;
    }

    // gentle help message, also blocking so we don't talk over ourselves
    speakBlocking('Try saying: next, back, read again, done, or exit.');
  };

  // ===== data load ===================================================
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!id) return;
        const r = await dataAPI.getRecipeById(id);
        if (!alive) return;

        setTitle(r?.title ?? 'Recipe');

        const img: any = (r as any)?.image;
        const thumb: string | null =
          img?.url ?? img ?? (r as any)?.photo ?? (r as any)?.originalImage ?? (r as any)?.cover ?? (r as any)?.hero ?? (r as any)?.thumbnail ?? null;
        setImageUrl(thumb);

        const rawSteps = (r?.steps ?? []).map((x: any) => {
          const givenSeconds = typeof x.seconds === 'number' ? x.seconds : null;
          const parsedSeconds = givenSeconds ?? parseDurationFromText(String(x.text)) ?? null;
          return { text: String(x.text), seconds: parsedSeconds };
        });

        setSteps(
          rawSteps.length
            ? rawSteps
            : [
                { text: `Get everything ready for ${r?.title ?? 'your recipe'}.`, seconds: 60 },
                { text: 'Heat the pan. Add oil and garlic. Cook 2 minutes.', seconds: 120 },
                { text: 'Add main ingredients. Cook 3 minutes.', seconds: 180 },
                { text: 'Season, plate, and enjoy! 30 seconds.', seconds: 30 },
              ]
        );
        setIdx(0);
      } catch (e) {
        console.log('Cook load error', e);
        Alert.alert('Oops', 'Could not load that recipe.');
        router.back();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      // when leaving the screen, stop both TTS and mic
      stopAllSpeech();
      hardStopVoice();
    };
  }, [id]);

  // ===== on step change: preset timer + SPEAK (with callbacks) ======
  useEffect(() => {
    if (!steps.length) return;
    const s = steps[idx];

    const parsedFromText = parseDurationFromText(s.text);
    const start =
      typeof s.seconds === 'number' && s.seconds > 0
        ? s.seconds
        : (parsedFromText ?? DEFAULT_STEP_SECONDS);

    setSeconds(start);
    setRunning(false);

    // Speak the step WITHOUT getting cut off:
    speakBlocking(s.text);
  }, [idx, steps]);

  // ===== timer ticking ==============================================
  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        const next = clamp(prev - 1, 0, 99 * 60);
        if (next === 0) {
          success();
          setRunning(false);
          setTimeout(() => goNext('timer'), 250);
        }
        return next;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  // ===== hands-free toggle ==========================================
  const toggleHandsFree = async () => {
    if (!alwaysOn) {
      setAlwaysOn(true);
      if (!ttsTalking) await safeStartVoice();
      return;
    }
    setAlwaysOn(false);
    await hardStopVoice();
  };

  // ===== tiny helpers ===============================================
  const startPause = () => setRunning((r) => !r);
  const add30 = () => setSeconds((s) => clamp(s + 30, 0, 99 * 60));
  const minus30 = () => setSeconds((s) => clamp(s - 30, 0, 99 * 60));

  const goBack = () => {
    if (idx === 0) {
      warn();
      Alert.alert('At the beginning', 'This is the first step.');
      return;
    }
    setIdx((i) => i - 1);
  };
  const goNext = (_why?: 'timer' | 'tap') => {
    if (idx >= steps.length - 1) {
      success();
      Alert.alert('All done!', 'Cook Mode complete. Bon appétit!', [{ text: 'Back to Recipe', onPress: () => router.back() }]);
      return;
    }
    setIdx((i) => i + 1);
  };

  const exitCookMode = () => setShowExit(true);
  const confirmExit = () => {
    setShowExit(false);
    router.back();
  };

  if (loading) {
    return (
      <View style={[styles.flex, styles.center, { backgroundColor: COLORS.bg }]}>
        <Text style={{ color: COLORS.text }}>Loading…</Text>
      </View>
    );
  }

  // background frame inside safe area
  const bgFrameStyle = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: insets.top,
    bottom: insets.bottom,
    overflow: 'hidden' as const,
  };

  const bottomBarHeight = 68;
  const extraGap = SAFE_BOTTOM + 20;
  const scrollBottomPadding = bottomBarHeight + extraGap;

  return (
    <View style={styles.flex}>
      {/* ===== BACKGROUND ===== */}
      <View style={bgFrameStyle} pointerEvents="none">
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={[StyleSheet.absoluteFill, { transform: [{ scale: BG_SCALE }] }]}
            contentFit="cover"
            contentPosition="center"
            transition={120}
            blurRadius={BLUR_RADIUS}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.bg }]} />
        )}

        <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(2,6,23,${SCRIM_OPACITY})` }]} />
        <LinearGradient
          colors={['transparent', 'rgba(2,6,23,0.6)', 'rgba(2,6,23,0.9)']}
          locations={[0, GRADIENT_TOP, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* ===== FOREGROUND ===== */}
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        {/* top row: hands-free status + exit */}
        <View style={{ paddingHorizontal: SPACING.lg, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={styles.hfPill}>
            <Ionicons name={listening && alwaysOn ? 'mic' : 'mic-off'} size={14} color={listening && alwaysOn ? '#22c55e' : '#eab308'} />
            <Text style={styles.hfText}>
              {alwaysOn ? (listening ? 'Hands-free: Listening' : (ttsTalking ? 'Hands-free: Speaking…' : 'Hands-free: Starting…')) : 'Hands-free: Off'}
            </Text>
          </View>

          <TouchableOpacity onPress={exitCookMode} style={styles.exitPill} accessibilityLabel="Exit Cook Mode">
            <Ionicons name="close" size={16} color={COLORS.text} />
            <Text style={styles.exitPillText}>Exit</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1, backgroundColor: 'transparent' }}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: scrollBottomPadding }}
        >
          <Text style={styles.miniLabel}>Cooking:</Text>
          <Text style={styles.title}>{title}</Text>

          {/* progress */}
          <View style={styles.progressRow}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  {
                    marginRight: i < steps.length - 1 ? 6 : 0,
                    backgroundColor: i <= idx ? COLORS.accent : 'rgba(255,255,255,0.18)',
                  },
                ]}
              />
            ))}
          </View>
          <Text style={styles.stepCount}>
            Step {idx + 1} of {steps.length}
          </Text>

          {/* step card */}
          <View style={styles.card}>
            <Text style={styles.cardText}>{steps[idx]?.text}</Text>
          </View>

          {/* BIG ROUND TIMER */}
          <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 14 }}>
            <Pressable
              onPress={startPause}
              style={[
                styles.timerCircle,
                {
                  width: TIMER_SIZE,
                  height: TIMER_SIZE,
                  borderRadius: TIMER_SIZE / 2,
                  borderColor: running ? COLORS.accent : 'rgba(255,255,255,0.15)',
                },
              ]}
            >
              <Text style={styles.timerText}>{fmtMMSS(seconds)}</Text>
              <Text style={styles.timerHint}>{running ? 'Tap to pause' : 'Tap to start'}</Text>
            </Pressable>

            {/* +/- 30s pills */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pill title="-30s" icon="remove" onPress={minus30} />
              <Pill title="+30s" icon="add" onPress={add30} />
            </View>

            {/* what we heard bubble */}
            {heard ? (
              <View style={heardStyles.wrap}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color="#cbd5e1" />
                <Text style={heardStyles.txt} numberOfLines={1}>“{heard}”</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {/* bottom bar: Back / Hands-free / Next */}
        <View
          style={[
            styles.bottomBar,
            {
              bottom: SAFE_BOTTOM + 6,
              paddingBottom: 12,
            },
          ]}
        >
          <BigButton title="Back" onPress={goBack} style={[styles.barBtn]} />

          {/* Hands-free toggle */}
          <Pressable
            onPress={toggleHandsFree}
            style={[styles.barBtn, styles.micBtn]}
            accessibilityLabel="Hands-free toggle"
          >
            <Ionicons name={alwaysOn ? (ttsTalking ? 'volume-high' : (listening ? 'mic' : 'mic-outline')) : 'mic-off'} size={18} color={COLORS.text} />
            <Text style={styles.micBtnText}>
              {alwaysOn ? (ttsTalking ? 'Speaking…' : (listening ? 'Listening' : 'Starting…')) : 'Hands-free Off'}
            </Text>
          </Pressable>

          <BigButton title="Next Step" onPress={() => goNext('tap')} style={[styles.barBtn, { backgroundColor: COLORS.accent }]} />
        </View>
      </SafeAreaView>

      {/* EXIT MODAL */}
      <Modal visible={showExit} transparent animationType="fade" onRequestClose={() => setShowExit(false)}>
        <Pressable style={modalStyles.backdrop} onPress={() => setShowExit(false)}>
          <Pressable style={modalStyles.card} onPress={() => {}}>
            <Text style={modalStyles.title}>Exit Cook Mode</Text>
            <Text style={modalStyles.body}>
              Leave now? Your timer progress will be lost.
            </Text>

            <View style={modalStyles.row}>
              <TinyButton
                title="Cancel"
                onPress={() => setShowExit(false)}
                type="ghost"
              />
              <TinyButton
                title="Exit"
                onPress={confirmExit}
                type="primary"
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// --- +/- 30s pill ---------------------------------------------------
function Pill({ title, icon, onPress }: { title: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={pillStyles.wrap} activeOpacity={0.9}>
      <Ionicons name={icon} size={16} color="#e2e8f0" />
      <Text style={pillStyles.txt}>{title}</Text>
    </TouchableOpacity>
  );
}

// --- small modal buttons --------------------------------------------
function TinyButton({
  title,
  onPress,
  type,
}: {
  title: string;
  onPress: () => void;
  type: 'primary' | 'ghost';
}) {
  const primary = type === 'primary';
  return (
    <Pressable
      onPress={onPress}
      style={[
        tinyBtnStyles.wrap,
        {
          backgroundColor: primary ? COLORS.accent : 'transparent',
          borderColor: primary ? 'transparent' : 'rgba(255,255,255,0.18)',
        },
      ]}
      android_ripple={{ color: 'rgba(255,255,255,0.08)', borderless: false }}
    >
      <Text
        style={[
          tinyBtnStyles.txt,
          { color: primary ? '#0a0f1a' : '#e2e8f0', fontWeight: '800' },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

// === heard bubble styles ============================================
const heardStyles = StyleSheet.create({
  wrap: {
    marginTop: 14,
    paddingHorizontal: 12,
    height: 28,
    borderRadius: 999,
    backgroundColor: 'rgba(2,6,23,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  txt: { color: '#cbd5e1', fontSize: 12, maxWidth: 260 },
});

// === pill styles =====================================================
const pillStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    backgroundColor: 'rgba(2,6,23,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  txt: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
});

// === tiny button styles =============================================
const tinyBtnStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txt: {
    fontSize: 14,
    letterSpacing: 0.25,
  },
});

// === main styles =====================================================
const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  miniLabel: { color: COLORS.subtext, marginBottom: 6 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 8 },

  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  progressDot: { height: 8, flex: 1, borderRadius: 999 },
  stepCount: { color: COLORS.subtext, marginBottom: 12 },

  card: {
    backgroundColor: 'rgba(15,23,42,0.42)',
    borderRadius: RADIUS.xl,
    padding: 16,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardText: { color: COLORS.text, fontSize: 18 },

  timerCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,6,23,0.45)',
    borderWidth: 2,
  },
  timerText: { color: COLORS.text, fontSize: 48, fontWeight: '900', letterSpacing: 1 },
  timerHint: { color: COLORS.subtext, marginTop: 6 },

  exitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 999,
    backgroundColor: 'rgba(2,6,23,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  exitPillText: { color: COLORS.text, fontWeight: '700' },

  hfPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 999,
    backgroundColor: 'rgba(2,6,23,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  hfText: { color: COLORS.text, fontSize: 12, fontWeight: '800' },

  bottomBar: {
    position: 'absolute',
    left: SPACING.lg,
    right: SPACING.lg,
    paddingTop: 10,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(2,6,23,0.55)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 6,
  },
  barBtn: {
    flex: 1,
    height: 48,
  },

  micBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(2,6,23,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  micBtnText: { color: COLORS.text, fontWeight: '800' },
});

// === modal styles ====================================================
const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderRadius: 20,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 8,
  },
  body: {
    color: COLORS.subtext,
    fontSize: 15,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
});
