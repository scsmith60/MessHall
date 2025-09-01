// components/RecipeCard.tsx
// LIKE I'M 5: this is one big yummy card.
// We added a tiny medals pill next to the username:
//   Beta   [🎖️ 128]                      1h
//
// NEW: If the recipe is YOURS, we HIDE the Like + I Cooked buttons
// and show a soft "Your recipe" chip instead so it looks tidy.
// NEW: We also show a ❤️ likes COUNT pill (a tiny heart + number) for everyone.
//
// Notes:
// - "knives" prop = creator's lifetime medals (from user_stats.medals_total).
// - We hide the pill if medals = 0 so it’s not clutter.
// - Tap card to open (no "Open" text).
// - Middle row shows cooks (number + medal icon) + likes count, and a Like button (unless owner).
// - Big green "I Cooked (+3 🎖️)" button at the bottom (unless owner).

import React, { useMemo, useState } from 'react';
import { Alert, Image, Share, StyleSheet, Text, View } from 'react-native';
import SwipeCard from './ui/SwipeCard';
import HapticButton from './ui/HapticButton';
import { COLORS, RADIUS } from '../lib/theme';
import { compactNumber, timeAgo } from '../lib/utils';
import { tap, success, warn } from '../lib/haptics';
import { dataAPI } from '../lib/data';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useUserId } from '../lib/auth'; // 👈 tiny helper to know who I am

type Props = {
  id: string;
  title: string;
  image: string;
  creator: string;

  // 🔸 creator's lifetime medals (wired via dataAPI: user_stats.medals_total)
  knives: number;

  // how many people tapped "I Cooked" on THIS recipe
  cooks: number;

  // ❤️ how many likes (we show as a small heart + number)
  likes: number;

  // time
  createdAt: number | string;

  // 👇 who owns this recipe (so we can hide buttons if it's me)
  ownerId: string;

  onOpen?: (id: string) => void;
  onSave?: (id: string) => void;

  onLikedChange?: (id: string, liked: boolean) => void;
  onCooked?: (id: string) => void;

  // Optional: star rating for the RECIPE (not the user)
  rating?: number;        // 0..5 (can be 3.5)
  ratingCount?: number;   // e.g., 128
};

export default function RecipeCard(props: Props) {
  const { id, title, image, creator, createdAt, onOpen, onSave, onLikedChange, onCooked } = props;

  // 👶 Who am I? If my id matches ownerId, it's MY recipe.
  const { userId } = useUserId();
  const isOwner = useMemo(() => !!userId && userId === props.ownerId, [userId, props.ownerId]);

  // LOCAL: optimistic numbers so it feels instant
  const [medals, setMedals] = useState<number>(props.knives ?? 0); // creator's medals (lifetime)
  const [cooks, setCooks] = useState<number>(props.cooks ?? 0);
  const [likes, setLikes] = useState<number>(props.likes ?? 0);
  const [liked, setLiked] = useState<boolean>(false);

  const deepLink = `messhall://recipe/${id}`;

  // 👉 swipe actions: save + share
  const save = () => { success(); onSave?.(id); };
  const share = async () => {
    success();
    await Share.share({ message: `${title} on MessHall — ${deepLink}` });
  };

  // 👉 tapping the card opens it
  const open = async () => { await tap(); onOpen?.(id); };

  // ❤️ like: +/- 1 medal (UI nudge only; real medals come from cooks via DB)
  const toggleLike = async () => {
    try {
      const { liked: nowLiked, likesCount } = await dataAPI.toggleLike(id);
      setLiked(nowLiked);
      // If server returns a count, trust it; otherwise nudge by ±1
      setLikes((prev) =>
        typeof likesCount === 'number' ? likesCount : Math.max(0, prev + (nowLiked ? 1 : -1))
      );
      setMedals(m => Math.max(0, m + (nowLiked ? 1 : -1))); // optional UI nudge
      onLikedChange?.(id, nowLiked);
      await tap();
    } catch (e: any) {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to like recipes.');
    }
  };

  // 🍳 cooked: +3 medals and +1 cook (UI optimistic; DB trigger does the real thing)
  const markCooked = async () => {
    try {
      await dataAPI.markCooked(id);
      setCooks(c => c + 1);
      setMedals(m => Math.max(0, m + 3));
      onCooked?.(id);
      await success();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to record cooks.');
    }
  };

  // ⭐ tiny star rating row (for the RECIPE if provided)
  const StarRating = ({
    value = 0,
    count = 0,
    size = 14,
  }: { value?: number; count?: number; size?: number }) => {
    const v = Math.max(0, Math.min(5, value ?? 0));
    const stars = [0, 1, 2, 3, 4].map(i => {
      const diff = v - i;
      const name = diff >= 1 ? 'star' : diff >= 0.5 ? 'star-half' : 'star-outline';
      return <Ionicons key={i} name={name as any} size={size} color="#FACC15" />;
    });
    return (
      <View style={styles.ratingWrap}>
        <View style={styles.ratingStars}>{stars}</View>
        <Text style={styles.ratingCount}>{`(${compactNumber(count)})`}</Text>
      </View>
    );
  };

  // 🎖️ cooks stat pill (number + medal icon)
  const MedalStat = ({ count }: { count: number }) => (
    <View style={styles.medalStat}>
      <Text style={styles.stat}>{compactNumber(count)}</Text>
      <MaterialCommunityIcons name="medal-outline" size={14} color={COLORS.subtext} />
    </View>
  );

  // ❤️ likes stat pill (heart + number)
  const LikeStat = ({ count }: { count: number }) => (
    <View style={styles.likeStat}>
      <Ionicons name="heart" size={14} color="#F87171" />
      <Text style={styles.stat}>{compactNumber(count)}</Text>
    </View>
  );

  // 🎖️ tiny pill next to username showing the CREATOR'S lifetime medals
  const CreatorMedalPill = ({ value }: { value: number }) => {
    if (!value) return null; // hide if zero to keep it clean
    return (
      <View style={styles.pill}>
        <MaterialCommunityIcons name="medal" size={12} color="#E5E7EB" />
        <Text style={styles.pillText}>{compactNumber(value)}</Text>
      </View>
    );
  };

  // 🧢 gentle chip that says "Your recipe" (used when we hide buttons)
  const OwnerChip = () => (
    <View style={styles.ownerChip}>
      <Text style={styles.ownerChipText}>Your recipe</Text>
    </View>
  );

  return (
    <SwipeCard title={title} onSave={save} onShare={share}>
      {/* Whole card opens on tap */}
      <HapticButton onPress={open} style={{ borderRadius: RADIUS.xl }}>
        <View>
          {/* TITLE */}
          <Text style={styles.title} numberOfLines={2}>{title}</Text>

          {/* IMAGE */}
          <Image source={{ uri: image }} style={styles.img} resizeMode="cover" />

          {/* META: Creator + [🎖️ medals] + (optional ⭐ rating) + time */}
          <View style={styles.row}>
            <Text style={styles.creator} numberOfLines={1}>{creator}</Text>

            {/* creator's lifetime medals pill (from props.knives) */}
            <CreatorMedalPill value={medals} />

            {/* optional recipe star rating */}
            {typeof props.rating === 'number' && (
              <StarRating value={props.rating} count={props.ratingCount ?? 0} />
            )}

            <View style={{ flex: 1 }} />
            <Text style={styles.dim}>{timeAgo(createdAt as any)}</Text>
          </View>

          {/* STATS: cooks + likes, and Like button (hidden if owner) */}
          <View style={styles.row}>
            <MedalStat count={cooks} />
            <View style={{ width: 10 }} />
            <LikeStat count={likes} />
            <View style={{ flex: 1 }} />

            {/* Like button (compact ghost) — HIDDEN if it's my recipe */}
            {!isOwner && (
              <HapticButton
                onPress={toggleLike}
                style={[styles.likeBtn, liked && styles.likeBtnActive]}
                accessibilityLabel="Like this recipe"
              >
                <Ionicons
                  name={liked ? 'heart' : 'heart-outline'}
                  size={16}
                  color={liked ? COLORS.accent : COLORS.text}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.likeText, liked && { color: COLORS.accent, fontWeight: '800' }]}>
                  Like
                </Text>
              </HapticButton>
            )}
          </View>

          {/* ACTION: Big clear CTA (hidden if owner) */}
          {!isOwner ? (
            <View style={styles.actionRow}>
              <HapticButton
                onPress={markCooked}
                style={styles.cookedButton}
                accessibilityLabel="I cooked this"
              >
                <Ionicons name="checkmark-circle" size={18} color="#ffffff" />
                <Text style={styles.cookedText}>I Cooked</Text>
                <Text style={styles.cookedBonus}>+3</Text>
                <MaterialCommunityIcons name="medal" size={18} color="#ffffff" />
              </HapticButton>
            </View>
          ) : (
            <OwnerChip />
          )}
        </View>
      </HapticButton>
    </SwipeCard>
  );
}

const styles = StyleSheet.create({
  title: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginBottom: 6 },

  img: { width: '100%', height: 220, borderRadius: 16, marginBottom: 10 },

  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },

  creator: { color: COLORS.text, fontWeight: '800', fontSize: 14 },

  dim: { color: COLORS.subtext, fontSize: 12 },

  stat: { color: COLORS.subtext, fontSize: 13 },

  // ⭐ rating styles
  ratingWrap: { flexDirection: 'row', alignItems: 'center', marginLeft: 10 },
  ratingStars: { flexDirection: 'row', gap: 2 },
  ratingCount: { color: COLORS.subtext, fontSize: 12, marginLeft: 6, fontWeight: '600' },

  // 🎖️ cooks stat
  medalStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // ❤️ likes stat
  likeStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // 🎖️ creator medal pill (next to username)
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0b3b2e',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#134e4a',
    marginLeft: 8,
  },
  pillText: { color: COLORS.text, fontWeight: '800', fontSize: 12 },

  // like button (ghost)
  likeBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADIUS.lg, backgroundColor: COLORS.card,
  },
  likeBtnActive: { backgroundColor: '#1f2937' },
  likeText: { color: COLORS.text, fontSize: 13, fontWeight: '700' },

  // big green CTA
  actionRow: { marginTop: 8, marginBottom: 2 },
  cookedButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#0b3b2e',
    paddingVertical: 12, borderRadius: RADIUS.lg,
  },
  cookedText: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  cookedBonus: { color: '#ffffff', fontWeight: '900', fontSize: 14 },

  // gentle "Your recipe" chip
  ownerChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1f2937',
    marginTop: 6,
  },
  ownerChipText: { color: COLORS.subtext, fontWeight: '800', fontSize: 12 },
});
