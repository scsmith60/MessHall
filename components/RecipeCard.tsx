// components/RecipeCard.tsx
// LIKE I'M 5 🍪:
// - Calorie pill sits at the BOTTOM-RIGHT of the image (away from the edit pencil).
// - We now READ calories at mount AND LISTEN in real-time for changes to this recipe row,
//   so when the detail page/server computes calories, the feed pill updates automatically.
// - All your other UI (likes, cooks, save, comments) stays the same.
// - ✅ NEW: Opening the creator profile is now *block-aware* with a friendly "Unblock?" prompt if you blocked them.

import React, { useEffect, useMemo, useState, useCallback, memo } from "react";
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

// ⭐ CALORIE PILL CACHING (additive; safe if AsyncStorage not installed)
type StorageLike = { getItem(k: string): Promise<string|null>; setItem(k: string, v: string): Promise<void>; };
const __mem__: Record<string, string> = {};
const MemoryStorage: StorageLike = {
  async getItem(k){ return k in __mem__ ? __mem__[k] : null; },
  async setItem(k,v){ __mem__[k]=v; }
};
async function getStorage(): Promise<StorageLike> {
  try { const mod = await import("@react-native-async-storage/async-storage"); return (mod as any).default as StorageLike; }
  catch { return MemoryStorage; }
}
const calKey = (id: string) => `mh:recipe:calpill:${id}`;

import SwipeCard from "@/components/ui/SwipeCard";
import HapticButton from "@/components/ui/HapticButton";
import { COLORS, RADIUS } from "@/lib/theme";
import { compactNumber, timeAgo } from "@/lib/utils";
import { tap, success, warn } from "@/lib/haptics";
import { dataAPI } from "@/lib/data";
import { useUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { Share, Linking } from "react-native";
import { recipeUrl } from "@/lib/links";
import { isBlocked, unblockUser } from "@/lib/blocking"; // 👈 NEW

// Use semantic tokens from lib/theme for surface / borders to keep visuals uniform

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
  titleRightInset?: number; // pixels of right-side gap for the calories pill
  // Source attribution for imported recipes
  sourceUrl?: string | null;
  originalSourceUser?: string | null;
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
  const titleRightInset = props.titleRightInset ?? 66; // default keeps your current gap

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

  // 📤 share (use https so everything becomes a real, tappable link)
  const share = useCallback(async () => {
    const url = recipeUrl(id); // ex: https://messhall.app/r/ABC123
    await Share.share({
      message: `${title} on MessHall\n${url}`,
      url,
      title: `${title} – MessHall`,
    });
  }, [id, title]);

  // 🔍 open the recipe (tap big card)
  const open = useCallback(async () => {
    await tap();
    (onOpen ?? onOpenComments)?.(id);
  }, [id, onOpen, onOpenComments]);

  // 👤 open the creator profile (block-aware fallback)
  const safeOpenCreator = useCallback(async () => {
    try {
      if (!creator) return;
      // if parent provided a handler, use it (feed can override)
      if (typeof onOpenCreator === "function") {
        onOpenCreator(creator);
        return;
      }

      // Try RLS-read by user id if we have it; else resolve username → id
      let targetId: string | null = props.ownerId || null;
      if (!targetId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", creator)
          .maybeSingle();
        targetId = prof?.id ? String(prof.id) : null;
      }

      // If we still don't know the id, try to push but guard with neutral message on failure
      if (!targetId) {
        const { data: viewable } = await supabase
          .from("profiles")
          .select("username")
          .eq("username", creator)
          .maybeSingle();
        if (!viewable) {
          Alert.alert("M.I.A");
          return;
        }
        router.push({ pathname: "/u/[username]", params: { username: creator } });
        return;
      }

      // RLS gate: no row → blocked either way (or deleted)
      const { data: canSee } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", targetId)
        .maybeSingle();

      if (canSee) {
        router.push({ pathname: "/u/[username]", params: { username: creator, uid: targetId } });
        return;
      }

      // Nicety: if *I* blocked them, offer to unblock
      if (await isBlocked(targetId)) {
        Alert.alert(
          "You blocked this user",
          "Unblock to view their profile and content.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Unblock",
              style: "destructive",
              onPress: async () => {
                const ok = await unblockUser(targetId!);
                if (ok) router.push({ pathname: "/u/[username]", params: { username: creator, uid: targetId } });
                else Alert.alert("Sorry", "Couldn’t unblock. Try again.");
              },
            },
          ]
        );
      } else {
        Alert.alert("M.I.A."); // they blocked you or user is gone
      }
    } catch {
      Alert.alert("M.I.A.");
    }
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

  // 0) read cached pill immediately (so it sticks across app restarts/logout)
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const storage = await getStorage();
        const raw = await storage.getItem(calKey(id));
        if (!raw) return;
        const obj = JSON.parse(raw) as { total?: number|null; perServing?: number|null };
        if (!gone) {
          setCalTotal(typeof obj.total === "number" ? obj.total : null);
          setCalPerServ(typeof obj.perServing === "number" ? obj.perServing : null);
        }
      } catch {}
    })();
    return () => { gone = true; };
  }, [id]);
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
        // cache latest values so pill sticks next launch
        try {
          const storage = await getStorage();
          await storage.setItem(calKey(id), JSON.stringify({ total: t ?? null, perServing: p ?? null }));
        } catch {}
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
        async (payload: any) => {
          const t = (payload?.new as any)?.calories_total;
          const p = (payload?.new as any)?.calories_per_serving;
          const T = typeof t === "number" && t > 0 ? t : null;
          const P = typeof p === "number" && p > 0 ? p : null;
          setCalTotal(T);
          setCalPerServ(P);
          // cache
          try {
            const storage = await getStorage();
            await storage.setItem(calKey(id), JSON.stringify({ total: T, perServing: P }));
          } catch {}
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
      {/* CHANGE #1: Use unified card surface style so it matches rails */}
      <HapticButton onPress={open} style={styles.cardWrap}>
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
                <MaterialCommunityIcons name="pencil" size={16} color={COLORS.text} />
                
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
            <View style={[styles.titleSticker, { right: titleRightInset }]}>
              <Text style={styles.titleText} numberOfLines={2}>
                {title}
              </Text>
            </View>
          </View>

          {/* ===== BYLINE ===== */}
          <View style={styles.row}>
            <TouchableOpacity onPress={safeOpenCreator} activeOpacity={0.8} style={styles.creatorWrap}>
              <AvatarTiny creator={creator} creatorAvatar={creatorAvatar} />
              <Text style={styles.creator} numberOfLines={1}>
                {creator}
              </Text>
            </TouchableOpacity>

            {/* 💚 author medal count */}
            {props.knives > 0 && (
              <View style={styles.pill}>
                <MaterialCommunityIcons name="medal" size={12} color={COLORS.text} />
                <Text style={styles.pillText}>{compactNumber(props.knives)}</Text>
              </View>
            )}

            <View style={{ flex: 1 }} />
            <Text style={styles.dim}>{timeAgo(createdAt as any)}</Text>
          </View>

          {/* ===== SOURCE ATTRIBUTION (for imported recipes) ===== */}
          {props.originalSourceUser && props.sourceUrl && (
            <View style={styles.sourceAttribution}>
              <Text style={styles.sourceLabel}>Original: </Text>
              <TouchableOpacity
                onPress={() => {
                  Linking.openURL(props.sourceUrl!).catch(() => {});
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.sourceLink}>{props.originalSourceUser}</Text>
              </TouchableOpacity>
            </View>
          )}

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
              <HapticButton onPress={toggleLike} style={([styles.likeBtn, liked ? styles.likeBtnActive : undefined] as any)}>
                <Ionicons
                  name={liked ? "heart" : "heart-outline"}
                  size={16}
                  color={liked ? COLORS.accent : COLORS.text}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.likeText, liked ? { color: COLORS.accent, fontWeight: "800" } : undefined]}>
                  Like
                </Text>
              </HapticButton>
            )}

            {/* 💾 save btn (active+green when saved) */}
            {!isOwner && (
              <HapticButton
                onPress={props.onToggleSave}
                style={([styles.saveBtn, props.isSaved ? styles.saveBtnActive : undefined] as any)}
              >
                <Ionicons
                  name={props.isSaved ? "bookmark" : "bookmark-outline"}
                  size={16}
                  color={props.isSaved ? COLORS.accent : COLORS.text}
                  style={{ marginRight: 6 }}
                />
                <Text
                style={([
                  styles.saveText,
                  props.isSaved ? { color: COLORS.accent, fontWeight: "800" } : undefined,
                  ] as any)}
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
                style={([
                  styles.cookedButton,
                  cooked ? styles.cookedButtonActive : undefined,
                  savingCook ? { opacity: 0.7 } : undefined,
                ] as any)}
              >
                  {savingCook ? (
                    <>
                      <ActivityIndicator />
                      <Text style={styles.cookedText}>Saving…</Text>
                    </>
                  ) : cooked ? (
                    <>
                      <Ionicons name="checkmark-circle" size={16} color={COLORS.accent} />
                      <Text style={[styles.cookedText, { color: COLORS.accent }]}>Cooked</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="restaurant-outline" size={16} color={COLORS.text} />
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
  style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.card }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: COLORS.card,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: COLORS.border,
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
  // NEW: wrapper so RecipeCard matches rails (only addition to styles)
  cardWrap: {
    borderRadius: RADIUS.xl,
    backgroundColor:  COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },

  imageWrap: { position: "relative", marginBottom: 8 },
  img: { width: "100%", height: 240, borderRadius: 16 },

  // 🧱 fallback block when there is no image URL
  imgFallback: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.overlay,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    elevation: 10,
  },

  // 👉 BOTTOM-RIGHT calorie pill
  caloriePillPos: {
    position: "absolute",
    bottom: 4,
    right: 10,
    zIndex: 9,
    elevation: 9,
  },

  titleSticker: {
    position: "absolute",
    left: 10,
    right: 88,
    bottom: 16,
    //maxWidth: "85%",
    backgroundColor: COLORS.overlay,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  titleText: { color: COLORS.text, fontSize: 16, fontWeight: "900" },

  row: { flexDirection: "row", alignItems: "center", marginBottom: 6 },

  creatorWrap: { flexDirection: "row", alignItems: "center", maxWidth: "55%" },
  creator: { color: COLORS.text, fontWeight: "600", fontSize: 14 },
  dim: { color: COLORS.subtext, fontSize: 12 },
  stat: { color: COLORS.subtext, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, opacity: 0.9, marginTop: 2 },

  medalStat: { flexDirection: "row", alignItems: "center" },
  likeStat: { flexDirection: "row", alignItems: "center" },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginLeft: 8,
  },
  pillText: { color: COLORS.text, fontSize: 11, fontWeight: "800" },

  likeBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "transparent",
    marginRight: 8,
  },
  likeBtnActive: { borderColor: COLORS.accent, backgroundColor: COLORS.surface },
  likeText: { color: COLORS.text, fontWeight: "700", fontSize: 13 },

  // 💾 SAVE button styles
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "transparent",
  },
  saveBtnActive: { borderColor: COLORS.accent, backgroundColor: COLORS.surface },
  saveText: { color: COLORS.text, fontWeight: "700", fontSize: 13 },

  actionRow: { marginTop: 6 },
  // CHANGE #2: cooked button uses unified surface + border
  cookedButton: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cookedButtonActive: { backgroundColor: 'rgba(29,185,84,0.14)', borderColor: COLORS.accent },
  cookedText: { color: COLORS.text, fontWeight: "900", fontSize: 14 },

  ownerChip: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: COLORS.elevated,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  commentChipText: { color: COLORS.text, fontWeight: "700", fontSize: 12 },

  // Source attribution styles
  sourceAttribution: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
    marginBottom: 2,
    marginLeft: 32, // Align with creator text (avatar is ~24px + 8px margin)
  },
  sourceLabel: { color: COLORS.subtext, fontSize: 11, fontWeight: "600" },
  sourceLink: { color: COLORS.accent, fontSize: 11, fontWeight: "700", textDecorationLine: "underline" },

  commentsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    justifyContent: "center",
  },
  commentsText: { color: COLORS.text, fontWeight: "800", fontSize: 14 },
  commentsBadge: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  commentsBadgeText: { color: COLORS.text, fontWeight: "800", fontSize: 12 },
});

// ✅ memoized export so FlatList doesn’t re-render every card all the time
export default memo(RecipeCard);
