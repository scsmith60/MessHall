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
  <!-- CRITICAL: Request media permissions -->
  <meta http-equiv="Permissions-Policy" content="camera=*, microphone=*, geolocation=*">
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
    #status {
      position: absolute;
      top: 20px;
      left: 20px;
      color: #fff;
      background: rgba(0,0,0,0.7);
      padding: 10px;
      border-radius: 5px;
      z-index: 2000;
      font-size: 12px;
    }
    /* Force Jitsi toolbar to always be visible */
    [class*="toolbox"],
    [class*="toolbar"],
    [id*="toolbar"],
    [class*="filmstrip"],
    button[aria-label*="microphone"],
    button[aria-label*="camera"],
    button[aria-label*="video"],
    button[aria-label*="mic"] {
      display: flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      z-index: 9999 !important;
      pointer-events: auto !important;
    }
  </style>
  <!-- No script tags - all code moved to injected JavaScript -->
</head>
<body>
  <div id="status">Initializing Jitsi...</div>
  <div id="jitsi-container"></div>
  <div id="error" class="error-message"></div>
</body>
</html>
  `;

  // Create the full Jitsi initialization script to inject
  const jitsiInitScript = `
    (function() {
      console.log('[JITSI INJECTED] Starting initialization...');
      const statusDiv = document.getElementById('status');
      const container = document.getElementById('jitsi-container');
      const errorDiv = document.getElementById('error');
      
      function updateStatus(msg) {
        if (statusDiv) statusDiv.textContent = msg;
        console.log('[Jitsi]', msg);
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: msg }));
        }
      }
      
      updateStatus('Loading Jitsi API...');
      
      // Load Jitsi API script - try multiple CDN URLs
      function loadJitsiAPI() {
        return new Promise(function(resolve, reject) {
          if (typeof JitsiMeetExternalAPI !== 'undefined') {
            console.log('[Jitsi] API already loaded');
            resolve();
            return;
          }
          
          var urls = [
            'https://8x8.vc/external_api.js',
            'https://meet.jit.si/external_api.js',
            'https://cdn.jsdelivr.net/npm/jitsi-meet@latest/external_api.js'
          ];
          
          var currentUrlIndex = 0;
          
          function tryLoadScript(url) {
            console.log('[Jitsi] Attempting to load from:', url);
            updateStatus('Loading from: ' + url.replace('https://', ''));
            
            var script = document.createElement('script');
            script.type = 'text/javascript';
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.src = url;
            
            var timeout = setTimeout(function() {
              console.error('[Jitsi] Script load timeout for:', url);
              script.onload = null;
              script.onerror = null;
              tryNextUrl();
            }, 10000); // 10 second timeout per URL
            
            script.onload = function() {
              clearTimeout(timeout);
              console.log('[Jitsi] Script onload fired for:', url);
              setTimeout(function() {
                if (typeof JitsiMeetExternalAPI !== 'undefined') {
                  console.log('[Jitsi] ✅ API loaded successfully from:', url);
                  updateStatus('✅ API loaded from: ' + url.replace('https://', ''));
                  resolve();
                } else {
                  console.log('[Jitsi] Script loaded but API not available, trying next URL...');
                  tryNextUrl();
                }
              }, 2000);
            };
            
            script.onerror = function(err) {
              clearTimeout(timeout);
              console.error('[Jitsi] Script onerror fired for:', url, err);
              updateStatus('Failed: ' + url.replace('https://', ''));
              tryNextUrl();
            };
            
            try {
              document.head.appendChild(script);
              console.log('[Jitsi] Script tag appended to head');
            } catch(e) {
              console.error('[Jitsi] Failed to append script:', e);
              tryNextUrl();
            }
          }
          
          function tryNextUrl() {
            currentUrlIndex++;
            if (currentUrlIndex < urls.length) {
              tryLoadScript(urls[currentUrlIndex]);
            } else {
              console.error('[Jitsi] All script URLs failed to load');
              reject(new Error('Failed to load Jitsi API from all CDN URLs. Check internet connection.'));
            }
          }
          
          tryLoadScript(urls[0]);
        });
      }
      
      loadJitsiAPI().then(function() {
        updateStatus('Jitsi API loaded, initializing...');
        const roomName = '${roomName}';
        const userDisplayName = ${JSON.stringify(userDisplayName)};
        const isHostConfig = ${isHost};
        
        // CRITICAL: Request media permissions via getUserMedia BEFORE initializing Jitsi
        // This ensures permissions are granted when Jitsi tries to access devices
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          console.log('[Jitsi] Requesting media permissions before initializing...');
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Requesting camera/microphone permissions...' }));
          }
          
          var constraints = {
            video: isHostConfig ? { facingMode: 'user' } : false,
            audio: isHostConfig ? true : false
          };
          
          navigator.mediaDevices.getUserMedia(constraints)
            .then(function(stream) {
              console.log('[Jitsi] ✅ Media permissions granted!');
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅ Camera/mic permissions granted!' }));
              }
              // Stop the stream immediately - we just needed permission
              stream.getTracks().forEach(function(track) {
                track.stop();
              });
              // Now initialize Jitsi with permissions granted
              initializeJitsi();
            })
            .catch(function(error) {
              console.error('[Jitsi] Media permission denied:', error);
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ 
                  type: 'status', 
                  message: '⚠️ Permission prompt: ' + (error.name === 'NotAllowedError' ? 'Please allow camera/mic access' : error.message)
                }));
              }
              // Try to initialize anyway - Jitsi will request permissions again
              initializeJitsi();
            });
        } else {
          console.log('[Jitsi] getUserMedia not available, initializing without pre-permission');
          initializeJitsi();
        }
        
        function initializeJitsi() {
        try {
          // Try using skipPrejoinPage flag if available (newer Jitsi versions)
          var jitsiOptions = {
            roomName: roomName,
            parentNode: container,
            configOverwrite: {
              prejoinPageEnabled: false,
              startWithAudioMuted: isHostConfig ? false : true,
              startWithVideoMuted: isHostConfig ? false : true,
              enableLobby: false,
              enablePrejoinUI: false,
              enableWelcomePage: false,
              // Try multiple ways to skip prejoin
              skipPrejoinPage: true,
              skipJoinLeaveSounds: true,
              // Hard-disable deep linking splash screen that blocks auto-join on mobile WebView
              disableDeepLinking: true,
              deepLinkingEnabled: false,
              deeplinking: { disabled: true },
              // Newer config shape (2024+) for prejoin and deeplinking
              prejoinConfig: { enabled: false },
            },
            interfaceConfigOverwrite: {
              TOOLBAR_BUTTONS: isHostConfig ? ['microphone', 'camera', 'hangup', 'settings'] : ['hangup'],
              INITIAL_TOOLBAR_TIMEOUT: 999999999,
              TOOLBAR_TIMEOUT: 999999999,
              SHOW_PREJOIN_PAGE: false,
              DISABLE_PRESENCE_LOBBY: true,
              HIDE_INVITE_MORE_HEADER: true,
              MOBILE_APP_PROMO: false,
            },
            userInfo: { displayName: userDisplayName }
          };
          
          // Try using the noPrejoinMode flag if it exists (some Jitsi versions support this)
          try {
            if (typeof JitsiMeetExternalAPI !== 'undefined' && JitsiMeetExternalAPI.prototype) {
              // Check if there's a way to disable prejoin via constructor options
              console.log('[Jitsi] Creating API instance...');
            }
          } catch(e) {}
          
          // Create API instance - configOverwrite should handle skipping prejoin
          console.log('[Jitsi] Creating API instance with room:', roomName);
          const api = new JitsiMeetExternalAPI('meet.jit.si', jitsiOptions);
          
          // Force click "Join" buttons immediately to bypass prejoin screen
          function forceClickJoinButton() {
            try {
              console.log('[Jitsi] Searching for join buttons...');
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Searching for join button...' }));
              }
              
              // CRITICAL: Jitsi loads in an iframe, so we need to check iframe documents too
              var clickableCount = 0;
              var documentsToCheck = [document];
              
              // Find all iframes and add their documents
              var iframes = document.querySelectorAll('iframe');
              console.log('[Jitsi] Found', iframes.length, 'iframes');
              iframes.forEach(function(iframe) {
                try {
                  // Try to access iframe content (may fail due to CORS)
                  if (iframe.contentDocument) {
                    documentsToCheck.push(iframe.contentDocument);
                    console.log('[Jitsi] Added iframe document');
                  } else if (iframe.contentWindow) {
                    try {
                      var iframeDoc = iframe.contentWindow.document;
                      documentsToCheck.push(iframeDoc);
                      console.log('[Jitsi] Added iframe document via contentWindow');
                    } catch(e) {
                      console.log('[Jitsi] Cannot access iframe document (CORS):', e);
                    }
                  }
                } catch(e) {
                  console.log('[Jitsi] Error accessing iframe:', e);
                }
              });
              
              // Check ALL clickable elements in main document and iframes
              documentsToCheck.forEach(function(doc) {
                try {
                  var allClickable = doc.querySelectorAll('button, a, [role="button"], div[class*="button"], span[class*="button"], [class*="join"]');
                  clickableCount += allClickable.length;
                } catch(e) {
                  console.log('[Jitsi] Error querying document:', e);
                }
              });
              
              console.log('[Jitsi] Found', clickableCount, 'total clickable elements across all documents');
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Found ' + clickableCount + ' clickable elements (including iframes)' }));
              }
              
              var clicked = false;
              var foundButtons = [];
              
              // Check each document (main + iframes)
              documentsToCheck.forEach(function(doc) {
                try {
                  var allClickable = doc.querySelectorAll('button, a, [role="button"], div[class*="button"], span[class*="button"], [class*="join"], [id*="join"]');
                  
                  allClickable.forEach(function(el) {
                try {
                  var text = (el.textContent || el.innerText || '').toLowerCase().trim();
                  var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                  
                  // Look for "Join in app", "Join in browser", "Join meeting", etc.
                  if ((text.includes('join') || text.includes('enter') || ariaLabel.includes('join')) && 
                      !text.includes('leave') && !text.includes('end') && !text.includes('download')) {
                    foundButtons.push(text);
                    console.log('[Jitsi] Found join button! Text:', text);
                    if (window.ReactNativeWebView) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Found join button: ' + text }));
                    }
                    
                    // Try multiple click methods
                    try {
                      el.click();
                      clicked = true;
                      console.log('[Jitsi] ✅ Clicked via .click()');
                      if (window.ReactNativeWebView) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅ Clicked join button!' }));
                      }
                    } catch(e1) {
                      console.log('[Jitsi] .click() failed:', e1);
                    }
                    
                    try {
                      if (el.dispatchEvent) {
                        var clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                        el.dispatchEvent(clickEvent);
                        clicked = true;
                        console.log('[Jitsi] ✅ Clicked via dispatchEvent');
                      }
                    } catch(e2) {
                      console.log('[Jitsi] dispatchEvent failed:', e2);
                    }
                    
                    try {
                      if (el.dispatchEvent) {
                        var touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
                        var touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
                        el.dispatchEvent(touchStart);
                        el.dispatchEvent(touchEnd);
                        clicked = true;
                        console.log('[Jitsi] ✅ Clicked via touch event');
                      }
                    } catch(e3) {
                      console.log('[Jitsi] touch event failed:', e3);
                    }
                    
                    // Also try focus and then click
                    try {
                      el.focus();
                      el.click();
                      clicked = true;
                      console.log('[Jitsi] ✅ Clicked after focus');
                    } catch(e4) {
                      console.log('[Jitsi] focus+click failed:', e4);
                    }
                  }
                  } catch(e) {
                    console.log('[Jitsi] Error checking element:', e);
                  }
                });
                } catch(e) {
                  console.log('[Jitsi] Error checking document:', e);
                }
              });
              
              if (foundButtons.length > 0 && !clicked) {
                console.log('[Jitsi] ⚠️ Found buttons but clicking failed:', foundButtons);
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '⚠️ Found ' + foundButtons.length + ' join buttons but clicking failed' }));
                }
              } else if (foundButtons.length === 0) {
                console.log('[Jitsi] ⚠️ No join button found');
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '⚠️ No join button found to click' }));
                }
              }
              
              // Also try to hide the entire prejoin container (check all documents)
              documentsToCheck.forEach(function(doc) {
                try {
                  var prejoinContainers = doc.querySelectorAll('[class*="prejoin"], [class*="lobby"], [id*="prejoin"], [id*="lobby"], [class*="join-screen"]');
                  if (prejoinContainers.length > 0) {
                    console.log('[Jitsi] Hiding', prejoinContainers.length, 'prejoin containers in document');
                    prejoinContainers.forEach(function(container) {
                      container.style.display = 'none';
                      container.style.visibility = 'hidden';
                      container.style.opacity = '0';
                      container.style.height = '0';
                      container.style.overflow = 'hidden';
                      container.style.pointerEvents = 'none';
                    });
                    if (window.ReactNativeWebView) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Hid ' + prejoinContainers.length + ' prejoin containers' }));
                    }
                  }
                } catch(e) {
                  console.log('[Jitsi] Error hiding containers in document:', e);
                }
              });
              
              // If no button found, try using Jitsi API commands directly
              if (!clicked && typeof api !== 'undefined') {
                try {
                  console.log('[Jitsi] Trying API commands to force join...');
                  if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Trying API commands to force join...' }));
                  }
                  
                  // Try various API commands that might dismiss prejoin
                  try {
                    api.executeCommand('displayName', userDisplayName);
                  } catch(e) {}
                  
                  try {
                    api.executeCommand('toggleLobby'); // Toggle lobby off
                  } catch(e) {}
                  
                  try {
                    if (isHostConfig) {
                      api.executeCommand('toggleVideo'); // Enable video to trigger join
                    }
                  } catch(e) {}
                } catch(e) {
                  console.log('[Jitsi] API command error:', e);
                }
              }
            } catch(e) {
              console.log('[Jitsi] Error in forceClickJoinButton:', e);
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Error: ' + e.message }));
              }
            }
          }
          
          // Call immediately and repeatedly - be very aggressive
          setTimeout(forceClickJoinButton, 200);
          setTimeout(forceClickJoinButton, 500);
          setTimeout(forceClickJoinButton, 1000);
          setTimeout(forceClickJoinButton, 2000);
          setTimeout(forceClickJoinButton, 3000);
          setTimeout(forceClickJoinButton, 4000);
          
          // Aggressively hide prejoin UI elements with CSS - run continuously
          function hidePrejoinUI() {
            try {
              // Hide by class/id
              var prejoinElements = document.querySelectorAll('[class*="prejoin"], [class*="lobby"], [id*="prejoin"], [id*="lobby"], [class*="join-screen"], [data-testid*="prejoin"]');
              prejoinElements.forEach(function(el) {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
                el.style.opacity = '0';
                el.style.pointerEvents = 'none';
              });
              
              // Hide by text content - find elements containing "How do you want to join"
              var allDivs = document.querySelectorAll('div, section, main');
              allDivs.forEach(function(div) {
                var text = (div.textContent || '').toLowerCase();
                if (text.includes('how do you want to join') || text.includes('join this meeting')) {
                  div.style.display = 'none';
                  console.log('[Jitsi] Hid prejoin div by text');
                }
              });
            } catch(e) {
              console.log('[Jitsi] Error hiding prejoin UI:', e);
            }
          }
          
          // Hide continuously
          setTimeout(hidePrejoinUI, 200);
          setInterval(hidePrejoinUI, 1000);
          
          api.addEventListener('readyToClose', function() {
            api.dispose();
          });
          
          // CRITICAL: Aggressively auto-click "Join in browser" and "Join meeting" buttons
          var joinButtonsClicked = { inBrowser: false, meeting: false };
          
          function autoClickJoinButtons() {
            try {
              var foundButtons = [];
              
              // Method 1: Search main document
              function searchDocument(doc, docName) {
                try {
                  // Very broad selectors to catch anything clickable
                  var allElements = doc.querySelectorAll('*');
                  
                  for (var i = 0; i < allElements.length; i++) {
                    var el = allElements[i];
                    if (!el || el.offsetParent === null) continue; // Skip hidden elements
                    
                    try {
                      var text = (el.textContent || el.innerText || '').trim();
                      var textLower = text.toLowerCase();
                      
                      // Check for "Join in browser" text
                      if ((textLower === 'join in browser' || textLower.includes('join in browser')) && !joinButtonsClicked.inBrowser) {
                        foundButtons.push({ element: el, text: text, type: 'join-in-browser', doc: docName });
                      }
                      
                      // Check for "Join meeting" text (but not "Join in app" or "Join in browser")
                      if ((textLower === 'join meeting' || 
                           (textLower.includes('join meeting') && !textLower.includes('join in app') && !textLower.includes('join in browser'))) && 
                          !joinButtonsClicked.meeting) {
                        foundButtons.push({ element: el, text: text, type: 'join-meeting', doc: docName });
                      }
                    } catch(e) {}
                  }
                } catch(e) {
                  console.log('[Jitsi] Error searching document:', docName, e);
                }
              }
              
              // Search main document
              searchDocument(document, 'main');
              
              // Search all iframes
              var iframes = document.querySelectorAll('iframe');
              console.log('[Jitsi] Checking', iframes.length, 'iframes for buttons...');
              iframes.forEach(function(iframe, idx) {
                try {
                  if (iframe.contentDocument) {
                    searchDocument(iframe.contentDocument, 'iframe-' + idx);
                  } else if (iframe.contentWindow && iframe.contentWindow.document) {
                    searchDocument(iframe.contentWindow.document, 'iframe-' + idx);
                  }
                } catch(e) {
                  console.log('[Jitsi] Cannot access iframe', idx, '(CORS):', e.message);
                }
              });
              
              console.log('[Jitsi] Found', foundButtons.length, 'potential buttons');
              
              // Click buttons in priority order
              foundButtons.forEach(function(btnInfo) {
                try {
                  var el = btnInfo.element;
                  
                  // Try to find the actual clickable parent (button, anchor, or parent with click handler)
                  var clickable = el;
                  while (clickable && clickable !== document.body) {
                    var tagName = clickable.tagName ? clickable.tagName.toLowerCase() : '';
                    var role = clickable.getAttribute ? clickable.getAttribute('role') : '';
                    var onclick = clickable.onclick ? 'yes' : '';
                    
                    if (tagName === 'button' || tagName === 'a' || role === 'button' || onclick || 
                        clickable.getAttribute('class')?.includes('button') ||
                        clickable.getAttribute('class')?.includes('join')) {
                      break; // Found clickable element
                    }
                    clickable = clickable.parentElement;
                  }
                  
                  if (!clickable || clickable === document.body) {
                    clickable = el; // Fallback to original element
                  }
                  
                  // Click "Join in browser" first
                  if (btnInfo.type === 'join-in-browser' && !joinButtonsClicked.inBrowser) {
                    console.log('[Jitsi] 🎯 Clicking "Join in browser":', btnInfo.text);
                    if (window.ReactNativeWebView) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '🎯 Clicking "Join in browser" button' }));
                    }
                    
                    // Try multiple click methods
                    try {
                      clickable.focus();
                      clickable.click();
                    } catch(e) {}
                    
                    try {
                      var evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                      clickable.dispatchEvent(evt);
                    } catch(e) {}
                    
                    try {
                      var touchEvt = new TouchEvent('touchend', { bubbles: true, cancelable: true });
                      clickable.dispatchEvent(touchEvt);
                    } catch(e) {}
                    
                    // Try mousedown/up
                    try {
                      clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                      clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                      clickable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    } catch(e) {}
                    
                    joinButtonsClicked.inBrowser = true;
                    console.log('[Jitsi] ✅ Attempted to click "Join in browser"');
                    if (window.ReactNativeWebView) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅ Clicked "Join in browser"!' }));
                    }
                    
                    // Wait a bit before looking for "Join meeting" button
                    setTimeout(function() {
                      joinButtonsClicked.inBrowser = false; // Reset to allow retry
                    }, 2000);
                  }
                  
                  // Click "Join meeting" second
                  if (btnInfo.type === 'join-meeting' && !joinButtonsClicked.meeting) {
                    console.log('[Jitsi] 🎯 Clicking "Join meeting":', btnInfo.text);
                    if (window.ReactNativeWebView) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '🎯 Clicking "Join meeting" button' }));
                    }
                    
                    // Try multiple click methods
                    try {
                      clickable.focus();
                      clickable.click();
                    } catch(e) {}
                    
                    try {
                      var evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                      clickable.dispatchEvent(evt);
                    } catch(e) {}
                    
                    try {
                      var touchEvt = new TouchEvent('touchend', { bubbles: true, cancelable: true });
                      clickable.dispatchEvent(touchEvt);
                    } catch(e) {}
                    
                    try {
                      clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                      clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                      clickable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    } catch(e) {}
                    
                    joinButtonsClicked.meeting = true;
                    console.log('[Jitsi] ✅ Attempted to click "Join meeting"');
                    if (window.ReactNativeWebView) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅ Clicked "Join meeting"!' }));
                    }
                  }
                } catch(e) {
                  console.log('[Jitsi] Error clicking button:', e);
                }
              });
              
            } catch(e) {
              console.log('[Jitsi] Error in autoClickJoinButtons:', e);
            }
          }
          
          // Run VERY aggressively - start immediately and frequently
          setTimeout(autoClickJoinButtons, 100);
          setTimeout(autoClickJoinButtons, 300);
          setTimeout(autoClickJoinButtons, 500);
          setTimeout(autoClickJoinButtons, 1000);
          setTimeout(autoClickJoinButtons, 1500);
          setTimeout(autoClickJoinButtons, 2000);
          setTimeout(autoClickJoinButtons, 3000);
          setTimeout(autoClickJoinButtons, 4000);
          setInterval(autoClickJoinButtons, 800); // Check every 800ms
          
          api.addEventListener('videoConferenceJoined', function() {
            updateStatus('✅ Joined conference!');
            
            // Force toolbar visibility for host
            if (isHostConfig) {
              setTimeout(function() {
                try {
                  var toolbars = document.querySelectorAll('[class*="toolbox"], [class*="toolbar"]');
                  toolbars.forEach(function(tb) {
                    tb.style.display = 'flex';
                    tb.style.visibility = 'visible';
                    tb.style.opacity = '1';
                    tb.style.zIndex = '9999';
                  });
                } catch(e) {}
              }, 1000);
            }
            
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready', message: 'Connected' }));
            }
          });
          
          // CRITICAL: Try to bypass prejoin using API commands immediately
          // This might work better than DOM manipulation
          function tryDirectJoin() {
            try {
              if (!api) {
                console.log('[Jitsi] ⚠️ API not available in tryDirectJoin');
                return;
              }
              
              console.log('[Jitsi] 🔧🔧🔧 ATTEMPTING DIRECT JOIN VIA API COMMANDS...');
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '🔧🔧🔧 Trying direct join via API commands...' }));
              }
              
              // Method 1: Try to toggle lobby off first
              console.log('[Jitsi] 🔧 Step 1: Calling api.executeCommand("toggleLobby")');
              try {
                api.executeCommand('toggleLobby').then(function() {
                  console.log('[Jitsi] ✅✅✅ toggleLobby SUCCEEDED!');
                  if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅✅✅ toggleLobby succeeded!' }));
                  }
                }).catch(function(e) {
                  console.log('[Jitsi] ❌ toggleLobby FAILED:', e.message || e.toString());
                });
              } catch(e) {
                console.log('[Jitsi] ❌ toggleLobby EXCEPTION:', e.message || e.toString());
              }
              
              // Method 2: Try to set display name which sometimes triggers join
              console.log('[Jitsi] 🔧 Step 2: Calling api.executeCommand("displayName")');
              try {
                api.executeCommand('displayName', userDisplayName || 'User').then(function() {
                  console.log('[Jitsi] ✅✅✅ displayName SUCCEEDED!');
                  if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅✅✅ displayName succeeded!' }));
                  }
                }).catch(function(e) {
                  console.log('[Jitsi] ❌ displayName FAILED:', e.message || e.toString());
                });
              } catch(e) {
                console.log('[Jitsi] ❌ displayName EXCEPTION:', e.message || e.toString());
              }
              
              // Method 3: For hosts, try to enable video/audio to trigger join
              if (isHostConfig) {
                console.log('[Jitsi] 🔧 Step 3: Calling api.executeCommand("toggleVideo") (HOST)');
                try {
                  api.executeCommand('toggleVideo').then(function() {
                    console.log('[Jitsi] ✅✅✅ toggleVideo SUCCEEDED!');
                    if (window.ReactNativeWebView) {
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅✅✅ toggleVideo succeeded!' }));
                    }
                  }).catch(function(e) {
                    console.log('[Jitsi] ❌ toggleVideo FAILED:', e.message || e.toString());
                  });
                } catch(e) {
                  console.log('[Jitsi] ❌ toggleVideo EXCEPTION:', e.message || e.toString());
                }
                
                setTimeout(function() {
                  console.log('[Jitsi] 🔧 Step 4: Calling api.executeCommand("toggleAudio") (HOST)');
                  try {
                    api.executeCommand('toggleAudio').then(function() {
                      console.log('[Jitsi] ✅✅✅ toggleAudio SUCCEEDED!');
                      if (window.ReactNativeWebView) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅✅✅ toggleAudio succeeded!' }));
                      }
                    }).catch(function(e) {
                      console.log('[Jitsi] ❌ toggleAudio FAILED:', e.message || e.toString());
                    });
                  } catch(e) {
                    console.log('[Jitsi] ❌ toggleAudio EXCEPTION:', e.message || e.toString());
                  }
                }, 200);
              }
              
              // Method 4: Check participant count to see if we're actually in
              try {
                var participantCount = api.getNumberOfParticipants();
                console.log('[Jitsi] 📊 Participant count:', participantCount);
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '📊 Participant count: ' + participantCount }));
                }
              } catch(e) {
                console.log('[Jitsi] ❌ getNumberOfParticipants FAILED:', e.message || e.toString());
              }
            } catch(e) {
              console.log('[Jitsi] ❌ Direct join error:', e.message || e.toString());
            }
          }
          
          // Force join after API is ready
          api.addEventListener('ready', function() {
            updateStatus('API ready, joining...');
            console.log('[Jitsi] ✅✅✅ API READY EVENT FIRED - Starting join attempts...');
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: '✅✅✅ API ready - starting join attempts...' }));
            }
            
            // Try direct join immediately with logging
            console.log('[Jitsi] 🔧 Scheduling tryDirectJoin at 100ms');
            setTimeout(function() {
              console.log('[Jitsi] 🔧 Executing tryDirectJoin (100ms)');
              tryDirectJoin();
            }, 100);
            
            console.log('[Jitsi] 🔧 Scheduling tryDirectJoin at 500ms');
            setTimeout(function() {
              console.log('[Jitsi] 🔧 Executing tryDirectJoin (500ms)');
              tryDirectJoin();
            }, 500);
            
            console.log('[Jitsi] 🔧 Scheduling tryDirectJoin at 1000ms');
            setTimeout(function() {
              console.log('[Jitsi] 🔧 Executing tryDirectJoin (1000ms)');
              tryDirectJoin();
            }, 1000);
            
            console.log('[Jitsi] 🔧 Scheduling tryDirectJoin at 2000ms');
            setTimeout(function() {
              console.log('[Jitsi] 🔧 Executing tryDirectJoin (2000ms)');
              tryDirectJoin();
            }, 2000);
            
            console.log('[Jitsi] 🔧 Scheduling tryDirectJoin at 3000ms');
            setTimeout(function() {
              console.log('[Jitsi] 🔧 Executing tryDirectJoin (3000ms)');
              tryDirectJoin();
            }, 3000);
            
            // Try multiple approaches to force join
            setTimeout(function() {
              try {
                // Check if we're actually in
                var participants = api.getNumberOfParticipants();
                console.log('[Jitsi] Participant count:', participants);
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Participant count: ' + participants }));
                }
                
                if (participants >= 0) {
                  updateStatus('✅ Already in conference!');
                  
                  // Try using Jitsi API commands to dismiss prejoin
                  try {
                    // Force video/audio on to trigger join
                    if (isHostConfig) {
                      api.executeCommand('toggleVideo').then(function() {
                        console.log('[Jitsi] Video toggled');
                        api.executeCommand('toggleVideo'); // Toggle back on
                      }).catch(function(e) {
                        console.log('[Jitsi] Video toggle failed:', e);
                      });
                      
                      api.executeCommand('toggleAudio').then(function() {
                        console.log('[Jitsi] Audio toggled');
                        api.executeCommand('toggleAudio'); // Toggle back on
                      }).catch(function(e) {
                        console.log('[Jitsi] Audio toggle failed:', e);
                      });
                    }
                    
                    // Try to send subject to force UI update
                    try {
                      api.executeCommand('subject', '');
                    } catch(e) {}
                  } catch(e) {
                    console.log('[Jitsi] API command error:', e);
                  }
                  
                  // Even if we're "in", click join to dismiss UI
                  forceClickJoinButton();
                } else {
                  // Not in yet, keep trying to click join
                  forceClickJoinButton();
                }
              } catch(e) {
                console.log('[Jitsi] Error checking participants:', e);
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Error: ' + e.message }));
                }
                forceClickJoinButton();
              }
              
              // Keep trying periodically
              var retryCount = 0;
              var retryInterval = setInterval(function() {
                retryCount++;
                if (retryCount > 10) {
                  clearInterval(retryInterval);
                  if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Stopped retrying after 10 attempts' }));
                  }
                  return;
                }
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'status', message: 'Retry ' + retryCount + '/10: clicking join button...' }));
                }
                forceClickJoinButton();
              }, 500);
            }, 500);
          });
        } catch(e) {
          updateStatus('ERROR: ' + e.message);
          console.error('[Jitsi]', e);
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: 'Initialization error: ' + e.message }));
          }
        }
        } // End of initializeJitsi function
      }).catch(function(error) {
        updateStatus('ERROR: ' + error.message);
        console.error('[Jitsi]', error);
      });
    })();
    true;
  `.replace('${roomName}', roomName).replace('${JSON.stringify(userDisplayName)}', JSON.stringify(userDisplayName)).replace('${isHost}', String(isHost));

  const handleLoadEnd = () => {
    setTimeout(() => {
      setLoading(false);
    }, 3000);
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log('[WebView Message]', data.type, data.message || '');
      
      if (data.type === 'ready') {
        setLoading(false);
        onReady?.();
      } else if (data.type === 'error') {
        setLoading(false);
        onError?.(data.message || "Jitsi Meet error");
      } else if (data.type === 'loading') {
        // Keep loading state
      } else if (data.type === 'status') {
        console.log('[Jitsi Status]', data.message);
      } else if (data.type === 'test') {
        // Test message confirms JavaScript injection works
        console.log('[WebView Test] ✅ JavaScript injection confirmed:', data.message);
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
        allowUniversalAccessFromFileURLs={true}
        mixedContentMode="always"
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        injectedJavaScript={jitsiInitScript}
        // Android specific
        androidLayerType="hardware"
        // iOS specific  
        allowsProtectedMedia={true}
        // Additional media settings
        allowFileAccess={true}
        cacheEnabled={false}
        incognito={false}
        originWhitelist={['*']}
        setSupportMultipleWindows={false}
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

