// components/VideoStream.tsx
// Daily.co video streaming component using WebView

import React, { useRef } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { WebView } from "react-native-webview";
import { COLORS } from "../lib/theme";

type Props = {
  roomUrl: string;
  token: string;
  isHost?: boolean;
  onError?: (error: string) => void;
};

export default function VideoStream({ roomUrl, token, isHost = false, onError }: Props) {
  const webViewRef = useRef<WebView>(null);

  // Daily.co prebuilt UI URL with token
  // roomUrl should be the full Daily.co room URL (e.g., https://roomname.daily.co)
  // If it's just a room name, construct the URL
  let dailyUrl: string;
  if (roomUrl.includes("daily.co")) {
    // Full URL provided
    dailyUrl = `${roomUrl.replace(/\/$/, "")}?t=${token}`;
  } else {
    // Just room name provided
    dailyUrl = `https://${roomUrl}.daily.co/?t=${token}`;
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #000;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
  </style>
</head>
<body>
  <iframe
    src="${dailyUrl}"
    allow="camera; microphone; fullscreen"
    style="width: 100%; height: 100vh;"
  ></iframe>
</body>
</html>
  `;

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent }}
        style={styles.webview}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={COLORS.accent} />
            <Text style={styles.loadingText}>Loading video...</Text>
          </View>
        )}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          const error = `WebView error: ${nativeEvent.code} - ${nativeEvent.description}`;
          console.error(error);
          onError?.(error);
        }}
        onHttpError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          const error = `HTTP error: ${nativeEvent.statusCode}`;
          console.error(error);
          onError?.(error);
        }}
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
    backgroundColor: "transparent",
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
  },
  loadingText: {
    color: COLORS.text,
    marginTop: 12,
    fontSize: 14,
  },
});

