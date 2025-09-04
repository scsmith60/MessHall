// components/RecipeCard.tsx
// LIKE I'M 5:
// - Card shows a tiny ✏️ pencil on the photo (top-right) ONLY if it's your recipe.
// - Tap the pencil → go to /edit/[id].
// - No big buttons. Just sleek + subtle.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Alert, Image, Share, StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import SwipeCard from './ui/SwipeCard';
import HapticButton from './ui/HapticButton';
import { COLORS, RADIUS } from '../lib/theme';
import { compactNumber, timeAgo } from '../lib/utils';
import { tap, success, warn } from '../lib/haptics';
import { dataAPI } from '../lib/data';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useUserId } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { router } from 'expo-router';

type Props = {
  id: string;
  title: string;
  image: string;
  creator: string;
  creatorAvatar?: string | null;
  knives: number;
  cooks: number;
  likes: number;
  commentCount?: number;
  createdAt: number | string;
  ownerId: string;
  onOpen?: (id: string) => void;
  onSave?: (id: string) => void;
  onOpenCreator?: (username: string) => void;
  onOpenComments?: (id: string) => void;
  rating?: number;
  ratingCount?: number;
  onLikedChange?: (id: string, liked: boolean) => void;
  onCooked?: (id: string, cooked: boolean) => void;
};

export default function RecipeCard(props: Props) {
  const {
    id, title, image, creator, creatorAvatar,
    createdAt, onOpen, onSave, onLikedChange, onCooked, onOpenCreator, onOpenComments
  } = props;

  const { userId } = useUserId();
  const isOwner = useMemo(() => !!userId && userId === props.ownerId, [userId, props.ownerId]);

  const [medals, setMedals]   = useState<number>(props.knives ?? 0);
  const [cooks, setCooks]     = useState<number>(props.cooks ?? 0);
  const [likes, setLikes]     = useState<number>(props.likes ?? 0);
  const [liked, setLiked]     = useState<boolean>(false);
  const [commentCount]        = useState<number>(props.commentCount ?? 0);
  const [cooked, setCooked]   = useState<boolean>(false);
  const [savingCook, setSavingCook] = useState<boolean>(false);

  const deepLink = `messhall://recipe/${id}`;

  // 🍳 cooked state by me
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!userId) { setCooked(false); return; }
      const { data } = await supabase
        .from('recipe_cooks')
        .select('id')
        .eq('recipe_id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!gone) setCooked(!!data);
    })().catch(() => {});
    return () => { gone = true; };
  }, [id, userId]);

  const save  = () => { success(); onSave?.(id); };
  const share = async () => { success(); await Share.share({ message: `${title} on MessHall — ${deepLink}` }); };

  const open = async () => { await tap(); (onOpen ?? onOpenComments)?.(id) ?? onOpen?.(id); };

  const toggleLike = async () => {
    try {
      const { liked: nowLiked, likesCount } = await dataAPI.toggleLike(id);
      setLiked(nowLiked);
      setLikes(prev => typeof likesCount === 'number' ? likesCount : Math.max(0, prev + (nowLiked ? 1 : -1)));
      onLikedChange?.(id, nowLiked);
      await tap();
    } catch {
      await warn();
      Alert.alert('Sign in required', 'Please sign in to like recipes.');
    }
  };

  const toggleCooked = useCallback(async () => {
    if (!userId) { await warn(); Alert.alert('Please sign in to record cooks.'); return; }
    if (isOwner) { Alert.alert('Heads up', "You can’t medal your own recipe."); return; }
    if (savingCook) return;

    try {
      setSavingCook(true);
      if (cooked) {
        setCooked(false); setCooks(n => Math.max(0, n - 1)); setMedals(m => Math.max(0, m - 1)); onCooked?.(id, false);
        const { error } = await supabase.from('recipe_cooks').delete().eq('user_id', userId).eq('recipe_id', id);
        if (error) { setCooked(true); setCooks(n => n + 1); setMedals(m => m + 1); throw error; }
        await tap();
      } else {
        setCooked(true); setCooks(n => n + 1); setMedals(m => m + 1); onCooked?.(id, true);
        const { error } = await supabase.from('recipe_cooks').insert({ user_id: userId, recipe_id: id as any });
        // @ts-ignore
        if (error && error.code !== '23505') { setCooked(false); setCooks(n => Math.max(0, n - 1)); setMedals(m => Math.max(0, m - 1)); throw error; }
        await success();
      }
    } catch (e: any) {
      await warn();
      Alert.alert('Oops', e?.message ?? 'Could not update cooked state.');
    } finally {
      setSavingCook(false);
    }
  }, [userId, isOwner, cooked, id, savingCook, onCooked]);

  const openComments = async () => { await tap(); (onOpenComments ?? onOpen)?.(id); };

  const MedalStat   = ({ count }: { count: number }) => (<View style={styles.medalStat}><Text style={styles.stat}>{compactNumber(count)}</Text><MaterialCommunityIcons name="medal-outline" size={14} color={COLORS.subtext} /></View>);
  const LikeStat    = ({ count }: { count: number }) => (<View style={styles.likeStat}><Ionicons name="heart" size={14} color="#F87171" /><Text style={styles.stat}>{compactNumber(count)}</Text></View>);
  const CommentStat = ({ count }: { count: number }) => (
    <TouchableOpacity onPress={openComments} activeOpacity={0.85} style={styles.commentChip}>
      <Ionicons name="chatbubble-ellipses-outline" size={14} color={COLORS.text} />
      <Text style={styles.commentChipText}>{compactNumber(count)}</Text>
    </TouchableOpacity>
  );

  const OwnerChip = () => (<View style={styles.ownerChip}><Text style={styles.ownerChipText}>Your recipe</Text></View>);

  const AvatarTiny = ({ size = 22 }: { size?: number }) => {
    const letter = (creator || 'U').slice(0, 1).toUpperCase();
    if (creatorAvatar && creatorAvatar.trim().length > 0) {
      return <Image source={{ uri: creatorAvatar }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#0b1220' }} />;
    }
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#0b1220', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#243042' }}>
        <Text style={{ color: COLORS.text, fontSize: size * 0.6, fontWeight: '800' }}>{letter}</Text>
      </View>
    );
  };

  const openCreator = () => { if (typeof onOpenCreator === 'function' && creator) onOpenCreator(creator); };

  return (
    <SwipeCard onSave={save} onShare={share}>
      <HapticButton onPress={open} style={{ borderRadius: RADIUS.xl }}>
        <View>

          {/* IMAGE with TITLE STICKER at bottom-left */}
          <View style={styles.imageWrap}>
            <Image source={{ uri: image }} style={styles.img} resizeMode="cover" />

            {/* ✏️ tiny edit button only if owner (top-right over the image) */}
            {isOwner && (
              <TouchableOpacity
                onPress={() => router.push(`/edit/${id}`)}
                activeOpacity={0.9}
                style={styles.editFab}
              >
                <MaterialCommunityIcons name="pencil" size={16} color="#e5e7eb" />
              </TouchableOpacity>
            )}

            <View style={styles.titleSticker}>
              <Text style={styles.titleText} numberOfLines={2}>{title}</Text>
            </View>
          </View>

          {/* rest of card... */}
          <View style={styles.row}>
            <TouchableOpacity onPress={openCreator} activeOpacity={0.8} style={styles.creatorWrap}>
              <AvatarTiny />
              <Text style={styles.creator} numberOfLines={1}>{creator}</Text>
            </TouchableOpacity>

            {medals > 0 && (
              <View style={styles.pill}>
                <MaterialCommunityIcons name="medal" size={12} color="#E5E7EB" />
                <Text style={styles.pillText}>{compactNumber(medals)}</Text>
              </View>
            )}

            <View style={{ flex: 1 }} />
            <Text style={styles.dim}>{timeAgo(createdAt as any)}</Text>
          </View>

          <View style={styles.divider} />

          <View style={[styles.row, { marginTop: 6 }]}>
            <MedalStat count={cooks} />
            <View style={{ width: 10 }} />
            <LikeStat count={likes} />
            <View style={{ width: 10 }} />
            <CommentStat count={commentCount} />
            <View style={{ flex: 1 }} />
            {!isOwner && (
              <HapticButton onPress={toggleLike} style={[styles.likeBtn, liked && styles.likeBtnActive]}>
                <Ionicons name={liked ? 'heart' : 'heart-outline'} size={16} color={liked ? COLORS.accent : COLORS.text} style={{ marginRight: 6 }} />
                <Text style={[styles.likeText, liked && { color: COLORS.accent, fontWeight: '800' }]}>Like</Text>
              </HapticButton>
            )}
          </View>

          {/* Cook + Comments */}
          {!isOwner ? (
            <>
              <View style={styles.actionRow}>
                <HapticButton onPress={toggleCooked} disabled={savingCook} style={[styles.cookedButton, cooked && styles.cookedButtonActive, savingCook && { opacity: 0.7 }]}>
                  {savingCook ? (
                    <>
                      <ActivityIndicator />
                      <Text style={styles.cookedText}>{'Saving…'}</Text>
                    </>
                  ) : cooked ? (
                    <>
                      <Ionicons name="checkmark-circle" size={16} color="#CFF8D6" />
                      <Text style={[styles.cookedText, { color: '#CFF8D6' }]}>Cooked</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="restaurant-outline" size={16} color="#E5E7EB" />
                      <Text style={styles.cookedText}>I cooked</Text>
                    </>
                  )}
                </HapticButton>
              </View>
              <View style={{ marginTop: 8 }}>
                <HapticButton onPress={openComments} style={styles.commentsButton}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.text} />
                  <Text style={styles.commentsText}>View comments</Text>
                  <View style={styles.commentsBadge}><Text style={styles.commentsBadgeText}>{compactNumber(commentCount)}</Text></View>
                </HapticButton>
              </View>
            </>
          ) : (
            <>
              <OwnerChip />
              <View style={{ marginTop: 8 }}>
                <HapticButton onPress={openComments} style={styles.commentsButton}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.text} />
                  <Text style={styles.commentsText}>View comments</Text>
                  <View style={styles.commentsBadge}><Text style={styles.commentsBadgeText}>{compactNumber(commentCount)}</Text></View>
                </HapticButton>
              </View>
            </>
          )}
        </View>
      </HapticButton>
    </SwipeCard>
  );
}

const styles = StyleSheet.create({
  imageWrap: { position: 'relative', marginBottom: 8 },
  img: { width: '100%', height: 240, borderRadius: 16 },
  // ✏️ tiny pencil pill
  editFab: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(2,6,23,0.7)',
    borderWidth: 1,
    borderColor: '#2c3a4d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleSticker: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    maxWidth: '85%',
    backgroundColor: 'rgba(2, 6, 23, 0.55)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2c3a4d',
  },
  titleText: { color: COLORS.text, fontSize: 16, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  creatorWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '55%' },
  creator: { color: COLORS.text, fontWeight: '600', fontSize: 14 },
  dim: { color: COLORS.subtext, fontSize: 12 },
  stat: { color: COLORS.subtext, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#2c3a4d', opacity: 0.8, marginTop: 2 },
  medalStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeStat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0b3b2e', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: '#134e4a', marginLeft: 8 },
  pillText: { color: '#E5E7EB', fontSize: 11, fontWeight: '800' },
  likeBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#2c3a4d', backgroundColor: 'transparent' },
  likeBtnActive: { borderColor: COLORS.accent, backgroundColor: '#0b1220' },
  likeText: { color: COLORS.text, fontWeight: '700', fontSize: 13 },
  actionRow: { marginTop: 6 },
  cookedButton: { backgroundColor: '#1e293b', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#2c3a4d' },
  cookedButtonActive: { backgroundColor: '#14532d', borderColor: '#134e4a' },
  cookedText: { color: '#E5E7EB', fontWeight: '900', fontSize: 14 },
  ownerChip: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: '#1f2937', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#2c3a4d' },
  ownerChipText: { color: COLORS.subtext, fontWeight: '800' },
  commentChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: '#2c3a4d', backgroundColor: '#0b1220' },
  commentChipText: { color: COLORS.text, fontWeight: '700', fontSize: 12 },
  commentsButton: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: '#2c3a4d', paddingVertical: 10, justifyContent: 'center' },
  commentsText: { color: COLORS.text, fontWeight: '800', fontSize: 14 },
  commentsBadge: { marginLeft: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#0b1220', borderWidth: 1, borderColor: '#2c3a4d' },
  commentsBadgeText: { color: COLORS.text, fontWeight: '800', fontSize: 12 },
});
