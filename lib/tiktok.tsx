// lib/tiktok.tsx
// TikTok preview helper: oEmbed -> poster via WebView -> ViewShot screenshot.
// Hardened for deep-link jumps; supports zoom + focus with !important styles.

import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, ActivityIndicator, Pressable } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import ViewShot from 'react-native-view-shot';

// 1) TikTok URL check
export const isTikTokUrl = (u: string) => {
  try { return /(^|\.)tiktok\.com$/i.test(new URL(u).hostname); } catch { return false; }
};

// 2) oEmbed fast-path
export async function tiktokOEmbedThumbnail(url: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j as any)?.thumbnail_url || null;
  } catch {
    return null;
  }
}

export function TikTokSnap({
  url,
  visible,
  onCancel,
  onFound,
  delayAfterLoadMs = 1400, // grab early before redirects try anything
  zoom = 1.25,             // how much to zoom in
  focusY = 0.45,           // 0 top .. 1 bottom (where to center crop vertically)
  reloadKey,               // change this to force a fresh WebView
}: {
  url: string;
  visible: boolean;
  onCancel: () => void;
  onFound: (uriOrUrl: string) => void; // http(s) or file://
  delayAfterLoadMs?: number;
  zoom?: number;
  focusY?: number;
  reloadKey?: number | string;
}) {
  const viewShotRef = useRef<ViewShot>(null);
  const webViewRef = useRef<WebView>(null);
  const loadedOnceRef = useRef(false);
  const [gotDirect, setGotDirect] = useState(false);

  // Reset internal flags each time we (re)open or (re)mount
  useEffect(() => {
    if (visible) {
      setGotDirect(false);
      loadedOnceRef.current = false;
    }
  }, [visible, reloadKey]);

  // ----- injected JS (blocks deep-links; hides chrome; spotlight + zoom media with !important)
    const injectedJS = `
(function () {
  function pm(tag,val){try{window.ReactNativeWebView.postMessage(tag+'|'+val);}catch(e){}}
  function imp(el, prop, val){ try { el && el.style && el.style.setProperty(prop, String(val), 'important'); } catch(_){} }

  // base CSS reset
  var st = document.createElement('style');
  st.innerHTML = \`
    html,body{margin:0!important;padding:0!important;background:#000!important;overflow:hidden!important}
    main,#root,#app{margin:0!important;padding:0!important}
    *{pointer-events:none!important}       /* 👶 no touchy */
    *::before,*::after{display:none!important;content:none!important}
    video::-webkit-media-controls {display:none!important} /* 👶 hide UA play button */
    video::-webkit-media-controls-enclosure{display:none!important}
  \`;
  document.head.appendChild(st);

  // find media
  var img = (function(){
    var arr = Array.from(document.images||[]);
    arr.sort((a,b)=> (b.naturalWidth*b.naturalHeight) - (a.naturalWidth*a.naturalHeight));
    return arr.find(i=>/(tiktokcdn|p16|p19|imagecdn|object-storage)/i.test(i.src)) || arr[0];
  })();
  var vid = document.querySelector('video');
  var target = img || vid;

  if (target) {
    if (img && img.src) pm('IMG', img.src);
    if (vid && vid.getAttribute('poster')) pm('IMG', vid.getAttribute('poster'));

    // spotlight + zoom
    var z = ${zoom};
    var fy = Math.max(0, Math.min(1, ${focusY}));

    imp(target,'position','fixed');
    imp(target,'left','0');
    imp(target,'top','0');
    imp(target,'width','100vw');
    imp(target,'height','100vh');
    imp(target,'object-fit','cover');
    imp(target,'object-position','50% '+(fy*100)+'%');
    imp(target,'transform-origin','50% '+(fy*100)+'%');
    imp(target,'transform','scale('+z+')');
    imp(target,'background','#000');
    imp(target,'z-index','999999');

    if (vid){ try{ vid.pause(); vid.removeAttribute('controls'); }catch(_){} }
  }

  window.scrollTo(0,0);
  true;
})();
`;


  // message from page (direct image found)
  function onMessage(e: WebViewMessageEvent) {
    const data = e?.nativeEvent?.data || '';
    if (!data) return;
    if (data.startsWith('IMG|')) {
      const src = data.slice(4);
      if (src && !gotDirect) {
        setGotDirect(true);
        onFound(src);
      }
    }
  }

  // screenshot fallback
  const tryScreenshotAfterDelay = async () => {
    if (gotDirect) return;
    try {
      const uri = await viewShotRef.current?.capture?.({
        format: 'jpg',
        quality: 0.95,
        result: 'tmpfile',
      });
      if (uri) onFound(uri);
    } catch {
      onCancel();
    }
  };

  const allowHttpOnly = (nextUrl: string) => /^https?:\/\//i.test(nextUrl);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.5)', alignItems:'center', justifyContent:'center' }}>
        <View style={{ width: 360+24, padding:12, borderRadius:12, backgroundColor:'#0B1120' }}>
          <Text style={{ color:'#fff', fontWeight:'700', marginBottom:8 }}>Preparing preview…</Text>

          <ViewShot
            ref={viewShotRef}
            collapsable={false}
            style={{ width: 360, height: 460, borderRadius:12, overflow:'hidden', alignSelf:'center', backgroundColor:'#000' }}
          >
            <WebView
              key={String(reloadKey ?? '0')}   // force a fresh mount when key changes
              ref={webViewRef}
              source={{ uri: url }}
              injectedJavaScript={injectedJS}
              onMessage={onMessage}
              onLoadEnd={() => {
                if (loadedOnceRef.current) return;
                loadedOnceRef.current = true;
                setTimeout(tryScreenshotAfterDelay, delayAfterLoadMs);
              }}
              // block deep-links before they swap the view
              originWhitelist={['*']}
              onShouldStartLoadWithRequest={(req) => {
                const u = req?.url ?? '';
                const ok = allowHttpOnly(u);
                if (!ok) webViewRef.current?.stopLoading?.();
                return ok;
              }}
              onNavigationStateChange={(nav) => {
                if (!allowHttpOnly(nav.url)) webViewRef.current?.stopLoading?.();
              }}
              // keep first frame visible (no Android error page)
              renderError={() => <View style={{ flex:1, backgroundColor:'#000' }} />}
              onError={(e) => {
                const msg = String(e?.nativeEvent?.description || '');
                if (!/ERR_UNKNOWN_URL_SCHEME/i.test(msg)) {
                  // swallow non-scheme errors; we keep frame
                }
              }}
              setSupportMultipleWindows={false}
              javaScriptEnabled
              domStorageEnabled
              overScrollMode="never"
              androidLayerType="hardware"
              userAgent={'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36'}
              style={{ width: 360, height: 460, backgroundColor:'#000' }}
            />
          </ViewShot>

          {!gotDirect ? (
            <View style={{ marginTop:10, alignItems:'center' }}>
              <ActivityIndicator />
            </View>
          ) : null}

          <Pressable onPress={onCancel} style={{ marginTop:10, padding:10, borderRadius:8, backgroundColor:'#1F2937' }}>
            <Text style={{ color:'#fff', fontWeight:'600', textAlign:'center' }}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
