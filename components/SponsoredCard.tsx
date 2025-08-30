// /components/SponsoredCard.tsx
import React from 'react';
import { Image, Linking, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, RADIUS } from '../lib/theme';
import { logAdEvent } from '../lib/ads';

export type SponsoredCardModel = {
  slotId: string;
  creativeId: string;
  brand: string;
  title: string;
  image_url: string;
  cta: string | null;
  cta_url: string | null;
};

export default function SponsoredCard({ m }: { m: SponsoredCardModel }) {
  const onPress = async () => {
    await logAdEvent(m.slotId, 'click', { where: 'home_feed' }, m.creativeId);
    if (m.cta_url) { try { await Linking.openURL(m.cta_url); } catch {} }
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}
      style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: 12 }}>
      {m.image_url ? <Image source={{ uri: m.image_url }} style={{ width: '100%', height: 160 }} /> : null}
      <View style={{ padding: 12 }}>
        <Text style={{ color: COLORS.subtext, fontWeight: '800', marginBottom: 4 }}>{m.brand}</Text>
        <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: '900', marginBottom: 8 }}>{m.title}</Text>
        <View style={{ alignSelf: 'flex-start', backgroundColor: COLORS.accent, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 }}>
          <Text style={{ color: '#001018', fontWeight: '900' }}>{m.cta || 'Learn more'}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
