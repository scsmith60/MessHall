// components/RecipeCard.tsx
// LIKE I'M 5 🍪:
// - Calorie pill sits at the BOTTOM-RIGHT of the image (away from the edit pencil).
// - We now READ calories at mount AND LISTEN in real-time for changes to this recipe row,
//   so when the detail page/server computes calories, the feed pill updates automatically.
// - All your other UI (likes, cooks, save, comments) stays the same.

import React, { useEffect, useMemo, useState, useCallback, memo } from "react";
import {
  Alert,
  Image,
  Share,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import SwipeCard from "@/components/ui/SwipeCard";
import HapticButton from "@/components/ui/HapticButton";
import { COLORS, RADIUS } from "@/lib/theme";
import { compactNumber, timeAgo } from "@/lib/utils";
import { tap, success, warn } from "@/lib/haptics";
import { dataAPI } from "@/lib/data";
import { useUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// 👉 tiny badge
import CaloriePill from "@/components/CaloriePill";

// 🧰 Props the card needs
type Props = {
  id: string;
  title: string;
  image?: string | null; // may be empty/null; we guard it
  creator: string;
  creatorAvatar?: string | null;
  knives: number;
  cooks: number;
  likes: number;
  commentCount?: number;
  createdAt: number | string;
  ownerId: string;
  isPrivate?: boolean;
  // actions
  onOpen?: (id: string) => void;
  onOpenCreator?: (username: string) => void;
  onOpenComments?: (id: string) => void;
  onLikedChange?: (id: string, liked: boolean) => void;
  onCooked?: (id: string, cooked: boolean) => void;
  onEdit?: (id: string) => void;
  // SAVE hooks
  isSaved?: boolean;
  onToggleSave?: () => void;
  onSave?: (id: string) => void;
};

function RecipeCard(props: Props) {
  const {
    id,
    title,
    image,
    creator,
    creatorAvatar,
    createdAt,
    isPrivate,
    onOpen,
    onLikedChange,
    onCooked,
    onOpenCreator,
    onOpenComments,
    onEdit,
  } = props;

  // 👤 who am I?
  const { userId } = useUserId();
  const isOwner = useMemo(() => !!userId && userId === props.ownerId, [userId, props.ownerId]);

  // ✅ counters for snappy UI
  const [cooks, setCooks] = useState<number>(props.cooks ?? 0);
  const [likes, setLikes] = useState<number>(props.likes ?? 0);
  const [liked, setLiked] = useState<boolean>(false);
  const commentCount = props.commentCount ?? 0;

  const [cooked, setCooked] = useState<boolean>(false);
  const [savingCook, setSavingCook] = useState<boolean>(false);

  // 🖼️ safe image URL or null
  const imgUri = useMemo(() => {
    const s = typeof image === "string" ? image.trim() : "";
    return s.length > 0 ? s : null;
  }, [image]);

  // 🍳 did I cook this already?
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!userId) {
        setCooked(false);
        return;
      }
      const { data } = await supabase
        .from("recipe_cooks")
        .select("id")
        .eq("recipe_id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!gone) setCooked(!!data);
    })().catch(() => {});
    return () => {
      gone = true;
    };
  }, [id, userId]);

  // 💾 swipe-right save
  const save = useCallback(() => {
    success();
    if (props.onToggleSave) props.onToggleSave();
    else props.onSave?.(id);
  }, [id, props]);

  // 📤 share
  const share = useCallback(async () => {
    success();
    await Share.share({ message: `${title} on MessHall — messhall://recipe/${id}` });
  }, [id, title]);

  // 🔍 open the recipe (tap big card)
  const open = useCallback(async () => {
    await tap();
    (onOpen ?? onOpenComments)?.(id);
  }, [id, onOpen, onOpenComments]);

  // 👤 open the creator profile
  const openCreator = useCallback(async () => {
    if (!creator) return;
    await tap();
    if (typeof onOpenCreator === "function") {
      onOpenCreator(creator);
      return;
    }
    router.push({ pathname: "/u/[username]", params: { username: creator, uid: props.ownerId } });
  }, [creator, onOpenCreator, props.ownerId]);

  // ❤️ like
  const toggleLike = useCallback(async () => {
    try {
      const { liked: nowLiked, likesCount } = await dataAPI.toggleLike(id);
      setLiked(nowLiked);
      setLikes((prev) =>
        typeof likesCount === "number" ? likesCount : Math.max(0, prev + (nowLiked ? 1 : -1))
      );
      onLikedChange?.(id, nowLiked);
      await tap();
    } catch {
      await warn();
      Alert.alert("Sign in required", "Please sign in to like recipes.");
    }
  }, [id, onLikedChange]);

  // 🍽️ cooked
  const toggleCooked = useCallback(async () => {
    if (!userId) {
      await warn();
      Alert.alert("Please sign in to record cooks.");
      return;
    }
    if (isOwner) {
      Alert.alert("Heads up", "You can’t medal your own recipe.");
      return;
    }
    if (savingCook) return;

    try {
      setSavingCook(true);

      if (cooked) {
        setCooked(false);
        setCooks((n) => Math.max(0, n - 1));
        const { error } = await supabase
          .from("recipe_cooks")
          .delete()
          .eq("user_id", userId)
          .eq("recipe_id", id);
        if (error) {
          setCooked(true);
          setCooks((n) => n + 1);
          throw error;
        }
        onCooked?.(id, false);
        await tap();
      } else {
        setCooked(true);
        setCooks((n) => n + 1);
        const { error } = await supabase
          .from("recipe_cooks")
          .insert({ user_id: userId, recipe_id: id as any });
        // ignore unique
        // @ts-ignore
        if (error && error.code !== "23505") {
          setCooked(false);
          setCooks((n) => Math.max(0, n - 1));
          throw error;
        }
        onCooked?.(id, true);
        await success();
      }
    } catch (e: any) {
      await warn();
      Alert.alert("Oops", e?.message ?? "Could not update cooked state.");
    } finally {
      setSavingCook(false);
    }
  }, [userId, isOwner, cooked, id, savingCook, onCooked]);

  // 💬 comments button
  const openComments = useCallback(async () => {
    await tap();
    (onOpenComments ?? onOpen)?.(id);
  }, [id, onOpen, onOpenComments]);

  // 🔥 FEED CALORIES (read + realtime subscribe)
  const [calTotal, setCalTotal] = useState<number | null>(null);
  const [calPerServ, setCalPerServ] = useState<number | null>(null);

  // 1) initial fetch (fast read)
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("recipes")
          .select("calories_total, calories_per_serving")
          .eq("id", id)
          .maybeSingle();
        if (gone) return;
        const t = data?.calories_total ?? null;
        const p = data?.calories_per_serving ?? null;
        setCalTotal(typeof t === "number" && t > 0 ? t : null);
        setCalPerServ(typeof p === "number" && p > 0 ? p : null);
      } catch {}
    })();
    return () => {
      gone = true;
    };
  }, [id]);

  // 2) realtime subscription to keep pill in sync when detail page/server updates
  useEffect(() => {
    // IMPORTANT: enable Realtime on public.recipes (UPDATE) in your Supabase project settings.
    const channel = supabase
      .channel(`recipes-cal-${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "recipes", filter: `id=eq.${id}` },
        (payload: any) => {
          const t = (payload?.new as any)?.calories_total;
          const p = (payload?.new as any)?.calories_per_serving;
          setCalTotal(typeof t === "number" && t > 0 ? t : null);
          setCalPerServ(typeof p === "number" && p > 0 ? p : null);
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [id]);

  // 🎨 UI
  return (
    <SwipeCard onSave={save} onShare={share}>
      <HapticButton onPress={open} style={{ borderRadius: RADIUS.xl }}>
        <View>
          {/* ===== IMAGE + TITLE ===== */}
          <View style={styles.imageWrap}>
            {imgUri ? (
              <Image source={{ uri: imgUri }} style={styles.img} resizeMode="cover" />
            ) : (
              // 🧱 fallback so empty URL never crashes
              <View style={[styles.img, styles.imgFallback]}>
                <Ionicons name="image-outline" size={28} color={COLORS.subtext} />
                <Text style={styles.fallbackText}>No photo yet</Text>
              </View>
            )}

            {/* 🔒 Private pill */}
            {isPrivate && (
              <View pointerEvents="none" style={styles.privateChip} accessibilityLabel="Private">
                <MaterialCommunityIcons name="lock" size={12} color="#FFF7D6" />
                <Text style={styles.privateChipText}>Private</Text>
              </View>
            )}

            {/* ✏️ Edit button (owners only) */}
            {isOwner && (
              <Pressable
                onStartShouldSetResponder={() => true}
                onPressIn={(e) => e.stopPropagation()}
                onPress={(e) => {
                  e.stopPropagation();
                  onEdit ? onEdit(id) : router.push({ pathname: "/recipe/edit/[id]", params: { id } });
                }}
                hitSlop={12}
                style={styles.editFab}
                accessibilityLabel="Edit recipe"
              >
                <MaterialCommunityIcons name="pencil" size={16} color="#e5e7eb" />
              </Pressable>
            )}

            {/* 👉 Calorie pill BOTTOM-RIGHT on the image */}
            <View style={styles.caloriePillPos}>
              <CaloriePill
                total={calTotal ?? undefined}
                perServing={calPerServ ?? undefined}
                compact
              />
            </View>

            {/* Title sticker on the photo */}
            <View style={styles.titleSticker}>
              <Text style={styles.titleText} numberOfLines={2}>
                {title}
              </Text>
            </View>
          </View>

          {/* ===== BYLINE ===== */}
          <View style={styles.row}>
            <TouchableOpacity onPress={openCreator} activeOpacity={0.8} style={styles.creatorWrap}>
              <AvatarTiny creator={creator} creatorAvatar={creatorAvatar} />
              <Text style={styles.creator} numberOfLines={1}>
                {creator}
              </Text>
            </TouchableOpacity>

            {/* 💚 author medal count */}
            {props.knives > 0 && (
              <View style={styles.pill}>
                <MaterialCommunityIcons name="medal" size={12} color="#E5E7EB" />
                <Text style={styles.pillText}>{compactNumber(props.knives)}</Text>
              </View>
            )}

            <View style={{ flex: 1 }} />
            <Text style={styles.dim}>{timeAgo(createdAt as any)}</Text>
          </View>

          <View style={styles.divider} />

          {/* ===== STATS ===== */}
          <View style={[styles.row, { marginTop: 6 }]}>
            <MedalStat count={cooks} />
            <View style={{ width: 10 }} />
            <LikeStat count={likes} />
            <View style={{ width: 10 }} />
            <CommentStat count={commentCount} openComments={openComments} />

            <View style={{ flex: 1 }} />

            {/* ❤️ like btn */}
            {!isOwner && (
              <HapticButton onPress={toggleLike} style={[styles.likeBtn, liked && styles.likeBtnActive]}>
                <Ionicons
                  name={liked ? "heart" : "heart-outline"}
                  size={16}
                  color={liked ? COLORS.accent : COLORS.text}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.likeText, liked && { color: COLORS.accent, fontWeight: "800" }]}>
                  Like
                </Text>
              </HapticButton>
            )}

            {/* 💾 save btn (active+green when saved) */}
            {!isOwner && (
              <HapticButton
                onPress={props.onToggleSave}
                style={[styles.saveBtn, props.isSaved && styles.saveBtnActive]}
              >
                <Ionicons
                  name={props.isSaved ? "bookmark" : "bookmark-outline"}
                  size={16}
                  color={props.isSaved ? "#CFF8D6" : COLORS.text}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.saveText,
                    props.isSaved && { color: "#CFF8D6", fontWeight: "800" },
                  ]}
                >
                  {props.isSaved ? "Saved" : "Save"}
                </Text>
              </HapticButton>
            )}
          </View>

          {/* ===== ACTIONS ===== */}
          {!isOwner ? (
            <>
              <View style={styles.actionRow}>
                <HapticButton
                  onPress={toggleCooked}
                  disabled={savingCook}
                  style={[
                    styles.cookedButton,
                    cooked && styles.cookedButtonActive,
                    savingCook && { opacity: 0.7 },
                  ]}
                >
                  {savingCook ? (
                    <>
                      <ActivityIndicator />
                      <Text style={styles.cookedText}>Saving…</Text>
                    </>
                  ) : cooked ? (
                    <>
                      <Ionicons name="checkmark-circle" size={16} color="#CFF8D6" />
                      <Text style={[styles.cookedText, { color: "#CFF8D6" }]}>Cooked</Text>
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
                  <View style={styles.commentsBadge}>
                    <Text style={styles.commentsBadgeText}>{compactNumber(commentCount)}</Text>
                  </View>
                </HapticButton>
              </View>
            </>
          ) : (
            <>
              <View style={styles.ownerChip}>
                <Text style={styles.ownerChipText}>Your recipe</Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <HapticButton onPress={openComments} style={styles.commentsButton}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.text} />
                  <Text style={styles.commentsText}>View comments</Text>
                  <View style={styles.commentsBadge}>
                    <Text style={styles.commentsBadgeText}>{compactNumber(commentCount)}</Text>
                  </View>
                </HapticButton>
              </View>
            </>
          )}
        </View>
      </HapticButton>
    </SwipeCard>
  );
}

/* -------------------------
   Tiny helpers (memo = fewer re-renders)
------------------------- */

const AvatarTiny = memo(function AvatarTiny({
  size = 22,
  creator,
  creatorAvatar,
}: {
  size?: number;
  creator: string;
  creatorAvatar?: string | null;
}) {
  const letter = (creator || "U").slice(0, 1).toUpperCase();
  if (creatorAvatar && creatorAvatar.trim().length > 0) {
    return (
      <Image
        source={{ uri: creatorAvatar }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#0b1220" }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#0b1220",
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: "#243042",
      }}
    >
      <Text style={{ color: COLORS.text, fontSize: size * 0.6, fontWeight: "800" }}>{letter}</Text>
    </View>
  );
});

const MedalStat = memo(function MedalStat({ count }: { count: number }) {
  return (
    <View style={styles.medalStat}>
      <Text style={styles.stat}>{compactNumber(count)}</Text>
      <MaterialCommunityIcons name="medal-outline" size={14} color={COLORS.subtext} />
    </View>
  );
});

const LikeStat = memo(function LikeStat({ count }: { count: number }) {
  return (
    <View style={styles.likeStat}>
      <Ionicons name="heart" size={14} color="#F87171" />
      <Text style={styles.stat}>{compactNumber(count)}</Text>
    </View>
  );
});

const CommentStat = memo(function CommentStat({
  count,
  openComments,
}: {
  count: number;
  openComments: () => void;
}) {
  return (
    <TouchableOpacity onPress={openComments} activeOpacity={0.85} style={styles.commentChip}>
      <Ionicons name="chatbubble-ellipses-outline" size={14} color={COLORS.text} />
      <Text style={styles.commentChipText}>{compactNumber(count)}</Text>
    </TouchableOpacity>
  );
});

/* -------------------------
   Styles
------------------------- */
const styles = StyleSheet.create({
  imageWrap: { position: "relative", marginBottom: 8 },
  img: { width: "100%", height: 240, borderRadius: 16 },

  // 🧱 fallback block when there is no image URL
  imgFallback: {
    backgroundColor: "#0b1220",
    borderWidth: 1,
    borderColor: "#2c3a4d",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  fallbackText: { color: COLORS.subtext, fontSize: 12, fontWeight: "700" },

  // 🔒 orange "Private" pill (visible on dark photos)
  privateChip: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(245, 158, 11, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(252, 211, 77, 0.95)",
    zIndex: 10,
    elevation: 10,
  },
  privateChipText: { color: "#111827", fontSize: 11, fontWeight: "900", marginLeft: 6 },

  editFab: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(2,6,23,0.7)",
    borderWidth: 1,
    borderColor: "#2c3a4d",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    elevation: 10,
  },

  // 👉 BOTTOM-RIGHT calorie pill
  caloriePillPos: {
    position: "absolute",
    bottom: 10,
    right: 10,
    zIndex: 9,
    elevation: 9,
  },

  titleSticker: {
    position: "absolute",
    left: 10,
    bottom: 10,
    maxWidth: "85%",
    backgroundColor: "rgba(2, 6, 23, 0.55)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2c3a4d",
  },
  titleText: { color: COLORS.text, fontSize: 16, fontWeight: "900" },

  row: { flexDirection: "row", alignItems: "center", marginBottom: 6 },

  creatorWrap: { flexDirection: "row", alignItems: "center", maxWidth: "55%" },
  creator: { color: COLORS.text, fontWeight: "600", fontSize: 14 },
  dim: { color: COLORS.subtext, fontSize: 12 },
  stat: { color: COLORS.subtext, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#2c3a4d", opacity: 0.8, marginTop: 2 },

  medalStat: { flexDirection: "row", alignItems: "center" },
  likeStat: { flexDirection: "row", alignItems: "center" },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#0b3b2e",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#134e4a",
    marginLeft: 8,
  },
  pillText: { color: "#E5E7EB", fontSize: 11, fontWeight: "800" },

  likeBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2c3a4d",
    backgroundColor: "transparent",
    marginRight: 8,
  },
  likeBtnActive: { borderColor: COLORS.accent, backgroundColor: "#0b1220" },
  likeText: { color: COLORS.text, fontWeight: "700", fontSize: 13 },

  // 💾 SAVE button styles
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2c3a4d",
    backgroundColor: "transparent",
  },
  saveBtnActive: { borderColor: "#2BAA6B", backgroundColor: "#183B2B" },
  saveText: { color: COLORS.text, fontWeight: "700", fontSize: 13 },

  actionRow: { marginTop: 6 },
  cookedButton: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#2c3a4d",
  },
  cookedButtonActive: { backgroundColor: "#14532d", borderColor: "#134e4a" },
  cookedText: { color: "#E5E7EB", fontWeight: "900", fontSize: 14 },

  ownerChip: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#1f2937",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#2c3a4d",
  },
  ownerChipText: { color: COLORS.subtext, fontWeight: "800" },

  commentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2c3a4d",
    backgroundColor: "#0b1220",
  },
  commentChipText: { color: COLORS.text, fontWeight: "700", fontSize: 12 },

  commentsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2c3a4d",
    paddingVertical: 10,
    justifyContent: "center",
  },
  commentsText: { color: COLORS.text, fontWeight: "800", fontSize: 14 },
  commentsBadge: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "#0b1220",
    borderWidth: 1,
    borderColor: "#2c3a4d",
  },
  commentsBadgeText: { color: COLORS.text, fontWeight: "800", fontSize: 12 },
});

// ✅ memoized export so FlatList doesn’t re-render every card all the time
export default memo(RecipeCard);
