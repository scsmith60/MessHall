// components/Header.tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeController } from '../lib/theme';
import { useNavigation } from '@react-navigation/native';

type Props = {
  title: string;
  showBack?: boolean;
  rightLabel?: string;
  onRightPress?: () => void;
};

export default function Header({ title, showBack, rightLabel, onRightPress }: Props) {
  const { isDark } = useThemeController();
  const nav = useNavigation();

  return (
    <View style={[styles.wrap, { backgroundColor: isDark ? '#0B0F19' : '#FFFFFF' }]}>
      <View style={styles.side}>
        {showBack ? (
          <Pressable onPress={() => nav.goBack()} style={styles.btn}>
            <Text style={[styles.btnText, { color: isDark ? '#E5E7EB' : '#111827' }]}>‹ Back</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={[styles.title, { color: isDark ? '#E5E7EB' : '#111827' }]} numberOfLines={1}>
        {title}
      </Text>

      <View style={[styles.side, { alignItems: 'flex-end' }]}>
        {rightLabel ? (
          <Pressable onPress={onRightPress} style={styles.btn}>
            <Text style={[styles.btnText, { color: isDark ? '#93C5FD' : '#1D4ED8' }]}>{rightLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 52 },
  side: { width: 90 },
  btn: { padding: 8 },
  btnText: { fontWeight: '700' },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800' },
});
