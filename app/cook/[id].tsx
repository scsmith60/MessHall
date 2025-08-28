// COOK MODE (like I'm 5):
// - Big text shows the current step.
// - You can Start/Pause a countdown timer for that step.
// - Tap "Next Step" or "Back" to move around.
// - Phone won't go to sleep while you're here.
// - A friendly voice reads the step out loud when you arrive.
// - When the timer ends, it buzzes and auto-advances (you can change this).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import BigButton from '../../components/ui/BigButton';
import { recipeStore } from '../../lib/store';
import { fmtMMSS, clamp } from '../../lib/timer';
import { speak, stopSpeak } from '../../lib/speak';
import { success, warn } from '../../lib/haptics';

// SIMPLE: We don't have real step durations yet, so we'll use a gentle default.
// You can tap +30s to add time as you need. Later, we’ll read per-step times from DB.
const DEFAULT_STEP_SECONDS = 60;

// We’ll reuse the same "fake steps" idea as the detail screen for now.
function fakeStepsFor(title: string) {
  return [
    `Get everything ready for ${title}.`,
    'Heat the pan. Add oil and garlic. Stir for a bit.',
    'Add the main ingredients. Cook until done.',
    'Season, plate, and enjoy!'
  ];
}

export default function CookMode() {
  useKeepAwake(); // <- keeps the screen awake while cooking

  // 1) which recipe are we cooking?
  const { id } = useLocalSearchParams<{ id: string }>();
  const recipe = useMemo(() => (id ? recipeStore.get(id) : undefined), [id]);

  // 2) local state for steps + where we are
  const steps = useMemo(() => (recipe ? fakeStepsFor(recipe.title) : []), [recipe]);
  const [idx, setIdx] = useState(0);

  // 3) timer state
  const [seconds, setSeconds] = useState(DEFAULT_STEP_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<NodeJS.Timer | null>(null);

  // If no recipe, be nice.
  if (!recipe) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg }}>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', textAlign: 'center' }}>
          Oops, that recipe went missing.
        </Text>
        <BigButton title="Go Back" onPress={() => router.back()} style={{ marginTop: 16 }} />
      </View>
    );
  }

  // Speak the step when we land or change steps.
  useEffect(() => {
    const txt = steps[idx] ?? '';
    if (txt) speak(txt);
    // reset timer each step (you can change this to carry over if you want)
    setSeconds(DEFAULT_STEP_SECONDS);
    setRunning(false);
    return () => stopSpeak();
  }, [idx]);

  // Tick-tock timer
  useEffect(() => {
    if (!running) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        const next = clamp(prev - 1, 0, 99 * 60);
        if (next === 0) {
          // time's up! buzz + auto-advance
          success();
          setRunning(false);
          setTimeout(() => goNext('timer'), 250);
        }
        return next;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

  // controls
  const startPause = () => setRunning(r => !r);
  const add30 = () => setSeconds(s => clamp(s + 30, 0, 99 * 60));
  const minus30 = () => setSeconds(s => clamp(s - 30, 0, 99 * 60));

  const goBack = () => {
    if (idx === 0) {
      warn();
      Alert.alert('At the Beginning', 'This is the first step.');
      return;
    }
    setIdx(i => i - 1);
  };
  const goNext = (reason?: 'timer' | 'tap') => {
    if (idx >= steps.length - 1) {
      // finished
      success();
      Alert.alert('All Done!', 'Cook Mode complete. Bon appétit!', [
        { text: 'Back to Recipe', onPress: () => router.back() }
      ]);
      return;
    }
    setIdx(i => i + 1);
  };

  // UI layout
  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 32 }}>
      {/* TITLE */}
      <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>
        Cooking:
      </Text>
      <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 10 }}>
        {recipe.title}
      </Text>

      {/* STEP PROGRESS */}
      <View style={{ flexDirection: 'row', marginBottom: 8, alignItems: 'center' }}>
        {/* simple little dots to show progress */}
        {steps.map((_, i) => (
          <View
            key={i}
            style={{
              height: 8,
              flex: 1,
              marginRight: i < steps.length - 1 ? 6 : 0,
              borderRadius: 999,
              backgroundColor: i <= idx ? COLORS.accent : '#1f2937'
            }}
          />
        ))}
      </View>
      <Text style={{ color: COLORS.subtext, marginBottom: 16 }}>
        Step {idx + 1} of {steps.length}
      </Text>

      {/* BIG STEP TEXT */}
      <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.xl, padding: 16, marginBottom: 16 }}>
        <Text style={{ color: COLORS.text, fontSize: 18 }}>
          {steps[idx]}
        </Text>
      </View>

      {/* TIMER DISPLAY */}
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ color: COLORS.text, fontSize: 48, fontWeight: '900', letterSpacing: 2 }}>
          {fmtMMSS(seconds)}
        </Text>
        <Text style={{ color: COLORS.subtext, marginTop: 6 }}>
          Tap Start to begin countdown
        </Text>
      </View>

      {/* TIMER CONTROLS */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <BigButton title={running ? 'Pause' : 'Start'} onPress={startPause} style={{ flex: 1, backgroundColor: running ? '#1f2937' : COLORS.accent }} />
        <BigButton title="+30s" onPress={add30} style={{ width: 100 }} />
        <BigButton title="-30s" onPress={minus30} style={{ width: 100 }} />
      </View>

      {/* NAV CONTROLS */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <BigButton title="Back" onPress={goBack} style={{ flex: 1 }} />
        <BigButton title="Next Step" onPress={() => goNext('tap')} style={{ flex: 1, backgroundColor: COLORS.accent }} />
      </View>

      {/* FRIENDLY TIP */}
      <Text style={{ color: COLORS.subtext, textAlign: 'center', marginTop: 20 }}>
        Tip: We’ll add voice commands (“Next”, “Repeat”) in a later step.
      </Text>
    </ScrollView>
  );
}
