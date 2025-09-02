// components/RecipeCard.tsx
// LIKE I'M 5: this is one big yummy card with a tiny round creator face.
// WHAT'S NEW:
// 1) We show a tiny round avatar next to the creator's name.
// 2) Tapping the avatar OR the creator name can open /u/<username> if you pass onOpenCreator.
// 3) We kept medals/likes/buttons the same.
// 4) If no avatar picture, we show a fallback letter bubble.

import React, { useMemo, useState } from 'react';
import { Alert, Image, Share, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import SwipeCard from './ui/SwipeCard';
import HapticButton from './ui/HapticButton';
import { COLORS, RADIUS } from '../lib/theme';
import { compactNumber, timeAgo } from '../lib/utils';
import { tap, success, warn } from '../lib/haptics';
import { dataAPI } from '../lib/data';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useUserId } from '../lib/auth';

type Props = {
  id: string;
  title: string;
  image: string;
  creator: string;              // callsign like "Beta"
  creatorAvatar?: string | null; // 👶 little round picture

  // creator’s lifetime medals (from user_stats.medals_total)
  knives: number;

  // this recipe’s counts
  cooks: number; // how many "I cooked it!"
  likes: number; // ❤️ hearts

  // when
  createdAt: number | string;

  // ownership (so we hide buttons on your own recipe)
  ownerId: string;

  // actions the parent can handle
  onOpen?: (id: string) => void;
  onSave?: (id: string) => void;

  // open the creator’s public profile (/u/<username>)
  onOpenCreator?: (username: string) => void;

  // optional helpers
  onLikedChange?: (id: string, liked: boolean) => void;
  onCooked?: (id: string) => void;

  // optional stars for THIS recipe (not the user)
  rating?: number;        // 0..5 (can be 3.5)
  ratingCount?: number;   // e.g., 128
};

export default function RecipeCard(props: Props) {
  const {
    id, title, image, creator, creatorAvatar,
    createdAt, onOpen, onSave, onLikedChange, onCooked, onOpenCreator
  } = props;

  // Who am I? If my id matches ownerId, it's MY recipe.
  const { userId } = useUserId();
  const isOwner = useMemo(() => !!userId && userId === props.ownerId, [userId, props.ownerId]);

  // LOCAL: optimistic numbers so it feels instant
  const [medals, setMedals] = useState<number>(props.knives ?? 0); // creator's medals (lifetime)
  const [cooks, setCooks] = useState<number>(props.cooks ?? 0);
  const [likes, setLikes] = useState<number>(props.likes ?? 0);
  const [liked, setLiked] = useState<boolean>(false);

  const deepLink = `messhall://recipe/${id}`;

  // swipe actions: save + share
  const save = () => { success(); onSave?.(id); };
  const share = async () => { success(); await Share.share({ message: `${title} on MessHall — ${deepLink}` }); };

  // tapping the card opens it
  const open = async () => { await tap(); onOpen?.(id); };

  // Like
  const toggleLike = async () => {
    try {
      const { liked: nowLiked, likesCount } = await dataAPI.toggleLike(id);
      setLiked(nowLiked);
      setLikes(prev => typeof likesCount === 'number' ? likesCount : Math.max(0, prev + (nowLiked ? 1 : -1)));
      setMedals(m => Math.max(0, m + (nowLiked ? 1 : -1))); // small UI nudge
      onLikedChange?.(id, nowLiked);
      await tap();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to like recipes.');
    }
  };

  // Cooked
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

  // tiny star row
  const StarRating = ({ value = 0, count = 0, size = 14 }: { value?: number; count?: number; size?: number }) => {
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

  const MedalStat = ({ count }: { count: number }) => (
    <View style={styles.medalStat}>
      <Text style={styles.stat}>{compactNumber(count)}</Text>
      <MaterialCommunityIcons name="medal-outline" size={14} color={COLORS.subtext} />
    </View>
  );

  const LikeStat = ({ count }: { count: number }) => (
    <View style={styles.likeStat}>
      <Ionicons name="heart" size={14} color="#F87171" />
      <Text style={styles.stat}>{compactNumber(count)}</Text>
    </View>
  );

  const OwnerChip = () => (
    <View style={styles.ownerChip}>
      <Text style={styles.ownerChipText}>Your recipe</Text>
    </View>
  );

  // Avatar bubble (fallback letter)
  const AvatarTiny = ({ size = 22 }: { size?: number }) => {
    const letter = (creator || 'U').slice(0, 1).toUpperCase();
    if (creatorAvatar && creatorAvatar.trim().length > 0) {
      return <Image source={{ uri: creatorAvatar }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#0b1220' }} />;
    }
    return (
      <View
        style={{
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: '#0b1220', alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: '#243042',
        }}
      >
        <Text style={{ color: COLORS.text, fontSize: size * 0.6, fontWeight: '800' }}>{letter}</Text>
      </View>
    );
  };

  // open /u/<creator>
  const openCreator = () => { if (typeof onOpenCreator === 'function' && creator) onOpenCreator(creator); };

  return (
    <SwipeCard title={title} onSave={save} onShare={share}>
      {/* Whole card opens on tap */}
      <HapticButton onPress={open} style={{ borderRadius: RADIUS.xl }}>
        <View>
          {/* TITLE */}
          <Text style={styles.title} numberOfLines={2}>{title}</Text>

          {/* IMAGE */}
          <Image source={{ uri: image }} style={styles.img} resizeMode="cover" />

          {/* META: avatar + name (tappable) + medals + optional rating + time */}
          <View style={styles.row}>
            <TouchableOpacity onPress={openCreator} activeOpacity={0.8} style={styles.creatorWrap}>
              <AvatarTiny />
              {/* lighter weight username */}
              <Text style={styles.creator} numberOfLines={1}>{creator}</Text>
            </TouchableOpacity>

            {/* creator lifetime medals pill */}
            {medals > 0 && (
              <View style={styles.pill}>
                <MaterialCommunityIcons name="medal" size={12} color="#E5E7EB" />
                <Text style={styles.pillText}>{compactNumber(medals)}</Text>
              </View>
            )}

            {typeof props.rating === 'number' && (
              <StarRating value={props.rating} count={props.ratingCount ?? 0} />
            )}

            <View style={{ flex: 1 }} />
            <Text style={styles.dim}>{timeAgo(createdAt as any)}</Text>
          </View>

          {/* STATS + LIKE */}
          <View style={styles.row}>
            <MedalStat count={cooks} />
            <View style={{ width: 10 }} />
            <LikeStat count={likes} />
            <View style={{ flex: 1 }} />
            {!isOwner && (
              <HapticButton onPress={toggleLike} style={[styles.likeBtn, liked && styles.likeBtnActive]}>
                <Ionicons name={liked ? 'heart' : 'heart-outline'} size={16} color={liked ? COLORS.accent : COLORS.text} style={{ marginRight: 6 }} />
                <Text style={[styles.likeText, liked && { color: COLORS.accent, fontWeight: '800' }]}>Like</Text>
              </HapticButton>
            )}
          </View>

          {/* ACTION */}
          {!isOwner ? (
            <View style={styles.actionRow}>
              <HapticButton onPress={markCooked} style={styles.cookedButton}>
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

  // avatar + name tap target
  creatorWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '55%' },

  // lighter weight name
  creator: { color: COLORS.text, fontWeight: '600', fontSize: 14 },

  dim: { color: COLORS.subtext, fontSize: 12 },
  stat: { color: COLORS.subtext, fontSize: 13 },

  // ⭐ rating styles
  ratingWrap: { flexDirection: 'row', alignItems: 'center', marginLeft: 10 },
  ratingStars: { flexDirection: 'row', gap: 2 },
  ratingCount: { color: COLORS.subtext, fontSize: 12, marginLeft: 6, fontWeight: '600' },

  medalStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // creator medal pill (next to username)
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
  pillText: { color: '#E5E7EB', fontSize: 11, fontWeight: '800' },

  // like button (small ghost)
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2c3a4d',
    backgroundColor: 'transparent',
  },
  likeBtnActive: { borderColor: COLORS.accent, backgroundColor: '#0b1220' },
  likeText: { color: COLORS.text, fontWeight: '700', fontSize: 13 },

  // Big green "I Cooked" button
  actionRow: { marginTop: 8 },
  cookedButton: {
    backgroundColor: '#22c55e',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  cookedText: { color: '#ffffff', fontWeight: '900', fontSize: 15 },
  cookedBonus: { color: '#ffffff', fontWeight: '900' },

  // owner chip
  ownerChip: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#1f2937',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2c3a4d',
  },
  ownerChipText: { color: COLORS.subtext, fontWeight: '800' },
});
