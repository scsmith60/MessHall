// /app/(tabs)/planner.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { COLORS } from '../../lib/theme';
export default function Planner() {
  return <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems:'center', justifyContent:'center' }}>
    <Text style={{ color: 'white' }}>Weekly Planner — coming right up</Text>
  </View>;
}
