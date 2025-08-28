// PURPOSE: shows a tiny badge next to a creator (their "cheese-knife" level).
import React from 'react';
import { View, Text } from 'react-native';
import { COLORS } from '../../lib/theme';

export default function Badge({ knives }: { knives: number }) {
  // LEVEL RULES (simple for now):
  // 0-4 = none, 5-9 = one knife, 10-14 = two, 15+ = three
  const level = knives >= 15 ? 3 : knives >= 10 ? 2 : knives >= 5 ? 1 : 0;
  if (level === 0) return null;

  const knivesArr = Array.from({ length: level });

  return (
    <View style={{ flexDirection: 'row', marginLeft: 6 }}>
      {knivesArr.map((_, i) => (
        <Text key={i} style={{ color: COLORS.accent, fontSize: 12, marginRight: 2 }}>🔪</Text>
      ))}
    </View>
  );
}
