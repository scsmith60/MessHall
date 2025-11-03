// app/enlisted-club/[id].tsx
// Join and participate in an Enlisted Club cooking session

import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
  PermissionsAndroid,
  Linking,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import VideoStreamAgora from "../../components/VideoStreamAgora";
import VideoStreamTwitch from "../../components/VideoStreamTwitch";
import VideoStreamYouTube from "../../components/VideoStreamYouTube";
import { COLORS, SPACING } from "../../lib/theme";
import { useUserId } from "../../lib/auth";
import { success, tap, warn } from "../../lib/haptics";
import ThemedNotice from "../../components/ui/ThemedNotice";
import ThemedConfirm from "../../components/ui/ThemedConfirm";
import { useStripe } from "@stripe/stripe-react-native";

type Participant = {
  id: string;
  user_id: string;
  role: string;
  is_muted: boolean;
  is_video_enabled: boolean;
  profile: {
    username: string | null;
    avatar_url: string | null;
  } | null;
};

type Tip = {
  id: string;
  from_user_id: string;
  amount_cents: number;
  message: string | null;
  created_at: string;
  from_profile: {
    username: string | null;
  } | null;
};

type ChatMessage = {
  id: string;
  user_id: string;
  message: string;
  created_at: string;
  profile: {
    username: string | null;
    avatar_url: string | null;
  } | null;
};

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useUserId();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 16 : 0);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [session, setSession] = useState<any>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [recentTips, setRecentTips] = useState<Tip[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [isParticipant, setIsParticipant] = useState(false);
  const [tipModalVisible, setTipModalVisible] = useState(false);
  const [tipAmount, setTipAmount] = useState("5.00");
  const [tipMessage, setTipMessage] = useState("");
  const [tipping, setTipping] = useState(false);
  const [notice, setNotice] = useState<{ visible: boolean; title: string; message: string }>({
    visible: false,
    title: "",
    message: "",
  });
  const [endSessionConfirm, setEndSessionConfirm] = useState(false);
  const [hostHasStripe, setHostHasStripe] = useState<boolean | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [showParticipants, setShowParticipants] = useState(true);
  const [showReactions, setShowReactions] = useState(true);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState<number | null>(null); // seconds remaining
  const [isAdmin, setIsAdmin] = useState(false);
  const [usageInfo, setUsageInfo] = useState<{ total_minutes: number; limit_minutes: number; limit_reached: boolean } | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoRoomId, setVideoRoomId] = useState<string | null>(null);
  const [videoToken, setVideoToken] = useState<string | null>(null);
  const [agoraChannelName, setAgoraChannelName] = useState<string | null>(null);
  const [agoraAppId, setAgoraAppId] = useState<string | null>(null);
  const [streamProvider, setStreamProvider] = useState<"agora" | "twitch" | "youtube">("agora");
  const [twitchChannel, setTwitchChannel] = useState<string | null>(null);
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [startingVideo, setStartingVideo] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<Array<{ 
    id: string; 
    emoji: string; 
    x: Animated.Value; 
    y: Animated.Value; 
    opacity: Animated.Value;
    staticX: number;
    staticY: number;
  }>>([]);
  const floatingEmojiIdRef = useRef(0);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [userProfile, setUserProfile] = useState<{ username: string | null; avatar_url: string | null } | null>(null);

  // Load current user profile and ensure avatar URL is publicly accessible
  const loadUserProfile = useCallback(async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        let publicAvatarUrl = data.avatar_url;
        
        // If avatar_url is a storage path (not a full URL), convert it to public URL
        if (publicAvatarUrl && !publicAvatarUrl.startsWith("http")) {
          // Assume it's in the avatars bucket
          const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(publicAvatarUrl);
          publicAvatarUrl = publicUrlData?.publicUrl || publicAvatarUrl;
        }
        
        setUserProfile({
          username: data.username,
          avatar_url: publicAvatarUrl,
        });
      }
    } catch (err) {
      console.error("Failed to load user profile:", err);
    }
  }, [userId]);

  // Check if user is admin
  const checkAdmin = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", userId)
        .maybeSingle();
      setIsAdmin(!!data?.is_admin);
    } catch (err) {
      console.error("Failed to check admin status:", err);
    }
  }, [userId]);

  // Load Agora App ID from environment
  useEffect(() => {
    const envAppId = process.env.EXPO_PUBLIC_AGORA_APP_ID;
    if (envAppId) {
      setAgoraAppId(envAppId);
    } else {
      console.warn("[Agora] EXPO_PUBLIC_AGORA_APP_ID not found. Add it to your .env file.");
    }
  }, []);

  // Load monthly usage info (optional - function may not exist if migration not run)
  const loadUsageInfo = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_monthly_usage");
      if (error) {
        // Function doesn't exist yet or has SQL errors (migration not run or needs update) - this is OK
        if (error.code === "PGRST202" || error.code === "42702") {
          console.log("Usage tracking not available:", error.message || "migration not applied or needs update");
          return;
        }
        throw error;
      }
      if (data && data.length > 0) {
        setUsageInfo({
          total_minutes: data[0].total_minutes || 0,
          limit_minutes: data[0].limit_minutes || 100000,
          limit_reached: data[0].limit_reached || false,
        });
      }
    } catch (err: any) {
      // Silently handle missing function - it's optional
      if (err?.code === "PGRST202") {
        console.log("Usage tracking not available (migration not applied)");
        return;
      }
      console.error("Failed to load usage info:", err);
    }
  }, []);

  const loadSession = useCallback(async () => {
    if (!id) return;

    try {
      const { data, error } = await supabase
        .from("enlisted_club_sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setNotice({ visible: true, title: "Session Not Found", message: "This session doesn't exist." });
        setTimeout(() => router.back(), 2000);
        return;
      }

      // Check if session was admin-killed
      if (data.admin_killed) {
        setNotice({
          visible: true,
          title: "Session Terminated",
          message: data.admin_kill_reason || "This session was terminated by an administrator.",
        });
      }

      // Load host profile separately
      const { data: hostProfile } = await supabase
        .from("profiles")
        .select("username, avatar_url")
        .eq("id", data.host_id)
        .maybeSingle();

      // Check if video room exists
      if (data.video_url || data.room_id) {
        const roomUrl = data.video_url || (data.room_id?.startsWith("http") 
          ? data.room_id 
          : `https://meet.jit.si/${data.room_id}`);
        setVideoRoomId(roomUrl);
        setVideoToken(roomUrl);
        
        // Detect provider type
        if (roomUrl.includes("twitch.tv")) {
          setStreamProvider("twitch");
          const channelMatch = roomUrl.match(/twitch\.tv\/([^/?]+)/);
          if (channelMatch) setTwitchChannel(channelMatch[1]);
        } else if (roomUrl.includes("youtube.com") || roomUrl.includes("youtu.be")) {
          setStreamProvider("youtube");
          const videoIdMatch = roomUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/);
          if (videoIdMatch) setYoutubeVideoId(videoIdMatch[1]);
        } else if (roomUrl.startsWith("agora://")) {
          setStreamProvider("agora");
          setAgoraChannelName(roomUrl.replace("agora://", ""));
        } else {
          setStreamProvider("agora"); // Default to Agora now
        }
      }

      // Load recipe if exists
      let recipe = null;
      if (data.recipe_id) {
        const { data: recipeData } = await supabase
          .from("recipes")
          .select("id, title, image_url")
          .eq("id", data.recipe_id)
          .maybeSingle();
        recipe = recipeData;
      }

      const sessionData = {
        ...data,
        host_profile: hostProfile || null,
        recipe: recipe,
      };

      setSession(sessionData);

      // Check if host has Stripe set up
      if (data.host_id) {
        const { data: hostStripe } = await supabase
          .from("profiles")
          .select("stripe_account_id")
          .eq("id", data.host_id)
          .maybeSingle();
        setHostHasStripe(!!hostStripe?.stripe_account_id);
      }

      // Note: Timer will be started in useEffect after component mounts
    } catch (err: any) {
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to load session." });
    }
  }, [id]);

  const loadParticipants = useCallback(async () => {
    if (!id) return;

    try {
      // Load participants
      const { data: participantsData, error } = await supabase
        .from("enlisted_club_participants")
        .select("*")
        .eq("session_id", id)
        .is("left_at", null)
        .order("joined_at", { ascending: false });

      if (error) throw error;

      if (!participantsData || participantsData.length === 0) {
        setParticipants([]);
        setIsParticipant(false);
        return;
      }

      // Get unique user IDs
      const userIds = [...new Set(participantsData.map((p: any) => p.user_id).filter(Boolean))];

      // Load profiles separately
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", userIds);

      // Create lookup map
      const profilesMap = new Map((profilesData || []).map((p: any) => [p.id, p]));

      // Transform data with profiles
      const transformed = participantsData.map((p: any) => ({
        ...p,
        profile: profilesMap.get(p.user_id) || null,
      }));

      setParticipants(transformed);
      setIsParticipant(transformed.some((p) => p.user_id === userId));
    } catch (err: any) {
      console.error("Failed to load participants:", err);
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to load participants." });
    }
  }, [id, userId]);

  const loadChatMessages = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from("enlisted_club_messages")
        .select("id, user_id, message, created_at")
        .eq("session_id", id)
        .order("created_at", { ascending: true })
        .limit(100);

      if (error) {
        // If table doesn't exist (PGRST205), just set empty array - migration hasn't been run yet
        if (error.code === "PGRST205") {
          console.log("Chat table not found - migration needs to be applied");
          setChatMessages([]);
          return;
        }
        throw error;
      }

      // Get unique user IDs
      const userIds = [...new Set((data || []).map((m: any) => m.user_id))];
      
      if (userIds.length === 0) {
        setChatMessages([]);
        return;
      }

      // Load profiles separately
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", userIds);

      const profilesMap = new Map((profilesData || []).map((p: any) => [p.id, p]));

      // Transform data
      const transformed = (data || []).map((m: any) => ({
        ...m,
        profile: profilesMap.get(m.user_id) || null,
      }));

      setChatMessages(transformed);
    } catch (err: any) {
      // Gracefully handle errors - chat is optional
      console.error("Failed to load chat messages:", err);
      setChatMessages([]);
    }
  }, [id]);

  const sendReaction = useCallback(async (emoji: string) => {
    if (!userId || !id || (session?.status !== "active" && session?.status !== "scheduled")) return;

    await tap();

    // Create floating emoji animation
    const emojiId = `emoji_${floatingEmojiIdRef.current++}`;
    const startX = Dimensions.get("window").width / 2;
    const startY = Dimensions.get("window").height * 0.7;
    
    // For native driver, we need to start translate values at 0
    const translateXAnim = new Animated.Value(0);
    const translateYAnim = new Animated.Value(0);
    const opacityAnim = new Animated.Value(1);

    // Store static position for rendering
    const staticX = startX;
    const staticY = startY;
    const randomOffset = (Math.random() - 0.5) * 100;

    setFloatingEmojis((prev) => [...prev, { 
      id: emojiId, 
      emoji, 
      x: translateXAnim, 
      y: translateYAnim, 
      opacity: opacityAnim,
      staticX,
      staticY,
    }]);

    // Animate floating emoji
    Animated.parallel([
      Animated.timing(translateYAnim, {
        toValue: -200, // Move up 200 pixels
        duration: 2000,
        useNativeDriver: true,
      }),
      Animated.timing(translateXAnim, {
        toValue: randomOffset, // Random horizontal drift
        duration: 2000,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(1500),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      setFloatingEmojis((prev) => prev.filter((e) => e.id !== emojiId));
    });

    try {
      const { error } = await supabase.from("enlisted_club_reactions").insert({
        session_id: id,
        user_id: userId,
        emoji: emoji,
      });

      if (error) {
        if (error.code === "PGRST205") {
          // Table doesn't exist yet - just ignore
        } else if (error.code === "42501") {
          // RLS policy error - check if user is host
          const isHostUser = session?.host_id === userId;
          if (!isHostUser) {
            console.error("RLS policy violation - user cannot send reaction");
          }
        } else {
          throw error;
        }
      }
    } catch (err: any) {
      // Silently fail - reactions are optional
      console.error("Failed to send reaction:", err);
    }
  }, [userId, id, session?.status, session?.host_id]);

  const sendChatMessage = useCallback(async () => {
    if (!userId || !id || !chatText.trim() || sendingChat) return;

    const messageText = chatText.trim();
    setChatText("");
    setSendingChat(true);
    await tap();

    try {
      const { error } = await supabase.from("enlisted_club_messages").insert({
        session_id: id,
        user_id: userId,
        message: messageText,
      });

      if (error) {
        // Handle case where table doesn't exist
        if (error.code === "PGRST205") {
          await warn();
          setNotice({
            visible: true,
            title: "Chat Not Available",
            message: "Chat feature requires a database migration. Please contact support or check the migration file.",
          });
          setChatText(messageText);
          return;
        }
        throw error;
      }

      // Reload messages to get the new one with profile
      await loadChatMessages();
    } catch (err: any) {
      await warn();
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to send message." });
      setChatText(messageText); // Restore text on error
    } finally {
      setSendingChat(false);
    }
  }, [userId, id, chatText, sendingChat, loadChatMessages]);

  const loadRecentTips = useCallback(async () => {
    if (!id) return;

    try {
      // Load tips
      const { data: tipsData, error } = await supabase
        .from("enlisted_club_tips")
        .select("*")
        .eq("session_id", id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      if (!tipsData || tipsData.length === 0) {
        setRecentTips([]);
        return;
      }

      // Get unique user IDs
      const userIds = [...new Set(tipsData.map((t: any) => t.from_user_id).filter(Boolean))];

      // Load profiles separately
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", userIds);

      // Create lookup map
      const profilesMap = new Map((profilesData || []).map((p: any) => [p.id, { username: p.username }]));

      // Transform data with profiles
      const transformed = tipsData.map((t: any) => ({
        ...t,
        from_profile: profilesMap.get(t.from_user_id) || null,
      }));

      setRecentTips(transformed as Tip[]);
    } catch (err: any) {
      console.error("Failed to load tips:", err);
    }
  }, [id]);

  // Countdown timer for scheduled sessions
  useEffect(() => {
    if (!session || session.status !== "scheduled" || !session.scheduled_start_at) {
      setCountdown(null);
      return;
    }

    const updateCountdown = () => {
      const now = new Date().getTime();
      const scheduled = new Date(session.scheduled_start_at).getTime();
      const diff = scheduled - now;

      if (diff <= 0) {
        setCountdown(null);
        // Auto-start if host - using Alert instead
        if (userId && session.host_id === userId) {
          onStartSession();
        }
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [session, userId]);


  useEffect(() => {
    loadSession();
    loadParticipants();
    loadUserProfile();
    checkAdmin();
    loadUsageInfo();
    loadRecentTips();
    loadChatMessages();
    setLoading(false);
  }, [loadSession, loadParticipants, loadUserProfile, checkAdmin, loadUsageInfo, loadRecentTips, loadChatMessages]);

  // Real-time subscriptions
  useEffect(() => {
    if (!id) return;

    const sessionChannel = supabase
      .channel(`session_${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "enlisted_club_sessions",
          filter: `id=eq.${id}`,
        },
        (payload) => {
          setSession((prev: any) => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe();

    const participantsChannel = supabase
      .channel(`participants_${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "enlisted_club_participants",
          filter: `session_id=eq.${id}`,
        },
        () => {
          loadParticipants();
        }
      )
      .subscribe();

    const tipsChannel = supabase
      .channel(`tips_${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "enlisted_club_tips",
          filter: `session_id=eq.${id}`,
        },
        (payload) => {
          loadRecentTips();
          // Show tip notification
          const tip = payload.new as any;
          if (tip.from_user_id !== userId) {
            setNotice({
              visible: true,
              title: "💰 New Tip!",
              message: `$${(tip.amount_cents / 100).toFixed(2)} received!`,
            });
          }
        }
      )
      .subscribe();

    // Only subscribe to chat if table exists (will fail silently if table doesn't exist)
    const chatChannel = supabase
      .channel(`chat_${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "enlisted_club_messages",
          filter: `session_id=eq.${id}`,
        },
        () => {
          loadChatMessages();
        }
      )
      .subscribe((status) => {
        // Silently handle subscription failures (table might not exist yet)
        if (status === "CHANNEL_ERROR") {
          console.log("Chat subscription unavailable (table may not exist)");
        }
      });

    // Subscribe to reactions for real-time emoji updates
    const reactionsChannel = supabase
      .channel(`reactions_${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "enlisted_club_reactions",
          filter: `session_id=eq.${id}`,
        },
        () => {
          // Reactions are recorded but we don't show floating animations anymore
        }
      )
      .subscribe((status) => {
        // Silently handle subscription failures (table might not exist yet)
        if (status === "CHANNEL_ERROR") {
          console.log("Reactions subscription unavailable (table may not exist)");
        }
      });

    return () => {
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(participantsChannel);
      supabase.removeChannel(tipsChannel);
      supabase.removeChannel(chatChannel);
      supabase.removeChannel(reactionsChannel);
    };
  }, [id, userId, loadParticipants, loadRecentTips, loadChatMessages]);

  const onJoin = async () => {
    if (!userId || !id) {
      setNotice({ visible: true, title: "Sign In Required", message: "Please sign in to join." });
      return;
    }

    setJoining(true);
    try {
      const { error } = await supabase.from("enlisted_club_participants").insert({
        session_id: id,
        user_id: userId,
        role: "viewer",
      });

      if (error) throw error;

      await success();
      setIsParticipant(true);
      await loadParticipants();
      
      // Auto-join video if host has already started streaming
      if (session && session.status === "active" && session.room_id) {
        // Small delay to let UI update
        setTimeout(async () => {
          await joinVideo();
        }, 500);
      }
    } catch (err: any) {
      await warn();
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to join session." });
    } finally {
      setJoining(false);
    }
  };

  const [confirmAction, setConfirmAction] = useState<{ type: "start" | "end" | null }>({ type: null });

  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ];

      const currentStatuses = await Promise.all(
        permissions.map(async (perm) => ({
          permission: perm,
          granted: await PermissionsAndroid.check(perm),
        }))
      );

      const allGranted = currentStatuses.every(({ granted }) => granted);
      if (allGranted) return true;

      const result = await PermissionsAndroid.requestMultiple(permissions);

      const cameraStatus = result[PermissionsAndroid.PERMISSIONS.CAMERA];
      const micStatus = result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];

      const cameraGranted = cameraStatus === PermissionsAndroid.RESULTS.GRANTED;
      const micGranted = micStatus === PermissionsAndroid.RESULTS.GRANTED;

      if (cameraGranted && micGranted) {
        return true;
      }

      const permanentlyDenied =
        cameraStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
        micStatus === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

      if (permanentlyDenied) {
        Alert.alert(
          "Enable Camera & Mic",
          "Android is blocking camera/mic for MessHall. Please open App Settings and enable both permissions.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => Linking.openSettings(),
            },
          ]
        );
      }

      return false;
    }
    return true; // iOS handles permissions automatically
  };

  const startVideo = async () => {
    if (!userId || !id || !session || !isHost) return;

    setStartingVideo(true);
    await tap();

    try {
      // Request permissions first
      const hasPermissions = await requestPermissions();
      if (!hasPermissions) {
        setNotice({
          visible: true,
          title: "Permissions Required",
          message: "Camera and microphone permissions are required for video streaming.",
        });
        setStartingVideo(false);
        return;
      }

      // Create or get Agora channel (native SDK - no WebView issues!)
      const { data, error } = await supabase.functions.invoke("agora-create-room", {
        body: {
          session_id: id,
          user_id: userId,
        },
      });

      if (error) {
        // Try to extract more details from the error
        const statusCode = (error as any)?.status || (error as any)?.context?.status || "unknown";
        const errorMessage = (error as any)?.message || error.toString();
        const errorData = (error as any)?.context?.body || (error as any)?.body;
        
        console.error("Jitsi edge function error:", {
          error,
          statusCode,
          errorMessage,
          errorData,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        });
        
        // Try to extract error message from response body if available
        let detailedError = errorMessage;
        if (errorData && typeof errorData === 'object' && errorData.error) {
          detailedError = errorData.error;
        } else if (errorData && typeof errorData === 'string') {
          try {
            const parsed = JSON.parse(errorData);
            detailedError = parsed.error || detailedError;
          } catch {
            detailedError = errorData;
          }
        }
        
        throw new Error(`Edge function error (${statusCode}): ${detailedError || "Unknown error. Check if function is deployed."}`);
      }

      if (!data || !data.ok) {
        const errorMsg = data?.error || "Failed to create video room";
        console.error("Agora room creation failed:", errorMsg, data);
        throw new Error(errorMsg);
      }

      // Agora returns channel_name instead of room_url
      const channelName = data.channel_name || data.room_id;
      setAgoraChannelName(channelName);
      setVideoRoomId(channelName); // Keep for compatibility
      setVideoToken(data.token || null);
      setStreamProvider("agora");
      setVideoReady(true);
      await success();

      // If session isn't active yet, activate it
      if (session.status !== "active") {
        const startedAt = new Date().toISOString();
        await supabase
          .from("enlisted_club_sessions")
          .update({
            status: "active",
            started_at: startedAt,
          })
          .eq("id", id);
        await loadSession();
        
        // Timer will start automatically via useEffect when session updates
      }
    } catch (err: any) {
      await warn();
      setNotice({
        visible: true,
        title: "Video Error",
        message: err?.message || "Failed to start video.",
      });
    } finally {
      setStartingVideo(false);
    }
  };

  const joinVideo = async () => {
    if (!userId || !id || !session || !isParticipant || !isActive) return;

    setStartingVideo(true);
    try {
      const hasPermissions = await requestPermissions();
      if (!hasPermissions) {
        setNotice({
          visible: true,
          title: "Permissions Required",
          message: "Camera and microphone permissions are required for video streaming.",
        });
        setStartingVideo(false);
        return;
      }

      // Get Agora channel for participant via edge function
      const { data, error } = await supabase.functions.invoke("agora-create-room", {
        body: {
          session_id: id,
          user_id: userId,
        },
      });

      if (error) {
        // Try to extract more details from the error
        const statusCode = (error as any)?.status || (error as any)?.context?.status || "unknown";
        const errorMessage = (error as any)?.message || error.toString();
        const errorData = (error as any)?.context?.body || (error as any)?.body;
        
        console.error("Agora get-channel error:", {
          error,
          statusCode,
          errorMessage,
          errorData,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        });
        
        // Try to extract error message from response body if available
        let detailedError = errorMessage;
        if (errorData && typeof errorData === 'object' && errorData.error) {
          detailedError = errorData.error;
        } else if (errorData && typeof errorData === 'string') {
          try {
            const parsed = JSON.parse(errorData);
            detailedError = parsed.error || detailedError;
          } catch {
            detailedError = errorData;
          }
        }
        
        throw new Error(`Edge function error (${statusCode}): ${detailedError || "Unknown error. Check if function is deployed."}`);
      }

      if (!data || !data.ok) {
        const errorMsg = data?.error || "Failed to get video room";
        console.error("Agora get-channel failed:", errorMsg, data);
        throw new Error(errorMsg);
      }

      // Agora returns channel_name, not room_url
      const channelName = data.channel_name || data.room_url?.replace("agora://", "");
      if (channelName) {
        setAgoraChannelName(channelName);
        setVideoRoomId(channelName);
        setVideoToken(data.token || null);
      }
      setStreamProvider("agora");

      setVideoReady(true);
      await success();
    } catch (err: any) {
      await warn();
      setNotice({
        visible: true,
        title: "Video Error",
        message: err?.message || "Failed to join video.",
      });
    } finally {
      setStartingVideo(false);
    }
  };

  const onStartSession = async () => {
    if (!userId || !id || !session) return;
    Alert.alert(
      "Start Session?",
      "Are you ready to go live? This will make the session active and allow participants to join.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start Live",
          onPress: async () => {
            try {
              const { error } = await supabase
                .from("enlisted_club_sessions")
                .update({
                  status: "active",
                  started_at: new Date().toISOString(),
                })
                .eq("id", id)
                .eq("host_id", userId);

              if (error) throw error;

              await success();
              await loadSession();
            } catch (err: any) {
              await warn();
              setNotice({ visible: true, title: "Error", message: err?.message || "Failed to start session." });
            }
          },
        },
      ]
    );
  };

  // Admin kill session function
  const adminKillSession = useCallback(async (reason?: string) => {
    if (!isAdmin || !id) return;

    Alert.alert(
      "Kill Session?",
      reason ? `Reason: ${reason}\n\nThis will immediately end the session for all participants.` : "This will immediately end the session for all participants.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Kill Session",
          style: "destructive",
          onPress: async () => {
            try {
              const { data, error } = await supabase.functions.invoke("admin-kill-session", {
                body: {
                  session_id: id,
                  reason: reason || "Session terminated by administrator",
                },
              });

              if (error || !data?.ok) {
                throw new Error(error?.message || data?.error || "Failed to kill session");
              }

              await success();
              setNotice({
                visible: true,
                title: "Session Terminated",
                message: "The session has been terminated successfully.",
              });
              
              // Reload session to show updated status
              await loadSession();
            } catch (err: any) {
              await warn();
              setNotice({
                visible: true,
                title: "Error",
                message: err?.message || "Failed to kill session.",
              });
            }
          },
        },
      ]
    );
  }, [isAdmin, id, loadSession]);

  const onEndSession = async () => {
    if (!userId || !id || !session) return;
    setEndSessionConfirm(true);
  };

  const confirmEndSession = async () => {
    if (!userId || !id || !session || session.host_id !== userId) {
      // Only host can end session
      setEndSessionConfirm(false);
      setNotice({
        visible: true,
        title: "Permission Denied",
        message: "Only the host can end the session.",
      });
      return;
    }
    setEndSessionConfirm(false);
    
    try {
      const { error } = await supabase
        .from("enlisted_club_sessions")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("host_id", userId);

      if (error) throw error;

      await success();
      setNotice({
        visible: true,
        title: "Session Ended",
        message: "Thanks for hosting! Participants can no longer join.",
      });
      setTimeout(() => router.back(), 2000);
    } catch (err: any) {
      await warn();
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to end session." });
    }
  };

  const onLeave = async () => {
    if (!userId || !id) return;

    setNotice({
      visible: true,
      title: "Leave Session?",
      message: "Are you sure you want to leave?",
    });
    // TODO: Add confirmation dialog component
    // For now, just leave without confirmation
    try {
      const { error } = await supabase
        .from("enlisted_club_participants")
        .update({ left_at: new Date().toISOString() })
        .eq("session_id", id)
        .eq("user_id", userId)
        .is("left_at", null);

      if (error) throw error;

      router.back();
    } catch (err: any) {
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to leave." });
    }
  };

  const onSendTip = async () => {
    if (!userId || !id || !session) return;

    const amount = parseFloat(tipAmount);
    if (isNaN(amount) || amount < 0.5 || amount > 500) {
      await warn();
      setNotice({ visible: true, title: "Invalid Amount", message: "Tip must be between $0.50 and $500.00" });
      return;
    }

    setTipping(true);
    try {
      const { data, error } = await supabase.functions.invoke("enlisted-club-tip", {
        body: {
          session_id: id,
          to_user_id: session.host_id,
          amount_cents: Math.round(amount * 100),
          message: tipMessage.trim() || null,
        },
      });

      if (error || !data?.ok) {
        throw new Error(error?.message || data?.error || "Failed to send tip");
      }

      // Handle payment if client_secret is returned
      if (data.tip?.client_secret) {
        // Initialize Stripe payment sheet
        const { error: initError } = await initPaymentSheet({
          paymentIntentClientSecret: data.tip.client_secret,
          merchantDisplayName: "MessHall",
        });

        if (initError) {
          throw new Error(initError.message || "Failed to initialize payment");
        }

        // Present payment sheet
        const { error: paymentError } = await presentPaymentSheet();

        if (paymentError) {
          // User cancelled or payment failed
          if (paymentError.code === "Canceled") {
            setNotice({
              visible: true,
              title: "Payment Cancelled",
              message: "Tip payment was cancelled.",
            });
          } else {
            throw new Error(paymentError.message || "Payment failed");
          }
          return;
        }

        // Payment successful!
        await success();
        setTipModalVisible(false);
        setTipAmount("5.00");
        setTipMessage("");
        setNotice({
          visible: true,
          title: "Tip Sent!",
          message: `$${amount.toFixed(2)} tip sent successfully!`,
        });
        await loadRecentTips();
      } else {
        // No payment required (shouldn't happen, but handle gracefully)
        await success();
        setTipModalVisible(false);
        setTipAmount("5.00");
        setTipMessage("");
        setNotice({ visible: true, title: "Tip Sent!", message: `$${amount.toFixed(2)} tip sent!` });
        await loadRecentTips();
      }
    } catch (err: any) {
      await warn();
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to send tip." });
    } finally {
      setTipping(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: COLORS.text }}>Session not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isHost = session.host_id === userId;
  const isActive = session.status === "active";

  const screenHeight = Dimensions.get("window").height;
  const screenWidth = Dimensions.get("window").width;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* TikTok-style Fullscreen Layout */}
      {videoReady && videoRoomId ? (
        <View style={{ flex: 1, position: "relative" }}>
          {/* Fullscreen Video Background */}
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }}>
            {streamProvider === "twitch" && twitchChannel ? (
              <VideoStreamTwitch
                channelName={twitchChannel}
                isHost={isHost}
                onError={(error: string) => {
                  setNotice({
                    visible: true,
                    title: "Video Error",
                    message: error || "Failed to load Twitch stream.",
                  });
                }}
              />
            ) : streamProvider === "youtube" && youtubeVideoId ? (
              <VideoStreamYouTube
                videoId={youtubeVideoId}
                isHost={isHost}
                onError={(error: string) => {
                  setNotice({
                    visible: true,
                    title: "Video Error",
                    message: error || "Failed to load YouTube stream.",
                  });
                }}
              />
            ) : agoraChannelName && agoraAppId ? (
              <VideoStreamAgora
                appId={agoraAppId}
                channelName={agoraChannelName}
                token={videoToken || undefined}
                isHost={isHost}
                displayName={userProfile?.username || undefined}
                onError={(error: string) => {
                  setNotice({
                    visible: true,
                    title: "Video Error",
                    message: error || "Failed to load video stream. Try Twitch/YouTube option.",
                  });
                }}
                onReady={() => {
                  console.log("Agora video ready");
                  setVideoReady(true);
                }}
              />
            ) : agoraChannelName ? (
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.card }}>
                <Text style={{ color: COLORS.text, textAlign: "center", padding: 20 }}>
                  Agora App ID not configured. Please add AGORA_APP_ID to your environment.
                </Text>
              </View>
            ) : null}
          </View>

          {/* Floating Emoji Reactions Overlay */}
          {floatingEmojis.map((emojiItem) => (
            <Animated.View
              key={emojiItem.id}
              style={{
                position: "absolute",
                left: emojiItem.staticX - 25, // Center the emoji (50px width / 2)
                top: emojiItem.staticY - 25, // Center the emoji (50px height / 2)
                opacity: emojiItem.opacity,
                zIndex: 1000,
                transform: [
                  { translateX: emojiItem.x }, // Animated horizontal movement
                  { translateY: emojiItem.y }, // Animated vertical movement
                ],
              }}
            >
              <Text style={{ fontSize: 50 }}>{emojiItem.emoji}</Text>
            </Animated.View>
          ))}

          {/* Top Header Overlay */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              paddingTop: Platform.OS === "ios" ? 50 : 10,
              paddingHorizontal: SPACING.md,
              paddingBottom: SPACING.md,
              zIndex: 100,
              backgroundColor: "rgba(0,0,0,0.3)",
            }}
          >
            <SafeAreaView edges={["top"]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <TouchableOpacity onPress={() => router.back()}>
                  <Ionicons name="arrow-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ color: "#FFF", fontWeight: "900", fontSize: 16 }}>{session.title}</Text>
                    {isHost && (
                      <View
                        style={{
                          backgroundColor: COLORS.accent,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 6,
                        }}
                      >
                        <Text style={{ color: "#000", fontWeight: "800", fontSize: 9 }}>HOST</Text>
                      </View>
                    )}
                  </View>
                  {isActive && (
                    <View
                      style={{
                        backgroundColor: COLORS.accent,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 8,
                        marginTop: 4,
                      }}
                    >
                      <Text style={{ color: "#000", fontWeight: "800", fontSize: 10 }}>LIVE</Text>
                    </View>
                  )}
                </View>
                {isHost && isActive && (
                  <TouchableOpacity onPress={onEndSession}>
                    <Text style={{ color: "#FFF", fontWeight: "800" }}>End</Text>
                  </TouchableOpacity>
                )}
                {isHost && session.status === "scheduled" && (
                  <TouchableOpacity onPress={onStartSession}>
                    <Text style={{ color: "#FFF", fontWeight: "800" }}>Start</Text>
                  </TouchableOpacity>
                )}
                {isParticipant && !isHost && (
                  <TouchableOpacity onPress={onLeave}>
                    <Text style={{ color: "#FFF", fontWeight: "800" }}>Leave</Text>
                  </TouchableOpacity>
                )}
              </View>
            </SafeAreaView>
          </View>

          {/* Right-Side Action Buttons (TikTok-style) */}
          {/* Show buttons when participant/host AND (active session OR video is ready) */}
          {((isParticipant || isHost) && (isActive || videoReady)) && (
            <View
              style={{
                position: "absolute",
                right: SPACING.md,
                bottom: bottomInset + (showChat ? 280 : 80),
                zIndex: 100,
                gap: SPACING.md,
                alignItems: "center",
              }}
            >
              {/* Reaction Buttons */}
              {['❤️', '🔥', '👏', '💯'].map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => sendReaction(emoji)}
                  style={{
                    backgroundColor: COLORS.overlay,
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2,
                    borderColor: COLORS.border,
                  }}
                >
                  <Text style={{ fontSize: 24 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}

              {/* Tip Button (for participants only) - Always visible when participant */}
              {isParticipant && !isHost && (
                <TouchableOpacity
                  onPress={() => {
                    if (hostHasStripe === false) {
                      setNotice({
                        visible: true,
                        title: "Payments Not Set Up",
                        message: "This host hasn't set up payment receiving yet.",
                      });
                      return;
                    }
                    setTipModalVisible(true);
                  }}
                  style={{
                    backgroundColor: hostHasStripe === false ? COLORS.elevated : COLORS.accent,
                    width: 50,
                    height: 50,
                    borderRadius: 25,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2,
                    borderColor: COLORS.border,
                  }}
                >
                  <Ionicons name="cash" size={24} color={hostHasStripe === false ? COLORS.subtext : "#000"} />
                </TouchableOpacity>
              )}

              {/* Chat Toggle Button */}
              <TouchableOpacity
                onPress={() => setShowChat(!showChat)}
                style={{
                  backgroundColor: COLORS.overlay,
                  width: 50,
                  height: 50,
                  borderRadius: 25,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 2,
                  borderColor: showChat ? COLORS.accent : COLORS.border,
                  position: "relative",
                }}
              >
                <Ionicons name="chatbubble" size={24} color={COLORS.text} />
                {chatMessages.length > 0 && (
                  <View
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      backgroundColor: COLORS.accent,
                      borderRadius: 10,
                      minWidth: 20,
                      height: 20,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 4,
                    }}
                  >
                    <Text style={{ color: "#000", fontSize: 10, fontWeight: "800" }}>
                      {chatMessages.length > 99 ? "99+" : chatMessages.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Transparent Chat Bubbles Overlay (Bottom) */}
          {showChat && (isParticipant || isHost) && (
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 50, // Lower than buttons
                paddingHorizontal: SPACING.md,
                paddingBottom: bottomInset + SPACING.md,
                paddingTop: SPACING.lg,
                maxHeight: screenHeight * 0.35,
              }}
            >
              {/* Gradient Overlay for Chat */}
              <View
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 300 + bottomInset,
                  backgroundColor: COLORS.overlay,
                  zIndex: -1,
                }}
              />

              {/* Chat Messages */}
              <ScrollView
                style={{ maxHeight: 200, marginBottom: SPACING.sm }}
                contentContainerStyle={{ gap: SPACING.sm, paddingBottom: SPACING.sm }}
                showsVerticalScrollIndicator={false}
                ref={(ref) => {
                  if (ref && chatMessages.length > 0) {
                    setTimeout(() => ref.scrollToEnd({ animated: true }), 100);
                  }
                }}
              >
                {chatMessages.slice(-10).map((msg) => {
                  const isOwnMessage = msg.user_id === userId;
                  return (
                    <View
                      key={msg.id}
                      style={{
                        alignSelf: isOwnMessage ? "flex-end" : "flex-start",
                        maxWidth: "70%",
                        flexDirection: isOwnMessage ? "row-reverse" : "row",
                        gap: 6,
                        alignItems: "flex-end",
                        marginBottom: SPACING.sm,
                      }}
                    >
                      {/* Avatar */}
                      {msg.profile?.avatar_url ? (
                        <Image
                          source={{ uri: msg.profile.avatar_url }}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: COLORS.elevated,
                          }}
                        />
                      ) : (
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: COLORS.accent,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text style={{ color: "#000", fontSize: 12, fontWeight: "700" }}>
                            {(msg.profile?.username || "U").slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      {/* Message Bubble */}
                      <View
                        style={{
                          backgroundColor: isOwnMessage ? 'rgba(29, 185, 84, 0.5)' : COLORS.card, // More transparent green for own messages
                          paddingHorizontal: SPACING.sm,
                          paddingVertical: 6,
                          borderRadius: 18,
                        }}
                      >
                        <Text style={{ color: COLORS.text, fontSize: 10, fontWeight: "700", marginBottom: 2, opacity: isOwnMessage ? 0.8 : 1 }}>
                          {msg.profile?.username || "User"}
                        </Text>
                        <Text style={{ color: isOwnMessage ? "#000" : COLORS.text, fontSize: 13, fontWeight: isOwnMessage ? "600" : "400" }}>
                          {msg.message}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Chat Input */}
              {(isActive || session.status === "scheduled") && (
                <View style={{ flexDirection: "row", gap: SPACING.sm, alignItems: "flex-end" }}>
                  <TextInput
                    value={chatText}
                    onChangeText={setChatText}
                    placeholder="Say something..."
                    placeholderTextColor={COLORS.subtext}
                    multiline
                    maxLength={500}
                    style={{
                      flex: 1,
                      backgroundColor: COLORS.elevated,
                      color: COLORS.text,
                      padding: SPACING.sm,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      fontSize: 14,
                      maxHeight: 80,
                    }}
                    onSubmitEditing={sendChatMessage}
                    returnKeyType="send"
                  />
                  <TouchableOpacity
                    onPress={sendChatMessage}
                    disabled={!chatText.trim() || sendingChat}
                    style={{
                      backgroundColor: chatText.trim() ? COLORS.accent : COLORS.elevated,
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: chatText.trim() ? 1 : 0.5,
                    }}
                  >
                    {sendingChat ? (
                      <ActivityIndicator size="small" color={chatText.trim() ? "#000" : COLORS.text} />
                    ) : (
                      <Ionicons name="send" size={18} color={chatText.trim() ? "#000" : COLORS.text} />
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* Start Video Button (for host) */}
          {isHost && isActive && !videoReady && (
            <View
              style={{
                position: "absolute",
                bottom: bottomInset + (showChat ? 280 : 100),
                left: 0,
                right: 0,
                zIndex: 150, // Higher than chat
                alignItems: "center",
                paddingHorizontal: SPACING.lg,
              }}
            >
              <Pressable
                onPress={startVideo}
                disabled={startingVideo}
                style={{
                  backgroundColor: COLORS.accent,
                  paddingHorizontal: SPACING.xl,
                  paddingVertical: SPACING.md,
                  borderRadius: 25,
                  alignItems: "center",
                  flexDirection: "row",
                  gap: 8,
                  minWidth: 200,
                  justifyContent: "center",
                }}
              >
                {startingVideo ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <>
                    <Ionicons name="videocam" size={20} color="#000" />
                    <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>Start Video</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {/* Join Session Button (when not participant and not host) */}
          {!isParticipant && !isHost && (isActive || session.status === "scheduled") && !videoReady && (
            <View
              style={{
                position: "absolute",
                bottom: bottomInset + (showChat ? 280 : 100),
                left: 0,
                right: 0,
                zIndex: 150, // Higher than chat
                alignItems: "center",
                paddingHorizontal: SPACING.lg,
              }}
            >
              <Pressable
                onPress={onJoin}
                disabled={joining}
                style={{
                  backgroundColor: COLORS.accent,
                  paddingHorizontal: SPACING.xl,
                  paddingVertical: SPACING.md,
                  borderRadius: 25,
                  alignItems: "center",
                  minWidth: 200,
                }}
              >
                {joining ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>Join Session</Text>
                )}
              </Pressable>
            </View>
          )}

          {/* Join Video Button (for participants when host started) */}
          {isParticipant && !isHost && isActive && !videoReady && session.room_id && (
            <View
              style={{
                position: "absolute",
                bottom: bottomInset + (showChat ? 280 : 100),
                left: 0,
                right: 0,
                zIndex: 150, // Higher than chat
                alignItems: "center",
                paddingHorizontal: SPACING.lg,
              }}
            >
              <Pressable
                onPress={joinVideo}
                disabled={startingVideo}
                style={{
                  backgroundColor: COLORS.accent,
                  paddingHorizontal: SPACING.xl,
                  paddingVertical: SPACING.md,
                  borderRadius: 25,
                  alignItems: "center",
                  flexDirection: "row",
                  gap: 8,
                  minWidth: 200,
                  justifyContent: "center",
                }}
              >
                {startingVideo ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <>
                    <Ionicons name="videocam" size={20} color="#000" />
                    <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>Join Video</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </View>
      ) : (
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top"]}>
          {/* Traditional Layout When No Video */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: SPACING.lg,
              paddingVertical: SPACING.md,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.border,
            }}
          >
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 16 }}>{session.title}</Text>
              {isActive && (
                <>
                  <View
                    style={{
                      backgroundColor: COLORS.accent,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 8,
                      marginTop: 4,
                    }}
                  >
                    <Text style={{ color: "#000", fontWeight: "800", fontSize: 10 }}>LIVE</Text>
                  </View>
                  {sessionTimeRemaining !== null && sessionTimeRemaining > 0 && (
                    <View
                      style={{
                        marginTop: 4,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 6,
                        backgroundColor: sessionTimeRemaining < 300 ? COLORS.danger : COLORS.elevated,
                      }}
                    >
                      <Text
                        style={{
                          color: sessionTimeRemaining < 300 ? "#fff" : COLORS.subtext,
                          fontWeight: "700",
                          fontSize: 11,
                        }}
                      >
                        {Math.floor(sessionTimeRemaining / 60)}:{(sessionTimeRemaining % 60).toString().padStart(2, "0")} remaining
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
            {isAdmin && isActive && (
              <TouchableOpacity
                onPress={() => adminKillSession()}
                style={{ marginRight: 8 }}
              >
                <Ionicons name="warning" size={24} color={COLORS.danger} />
              </TouchableOpacity>
            )}
            {isHost && isActive && (
              <TouchableOpacity onPress={onEndSession}>
                <Text style={{ color: COLORS.danger, fontWeight: "800" }}>End</Text>
              </TouchableOpacity>
            )}
            {isHost && session.status === "scheduled" && (
              <TouchableOpacity onPress={onStartSession}>
                <Text style={{ color: COLORS.accent, fontWeight: "800" }}>Start</Text>
              </TouchableOpacity>
            )}
            {isParticipant && !isHost && (
              <TouchableOpacity onPress={onLeave}>
                <Text style={{ color: COLORS.danger, fontWeight: "800" }}>Leave</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACING.lg }}>
          {/* Usage Limit Warning */}
          {usageInfo?.limit_reached && (
            <ThemedNotice
              visible={true}
              title="Monthly Limit Reached"
              message={`Streaming is temporarily unavailable. Monthly usage: ${usageInfo.total_minutes.toLocaleString()}/${usageInfo.limit_minutes.toLocaleString()} minutes.`}
              onClose={() => {}}
            />
          )}

          {/* Admin Kill Warning */}
          {session?.admin_killed && (
            <View
              style={{
                backgroundColor: COLORS.danger + "20",
                borderLeftWidth: 4,
                borderLeftColor: COLORS.danger,
                padding: SPACING.md,
                borderRadius: 8,
                marginBottom: SPACING.md,
              }}
            >
              <Text style={{ color: COLORS.danger, fontWeight: "800", fontSize: 14, marginBottom: 4 }}>
                Session Terminated
              </Text>
              <Text style={{ color: COLORS.text, fontSize: 13 }}>
                {session.admin_kill_reason || "This session was terminated by an administrator."}
              </Text>
            </View>
          )}

          <View
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 12,
              padding: SPACING.xl,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: SPACING.lg,
              minHeight: 200,
            }}
          >
            {isActive ? (
              <>
                <Ionicons name="videocam" size={64} color={COLORS.accent} />
                <Text style={{ color: COLORS.text, marginTop: 12, fontSize: 16, fontWeight: "800" }}>
                  Session Live
                </Text>
                {isHost && !videoReady && (
                  <TouchableOpacity
                    onPress={startVideo}
                    disabled={startingVideo}
                    style={{
                      backgroundColor: COLORS.accent,
                      paddingHorizontal: SPACING.xl,
                      paddingVertical: SPACING.md,
                      borderRadius: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 20,
                    }}
                  >
                    {startingVideo ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <>
                        <Ionicons name="videocam" size={20} color="#000" />
                        <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>
                          Start Video
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
                {isParticipant && !videoReady && session.room_id && (
                  <TouchableOpacity
                    onPress={joinVideo}
                    disabled={startingVideo}
                    style={{
                      backgroundColor: COLORS.accent,
                      paddingHorizontal: SPACING.xl,
                      paddingVertical: SPACING.md,
                      borderRadius: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 20,
                    }}
                  >
                    {startingVideo ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <>
                        <Ionicons name="videocam" size={20} color="#000" />
                        <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>
                          Join Video
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </>
            ) : session.status === "scheduled" ? (
              <>
                <Ionicons name="time" size={64} color={COLORS.subtext} />
                <Text style={{ color: COLORS.text, marginTop: 12, fontSize: 16, fontWeight: "800" }}>
                  Scheduled Session
                </Text>
                <Text style={{ color: COLORS.subtext, marginTop: 6, fontSize: 13 }}>
                  Starts{" "}
                  {session.scheduled_start_at
                    ? new Date(session.scheduled_start_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "soon"}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={64} color={COLORS.subtext} />
                <Text style={{ color: COLORS.subtext, marginTop: 12, fontSize: 14 }}>
                  Session Ended
                </Text>
              </>
            )}
          </View>

        {/* Session Info */}
        <View style={{ marginBottom: SPACING.lg }}>
          <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 18, marginBottom: 8 }}>
            {session.description || session.title}
          </Text>
          {session.description && (
            <Text style={{ color: COLORS.subtext, fontSize: 14, marginBottom: 12 }}>
              {session.description}
            </Text>
          )}
        </View>

        {/* Participants Section */}
        {showParticipants && (
          <View style={{ marginBottom: SPACING.lg }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: SPACING.md,
              }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16 }}>
                Participants ({participants.length}/{session.max_participants})
              </Text>
            </View>
            {participants.length === 0 ? (
              <Text style={{ color: COLORS.subtext, fontSize: 14 }}>No participants yet</Text>
            ) : (
              <View style={{ gap: SPACING.sm }}>
                {participants.map((p) => (
                  <View
                    key={p.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: COLORS.card,
                      padding: SPACING.md,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                    }}
                  >
                    {p.profile?.avatar_url ? (
                      <Image
                        source={{ uri: p.profile.avatar_url }}
                        style={{ width: 40, height: 40, borderRadius: 20, marginRight: 12 }}
                      />
                    ) : (
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: COLORS.elevated,
                          alignItems: "center",
                          justifyContent: "center",
                          marginRight: 12,
                        }}
                      >
                        <Text style={{ color: COLORS.text, fontWeight: "800" }}>
                          {(p.profile?.username || "U").charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: COLORS.text, fontWeight: "700", fontSize: 14 }}>
                          {p.profile?.username || "User"}
                        </Text>
                        {p.user_id === session?.host_id && (
                          <View
                            style={{
                              backgroundColor: COLORS.accent,
                              paddingHorizontal: 6,
                              paddingVertical: 1,
                              borderRadius: 4,
                            }}
                          >
                            <Text style={{ color: "#000", fontWeight: "800", fontSize: 9 }}>HOST</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: COLORS.subtext, fontSize: 12 }}>
                        {p.role === "host" ? "Host" : p.role === "cohost" ? "Co-host" : "Participant"}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Reactions Section */}
        {showReactions && (isActive || session.status === "scheduled") && (isParticipant || isHost) && (
          <View style={{ marginBottom: SPACING.lg }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: SPACING.md }}>
              Reactions
            </Text>
            <View style={{ flexDirection: "row", gap: SPACING.sm, flexWrap: "wrap" }}>
              {['❤️', '🔥', '👏', '💯'].map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  onPress={() => sendReaction(emoji)}
                  style={{
                    backgroundColor: COLORS.card,
                    padding: SPACING.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    minWidth: 60,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontSize: 28 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Chat Section */}
        {showChat && (isParticipant || isHost) && (
          <View style={{ marginBottom: SPACING.lg }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: SPACING.md }}>
              Chat
            </Text>
            <View
              style={{
                backgroundColor: COLORS.card,
                borderRadius: 12,
                padding: SPACING.md,
                borderWidth: 1,
                borderColor: COLORS.border,
                maxHeight: 300,
              }}
            >
              <ScrollView
                style={{ maxHeight: 200 }}
                contentContainerStyle={{ gap: SPACING.sm, paddingBottom: SPACING.sm }}
                ref={(ref) => {
                  if (ref && chatMessages.length > 0) {
                    setTimeout(() => ref.scrollToEnd({ animated: true }), 100);
                  }
                }}
              >
                {chatMessages.length === 0 ? (
                  <Text style={{ color: COLORS.subtext, fontSize: 14, textAlign: "center", padding: SPACING.md }}>
                    No messages yet
                  </Text>
                ) : (
                  chatMessages.map((msg) => {
                    const isOwnMessage = msg.user_id === userId;
                    return (
                      <View
                        key={msg.id}
                        style={{
                          alignSelf: isOwnMessage ? "flex-end" : "flex-start",
                          maxWidth: "75%",
                          flexDirection: isOwnMessage ? "row-reverse" : "row",
                          gap: 8,
                          alignItems: "flex-end",
                          marginBottom: SPACING.sm,
                        }}
                      >
                        {/* Avatar */}
                        {msg.profile?.avatar_url ? (
                          <Image
                            source={{ uri: msg.profile.avatar_url }}
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 16,
                              backgroundColor: COLORS.elevated,
                            }}
                          />
                        ) : (
                          <View
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 16,
                              backgroundColor: COLORS.accent,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text style={{ color: "#000", fontSize: 14, fontWeight: "700" }}>
                              {(msg.profile?.username || "U").slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        {/* Message Bubble */}
                        <View
                          style={{
                            backgroundColor: isOwnMessage ? 'rgba(29, 185, 84, 0.5)' : COLORS.elevated, // More transparent green for own messages
                            paddingHorizontal: SPACING.sm,
                            paddingVertical: 8,
                            borderRadius: 12,
                          }}
                        >
                          <Text
                            style={{
                              color: COLORS.text,
                              fontSize: 11,
                              fontWeight: "700",
                              marginBottom: 2,
                              opacity: isOwnMessage ? 0.8 : 1,
                            }}
                          >
                            {msg.profile?.username || "User"}
                          </Text>
                          <Text
                            style={{
                              color: isOwnMessage ? "#000" : COLORS.text,
                              fontSize: 14,
                              fontWeight: isOwnMessage ? "600" : "400",
                            }}
                          >
                            {msg.message}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
              {(isActive || session.status === "scheduled") && (
                <View
                  style={{
                    flexDirection: "row",
                    marginTop: SPACING.md,
                    gap: SPACING.sm,
                  }}
                >
                  <TextInput
                    value={chatText}
                    onChangeText={setChatText}
                    placeholder="Say something..."
                    placeholderTextColor={COLORS.subtext}
                    multiline
                    maxLength={500}
                    style={{
                      flex: 1,
                      backgroundColor: COLORS.bg,
                      color: COLORS.text,
                      padding: SPACING.sm,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      fontSize: 14,
                      maxHeight: 80,
                    }}
                    onSubmitEditing={sendChatMessage}
                    returnKeyType="send"
                  />
                  <TouchableOpacity
                    onPress={sendChatMessage}
                    disabled={!chatText.trim() || sendingChat}
                    style={{
                      backgroundColor: chatText.trim() ? COLORS.accent : COLORS.elevated,
                      padding: SPACING.sm,
                      borderRadius: 12,
                      justifyContent: "center",
                      minWidth: 44,
                      opacity: chatText.trim() ? 1 : 0.5,
                    }}
                  >
                    {sendingChat ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <Ionicons name="send" size={18} color={chatText.trim() ? "#000" : COLORS.subtext} />
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Recent Tips */}
        {recentTips.length > 0 && (
          <View style={{ marginBottom: SPACING.lg }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: SPACING.md }}>
              Recent Tips
            </Text>
            <View style={{ gap: SPACING.sm }}>
              {recentTips.slice(0, 5).map((tip) => (
                <View
                  key={tip.id}
                  style={{
                    backgroundColor: COLORS.card,
                    padding: SPACING.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: COLORS.text, fontWeight: "700" }}>
                      {tip.from_profile?.username || "Anonymous"}
                    </Text>
                    <Text style={{ color: COLORS.accent, fontWeight: "800", fontSize: 16 }}>
                      ${(tip.amount_cents / 100).toFixed(2)}
                    </Text>
                  </View>
                  {tip.message && (
                    <Text style={{ color: COLORS.subtext, fontSize: 13, marginTop: 4 }}>
                      {tip.message}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Session Info */}
        <View style={{ marginBottom: SPACING.lg }}>
          <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 18, marginBottom: 8 }}>
            {session.description || session.title}
          </Text>
          {session.description && (
            <Text style={{ color: COLORS.subtext, fontSize: 14, marginBottom: 12 }}>{session.description}</Text>
          )}
        </View>


        {/* Tip Button for Participants */}
        {isParticipant && !isHost && (isActive || session.status === "scheduled") && (
              <TouchableOpacity
                onPress={() => {
                  if (hostHasStripe === false) {
                    setNotice({
                      visible: true,
                      title: "Payments Not Set Up",
                      message: "This host hasn't set up payment receiving yet.",
                    });
                    return;
                  }
                  setTipModalVisible(true);
                }}
                style={{
                  backgroundColor: hostHasStripe === false ? COLORS.elevated : COLORS.accent,
                  padding: SPACING.md,
                  borderRadius: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginBottom: SPACING.lg,
                }}
              >
                <Ionicons
                  name="cash"
                  size={20}
                  color={hostHasStripe === false ? COLORS.subtext : "#000"}
                />
                <Text
                  style={{
                    color: hostHasStripe === false ? COLORS.subtext : "#000",
                    fontWeight: "800",
                    fontSize: 16,
                  }}
                >
                  Send Tip
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </SafeAreaView>
      )}

      {/* Notices */}
      <ThemedNotice
        visible={notice.visible}
        title={notice.title}
        message={notice.message}
        onClose={() => setNotice({ visible: false, title: "", message: "" })}
        confirmText="OK"
      />

      <ThemedConfirm
        visible={endSessionConfirm}
        title="End Session?"
        message="This will end the session for all participants. They won't be able to join or tip after this."
        confirmText="End Session"
        cancelText="Cancel"
        onConfirm={confirmEndSession}
        onCancel={() => setEndSessionConfirm(false)}
        destructive={true}
      />

      {/* Tip Modal */}
      <Modal
        visible={tipModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTipModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.8)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: COLORS.card,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: SPACING.lg,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: SPACING.lg,
              }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 20 }}>
                Send Tip
              </Text>
              <TouchableOpacity onPress={() => setTipModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={{ marginBottom: SPACING.md }}>
              <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 8 }}>
                Amount ($)
              </Text>
              <TextInput
                value={tipAmount}
                onChangeText={setTipAmount}
                placeholder="5.00"
                placeholderTextColor={COLORS.subtext}
                keyboardType="decimal-pad"
                style={{
                  backgroundColor: COLORS.bg,
                  color: COLORS.text,
                  padding: SPACING.md,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  fontSize: 18,
                }}
              />
            </View>

            <View style={{ marginBottom: SPACING.lg }}>
              <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 8 }}>
                Message (Optional)
              </Text>
              <TextInput
                value={tipMessage}
                onChangeText={setTipMessage}
                placeholder="Say something nice..."
                placeholderTextColor={COLORS.subtext}
                multiline
                numberOfLines={3}
                style={{
                  backgroundColor: COLORS.bg,
                  color: COLORS.text,
                  padding: SPACING.md,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  fontSize: 16,
                  minHeight: 80,
                  textAlignVertical: "top",
                }}
                maxLength={200}
              />
            </View>

            <Pressable
              onPress={onSendTip}
              disabled={tipping}
              style={{
                backgroundColor: tipping ? COLORS.elevated : COLORS.accent,
                padding: SPACING.md,
                borderRadius: 12,
                alignItems: "center",
              }}
            >
              {tipping ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>
                  Send ${tipAmount || "0.00"}
                </Text>
              )}
            </Pressable>

            <Text style={{ color: COLORS.subtext, fontSize: 12, marginTop: SPACING.md, textAlign: "center" }}>
              Minimum $0.50 • Platform fee: 10%
            </Text>
            <View
              style={{
                backgroundColor: COLORS.elevated,
                padding: SPACING.md,
                borderRadius: 12,
                marginTop: SPACING.md,
              }}
            >
              <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 13, marginBottom: 4 }}>
                How Tipping Works:
              </Text>
              <Text style={{ color: COLORS.subtext, fontSize: 12, lineHeight: 18 }}>
                • Your payment goes directly to the host's Stripe account{"\n"}
                • Stripe automatically transfers it to their bank account (usually 2-7 days){"\n"}
                • MessHall takes a 10% platform fee for hosting the service{"\n"}
                • The host receives 90% of your tip amount
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

