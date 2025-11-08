// app/(tabs)/enlisted-club.tsx
// Enlisted Club: TikTok-style vertical swipe feed for browsing cooking sessions

import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  ListRenderItemInfo,
  Pressable,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { COLORS, SPACING } from "../../lib/theme";
import { useUserId } from "../../lib/auth";
import { success, tap } from "../../lib/haptics";
import ThemedNotice from "../../components/ui/ThemedNotice";
import VideoStreamTwitch from "../../components/VideoStreamTwitch";
import VideoStreamYouTube from "../../components/VideoStreamYouTube";
import VideoStreamCloudflare from "../../components/VideoStreamCloudflare";
import VideoStreamAgora from "../../components/VideoStreamAgora";
import Constants from "expo-constants";

type Session = {
  id: string;
  host_id: string;
  recipe_id: string | null;
  title: string;
  description: string | null;
  status: "scheduled" | "active" | "ended" | "cancelled";
  max_participants: number;
  scheduled_start_at: string | null;
  started_at: string | null;
  total_tips_received_cents: number;
  room_id: string | null;
  video_url: string | null;
  created_at: string;
  host_profile: {
    username: string | null;
    avatar_url: string | null;
  } | null;
  recipe: {
    id: string;
    title: string;
    image_url: string | null;
  } | null;
  participant_count: number;
};

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get("window");

export default function EnlistedClubScreen() {
  const { userId } = useUserId();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const [notice, setNotice] = useState<{ visible: boolean; title: string; message: string }>({
    visible: false,
    title: "",
    message: "",
  });
  const [agoraAppId, setAgoraAppId] = useState<string | null>(null);
  const [countdowns, setCountdowns] = useState<Map<string, string>>(new Map()); // Session ID -> countdown string

  // Load Agora App ID
  useEffect(() => {
    let envAppId = process.env.EXPO_PUBLIC_AGORA_APP_ID;
    if (!envAppId) {
      envAppId = Constants.expoConfig?.extra?.agoraAppId as string | undefined;
      if (!envAppId) {
        envAppId = (Constants as any).manifest?.extra?.agoraAppId as string | undefined;
      }
    }
    if (envAppId) {
      setAgoraAppId(envAppId);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      // Load active and scheduled sessions (include video_url and room_id for previews)
      // Sort: active first, then by scheduled_start_at (soonest first), then by created_at
      const { data: sessionsData, error } = await supabase
        .from("enlisted_club_sessions")
        .select("*, video_url, room_id")
        .in("status", ["scheduled", "active"])
        .order("status", { ascending: true }) // active comes before scheduled alphabetically
        .order("scheduled_start_at", { ascending: true, nullsFirst: false }) // Soonest first
        .order("created_at", { ascending: false }) // Newest first as tiebreaker
        .limit(50);

      if (error) throw error;

      if (!sessionsData || sessionsData.length === 0) {
        setSessions([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Get unique host IDs and recipe IDs
      const hostIds = [...new Set(sessionsData.map((s: any) => s.host_id).filter(Boolean))];
      const recipeIds = [...new Set(sessionsData.map((s: any) => s.recipe_id).filter(Boolean))];

      // Load host profiles
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", hostIds);

      // Load recipes
      const { data: recipesData } = recipeIds.length > 0
        ? await supabase
            .from("recipes")
            .select("id, title, image_url")
            .in("id", recipeIds)
        : { data: [] };

      // Create lookup maps
      const profilesMap = new Map((profilesData || []).map((p: any) => [p.id, p]));
      const recipesMap = new Map((recipesData || []).map((r: any) => [r.id, r]));

      // Transform data to include participant count and related data
      const transformed = await Promise.all(
        sessionsData.map(async (s: any) => {
          // Get actual participant count
          const { count } = await supabase
            .from("enlisted_club_participants")
            .select("*", { count: "exact", head: true })
            .eq("session_id", s.id)
            .is("left_at", null);
          
          return {
            ...s,
            participant_count: count || 0,
            host_profile: profilesMap.get(s.host_id) || null,
            recipe: s.recipe_id ? (recipesMap.get(s.recipe_id) || null) : null,
          };
        })
      );

      // Sort on client side for better control:
      // 1. Active sessions first (by started_at, most recent first)
      // 2. Then scheduled sessions (by scheduled_start_at, soonest first)
      const sorted = [...transformed].sort((a, b) => {
        // Active sessions come first
        if (a.status === "active" && b.status !== "active") return -1;
        if (a.status !== "active" && b.status === "active") return 1;
        
        // Within active: sort by started_at (most recent first)
        if (a.status === "active" && b.status === "active") {
          const aStarted = a.started_at ? new Date(a.started_at).getTime() : 0;
          const bStarted = b.started_at ? new Date(b.started_at).getTime() : 0;
          return bStarted - aStarted; // Most recent first
        }
        
        // Within scheduled: sort by scheduled_start_at (soonest first)
        if (a.status === "scheduled" && b.status === "scheduled") {
          const aScheduled = a.scheduled_start_at ? new Date(a.scheduled_start_at).getTime() : Infinity;
          const bScheduled = b.scheduled_start_at ? new Date(b.scheduled_start_at).getTime() : Infinity;
          return aScheduled - bScheduled; // Soonest first
        }
        
        // Fallback: newest first
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      
      setSessions(sorted);
    } catch (err: any) {
      setLoading(false);
      setRefreshing(false);
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to load sessions" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [loadSessions])
  );

  // Countdown timer for scheduled sessions in feed
  useEffect(() => {
    const updateCountdowns = () => {
      const now = new Date().getTime();
      const newCountdowns = new Map<string, string>();
      
      sessions.forEach((session) => {
        if (session.status === "scheduled" && session.scheduled_start_at) {
          const scheduled = new Date(session.scheduled_start_at).getTime();
          const diff = scheduled - now;
          
          if (diff <= 0) {
            newCountdowns.set(session.id, "Starting now...");
          } else {
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            
            if (hours > 0) {
              newCountdowns.set(session.id, `${hours}h ${minutes}m`);
            } else if (minutes > 0) {
              newCountdowns.set(session.id, `${minutes}m ${seconds}s`);
            } else {
              newCountdowns.set(session.id, `${seconds}s`);
            }
          }
        }
      });
      
      setCountdowns(newCountdowns);
    };
    
    updateCountdowns();
    const interval = setInterval(updateCountdowns, 1000);
    
    return () => clearInterval(interval);
  }, [sessions]);

  // Real-time subscription for new sessions
  useEffect(() => {
    const channel = supabase
      .channel("enlisted_club_sessions")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "enlisted_club_sessions",
        },
        () => {
          loadSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadSessions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSessions();
    await success();
  }, [loadSessions]);

  const onJoinSession = useCallback(
    async (sessionId: string) => {
      if (!userId) {
        setNotice({ visible: true, title: "Sign In Required", message: "Please sign in to join a session." });
        return;
      }
      await tap();
      router.push(`/enlisted-club/${sessionId}`);
    },
    [userId]
  );

  const onCreateSession = useCallback(async () => {
    if (!userId) {
      setNotice({ visible: true, title: "Sign In Required", message: "Please sign in to create a session." });
      return;
    }
    await tap();
    router.push("/enlisted-club/create");
  }, [userId]);

  const formatTime = (iso: string | null) => {
    if (!iso) return null;
    const date = new Date(iso);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 0) return "Now";
    if (diffMins < 60) return `in ${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `in ${diffHours}h`;
    return date.toLocaleDateString();
  };

  const formatTips = (cents: number) => {
    if (cents === 0) return null;
    return `$${(cents / 100).toFixed(2)}`;
  };

  const renderSession = ({ item, index }: ListRenderItemInfo<Session>) => {
    // Ensure we only show LIVE for truly active sessions (not scheduled)
    const isActive = item.status === "active";
    const isScheduled = item.status === "scheduled";
    const hostAvatar = item.host_profile?.avatar_url;
    const hostUsername = item.host_profile?.username || "Chef";
    const recipeImage = item.recipe?.image_url;
    const recipeTitle = item.recipe?.title;
    // Only consider it "has video" if session is active AND there's actually a video stream
    const hasVideo = isActive && (item.video_url || item.room_id);
    const isVisible = Math.abs(currentIndex - index) <= 1; // Only play video if within 1 item of current
    
    // Detect video provider type first (needed for isActuallyLive check)
    let videoProvider: "twitch" | "youtube" | "cloudflare" | "jitsi" | "agora" | null = null;
    let videoSource: string | null = null;
    let agoraChannelName: string | null = null;
    
    if (hasVideo) {
      const videoUrl = item.video_url;
      const roomId = item.room_id;
      
      // Check for Agora first (agora:// prefix or room_id that looks like Agora channel)
      if (videoUrl?.startsWith("agora://")) {
        videoProvider = "agora";
        agoraChannelName = videoUrl.replace("agora://", "");
        videoSource = agoraChannelName;
      } else if (roomId && !roomId.startsWith("http") && !roomId.includes(".") && !roomId.includes("jit.si")) {
        // room_id is likely an Agora channel name (not a URL, no dots, not Jitsi)
        videoProvider = "agora";
        agoraChannelName = roomId;
        videoSource = roomId;
      } else if (videoUrl) {
        // Check other providers
        if (videoUrl.includes("twitch.tv")) {
          videoProvider = "twitch";
          const channelMatch = videoUrl.match(/twitch\.tv\/([^/?]+)/);
          if (channelMatch) videoSource = channelMatch[1];
        } else if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
          videoProvider = "youtube";
          const videoIdMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/);
          if (videoIdMatch) videoSource = videoIdMatch[1];
        } else if (videoUrl.includes("cloudflare") || videoUrl.includes(".m3u8")) {
          videoProvider = "cloudflare";
          videoSource = videoUrl;
        } else if (videoUrl.includes("jit.si") || videoUrl.includes("jitsi")) {
          videoProvider = "jitsi";
          videoSource = videoUrl;
        }
      }
    }
    
    // Only show LIVE if video has actually started streaming
    // For external providers (Twitch, YouTube, etc.), video_url means it's live
    // For Agora, room_id exists when room is created, but video might not be streaming yet
    // We'll be conservative: only show LIVE for external streams (video_url exists)
    // For Agora sessions, we'll show "STARTING" until video is actually streaming
    // (We can't easily detect if Agora video is streaming in the feed without rendering it)
    const isActuallyLive = isActive && !!item.video_url; // Only external streams are definitely live

    return (
      <Pressable
        onPress={() => onJoinSession(item.id)}
        style={{
          width: SCREEN_WIDTH,
          height: SCREEN_HEIGHT,
          backgroundColor: COLORS.bg,
        }}
      >
        {/* Fullscreen Background - Video Preview (if active) or Recipe Image */}
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          {hasVideo && isVisible && videoProvider && videoSource ? (
            // Live video preview (muted, autoplay)
            <View style={{ width: "100%", height: "100%" }}>
              {videoProvider === "twitch" && (
                <VideoStreamTwitch
                  channelName={videoSource}
                  isHost={false}
                  muted={true}
                  onError={() => {
                    // Fallback to recipe image on error
                  }}
                />
              )}
              {videoProvider === "youtube" && (
                <VideoStreamYouTube
                  videoId={videoSource}
                  isHost={false}
                  muted={true}
                  onError={() => {
                    // Fallback to recipe image on error
                  }}
                />
              )}
              {videoProvider === "cloudflare" && (
                <VideoStreamCloudflare
                  hlsUrl={videoSource}
                  isHost={false}
                  onError={() => {
                    // Fallback to recipe image on error
                  }}
                />
              )}
              {/* Jitsi preview would require a viewer-only component */}
              {videoProvider === "jitsi" && recipeImage && (
                <Image
                  source={{ uri: recipeImage }}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                />
              )}
              {/* Agora video preview */}
              {videoProvider === "agora" && agoraChannelName && agoraAppId && (
                <VideoStreamAgora
                  key={`agora-${item.id}-${agoraChannelName}`}
                  appId={agoraAppId}
                  channelName={agoraChannelName}
                  isHost={false}
                  showControls={false}
                  muteAudio={true}
                  onError={() => {
                    // Fallback to recipe image on error
                  }}
                />
              )}
            </View>
          ) : recipeImage ? (
            // Static recipe image for scheduled sessions or when no video
            <Image
              source={{ uri: recipeImage }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: "100%",
                height: "100%",
                backgroundColor: COLORS.card,
              }}
            />
          )}
          
          {/* Gradient Overlay - Dark bottom fade (TikTok style) */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.8)", "rgba(0,0,0,0.95)"]}
            locations={[0, 0.4, 0.7, 1]}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "65%",
            }}
          />
        </View>

        {/* Top Status Bar with Gradient */}
        <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }}>
          <LinearGradient
            colors={["rgba(0,0,0,0.6)", "rgba(0,0,0,0.3)", "transparent"]}
            locations={[0, 0.5, 1]}
            style={{
              paddingHorizontal: SPACING.lg,
              paddingVertical: SPACING.md,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View
                style={{
                  backgroundColor: isActuallyLive ? COLORS.accent : "rgba(0,0,0,0.7)",
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 20,
                  borderWidth: isActuallyLive ? 0 : 1,
                  borderColor: "rgba(255,255,255,0.3)",
                }}
              >
                <Text
                  style={{
                    color: isActuallyLive ? "#000" : "#fff",
                    fontWeight: "900",
                    fontSize: 11,
                    letterSpacing: 0.5,
                  }}
                >
                  {isActuallyLive ? "🔴 LIVE" : item.status === "scheduled" ? "⏰ SOON" : item.status === "active" ? "⏳ STARTING" : "ENDED"}
                </Text>
              </View>
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  onCreateSession();
                }}
                style={{
                  backgroundColor: "rgba(0,0,0,0.7)",
                  paddingHorizontal: 18,
                  paddingVertical: 9,
                  borderRadius: 20,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.2)",
                }}
              >
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 14 }}>Host</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </SafeAreaView>

        {/* Bottom Info Overlay - TikTok Style */}
        <SafeAreaView edges={["bottom"]} style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10 }}>
          <View
            style={{
              paddingBottom: SPACING.lg,
              paddingHorizontal: SPACING.lg,
              paddingTop: SPACING.md,
            }}
          >
            {/* Host Info Row */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              {hostAvatar ? (
                <Image
                  source={{ uri: hostAvatar }}
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    marginRight: 12,
                    borderWidth: 3,
                    borderColor: COLORS.accent,
                  }}
                />
              ) : (
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: COLORS.accent,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 12,
                    borderWidth: 3,
                    borderColor: COLORS.accent,
                  }}
                >
                  <Text style={{ color: "#000", fontWeight: "900", fontSize: 24 }}>
                    {hostUsername.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: "#fff",
                    fontWeight: "900",
                    fontSize: 19,
                    textShadowColor: "rgba(0,0,0,0.9)",
                    textShadowOffset: { width: 0, height: 2 },
                    textShadowRadius: 6,
                    marginBottom: 2,
                  }}
                >
                  @{hostUsername}
                </Text>
                {recipeTitle && (
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.95)",
                      fontSize: 13,
                      fontWeight: "600",
                      textShadowColor: "rgba(0,0,0,0.9)",
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 4,
                    }}
                  >
                    Cooking: {recipeTitle}
                  </Text>
                )}
              </View>
            </View>

            {/* Title */}
            <Text
              style={{
                color: "#fff",
                fontWeight: "900",
                fontSize: 26,
                marginBottom: 10,
                textShadowColor: "rgba(0,0,0,0.9)",
                textShadowOffset: { width: 0, height: 2 },
                textShadowRadius: 6,
                lineHeight: 32,
              }}
              numberOfLines={2}
            >
              {item.title}
            </Text>

            {/* Description */}
            {item.description && (
              <Text
                style={{
                  color: "rgba(255,255,255,0.95)",
                  fontSize: 16,
                  marginBottom: SPACING.md,
                  textShadowColor: "rgba(0,0,0,0.8)",
                  textShadowOffset: { width: 0, height: 1 },
                  textShadowRadius: 4,
                  lineHeight: 22,
                }}
                numberOfLines={3}
              >
                {item.description}
              </Text>
            )}

            {/* Stats Row */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: SPACING.lg,
                marginBottom: SPACING.md,
                flexWrap: "wrap",
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "rgba(0,0,0,0.4)",
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 16,
                }}
              >
                <Ionicons name="people" size={16} color="#fff" />
                <Text
                  style={{
                    color: "#fff",
                    marginLeft: 6,
                    fontSize: 14,
                    fontWeight: "800",
                  }}
                >
                  {item.participant_count}/{item.max_participants}
                </Text>
              </View>
              {item.total_tips_received_cents > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "rgba(29,185,84,0.25)",
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: COLORS.accent,
                  }}
                >
                  <Ionicons name="cash" size={16} color={COLORS.accent} />
                  <Text
                    style={{
                      color: COLORS.accent,
                      marginLeft: 6,
                      fontSize: 14,
                      fontWeight: "900",
                    }}
                  >
                    {formatTips(item.total_tips_received_cents)}
                  </Text>
                </View>
              )}
              {item.scheduled_start_at && (
                <View
                  style={{
                    backgroundColor: "rgba(0,0,0,0.6)",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.2)",
                  }}
                >
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: "700",
                      marginBottom: 2,
                    }}
                  >
                    Starts in:
                  </Text>
                  <Text
                    style={{
                      color: COLORS.accent,
                      fontSize: 16,
                      fontWeight: "900",
                    }}
                  >
                    {countdowns.get(item.id) || formatTime(item.scheduled_start_at)}
                  </Text>
                </View>
              )}
            </View>

            {/* Join Button */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                onJoinSession(item.id);
              }}
              style={{
                backgroundColor: COLORS.accent,
                paddingVertical: SPACING.md,
                paddingHorizontal: SPACING.lg,
                borderRadius: 16,
                alignItems: "center",
                marginTop: SPACING.sm,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 8,
              }}
            >
              <Text style={{ color: "#000", fontWeight: "900", fontSize: 17 }}>
                {isActive ? "Join Live Session" : isScheduled ? "Join Scheduled Session" : "View Session"}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Pressable>
    );
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index || 0);
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ThemedNotice
        visible={notice.visible}
        title={notice.title}
        message={notice.message}
        onClose={() => setNotice({ visible: false, title: "", message: "" })}
        confirmText="OK"
      />
      {loading && sessions.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={{ color: COLORS.text, marginTop: SPACING.md }}>Loading sessions...</Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl }}>
          <Ionicons name="videocam-outline" size={64} color={COLORS.subtext} />
          <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 18, marginTop: 16 }}>
            No Active Sessions
          </Text>
          <Text style={{ color: COLORS.subtext, fontSize: 14, marginTop: 8, textAlign: "center" }}>
            Be the first to host a cooking session!
          </Text>
          <TouchableOpacity
            onPress={onCreateSession}
            style={{
              backgroundColor: COLORS.accent,
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 12,
              marginTop: SPACING.xl,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Ionicons name="add" size={20} color="#000" />
            <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>Host Session</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          pagingEnabled
          snapToInterval={SCREEN_HEIGHT}
          snapToAlignment="start"
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          refreshControl={
            <RefreshControl
              tintColor="#fff"
              refreshing={refreshing}
              onRefresh={onRefresh}
              style={{ backgroundColor: "transparent" }}
            />
          }
          getItemLayout={(data, index) => ({
            length: SCREEN_HEIGHT,
            offset: SCREEN_HEIGHT * index,
            index,
          })}
        />
      )}
    </View>
  );
}

