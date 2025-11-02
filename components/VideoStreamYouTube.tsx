// components/VideoStreamYouTube.tsx
// YouTube Live streaming embed component

import React, { useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { WebView } from "react-native-webview";
import { COLORS } from "../lib/theme";

type Props = {
  videoId: string; // YouTube live stream video ID
  isHost?: boolean;
  muted?: boolean;
  onError?: (error: string) => void;
};

export default function VideoStreamYouTube({ videoId, isHost = false, muted = false, onError }: Props) {
  const [loading, setLoading] = useState(true);

  // YouTube Live embed URL
  const youtubeEmbedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${muted ? "1" : "0"}&playsinline=1&rel=0&modestbranding=1`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body, html {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #000;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    .error {
      color: #fff;
      padding: 20px;
      text-align: center;
      background: #000;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <iframe
    src="${youtubeEmbedUrl}"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen
    id="youtube-player"
  ></iframe>
  <script>
    const iframe = document.getElementById('youtube-player');
    iframe.addEventListener('load', function() {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'ready',
          message: 'YouTube player loaded'
        }));
      }
    });
    iframe.addEventListener('error', function(e) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error',
          message: 'Failed to load YouTube stream'
        }));
      }
    });
  </script>
</body>
</html>
  `;

  const handleLoadEnd = () => {
    setTimeout(() => setLoading(false), 2000);
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') {
        setLoading(false);
      } else if (data.type === 'error') {
        setLoading(false);
        onError?.(data.message || "YouTube stream error");
      }
    } catch (e) {
      // Ignore parse errors
    }
  };

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error("WebView error:", nativeEvent);
    setLoading(false);
    onError?.(nativeEvent?.description || "Failed to load YouTube stream");
  };

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading YouTube stream...</Text>
        </View>
      )}
      <WebView
        source={{ html: htmlContent }}
        style={styles.webview}
        onLoadEnd={handleLoadEnd}
        onError={handleError}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="always"
        originWhitelist={['*']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.card || "#000",
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
    backgroundColor: COLORS.card || "#000",
    zIndex: 1000,
  },
  loadingText: {
    color: COLORS.text || "#fff",
    marginTop: 12,
    fontSize: 14,
  },
});

