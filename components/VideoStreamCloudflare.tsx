// components/VideoStreamCloudflare.tsx
// Cloudflare Stream video player component using HLS

import React, { useState, useRef } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { WebView } from "react-native-webview";
import { COLORS } from "../lib/theme";
import { logError } from "../lib/logger";

type Props = {
  hlsUrl: string;
  isHost?: boolean;
  onError?: (error: string) => void;
};

export default function VideoStreamCloudflare({ hlsUrl, isHost = false, onError }: Props) {
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef<WebView>(null);

  // HLS.js player embedded in HTML for Cloudflare Stream
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
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
      display: flex;
      align-items: center;
      justify-content: center;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .error {
      color: #fff;
      padding: 20px;
      text-align: center;
    }
  </style>
</head>
<body>
  <video id="video" controls autoplay muted playsinline></video>
  <div id="error" class="error" style="display: none;"></div>
  <script>
    const video = document.getElementById('video');
    const errorDiv = document.getElementById('error');
    const hlsUrl = "${hlsUrl}";

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, function() {
        video.play().catch(function(err) {
          logError('Play error:', err);
          errorDiv.textContent = 'Failed to play video. Please try again.';
          errorDiv.style.display = 'block';
        });
        setLoading(false);
      });

      hls.on(Hls.Events.ERROR, function(event, data) {
        if (data.fatal) {
          switch(data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              logError('Fatal network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              logError('Fatal media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              logError('Fatal error, destroying player');
              hls.destroy();
              errorDiv.textContent = 'Failed to load stream. The host may not be streaming yet.';
              errorDiv.style.display = 'block';
              setLoading(false);
              break;
          }
        }
      });

      video.addEventListener('loadedmetadata', function() {
        setLoading(false);
      });

      video.addEventListener('error', function(e) {
        logError('Video error:', e);
        errorDiv.textContent = 'Failed to load video stream.';
        errorDiv.style.display = 'block';
        setLoading(false);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari/iOS)
      video.src = hlsUrl;
      video.addEventListener('loadedmetadata', function() {
        setLoading(false);
      });
      video.addEventListener('error', function(e) {
        logError('Video error:', e);
        errorDiv.textContent = 'Failed to load video stream.';
        errorDiv.style.display = 'block';
        setLoading(false);
      });
    } else {
      errorDiv.textContent = 'HLS playback not supported in this browser.';
      errorDiv.style.display = 'block';
      setLoading(false);
    }

    // Expose setLoading function to window for error handling
    window.setLoading = function(loading) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'loading',
          loading: loading
        }));
      }
    };
  </script>
</body>
</html>
  `;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'loading') {
        setLoading(!data.loading);
      }
    } catch (e) {
      // Ignore parse errors
    }
  };

  const handleLoadEnd = () => {
    // Give HLS time to initialize
    setTimeout(() => setLoading(false), 2000);
  };

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    logError("WebView error:", nativeEvent);
    setLoading(false);
    onError?.(nativeEvent?.description || "Failed to load Cloudflare Stream");
  };

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading stream...</Text>
        </View>
      )}
      <WebView
        ref={webViewRef}
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
    backgroundColor: "#000",
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

