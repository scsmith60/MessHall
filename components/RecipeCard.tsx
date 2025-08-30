// PURPOSE: one recipe in the feed with image, creator line, cooks, time ago.
// BEHAVIOR: swipe Save/Share (from SwipeCard), tap = open, long-press = haptic menu.
// STEP 5b ADDED:
// - Two tiny action buttons on the card: "♡ Like" and "I Cooked (+3 🔪)"
// - Optimistic UI updates so it feels instant
// - Calls dataAPI.toggleLike() and dataAPI.markCooked() to persist
// - Updates local cooks and knives values so Badge + "cooked" text change right away

import React, { useMemo, useState } from 'react';
import { Alert, Image, Linking, Share, StyleSheet, Text, View } from 'react-native';
import SwipeCard from './ui/SwipeCard';
import HapticButton from './ui/HapticButton';
import Badge from './ui/Badge';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { compactNumber, timeAgo } from '../lib/utils';
import { tap, success, warn } from '../lib/haptics';
import { dataAPI } from '../lib/data'; // STEP 5b: we call server here

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

  // (optional) let parent know about quick actions if they care
  onLikedChange?: (id: string, liked: boolean) => void;
  onCooked?: (id: string) => void;
};

export default function RecipeCard(props: Props) {
  const { id, title, image, creator, createdAt, onOpen, onSave, onLikedChange, onCooked } = props;

  // STEP 5b: local numbers we show on the card (so it feels instant)
  const [knives, setKnives] = useState<number>(props.knives ?? 0);
  const [cooks, setCooks] = useState<number>(props.cooks ?? 0);
  const [liked, setLiked] = useState<boolean>(false); // we can hydrate later from API if needed

  // fake deep link (later from database)
  const deepLink = `messhall://recipe/${id}`;

  // swipe actions
  const save = () => { success(); onSave?.(id); };
  const share = async () => {
    success();
    await Share.share({ message: `${title} on MessHall — ${deepLink}` });
  };

  // long-press menu (copy/report)
  const longPressMenu = async () => {
    await tap(); // gentle buzz before options
    Alert.alert('Recipe', 'What would you like to do?', [
      { text: 'Copy Link', onPress: () => Share.share({ message: deepLink }) },
      { text: 'Report', style: 'destructive', onPress: () => warn() },
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  // STEP 5b: tap Like (ELI5: heart gives/takes 1 knife point)
  const toggleLike = async () => {
    try {
      const { liked: nowLiked } = await dataAPI.toggleLike(id);
      setLiked(nowLiked);

      // optimistic knives nudge: +1 if liked, -1 if unliked
      setKnives(k => Math.max(0, k + (nowLiked ? 1 : -1)));

      onLikedChange?.(id, nowLiked);
      await tap();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to like recipes.');
    }
  };

  // STEP 5b: tap Cooked (ELI5: "I cooked it!" gives +3 knives and +1 cooked)
  const markCooked = async () => {
    try {
      await dataAPI.markCooked(id);

      // optimistic update: up we go!
      setCooks(c => c + 1);
      setKnives(k => Math.max(0, k + 3)); // match your knives_weights if different

      onCooked?.(id);
      await success();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to record cooks.');
    }
  };

  return (
    <SwipeCard title={title} onSave={save} onShare={share}>
      <HapticButton onPress={() => onOpen?.(id)} style={{ borderRadius: RADIUS.xl }}>
        {/* NOTE: onLongPress belongs on the touchable; HapticButton forwards it to child View here */}
        <View onLongPress={longPressMenu}>
          {/* IMAGE — use ~16:9 so it looks crisp; recommended: 1200x675 */}
          <Image source={{ uri: image }} style={styles.img} resizeMode="cover" />

          {/* META LINE: creator + knives badge + time ago */}
          <View style={styles.row}>
            <Text style={styles.creator}>{creator}</Text>
            <Badge knives={knives} />
            <View style={{ flex: 1 }} />
            <Text style={styles.dim}>{timeAgo(createdAt)}</Text>
          </View>

          {/* STATS LINE: shows cooked count + quick Open link */}
          <View style={styles.row}>
            <Text style={styles.stat}>{compactNumber(cooks)} cooked</Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.link} onPress={() => Linking.openURL(deepLink)}>Open</Text>
          </View>

          {/* STEP 5b: QUICK ACTION BAR (tiny buttons, easy for thumbs) */}
          <View style={styles.actionRow}>
            {/* Like button */}
            <HapticButton
              onPress={toggleLike}
              style={[
                styles.actionBtn,
                { backgroundColor: liked ? '#1f2937' : COLORS.card }
              ]}
            >
              <Text style={{ color: liked ? '#FFD1DC' : COLORS.text, fontWeight: '800' }}>
                {liked ? '♥ Liked' : '♡ Like'}
              </Text>
            </HapticButton>

            {/* I Cooked button */}
            <HapticButton
              onPress={markCooked}
              style={[styles.actionBtn, { backgroundColor: '#0b3b2e' }]}
            >
              <Text style={{ color: '#CFF8D6', fontWeight: '900' }}>I Cooked (+3 🔪)</Text>
            </HapticButton>
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

  link: { color: COLORS.accent, fontSize: 13, fontWeight: '800' },

  // STEP 5b styles: tidy little buttons row
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 4
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADIUS.lg,
    alignItems: 'center'
  }
});
