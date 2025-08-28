// /app/(tabs)/profile.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { COLORS } from '../../lib/theme';
export default function Profile() {
  return <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems:'center', justifyContent:'center' }}>
    <Text style={{ color: 'white' }}>Profile — stats, badges, payouts coming</Text>
  </View>;
}
