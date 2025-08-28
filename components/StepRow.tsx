// PURPOSE: one cooking step with delete.
import React from 'react';
import { TextInput, View, TouchableOpacity, Text } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { warn } from '../lib/haptics';

type Props = {
  value: string;
  onChange: (t: string) => void;
  onRemove: () => void;
  index: number;
};

export default function StepRow({ value, onChange, onRemove, index }: Props) {
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Step {index + 1}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Describe this step..."
          placeholderTextColor={COLORS.subtext}
          multiline
          style={{
            flex: 1,
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderRadius: RADIUS.lg,
            paddingHorizontal: 14,
            paddingVertical: 10,
            marginRight: 8,
            minHeight: 60
          }}
        />
        <TouchableOpacity
          onPress={async () => { await warn(); onRemove(); }}
          style={{ padding: 8, backgroundColor: '#7f1d1d', borderRadius: RADIUS.md, height: 60, justifyContent: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '800' }}>Del</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
