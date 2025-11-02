// components/VideoStreamJanus.tsx
// Janus WebRTC video streaming component using WebView

import React, { useRef, useEffect } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import { WebView } from "react-native-webview";
import { COLORS } from "../lib/env";

// Get Janus server URL from environment
const JANUS_SERVER_URL = process.env.EXPO_PUBLIC_JANUS_SERVER_URL || "wss://your-janus-server.com:8989/janus";
const JANUS_HTTP_URL = process.env.EXPO_PUBLIC_JANUS_HTTP_URL || "https://your-janus-server.com:8089/janus";

type Props = {
  roomId: string | number;
  token: string;
  isHost?: boolean;
  onError?: (error: string) => void;
  onReady?: () => void;
};

export default function VideoStreamJanus({ roomId, token, isHost = false, onError, onReady }: Props) {
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    // Notify when component is ready
    if (onReady) {
      setTimeout(() => onReady(), 1000);
    }
  }, [onReady]);

  // Convert roomId to number if it's a string
  const numericRoomId = typeof roomId === "string" ? parseInt(roomId.replace(/\D/g, "")) || 1234 : roomId;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://unpkg.com/janus-gateway/dist/janus.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #video-container {
      width: 100%;
      height: 100%;
      position: relative;
    }
    #local-video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #000;
    }
    #remote-video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #000;
    }
    #status {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0,0,0,0.7);
      color: #fff;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 100;
    }
    .hidden {
      display: none;
    }
  </style>
</head>
<body>
  <div id="status">Connecting to Janus...</div>
  <div id="video-container">
    ${isHost ? '<video id="local-video" autoplay muted playsinline></video>' : ''}
    <video id="remote-video" autoplay playsinline></video>
  </div>
  
  <script>
    let janus = null;
    let videoroom = null;
    let localStream = null;
    let remoteStream = null;
    let roomId = ${numericRoomId};

    function updateStatus(msg) {
      document.getElementById('status').textContent = msg;
      setTimeout(() => {
        if (msg !== 'Connected') {
          document.getElementById('status').classList.add('hidden');
        }
      }, 3000);
    }

    function errorHandler(error) {
      console.error('Janus error:', error);
      updateStatus('Error: ' + (error.message || error));
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error',
          message: error.message || String(error)
        }));
      }
    }

    // Initialize Janus
    Janus.init({
      debug: "all",
      callback: function() {
        updateStatus('Initializing connection...');
        janus = new Janus({
          server: "${JANUS_SERVER_URL}",
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
          ],
          success: function() {
            updateStatus('Connecting to room...');
            attachToVideoRoom();
          },
          error: errorHandler,
          destroyed: function() {
            console.log('Janus connection destroyed');
          }
        });
      }
    });

    function attachToVideoRoom() {
      janus.attach({
        plugin: "janus.plugin.videoroom",
        opaqueId: "enlisted-" + roomId + "-" + Date.now(),
        success: function(pluginHandle) {
          videoroom = pluginHandle;
          updateStatus('Room connected');
          ${isHost ? 'publishStream();' : 'subscribeToRoom();'}
        },
        error: errorHandler,
        iceState: function(state) {
          console.log('ICE state:', state);
        },
        webrtcState: function(on) {
          console.log('WebRTC state:', on ? 'up' : 'down');
          if (on) {
            updateStatus('Connected');
          }
        },
        onmessage: function(msg, jsep) {
          console.log('Message from Janus:', msg, jsep);
          
          if (jsep) {
            videoroom.handleRemoteJsep({ jsep: jsep });
          }

          var result = msg["result"];
          if (result) {
            if (result["videoroom"] === "joined") {
              var id = result["id"];
              console.log('Joined room, participant ID:', id);
            } else if (result["videoroom"] === "event") {
              var participants = result["publishers"];
              if (participants && participants.length > 0 && !${isHost}) {
                subscribeToPublisher(participants[0]);
              }
            }
          }
        }
      });
    }

    function publishStream() {
      updateStatus('Requesting camera access...');
      
      Janus.attachMediaStream(${isHost ? 'document.getElementById("local-video")' : 'null'}, null, {
        video: true,
        audio: true,
        success: function(stream) {
          localStream = stream;
          updateStatus('Creating offer...');
          
          videoroom.createOffer({
            tracks: [
              { kind: 'video', capture: true, recv: false },
              { kind: 'audio', capture: true, recv: false }
            ],
            success: function(jsep) {
              console.log('Got publisher offer:', jsep);
              updateStatus('Joining room...');
              
              videoroom.send({
                message: {
                  request: "joinandconfigure",
                  room: roomId,
                  ptype: "publisher",
                  display: "Host",
                  id: 12345
                },
                jsep: jsep
              });
            },
            error: errorHandler
          });
        },
        error: function(error) {
          errorHandler({ message: 'Camera access denied: ' + (error.message || error) });
        }
      });
    }

    function subscribeToRoom() {
      updateStatus('Finding active streams...');
      
      videoroom.send({
        message: {
          request: "join",
          room: roomId,
          ptype: "subscriber",
          feeds: []
        }
      });
    }

    function subscribeToPublisher(publisher) {
      if (!publisher || !publisher.id) {
        updateStatus('No active stream found');
        return;
      }

      updateStatus('Subscribing to stream...');
      
      videoroom.createOffer({
        tracks: [
          { kind: 'video', capture: false, recv: true },
          { kind: 'audio', capture: false, recv: true }
        ],
        success: function(jsep) {
          console.log('Got subscriber offer:', jsep);
          
          videoroom.send({
            message: {
              request: "join",
              room: roomId,
              ptype: "subscriber",
              feed: publisher.id
            },
            jsep: jsep
          });
        },
        error: errorHandler
      });
    }

    // Handle remote stream
    videoroom.ontrack = function(track, mid, on) {
      console.log('Track event:', track, mid, on);
      if (on && track && track.kind === 'video') {
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) {
          Janus.attachMediaStream(remoteVideo, track);
        }
      }
    };

    // Cleanup on page unload
    window.addEventListener('beforeunload', function() {
      if (videoroom) {
        videoroom.detach();
      }
      if (janus) {
        janus.destroy();
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    });
  </script>
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
            <Text style={styles.loadingText}>Connecting to Janus...</Text>
          </View>
        )}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'error') {
              console.error('Janus WebView error:', data.message);
              onError?.(data.message);
            }
          } catch (e) {
            console.error('Failed to parse WebView message:', e);
          }
        }}
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
  },
  loadingText: {
    color: COLORS.text || "#fff",
    marginTop: 12,
    fontSize: 14,
  },
});

