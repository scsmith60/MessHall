// components/EmptyState.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeController } from '../lib/theme';

type Props = {
  title: string;
  message?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
};

export default function EmptyState({ title, message, ctaLabel, onCtaPress }: Props) {
  const { isDark } = useThemeController();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: isDark ? '#E5E7EB' : '#111827' }]}>{title}</Text>
      {!!message && <Text style={[styles.msg, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>{message}</Text>}
      {!!ctaLabel && (
        <Pressable style={styles.btn} onPress={onCtaPress}>
          <Text style={styles.btnText}>{ctaLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 16 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
  msg: { textAlign: 'center', fontSize: 14 },
  btn: { marginTop: 12, backgroundColor: '#4F46E5', borderRadius: 9999, paddingHorizontal: 16, paddingVertical: 10 },
  btnText: { color: '#FFFFFF', fontWeight: '700' },
});
