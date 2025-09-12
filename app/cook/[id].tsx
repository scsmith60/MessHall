// /app/cook/[id].tsx
// COOK MODE (v7)
// like I'm 5:
// - We made our own pretty "Exit?" popup that matches our dark theme.
// - We also push the bottom buttons up a little more so they never get cut off.
// - Timer still auto-reads time from the step text ("10–12 minutes" -> 12:00).

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  Text,
  View,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  Modal,              // 👈 we use this to build our themed popup
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
import { speak, stopSpeak } from '../../lib/speak';
import { success, warn } from '../../lib/haptics';
import { dataAPI } from '../../lib/data';

// ==== knobs you can tweak ==============================================
const BG_SCALE = 1.12;        // how much we zoom the wallpaper image
const BLUR_RADIUS = 3;        // tiny blur keeps it classy, not mushy
const SCRIM_OPACITY = 0.40;   // dark sheet on photo so words pop
const GRADIENT_TOP = 0.55;    // bottom gets darker near buttons
const TIMER_SIZE = 220;       // big round clock size
// =======================================================================

const DEFAULT_STEP_SECONDS = 60;

export default function CookMode() {
  useKeepAwake(); // keep screen on while cooking

  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  // 👇 give Android a bigger lift because gesture bars often report 0 inset
  const SAFE_BOTTOM = Platform.select({
    ios: Math.max(insets.bottom, 14),
    android: Math.max(insets.bottom, 28), // <- extra cushion on Android
    default: Math.max(insets.bottom, 20),
  }) as number;

  // recipe bits
  const [title, setTitle] = useState('Recipe');
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // steps as { text, seconds }
  const [steps, setSteps] = useState<Array<{ text: string; seconds: number | null }>>([]);
  const [loading, setLoading] = useState(true);

  // timer bits
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(DEFAULT_STEP_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<NodeJS.Timer | null>(null);

  // THEMED EXIT MODAL state
  const [showExit, setShowExit] = useState(false);

  // 1) load recipe
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!id) return;
        const r = await dataAPI.getRecipeById(id);
        if (!alive) return;

        setTitle(r?.title ?? 'Recipe');

        // pick the best image we can find
        const thumb: string | null =
          r?.image?.url ?? r?.image ?? r?.photo ?? r?.originalImage ?? r?.cover ?? r?.hero ?? r?.thumbnail ?? null;
        setImageUrl(thumb);

        // Build steps. If API doesn't give "seconds", we auto-parse from the text.
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
    };
  }, [id]);

  // 2) when step changes, preset timer + speak the step
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
    stopSpeak();
    speak(s.text);
    return () => stopSpeak();
  }, [idx, steps]);

  // 3) ticking
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

  // helpers
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

  // open our themed modal (instead of default white Alert)
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

  // BACKGROUND stays inside safe area frame (no notch overlap)
  const bgFrameStyle = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: insets.top,
    bottom: insets.bottom,
    overflow: 'hidden' as const,
  };

  // ==== reserve room so ScrollView content isn't covered by the bar ====
  const bottomBarHeight = 68;                 // visual height of the bar area
  const extraGap = SAFE_BOTTOM + 20;          // more space so buttons breathe
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
        {/* Top row with tiny Exit button */}
        <View style={{ paddingHorizontal: SPACING.lg, paddingBottom: 6, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TouchableOpacity onPress={exitCookMode} style={styles.exitPill} accessibilityLabel="Exit Cook Mode">
            <Ionicons name="close" size={16} color={COLORS.text} />
            <Text style={styles.exitPillText}>Exit</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1, backgroundColor: 'transparent' }}
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: scrollBottomPadding }}
        >
          {/* Header: label + title */}
          <Text style={styles.miniLabel}>Cooking:</Text>
          <Text style={styles.title}>{title}</Text>

          {/* Progress dots */}
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

          {/* Step card */}
          <View style={styles.card}>
            <Text style={styles.cardText}>{steps[idx]?.text}</Text>
          </View>

          {/* ==== BIG ROUND TIMER (tap to start/pause) ==== */}
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

            {/* Small pill chips for time nudge */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Pill title="-30s" icon="remove" onPress={minus30} />
              <Pill title="+30s" icon="add" onPress={add30} />
            </View>
          </View>
        </ScrollView>

        {/* Floating bottom bar: Back / Next only */}
        <View
          style={[
            styles.bottomBar,
            {
              bottom: SAFE_BOTTOM + 6, // 👈 lift above gesture area more
              paddingBottom: 12,       // comfy inner padding
            },
          ]}
        >
          <BigButton title="Back" onPress={goBack} style={[styles.barBtn]} />
          <BigButton title="Next Step" onPress={() => goNext('tap')} style={[styles.barBtn, { backgroundColor: COLORS.accent }]} />
        </View>
      </SafeAreaView>

      {/* ===================== THEMED EXIT MODAL ====================== */}
      <Modal visible={showExit} transparent animationType="fade" onRequestClose={() => setShowExit(false)}>
        {/* dark blurry-ish backdrop you can tap to cancel */}
        <Pressable style={modalStyles.backdrop} onPress={() => setShowExit(false)}>
          {/* stop touches from falling through to the backdrop when tapping card */}
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
      {/* ============================================================== */}
    </View>
  );
}

// --- tiny pill component for +/-30s ---------------------------------
function Pill({ title, icon, onPress }: { title: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={pillStyles.wrap} activeOpacity={0.9}>
      <Ionicons name={icon} size={16} color="#e2e8f0" />
      <Text style={pillStyles.txt}>{title}</Text>
    </TouchableOpacity>
  );
}

// --- small modal buttons (themed) -----------------------------------
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

const tinyBtnStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  txt: {
    fontSize: 16,
    letterSpacing: 0.3,
  },
});

const pillStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 999,
    backgroundColor: 'rgba(2,6,23,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  txt: { color: '#e2e8f0', fontWeight: '600' },
});

// --- styles ---------------------------------------------------------
const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },

  miniLabel: { color: COLORS.subtext, marginBottom: 6 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 12 },

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

  // big round timer look
  timerCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,6,23,0.45)',
    borderWidth: 2,
  },
  timerText: { color: COLORS.text, fontSize: 48, fontWeight: '900', letterSpacing: 1 },
  timerHint: { color: COLORS.subtext, marginTop: 6 },

  // small Exit pill up top
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

  // floating bottom bar with two tidy buttons
  bottomBar: {
    position: 'absolute',
    left: SPACING.lg,
    right: SPACING.lg,
    // bottom: set dynamically above
    paddingTop: 10,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(2,6,23,0.55)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    // subtle shadow
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
});

// --- themed modal styles --------------------------------------------
const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.6)', // dark see-through sheet
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 500,
    backgroundColor: 'rgba(15,23,42,0.92)',    // deep slate
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
