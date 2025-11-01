// components/VideoStreamJitsi.tsx
// Jitsi Meet video streaming component using WebView (100% FREE, no native dependencies needed)

import React, { useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { WebView } from "react-native-webview";
import { COLORS } from "../lib/theme";

type Props = {
  roomUrl: string;
  isHost?: boolean;
  onError?: (error: string) => void;
};

export default function VideoStreamJitsi({ roomUrl, isHost = false, onError }: Props) {
  const [loading, setLoading] = useState(true);
  
  // Extract room name from URL (e.g., https://meet.jit.si/room-name -> room-name)
  const roomUrlFull = roomUrl.startsWith("http") ? roomUrl : `https://meet.jit.si/${roomUrl}`;
  const roomName = roomUrlFull.split('/').pop()?.split('?')[0] || roomUrlFull.split('/').pop() || '';
  
  // Build Jitsi Meet URL with configuration to prevent mobile redirect and auto-join
  // Use embedded HTML with iframe to avoid browser compatibility warnings
  const jitsiBaseUrl = `https://meet.jit.si/${roomName}`;
  
  // Build config string manually (URLSearchParams not available in RN context)
  const configStr = [
    "config.startWithAudioMuted=false",
    "config.startWithVideoMuted=false",
    "config.prejoinPageEnabled=false",
    "config.disableDeepLinking=true",
    "interfaceConfig.SHOW_JITSI_WATERMARK=false",
    "interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false",
    "interfaceConfig.SHOW_BRAND_WATERMARK=false",
    "interfaceConfig.HIDE_INVITE_MORE_HEADER=true",
  ].join("&");

  const fullJitsiUrl = `${jitsiBaseUrl}#${configStr}`;

  // Use HTML wrapper with iframe to prevent browser compatibility warnings
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body, html { width: 100%; height: 100%; overflow: hidden; }
          iframe { width: 100%; height: 100%; border: none; }
        </style>
      </head>
      <body>
        <iframe
          src="${fullJitsiUrl}"
          allow="camera; microphone; fullscreen; display-capture"
          allowfullscreen
        ></iframe>
      </body>
    </html>
  `;

  const handleLoadEnd = () => {
    setLoading(false);
  };

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error("WebView error:", nativeEvent);
    setLoading(false);
    onError?.(nativeEvent?.description || "Failed to load Jitsi Meet");
  };

  // Desktop user agent to prevent mobile app redirect
  const desktopUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading Jitsi Meet...</Text>
        </View>
      )}
      <WebView
        source={{ html: htmlContent }}
        style={styles.webview}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        allowFileAccess={true}
        mixedContentMode="always"
        userAgent={desktopUserAgent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.card,
  },
  webview: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: COLORS.card,
  },
  loading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.card,
    zIndex: 1000,
  },
  loadingText: {
    color: COLORS.text,
    marginTop: 12,
    fontSize: 14,
  },
});
