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
import { logDebug, logError } from "../lib/logger";

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
  onViewerCountChange?: (count: number) => void; // Callback when viewer count changes
  showControls?: boolean; // Show mute/camera controls
  viewerCount?: number; // Optional: show live viewer count
  muteAudio?: boolean; // Mute audio (for previews in feed)
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
  onViewerCountChange,
  showControls = true,
  viewerCount,
  muteAudio = false,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [remoteUids, setRemoteUids] = useState<number[]>([]);
  const [allUserIds, setAllUserIds] = useState<number[]>([]); // Track all users (including audience members without video)
  const [muted, setMuted] = useState(false); // Host: local audio muted, Attendee: remote audio muted
  const [remoteAudioMuted, setRemoteAudioMuted] = useState(false); // For attendees: track if remote audio is muted
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [connectionQuality, setConnectionQuality] = useState<"excellent" | "good" | "poor" | "unknown">("unknown");
  const engineRef = useRef<any>(null);
  const insets = useSafeAreaInsets();

  // Calculate and notify viewer count when users change
  // Note: For host in live broadcasting, Agora doesn't fire onUserJoined for audience members,
  // so we rely on the viewerCount prop from the participants table instead
  useEffect(() => {
    // For host: if viewerCount prop is provided, use it (from participants table)
    // Otherwise, try to use allUserIds (but this won't work for audience members)
    // For attendees: count themselves (1) + any remote users (host)
    const calculatedCount = isHost 
      ? (viewerCount !== undefined ? viewerCount : allUserIds.length) // Host: prefer prop, fallback to Agora
      : allUserIds.length + 1; // Attendees: allUserIds.length (host) + 1 (themselves)
    
    logDebug("[Agora] Viewer count updated:", {
      isHost,
      remoteUids: remoteUids.length,
      allUserIds: allUserIds.length,
      viewerCountProp: viewerCount,
      calculatedViewerCount: calculatedCount,
      finalDisplayCount: isHost 
        ? (viewerCount !== undefined ? viewerCount : allUserIds.length)
        : (viewerCount !== undefined ? viewerCount : allUserIds.length + 1),
    });
    
    // Only notify parent if we're not using a provided viewerCount for host
    // (since the parent already knows the count from participants table)
    if (onViewerCountChange && !(isHost && viewerCount !== undefined)) {
      onViewerCountChange(calculatedCount);
    }
  }, [remoteUids, allUserIds, isHost, viewerCount, onViewerCountChange]);

  useEffect(() => {
    if (!appId) {
      onError?.("Agora App ID is required");
      return;
    }

    if (!channelName) {
      logDebug("[Agora] No channel name provided, skipping initialization");
      return;
    }

    const initAgora = async () => {
      try {
        // For react-native-agora v4.x, RtcEngine is a function that creates an instance
        const engine = RtcEngine();
        await engine.initialize({ appId });
        engineRef.current = engine;

        // Enable video (but disable local video for previews in feed)
        if (muteAudio && !isHost) {
          // For feed previews, we only want to see remote video, not enable local camera
          await engine.enableVideo();
          await engine.muteLocalAudioStream(true);
          await engine.enableLocalVideo(false); // Don't show user's own camera in preview
          logDebug("[Agora] Preview mode: audio muted, local video disabled");
        } else {
          await engine.enableVideo();
        }
        
        // Set channel profile (ALL users must use the same profile - LiveBroadcasting for streaming)
        // Communication = 2-way, LiveBroadcasting = 1-way streaming (host broadcasts, audience watches)
        await engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
        logDebug("[Agora] Channel profile set: LiveBroadcasting");

        // Set client role BEFORE joining (host publishes, audience subscribes)
        const clientRole = isHost 
          ? ClientRoleType.ClientRoleBroadcaster 
          : ClientRoleType.ClientRoleAudience;
        await engine.setClientRole(clientRole);
        logDebug("[Agora] Set role:", isHost ? "Broadcaster (Host)" : "Audience (Viewer)");

        // Event handlers
        engine.addListener("onJoinChannelSuccess", async (connection: any, elapsed: number) => {
          logDebug("[Agora] Joined channel:", connection.channelId, "uid:", connection.localUid, "isHost:", isHost);
          
          // For audience members, ensure remote video/audio is enabled after joining
          if (!isHost && engineRef.current) {
            try {
              // Enable remote video for all users (0 = all users)
              await engineRef.current.muteRemoteVideoStream(0, false);
              // Mute remote audio if this is a preview (feed view)
              await engineRef.current.muteRemoteAudioStream(0, muteAudio);
              logDebug("[Agora] Enabled remote video subscription for audience, audio muted:", muteAudio);
              
              // Note: onUserJoined will fire for users already in the channel
              // We'll also get onRemoteVideoStateChanged when their video starts
            } catch (e) {
              logError("[Agora] Error enabling remote streams:", e);
            }
          }
          
          // For host: onUserJoined should fire for existing users, but if it doesn't,
          // we'll rely on the events. For now, just log that we've joined.
          if (isHost) {
            logDebug("[Agora] Host joined channel, waiting for onUserJoined events for existing users");
          }
          
          setLoading(false);
          onReady?.();
        });

        engine.addListener("onError", (err: number, msg: string) => {
          logError("[Agora] Error:", err, msg);
          onError?.(`Agora error: ${msg || String(err)}`);
        });

        engine.addListener("onUserJoined", async (connection: any, remoteUid: number, elapsed: number) => {
          // Verify we're still on the correct channel
          if (connection.channelId !== channelName) {
            logDebug("[Agora] Ignoring onUserJoined - wrong channel:", connection.channelId, "expected:", channelName);
            return;
          }
          
          logDebug("[Agora] User joined:", remoteUid, "channel:", connection.channelId, "isHost:", isHost, "elapsed:", elapsed);
          
          // Add to allUserIds for viewer counting (this includes all users, even audience members without video)
          setAllUserIds((prev) => {
            if (!prev.includes(remoteUid)) {
              const newCount = prev.length + 1;
              logDebug("[Agora] Added user to allUserIds:", remoteUid, "isHost:", isHost, "total users:", newCount);
              if (isHost) {
                logDebug("[Agora] Host detected audience member joined:", remoteUid, "total audience:", newCount);
              }
              return [...prev, remoteUid];
            }
            return prev;
          });
          
          // For audience members, explicitly enable remote video/audio for this user
          if (!isHost && engineRef.current) {
            try {
              await engineRef.current.muteRemoteVideoStream(remoteUid, false);
              // Mute remote audio if this is a preview (feed view)
              await engineRef.current.muteRemoteAudioStream(remoteUid, muteAudio);
              logDebug("[Agora] Enabled remote video for user:", remoteUid, "audio muted:", muteAudio, "channel:", channelName);
              
              // Add to remote UIDs immediately - video might already be streaming
              // onRemoteVideoStateChanged will also add it when video starts decoding
              setRemoteUids((prev) => {
                if (!prev.includes(remoteUid)) {
                  logDebug("[Agora] Added remote UID from onUserJoined:", remoteUid, "channel:", channelName);
                  return [...prev, remoteUid];
                }
                return prev;
              });
            } catch (e) {
              logError("[Agora] Error enabling remote streams for user:", remoteUid, e);
            }
          }
          // Note: For host, audience members are added to allUserIds above but not to remoteUids
          // because they don't publish video streams
          
          onUserJoined?.(remoteUid);
        });

        engine.addListener("onUserOffline", (connection: any, remoteUid: number, reason: number) => {
          logDebug("[Agora] User offline:", remoteUid, "isHost:", isHost, "reason:", reason);
          setRemoteUids((prev) => prev.filter((id) => id !== remoteUid));
          setAllUserIds((prev) => {
            const updated = prev.filter((id) => id !== remoteUid);
            logDebug("[Agora] Removed user from allUserIds:", remoteUid, "remaining users:", updated.length);
            return updated;
          });
          onUserOffline?.(remoteUid);
        });

        // Listen for remote video state changes (important for audience members)
        engine.addListener("onRemoteVideoStateChanged", async (connection: any, remoteUid: number, state: number, reason: number, elapsed: number) => {
          // Verify we're still on the correct channel
          if (connection.channelId !== channelName) {
            logDebug("[Agora] Ignoring onRemoteVideoStateChanged - wrong channel:", connection.channelId, "expected:", channelName);
            return;
          }
          
          const stateNames = ["stopped", "starting", "decoding", "failed", "frozen"];
          logDebug("[Agora] Remote video state changed:", { 
            remoteUid, 
            state: stateNames[state] || state, 
            reason,
            isHost,
            channel: connection.channelId
          });
          
          // State: 0 = stopped, 1 = starting, 2 = decoding, 3 = failed, 4 = frozen
          // When video starts decoding (state 2), ensure the UID is in our list and streams are enabled
          if (state === 2 && !isHost && engineRef.current) {
            try {
              // Ensure remote video is enabled, audio muted if preview
              await engineRef.current.muteRemoteVideoStream(remoteUid, false);
              await engineRef.current.muteRemoteAudioStream(remoteUid, muteAudio);
              logDebug("[Agora] Enabled remote video for user:", remoteUid, "audio muted:", muteAudio, "channel:", channelName);
            } catch (e) {
              logError("[Agora] Error enabling remote streams:", e);
            }
          }
          
          // Add to remote UIDs list when video starts decoding
          if (state === 2) {
            setRemoteUids((prev) => {
              if (!prev.includes(remoteUid)) {
                logDebug("[Agora] Adding remote UID to list:", remoteUid, "channel:", channelName);
                return [...prev, remoteUid];
              }
              return prev;
            });
          } else if (state === 0 || state === 3) {
            // Remove from list if video stops or fails
            logDebug("[Agora] Removing remote UID from list:", remoteUid, "channel:", channelName);
            setRemoteUids((prev) => prev.filter((id) => id !== remoteUid));
          }
        });

        // Join channel - needs token, channelName, uid, and optional info
        await engine.joinChannel(token || "", channelName, uid, {
          clientRoleType: isHost 
            ? ClientRoleType.ClientRoleBroadcaster 
            : ClientRoleType.ClientRoleAudience,
        });

      } catch (error: any) {
        logError("[Agora] Initialization error:", error);
        onError?.(error.message || "Failed to initialize Agora");
        setLoading(false);
      }
    };

    initAgora();

    // Cleanup on unmount or when channel/appId changes
    return () => {
      logDebug("[Agora] Cleanup triggered for channel:", channelName);
      if (engineRef.current) {
        try {
          engineRef.current.leaveChannel();
          engineRef.current.removeAllListeners();
          engineRef.current.release();
          logDebug("[Agora] Engine released for channel:", channelName);
        } catch (e) {
          logError("[Agora] Error during cleanup:", e);
        }
        engineRef.current = null;
      }
      // Reset state on cleanup immediately
      setRemoteUids([]);
      setAllUserIds([]);
      setLoading(true);
    };
  }, [appId, channelName, token, uid, isHost, muteAudio]);

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
      {(!loading || allUserIds.length > 0 || viewerCount !== undefined) && (
        <View style={[styles.viewerCountBadge, { top: insets.top + 60, right: 16 }]}>
          <Text style={styles.viewerIcon}>👁️</Text>
          <Text style={styles.viewerCountText}>
            {isHost 
              ? viewerCount !== undefined 
                ? viewerCount // Host: use provided count from participants table (Agora doesn't fire onUserJoined for audience)
                : allUserIds.length // Fallback to Agora count if available
              : viewerCount !== undefined 
                ? viewerCount // Use provided count if available
                : allUserIds.length + 1 // Attendees: allUserIds.length (host) + 1 (themselves)
            }
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
      {isHost && !muteAudio && engineRef.current && videoEnabled ? (
        <View style={styles.hostMainVideo}>
          <RtcSurfaceView
            style={styles.mainVideo}
            canvas={{
              uid: 0, // 0 = local user (host's own video)
            }}
          />
        </View>
      ) : isHost && !muteAudio && !videoEnabled ? (
        <View style={styles.hostMainVideo}>
          <View style={styles.videoDisabledPlaceholder}>
            <Text style={styles.videoDisabledText}>📵 Camera Off</Text>
          </View>
        </View>
      ) : null}

      {/* Remote video views (for viewers - show host's video large) */}
      {(!isHost || muteAudio) && (
        <View style={styles.remoteVideos}>
          {remoteUids.length > 0 && engineRef.current && !loading ? (
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
              <Text style={styles.waitingText}>
                {loading ? "Connecting..." : "Waiting for host to start video..."}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Audio/Video Controls */}
      {showControls && engineRef.current && !loading && (
        <>
          {isHost ? (
            // Host: Show full controls at bottom
            <View style={styles.controlsContainer}>
              <TouchableOpacity
                style={[styles.controlButton, muted && styles.controlButtonActive]}
                onPress={async () => {
                  try {
                    if (muted) {
                      await engineRef.current.muteLocalAudioStream(false);
                      setMuted(false);
                      logDebug("[Agora] Microphone unmuted");
                    } else {
                      await engineRef.current.muteLocalAudioStream(true);
                      setMuted(true);
                      logDebug("[Agora] Microphone muted");
                    }
                  } catch (e) {
                    logError("[Agora] Error toggling audio:", e);
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
                      await engineRef.current.enableLocalVideo(false);
                      setVideoEnabled(false);
                      logDebug("[Agora] Camera disabled");
                    } else {
                      await engineRef.current.enableLocalVideo(true);
                      setVideoEnabled(true);
                      logDebug("[Agora] Camera enabled");
                    }
                  } catch (e) {
                    logError("[Agora] Error toggling video:", e);
                  }
                }}
              >
                <Text style={styles.controlIcon}>{videoEnabled ? "📹" : "📵"}</Text>
              </TouchableOpacity>

              {videoEnabled && (
                <TouchableOpacity
                  style={styles.controlButton}
                  onPress={async () => {
                    try {
                      await engineRef.current.switchCamera();
                      logDebug("[Agora] Camera switched");
                    } catch (e) {
                      logError("[Agora] Error switching camera:", e);
                    }
                  }}
                >
                  <Text style={styles.controlIcon}>🔄</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            // Attendee: Small semi-transparent audio icon overlay (top-left)
            <TouchableOpacity
              style={{
                position: "absolute",
                top: insets.top + 60,
                left: 16,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                zIndex: 10,
              }}
              onPress={async () => {
                try {
                  if (remoteAudioMuted) {
                    await engineRef.current.muteRemoteAudioStream(0, false);
                    setRemoteAudioMuted(false);
                    logDebug("[Agora] Remote audio unmuted");
                  } else {
                    await engineRef.current.muteRemoteAudioStream(0, true);
                    setRemoteAudioMuted(true);
                    logDebug("[Agora] Remote audio muted");
                  }
                } catch (e) {
                  logError("[Agora] Error toggling remote audio:", e);
                }
              }}
            >
              <Text style={{ fontSize: 20, opacity: remoteAudioMuted ? 0.5 : 1 }}>
                {remoteAudioMuted ? "🔇" : "🔊"}
              </Text>
            </TouchableOpacity>
          )}
        </>
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
