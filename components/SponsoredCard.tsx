// PURPOSE: ad card that looks friendly. We'll wire real ad data later.
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import HapticButton from './ui/HapticButton';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { success } from '../lib/haptics';

type Props = { brand: string; title: string; image: string; cta: string; onPress?: () => void };

export default function SponsoredCard({ brand, title, image, cta, onPress }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.sponsored}>Sponsored by {brand}</Text>
      <View style={styles.card}>
        <Image source={{ uri: image }} style={styles.img} resizeMode="cover" />
        <View style={{ padding: SPACING.md }}>
          <Text style={styles.title}>{title}</Text>
          <HapticButton
            onPress={() => { success(); onPress?.(); }}
            style={styles.ctaBtn}
          >
            <Text style={styles.ctaText}>{cta}</Text>
          </HapticButton>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: SPACING.lg },
  sponsored: { color: COLORS.subtext, fontSize: 12, marginBottom: 6 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    overflow: 'hidden'
  },
  img: { width: '100%', height: 180 },
  title: { color: COLORS.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  ctaBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 10,
    borderRadius: RADIUS.lg,
    alignItems: 'center'
  },
  ctaText: { color: '#001018', fontSize: 14, fontWeight: '800' }
});
