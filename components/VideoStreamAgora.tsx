// components/VideoStreamAgora.tsx
// Agora Video SDK - Native React Native implementation (NO WebView!)
// Free tier: 10,000 minutes/month
// https://www.agora.io/en/pricing/

import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text, Platform, TouchableOpacity } from "react-native";
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
  showControls?: boolean; // Show mute/camera controls
  viewerCount?: number; // Optional: show live viewer count
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
  showControls = true,
  viewerCount,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [connectionQuality, setConnectionQuality] = useState<"excellent" | "good" | "poor" | "unknown">("unknown");
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

      {/* Live Viewer Count Overlay (Top Right) */}
      {(viewerCount !== undefined || remoteUids.length > 0) && (
        <View style={[styles.viewerCountBadge, { top: insets.top + 60, right: 16 }]}>
          <Text style={styles.viewerIcon}>👁️</Text>
          <Text style={styles.viewerCountText}>
            {viewerCount !== undefined ? viewerCount : remoteUids.length}
          </Text>
        </View>
      )}

      {/* Connection Quality Indicator (Top Left) */}
      {connectionQuality !== "unknown" && (
        <View style={[
          styles.qualityBadge,
          { top: insets.top + 60 },
          connectionQuality === "excellent" ? styles.qualityExcellent :
          connectionQuality === "good" ? styles.qualityGood :
          styles.qualityPoor
        ]}>
          <View style={[
            styles.qualityDot,
            connectionQuality === "excellent" ? styles.qualityDotExcellent :
            connectionQuality === "good" ? styles.qualityDotGood :
            styles.qualityDotPoor
          ]} />
          <Text style={styles.qualityText}>
            {connectionQuality === "excellent" ? "HD" : connectionQuality === "good" ? "Good" : "Poor"}
          </Text>
        </View>
      )}

      {/* Host view: Show host's own video large in center */}
      {isHost && engineRef.current && videoEnabled ? (
        <View style={styles.hostMainVideo}>
          <RtcSurfaceView
            style={styles.mainVideo}
            canvas={{
              uid: 0, // 0 = local user (host's own video)
            }}
          />
        </View>
      ) : isHost && !videoEnabled ? (
        <View style={styles.hostMainVideo}>
          <View style={styles.videoDisabledPlaceholder}>
            <Text style={styles.videoDisabledText}>📵 Camera Off</Text>
          </View>
        </View>
      ) : null}

      {/* Remote video views (for viewers - show host's video large) */}
      {!isHost && (
        <View style={styles.remoteVideos}>
          {remoteUids.length > 0 ? (
            remoteUids.map((remoteUid) => (
              <View key={remoteUid} style={styles.remoteVideoContainer}>
                <RtcSurfaceView
                  style={styles.remoteVideo}
                  canvas={{
                    uid: remoteUid,
                  }}
                />
              </View>
            ))
          ) : (
            <View style={styles.waitingForHost}>
              <Text style={styles.waitingText}>Waiting for host to start video...</Text>
            </View>
          )}
        </View>
      )}

      {/* Video/Audio Controls for Host */}
      {showControls && isHost && engineRef.current && !loading && (
        <View style={styles.controlsContainer}>
          <TouchableOpacity
            style={[styles.controlButton, muted && styles.controlButtonActive]}
            onPress={async () => {
              try {
                if (muted) {
                  await engineRef.current.muteLocalAudioStream(false);
                  setMuted(false);
                  console.log("[Agora] Microphone unmuted");
                } else {
                  await engineRef.current.muteLocalAudioStream(true);
                  setMuted(true);
                  console.log("[Agora] Microphone muted");
                }
              } catch (e) {
                console.error("[Agora] Error toggling audio:", e);
              }
            }}
          >
            <Text style={styles.controlIcon}>{muted ? "🔇" : "🎤"}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.controlButton, !videoEnabled && styles.controlButtonActive]}
            onPress={async () => {
              try {
                if (videoEnabled) {
                  // Actually disable the camera, not just mute
                  await engineRef.current.enableLocalVideo(false);
                  setVideoEnabled(false);
                  console.log("[Agora] Camera disabled");
                } else {
                  // Re-enable the camera
                  await engineRef.current.enableLocalVideo(true);
                  setVideoEnabled(true);
                  console.log("[Agora] Camera enabled");
                }
              } catch (e) {
                console.error("[Agora] Error toggling video:", e);
              }
            }}
          >
            <Text style={styles.controlIcon}>{videoEnabled ? "📹" : "📵"}</Text>
          </TouchableOpacity>

          {/* Switch Camera Button (only when video is enabled) */}
          {videoEnabled && (
            <TouchableOpacity
              style={styles.controlButton}
              onPress={async () => {
                try {
                  await engineRef.current.switchCamera();
                  console.log("[Agora] Camera switched");
                } catch (e) {
                  console.error("[Agora] Error switching camera:", e);
                }
              }}
            >
              <Text style={styles.controlIcon}>🔄</Text>
            </TouchableOpacity>
          )}
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
  hostMainVideo: {
    flex: 1,
    width: "100%",
    backgroundColor: COLORS.card || "#000",
  },
  mainVideo: {
    width: "100%",
    height: "100%",
  },
  videoDisabledPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.card || "#000",
  },
  videoDisabledText: {
    color: COLORS.muted || "#999",
    fontSize: 24,
    marginTop: 12,
  },
  waitingForHost: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.card || "#000",
  },
  waitingText: {
    color: COLORS.muted || "#999",
    fontSize: 16,
    textAlign: "center",
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
  controlsContainer: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    zIndex: 200,
    paddingHorizontal: 20,
  },
  controlButton: {
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    borderRadius: 30,
    width: 56,
    height: 56,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.4)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  controlButtonActive: {
    backgroundColor: "rgba(244, 67, 54, 0.8)",
    borderColor: "rgba(255, 255, 255, 0.8)",
  },
  controlIcon: {
    fontSize: 24,
  },
  viewerCountBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 150,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  viewerIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  viewerCountText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  qualityBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    zIndex: 150,
    gap: 6,
  },
  qualityExcellent: {
    borderColor: "rgba(76, 175, 80, 0.6)",
  },
  qualityGood: {
    borderColor: "rgba(255, 193, 7, 0.6)",
  },
  qualityPoor: {
    borderColor: "rgba(244, 67, 54, 0.6)",
  },
  qualityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  qualityDotExcellent: {
    backgroundColor: "#4CAF50",
  },
  qualityDotGood: {
    backgroundColor: "#FFC107",
  },
  qualityDotPoor: {
    backgroundColor: "#F44336",
  },
  qualityText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
