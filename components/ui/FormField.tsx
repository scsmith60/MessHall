// PURPOSE: labeled input so our form looks tidy everywhere.
import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../lib/theme';

type Props = {
  label: string;
  value?: string;
  placeholder?: string;
  onChangeText?: (t: string) => void;
  keyboardType?: 'default' | 'numeric';
  multiline?: boolean;
};

export default function FormField(props: Props) {
  return (
    <View style={{ marginBottom: SPACING.lg }}>
      <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>{props.label}</Text>
      <TextInput
        value={props.value}
        placeholder={props.placeholder}
        placeholderTextColor={COLORS.subtext}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType}
        multiline={props.multiline}
        style={{
          backgroundColor: COLORS.card,
          color: COLORS.text,
          borderRadius: RADIUS.lg,
          paddingHorizontal: 14,
          paddingVertical: props.multiline ? 12 : 10
        }}
      />
    </View>
  );
}
