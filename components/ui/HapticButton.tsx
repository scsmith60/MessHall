// /components/ui/HapticButton.tsx
// PURPOSE: Wraps any touchable so it buzzes and prevents double taps.
import React, { PropsWithChildren, useRef } from 'react';
import { TouchableOpacity, ViewStyle } from 'react-native';
import { tap } from '../../lib/haptics';

type Props = PropsWithChildren<{
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  disabled?: boolean;
}>;

export default function HapticButton({ onPress, style, disabled, children }: Props) {
  const busy = useRef(false);

  const handlePress = async () => {
    if (busy.current || disabled) return;
    busy.current = true;      // stop double-taps
    await tap();              // tiny tick
    try { onPress?.(); } finally {
      setTimeout(() => (busy.current = false), 250); // re-enable
    }
  };

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={handlePress} style={style} disabled={disabled}>
      {children}
    </TouchableOpacity>
  );
}
