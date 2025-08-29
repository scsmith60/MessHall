// /components/StepRow.tsx
// 🧸 ELI5: One step box with a tiny timer.
// - You type the instruction text.
// - You can add time with +30s/-30s or type minutes:seconds.
// - We send the number (seconds) back up.

import React, { useMemo } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../lib/theme';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmtMMSS(total: number | undefined | null) {
  const s = !total ? 0 : Math.max(0, total);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function parseMMSS(v: string) {
  // accepts "90", "01:30", "1:30"
  if (!v) return 0;
  if (v.includes(':')) {
    const [m, s] = v.split(':');
    const mm = parseInt(m || '0', 10) || 0;
    const ss = parseInt(s || '0', 10) || 0;
    return clamp(mm * 60 + ss, 0, 99 * 60);
  }
  const asInt = parseInt(v, 10);
  if (!Number.isFinite(asInt)) return 0;
  return clamp(asInt, 0, 99 * 60);
}

export default function StepRow({
  index,
  value,
  seconds,
  onChange,
  onChangeSeconds,
  onRemove
}: {
  index: number;
  value: string;
  seconds?: number | null;
  onChange: (next: string) => void;
  onChangeSeconds: (next: number) => void;
  onRemove: () => void;
}) {
  const timeText = useMemo(() => fmtMMSS(seconds ?? 0), [seconds]);

  const add = (delta: number) => onChangeSeconds(clamp((seconds ?? 0) + delta, 0, 99 * 60));

  return (
    <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: 12, marginBottom: 10 }}>
      {/* top row: index + delete */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ color: COLORS.accent, fontWeight: '900', marginRight: 8 }}>{index + 1}.</Text>
        <View style={{ flex: 1 }} />
        <Text onPress={onRemove} style={{ color: '#ffb4b4', fontWeight: '900' }}>Remove</Text>
      </View>

      {/* instruction text */}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Type what to do in this step…"
        placeholderTextColor={COLORS.subtext}
        multiline
        style={{ color: COLORS.text }}
      />

      {/* timer bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <Text style={{ color: COLORS.subtext }}>Timer</Text>
        <TouchableOpacity onPress={() => add(-30)} style={{ backgroundColor: '#1f2937', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.lg }}>
          <Text style={{ color: COLORS.text, fontWeight: '800' }}>-30s</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => add(+30)} style={{ backgroundColor: '#1f2937', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.lg }}>
          <Text style={{ color: COLORS.text, fontWeight: '800' }}>+30s</Text>
        </TouchableOpacity>

        {/* editable MM:SS box */}
        <TextInput
          value={timeText}
          onChangeText={(t) => onChangeSeconds(parseMMSS(t))}
          placeholder="00:00"
          placeholderTextColor={COLORS.subtext}
          style={{
            marginLeft: 'auto',
            backgroundColor: '#0f172a',
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 10,
            paddingVertical: 6,
            minWidth: 80,
            textAlign: 'center',
            letterSpacing: 1
          }}
        />
      </View>
    </View>
  );
}
