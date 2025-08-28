// PURPOSE: simple row-shaped button for "Add Ingredient", "Add Step" etc.
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import { tap } from '../../lib/haptics';

export default function RowButton({ title, onPress }: { title: string; onPress?: () => void }) {
  return (
    <TouchableOpacity
      onPress={async () => { await tap(); onPress?.(); }}
      style={{
        backgroundColor: COLORS.card,
        paddingVertical: 12,
        borderRadius: RADIUS.lg,
        alignItems: 'center',
        marginBottom: SPACING.md
      }}
    >
      <Text style={{ color: COLORS.accent, fontWeight: '800' }}>{title}</Text>
    </TouchableOpacity>
  );
}
