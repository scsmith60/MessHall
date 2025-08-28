// PURPOSE: little rounded "chips" to show numbers like 12.3k cooked, 842 likes.
import React from 'react';
import { Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';

export default function StatPill({ label }: { label: string }) {
  return (
    <View style={{
      backgroundColor: COLORS.card,
      borderRadius: RADIUS.lg,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginRight: SPACING.sm
    }}>
      <Text style={{ color: COLORS.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </View>
  );
}
