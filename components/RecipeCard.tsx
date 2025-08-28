// PURPOSE: one recipe in the feed with image, creator line, cooks, time ago.
// BEHAVIOR: swipe Save/Share (from SwipeCard), tap = open, long-press = haptic menu.

import React from 'react';
import { Alert, Image, Linking, Share, StyleSheet, Text, View } from 'react-native';
import SwipeCard from './ui/SwipeCard';
import HapticButton from './ui/HapticButton';
import Badge from './ui/Badge';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { compactNumber, timeAgo } from '../lib/utils';
import { tap, success, warn } from '../lib/haptics';

type Props = {
  id: string;
  title: string;
  image: string;
  creator: string;
  knives: number;
  cooks: number;
  createdAt: number;
  onOpen?: (id: string) => void;
  onSave?: (id: string) => void;
};

export default function RecipeCard(props: Props) {
  const { id, title, image, creator, knives, cooks, createdAt, onOpen, onSave } = props;

  // fake deep link (later from database)
  const deepLink = `messhall://recipe/${id}`;

  const save = () => { success(); onSave?.(id); };
  const share = async () => {
    success();
    await Share.share({ message: `${title} on MessHall — ${deepLink}` });
  };

  const longPressMenu = async () => {
    await tap(); // gentle buzz before options
    Alert.alert(
      'Recipe',
      'What would you like to do?',
      [
        { text: 'Copy Link', onPress: () => Share.share({ message: deepLink }) },
        { text: 'Report', style: 'destructive', onPress: () => warn() },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  return (
    <SwipeCard title={title} onSave={save} onShare={share}>
      <HapticButton onPress={() => onOpen?.(id)} style={{ borderRadius: RADIUS.xl }} >
        <View onLongPress={longPressMenu}>
          {/* IMAGE — use 16:9-ish so it looks crisp; recommended: 1200x675 */}
          <Image source={{ uri: image }} style={styles.img} resizeMode="cover" />
          {/* META LINE */}
          <View style={styles.row}>
            <Text style={styles.creator}>{creator}</Text>
            <Badge knives={knives} />
            <View style={{ flex: 1 }} />
            <Text style={styles.dim}>{timeAgo(createdAt)}</Text>
          </View>
          {/* STATS */}
          <View style={styles.row}>
            <Text style={styles.stat}>{compactNumber(cooks)} cooked</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.link} onPress={() => Linking.openURL(deepLink)}>Open</Text>
          </View>
        </View>
      </HapticButton>
    </SwipeCard>
  );
}

const styles = StyleSheet.create({
  img: { width: '100%', height: 220, borderRadius: 16, marginTop: 8, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  creator: { color: COLORS.text, fontWeight: '700', fontSize: 14 },
  dim: { color: COLORS.subtext, fontSize: 12 },
  stat: { color: COLORS.subtext, fontSize: 13 },
  link: { color: COLORS.accent, fontSize: 13, fontWeight: '800' }
});
