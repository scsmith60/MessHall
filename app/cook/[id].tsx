// /app/cook/[id].tsx
// COOK MODE with per-step timers + Exit button
// - Loads steps from DB (via dataAPI) and uses each step's 'seconds'.
// - If a step has no time, defaults to 60s.
// - You can still +30s/-30s and Pause/Start.
// - Auto-advance when a timer hits 0.
// - NEW: Exit button to leave Cook Mode anytime.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import BigButton from '../../components/ui/BigButton';
import { fmtMMSS, clamp } from '../../lib/timer';
import { speak, stopSpeak } from '../../lib/speak';
import { success, warn } from '../../lib/haptics';
import { dataAPI } from '../../lib/data';

const DEFAULT_STEP_SECONDS = 60;

export default function CookMode() {
  useKeepAwake();

  const { id } = useLocalSearchParams<{ id: string }>();

  // Load the recipe with steps (including seconds)
  const [title, setTitle] = useState<string>('');
  const [steps, setSteps] = useState<Array<{ text: string; seconds: number | null }>>([]);
  const [loading, setLoading] = useState(true);

  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(DEFAULT_STEP_SECONDS);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<NodeJS.Timer | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!id) return;
        const r = await dataAPI.getRecipeById(id);
        if (!alive) return;
        if (!r) throw new Error('Missing recipe');
        setTitle(r.title);
        const s = (r.steps ?? []).map((x: any) => ({ text: x.text, seconds: typeof x.seconds === 'number' ? x.seconds : null }));
        setSteps(s.length ? s : [
          { text: `Get everything ready for ${r.title}.`, seconds: 60 },
          { text: 'Heat the pan. Add oil and garlic.', seconds: 120 },
          { text: 'Add the main ingredients. Cook until done.', seconds: 180 },
          { text: 'Season, plate, and enjoy!', seconds: 30 }
        ]);
        setIdx(0);
      } catch (e) {
        console.log('Cook load error', e);
        Alert.alert('Oops', 'Could not load that recipe.');
        router.back();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // When we land on a step, load its time and speak it
  useEffect(() => {
    if (!steps.length) return;
    const s = steps[idx];
    const start = typeof s.seconds === 'number' && s.seconds > 0 ? s.seconds : DEFAULT_STEP_SECONDS;
    setSeconds(start);
    setRunning(false);
    stopSpeak();
    speak(s.text);
    return () => stopSpeak();
  }, [idx, steps]);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    intervalRef.current = setInterval(() => {
      setSeconds(prev => {
        const next = clamp(prev - 1, 0, 99 * 60);
        if (next === 0) {
          success();
          setRunning(false);
          setTimeout(() => goNext('timer'), 250);
        }
        return next;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running]);

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
  const goNext = (_reason?: 'timer' | 'tap') => {
    if (idx >= steps.length - 1) {
      success();
      Alert.alert('All Done!', 'Cook Mode complete. Bon appétit!', [
        { text: 'Back to Recipe', onPress: () => router.back() }
      ]);
      return;
    }
    setIdx(i => i + 1);
  };

  // NEW: Exit cook mode anytime
  const exitCookMode = () => {
    Alert.alert(
      'Exit Cook Mode',
      'Are you sure you want to leave? Your timer progress will be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => router.back() },
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: COLORS.text }}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 32 }}>
      {/* TITLE */}
      <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Cooking:</Text>
      <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 10 }}>{title}</Text>

      {/* PROGRESS */}
      <View style={{ flexDirection: 'row', marginBottom: 8, alignItems: 'center' }}>
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

      {/* STEP TEXT */}
      <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.xl, padding: 16, marginBottom: 16 }}>
        <Text style={{ color: COLORS.text, fontSize: 18 }}>
          {steps[idx]?.text}
        </Text>
      </View>

      {/* TIMER DISPLAY */}
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ color: COLORS.text, fontSize: 48, fontWeight: '900', letterSpacing: 2 }}>
          {fmtMMSS(seconds)}
        </Text>
        <Text style={{ color: COLORS.subtext, marginTop: 6 }}>
          {running ? 'Timer running…' : 'Tap Start to begin countdown'}
        </Text>
      </View>

      {/* TIMER CONTROLS */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <BigButton title={running ? 'Pause' : 'Start'} onPress={startPause} style={{ flex: 1, backgroundColor: running ? '#1f2937' : COLORS.accent }} />
        <BigButton title="+30s" onPress={add30} style={{ width: 100 }} />
        <BigButton title="-30s" onPress={minus30} style={{ width: 100 }} />
      </View>

      {/* NAV CONTROLS */}
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <BigButton title="Back" onPress={goBack} style={{ flex: 1 }} />
        <BigButton title="Next Step" onPress={() => goNext('tap')} style={{ flex: 1, backgroundColor: COLORS.accent }} />
      </View>

      {/* EXIT BUTTON */}
      <BigButton title="Exit Cook Mode" onPress={exitCookMode} style={{ marginTop: 20, backgroundColor: '#b91c1c' }} />
    </ScrollView>
  );
}
