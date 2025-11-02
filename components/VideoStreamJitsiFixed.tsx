// components/VideoStreamJitsiFixed.tsx
// Fixed Jitsi Meet component with proper WebView configuration for React Native

import React, { useState, useRef } from "react";
import { View, StyleSheet, ActivityIndicator, Text, Platform } from "react-native";
import { WebView } from "react-native-webview";
import { COLORS } from "../lib/theme";

type Props = {
  roomUrl: string;
  isHost?: boolean;
  displayName?: string;
  avatarUrl?: string | null;
  onError?: (error: string) => void;
  onReady?: () => void;
};

export default function VideoStreamJitsiFixed({ roomUrl, isHost = false, displayName, avatarUrl, onError, onReady }: Props) {
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef<WebView>(null);
  
  // Extract room name from URL
  const roomUrlFull = roomUrl.startsWith("http") ? roomUrl : `https://meet.jit.si/${roomUrl}`;
  const roomName = roomUrlFull.split('/').pop()?.split('?')[0] || roomUrlFull.split('/').pop() || '';
  
  // Build Jitsi Meet URL with optimized configuration
  const jitsiBaseUrl = `https://meet.jit.si/${roomName}`;
  
  // Use provided displayName or fallback
  const userDisplayName = displayName || (isHost ? "Host" : "Participant");

  // Modern WebView-compatible user agent
  const webViewUserAgent = Platform.select({
    ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    android: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
    default: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  });

  // Use direct URL (not iframe) for better WebView compatibility
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
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
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
    }
    #jitsi-container {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0;
      left: 0;
    }
    .error-message {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #fff;
      text-align: center;
      padding: 20px;
      background: rgba(0,0,0,0.8);
      border-radius: 8px;
      z-index: 1000;
      display: none;
    }
  </style>
  <script src="https://8x8.vc/external_api.js"></script>
</head>
<body>
  <div id="jitsi-container"></div>
  <div id="error" class="error-message"></div>
  <script>
    (function() {
      const container = document.getElementById('jitsi-container');
      const errorDiv = document.getElementById('error');
      
      try {
        // Use Jitsi External API for better WebView compatibility
        const domain = 'meet.jit.si';
        const userDisplayName = ${JSON.stringify(userDisplayName)};
        const userAvatarUrl = ${JSON.stringify(avatarUrl || null)};
        
        const userInfoObj = { 
          displayName: userDisplayName
        };
        // Jitsi accepts avatar via avatarUrl - must be a publicly accessible URL
        // Ensure it's a full HTTP/HTTPS URL that Jitsi can fetch
        if (userAvatarUrl && (userAvatarUrl.startsWith('http://') || userAvatarUrl.startsWith('https://'))) {
          // Use avatarUrl property (primary method)
          userInfoObj.avatarUrl = userAvatarUrl;
          console.log('Setting Jitsi avatar URL:', userAvatarUrl);
        } else if (userAvatarUrl) {
          console.warn('Avatar URL is not a full HTTP URL, skipping:', userAvatarUrl);
        }
        
        const options = {
          roomName: '${roomName}',
          parentNode: container,
          configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            prejoinPageEnabled: true, // Enable prejoin page so buttons work
            disableDeepLinking: true,
            disableInviteFunctions: true,
            enableWelcomePage: false,
            enableLayerSuspension: true,
            resolution: 720,
            enableTCC: true,
            useStunTurn: true,
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_BRAND_WATERMARK: false,
            HIDE_INVITE_MORE_HEADER: true,
            DISABLE_FOCUS_INDICATOR: true,
            TOOLBAR_BUTTONS: [],
          },
          userInfo: userInfoObj,
        };

        const api = new JitsiMeetExternalAPI(domain, options);
        
        api.addEventListener('videoConferenceJoined', function() {
          console.log('Joined Jitsi conference');
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'ready',
              message: 'Connected to Jitsi'
            }));
          }
        });

        api.addEventListener('readyToClose', function() {
          console.log('Jitsi ready to close');
          api.dispose();
        });

        api.addEventListener('error', function(error) {
          console.error('Jitsi error:', error);
          errorDiv.textContent = 'Error: ' + (error.error || 'Unknown error');
          errorDiv.style.display = 'block';
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'error',
              message: error.error || 'Jitsi connection error'
            }));
          }
        });

        // Notify React Native that Jitsi is loading
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'loading',
            message: 'Loading Jitsi Meet...'
          }));
        }
      } catch (error) {
        console.error('Failed to initialize Jitsi:', error);
        errorDiv.textContent = 'Failed to load Jitsi: ' + error.message;
        errorDiv.style.display = 'block';
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'error',
            message: error.message || 'Failed to initialize Jitsi'
          }));
        }
      }
    })();
  </script>
</body>
</html>
  `;

  const handleLoadEnd = () => {
    // Give Jitsi time to initialize
    setTimeout(() => {
      setLoading(false);
    }, 3000);
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') {
        setLoading(false);
        onReady?.();
      } else if (data.type === 'error') {
        setLoading(false);
        onError?.(data.message || "Jitsi Meet error");
      } else if (data.type === 'loading') {
        // Keep loading state
      }
    } catch (e) {
      console.error("Failed to parse message:", e);
    }
  };

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.error("WebView error:", nativeEvent);
    setLoading(false);
    onError?.(nativeEvent?.description || "Failed to load Jitsi Meet");
  };

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Connecting to Jitsi Meet...</Text>
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
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        mixedContentMode="always"
        userAgent={webViewUserAgent}
        originWhitelist={['*']}
        setSupportMultipleWindows={false}
        geolocationEnabled={false}
        // Android specific
        androidLayerType="hardware"
        // iOS specific
        allowsProtectedMedia={true}
        // Additional settings for media capture
        cacheEnabled={false}
        incognito={false}
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
    width: "100%",
    height: "100%",
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
});

