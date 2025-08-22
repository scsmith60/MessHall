// components/PillButton.tsx
import React from 'react';
import { Pressable, Text, ViewStyle, TextStyle } from 'react-native';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
};

export default function PillButton({
  label,
  onPress,
  variant = 'primary',
  style,
  textStyle,
  disabled,
}: Props) {
  const base: ViewStyle = {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  };

  const variants: Record<string, { btn: ViewStyle; txt: TextStyle }> = {
    primary: { btn: { backgroundColor: '#111', borderColor: '#111' }, txt: { color: '#fff', fontWeight: '600' } },
    secondary: { btn: { backgroundColor: '#fff', borderColor: '#111' }, txt: { color: '#111', fontWeight: '600' } },
    danger: { btn: { backgroundColor: '#fff', borderColor: '#b00020' }, txt: { color: '#b00020', fontWeight: '600' } },
    ghost: { btn: { backgroundColor: 'transparent', borderColor: '#ddd' }, txt: { color: '#111', fontWeight: '600' } },
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[base, variants[variant].btn, disabled && { opacity: 0.5 }, style]}
      hitSlop={8}
    >
      <Text style={[variants[variant].txt, textStyle]}>{label}</Text>
    </Pressable>
  );
}
