// components/VideoStreamAgora.tsx
// Agora Video SDK - Native React Native implementation (NO WebView!)
// Free tier: 10,000 minutes/month
// https://www.agora.io/en/pricing/

import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text, Platform } from "react-native";
import RtcEngine, {
  ChannelProfileType,
  ClientRoleType,
  RtcSurfaceView,
} from "react-native-agora";
import { COLORS } from "../lib/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  appId: string; // Agora App ID from dashboard
  channelName: string; // Room/channel name
  token?: string; // Optional token for secure channels
  uid?: number; // User ID (0 = auto-generate)
  isHost?: boolean; // If true, publishes video/audio
  displayName?: string;
  onError?: (error: string) => void;
  onReady?: () => void;
  onUserJoined?: (uid: number) => void;
  onUserOffline?: (uid: number) => void;
};

export default function VideoStreamAgora({
  appId,
  channelName,
  token,
  uid = 0,
  isHost = false,
  displayName,
  onError,
  onReady,
  onUserJoined,
  onUserOffline,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const engineRef = useRef<any>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!appId) {
      onError?.("Agora App ID is required");
      return;
    }

    const initAgora = async () => {
      try {
        // For react-native-agora v4.x, RtcEngine is a function that creates an instance
        const engine = RtcEngine();
        await engine.initialize({ appId });
        engineRef.current = engine;

        // Enable video
        await engine.enableVideo();
        
        // Set channel profile (communication = 2-way, live = 1-way streaming)
        await engine.setChannelProfile(
          isHost 
            ? ChannelProfileType.ChannelProfileLiveBroadcasting 
            : ChannelProfileType.ChannelProfileCommunication
        );

        // Set client role (host publishes, audience subscribes)
        if (isHost) {
          await engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
        } else {
          await engine.setClientRole(ClientRoleType.ClientRoleAudience);
        }

        // Event handlers
        engine.addListener("onJoinChannelSuccess", (connection: any, elapsed: number) => {
          console.log("[Agora] Joined channel:", connection.channelId, "uid:", connection.localUid);
          setLoading(false);
          onReady?.();
        });

        engine.addListener("onError", (err: number, msg: string) => {
          console.error("[Agora] Error:", err, msg);
          onError?.(`Agora error: ${msg || String(err)}`);
        });

        engine.addListener("onUserJoined", (connection: any, remoteUid: number, elapsed: number) => {
          console.log("[Agora] User joined:", remoteUid);
          setRemoteUids((prev) => [...prev, remoteUid]);
          onUserJoined?.(remoteUid);
        });

        engine.addListener("onUserOffline", (connection: any, remoteUid: number, reason: number) => {
          console.log("[Agora] User offline:", remoteUid);
          setRemoteUids((prev) => prev.filter((id) => id !== remoteUid));
          onUserOffline?.(remoteUid);
        });

        // Join channel - needs token, channelName, uid, and optional info
        await engine.joinChannel(token || "", channelName, uid, {
          clientRoleType: isHost 
            ? ClientRoleType.ClientRoleBroadcaster 
            : ClientRoleType.ClientRoleAudience,
        });

      } catch (error: any) {
        console.error("[Agora] Initialization error:", error);
        onError?.(error.message || "Failed to initialize Agora");
        setLoading(false);
      }
    };

    initAgora();

    // Cleanup on unmount
    return () => {
      if (engineRef.current) {
        try {
          engineRef.current.leaveChannel();
          engineRef.current.removeAllListeners();
          engineRef.current.release();
        } catch (e) {
          console.error("[Agora] Error during cleanup:", e);
        }
        engineRef.current = null;
      }
    };
  }, [appId, channelName, token, uid, isHost]);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>
            {isHost ? "Starting video..." : "Joining video..."}
          </Text>
        </View>
      )}

      {/* Local video view (host only) */}
      {isHost && engineRef.current && (
        <View style={styles.localVideoContainer}>
          <RtcSurfaceView
            style={styles.localVideo}
            canvas={{
              uid: 0, // 0 = local user
            }}
          />
        </View>
      )}

      {/* Remote video views */}
      <View style={styles.remoteVideos}>
        {remoteUids.map((remoteUid) => (
          <View key={remoteUid} style={styles.remoteVideoContainer}>
            <RtcSurfaceView
              style={styles.remoteVideo}
              canvas={{
                uid: remoteUid,
              }}
            />
          </View>
        ))}
      </View>

      {!loading && remoteUids.length === 0 && !isHost && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Waiting for host to start...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.card || "#000",
  },
  loading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.card || "#000",
    zIndex: 1000,
  },
  loadingText: {
    color: COLORS.text || "#fff",
    marginTop: 12,
    fontSize: 14,
  },
  localVideoContainer: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 120,
    height: 160,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: COLORS.card || "#000",
    zIndex: 100,
  },
  localVideo: {
    width: "100%",
    height: "100%",
  },
  remoteVideos: {
    flex: 1,
    width: "100%",
  },
  remoteVideoContainer: {
    flex: 1,
    width: "100%",
    backgroundColor: COLORS.card || "#000",
  },
  remoteVideo: {
    width: "100%",
    height: "100%",
  },
  emptyState: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: COLORS.muted || "#999",
    fontSize: 16,
  },
});
