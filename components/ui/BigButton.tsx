// PURPOSE: an easy-to-tap, big rounded button with a buzz on press.
import React from 'react';
import { Text, TouchableOpacity, ViewStyle } from 'react-native';
import { COLORS, RADIUS } from '../../lib/theme';
import { tap } from '../../lib/haptics';

type Props = {
  title: string;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  dim?: boolean; // if true, make text subtle (like "Pause")
};

export default function BigButton({ title, onPress, style, dim }: Props) {
  return (
    <TouchableOpacity
      onPress={async () => { await tap(); onPress?.(); }}
      activeOpacity={0.9}
      style={[
        {
          backgroundColor: COLORS.card,
          paddingVertical: 16,
          borderRadius: RADIUS.xl,
          alignItems: 'center'
        },
        style
      ]}
    >
      <Text style={{ color: dim ? '#cbd5e1' : COLORS.text, fontWeight: '900', fontSize: 16 }}>
        {title}
      </Text>
    </TouchableOpacity>
  );
}
