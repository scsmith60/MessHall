// PURPOSE: one ingredient line with delete.
import React from 'react';
import { TextInput, View, TouchableOpacity, Text } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { warn } from '../lib/haptics';

type Props = {
  value: string;
  onChange: (t: string) => void;
  onRemove: () => void;
};

export default function IngredientRow({ value, onChange, onRemove }: Props) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="e.g., 2 cups flour"
        placeholderTextColor={COLORS.subtext}
        style={{
          flex: 1,
          backgroundColor: COLORS.card,
          color: COLORS.text,
          borderRadius: RADIUS.lg,
          paddingHorizontal: 14,
          paddingVertical: 10,
          marginRight: 8
        }}
      />
      <TouchableOpacity
        onPress={async () => { await warn(); onRemove(); }}
        style={{ padding: 8, backgroundColor: '#7f1d1d', borderRadius: RADIUS.md }}
      >
        <Text style={{ color: 'white', fontWeight: '800' }}>Del</Text>
      </TouchableOpacity>
    </View>
  );
}
