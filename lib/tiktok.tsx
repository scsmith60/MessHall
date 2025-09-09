// lib/tiktok.tsx
// 🧒 like I'm 5:
// - We open the TikTok page inside a tiny window.
// - We wait for DOM + load + 2 frames + your delay.
// - We take a picture of that window.
// - resnapKey = take another picture without reloading (fast).
// - focusY tells us where on the page to look; we scroll there and re-snap.
// - SMART bits:
//     • “Hard top” clamp: if the math goes above the very top, we use top=0.
//     • Zoom is anchored to the TOP-CENTER (not top-left), so “Top” really
//       shows the hero image and doesn’t shove content to the left.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, StyleSheet, ActivityIndicator, LayoutChangeEvent } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import ViewShot, { captureRef } from "react-native-view-shot";

/* ---------------------------- Props from parent ---------------------------- */
type TikTokSnapProps = {
  url: string;                 // TikTok URL (normal or embed)
  visible: boolean;            // show/hide modal
  reloadKey: number;           // HARD reload (first attempt)
  resnapKey?: number;          // SOFT re-snap (no reload) for retries or focus changes
  zoom?: number;               // 1.0 normal, 1.5–2.0 closer
  focusY?: number;             // 0..1 = where on the page we want to look
  focusCenter?: number;        // 0..1 = target spot inside viewport (0=top, 0.5=center)
  captureDelayMs?: number;     // wait INSIDE the page before each snap
  onCancel: () => void;
  onFound: (uri: string) => void; // tmpfile:// screenshot path
};

/* ------------------------------ Small helpers ------------------------------ */
const allowHttpHttps = (u: string) =>
  !!u && (u === "about:blank" || /^https?:\/\//i.test(u));

const sanitize = (raw: string) =>
  raw && /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(raw) ? raw : `https://${raw || "www.tiktok.com/"}`;

/* -------- Named export: TikTok oEmbed thumbnail (fallback for images) ------ */
export async function tiktokOEmbedThumbnail(rawUrl: string): Promise<string | null> {
  try {
    const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(rawUrl)}`;
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(endpoint, { signal: ac.signal, headers: { Accept: "application/json" } });
    clearTimeout(tm);
    if (!res.ok) return null;
    const data: any = await res.json();
    const thumb =
      data?.thumbnail_url ||
      data?.thumbnail_url_with_play_button ||
      data?.author?.avatar_url;
    return typeof thumb === "string" ? thumb : null;
  } catch {
    return null;
  }
}

/* -------------------------------- Component -------------------------------- */
export default function TikTokSnap({
  url,
  visible,
  reloadKey,
  resnapKey = 0,
  zoom = 1.75,
  focusY,
  focusCenter = 0.45,     // keep target a bit above center (reads nicer)
  captureDelayMs = 700,
  onCancel,
  onFound,
}: TikTokSnapProps) {
  // clamp values safely
  const fy = Math.min(1, Math.max(0, focusY ?? 0.60));
  const fc = Math.min(1, Math.max(0, focusCenter));

  // refs to things we touch
  const shotRef = useRef<View>(null);    // the box we screenshot
  const webRef  = useRef<WebView>(null); // the webview inside the box

  // measure the shot box so we can anchor zoom correctly
  const [boxW, setBoxW] = useState(360);
  const [boxH, setBoxH] = useState(640);
  const onShotLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width && height) { setBoxW(width); setBoxH(height); }
  }, []);

  // “ready?” flags for the HARD load
  const [readyDom, setReadyDom]     = useState(false);
  const [readyLoad, setReadyLoad]   = useState(false);
  const [readyRaf2, setReadyRaf2]   = useState(false);
  const [readyDelay, setReadyDelay] = useState(false);

  const [webKey, setWebKey] = useState(0);       // force WebView reload
  const [isCapturing, setIsCapturing] = useState(false);

  // has the page painted at least once? (allows soft re-snap)
  const hasPaintedRef = useRef(false);

  // per-attempt bookkeeping
  const attemptIdRef = useRef(0);             // increases on reload AND on resnap
  const sentForAttemptRef = useRef(false);    // allow one send per attempt
  const lastFyRef = useRef(fy);
  const lastFcRef = useRef(fc);

  /* ---------------------------- reset readiness ---------------------------- */
  const resetReady = useCallback(() => {
    setReadyDom(false);
    setReadyLoad(false);
    setReadyRaf2(false);
    setReadyDelay(false);
    hasPaintedRef.current = false;
    sentForAttemptRef.current = false;
  }, []);

  /* ------------------------ smart-centering scroll ------------------------- */
  // math we run INSIDE the page:
  //   t = H*focusY - V*focusCenter
  //   then clamp HARD to [0, H-V] so “Top” can be truly the top.
  const scrollToFocus = useCallback((focus: number, center: number) => {
    const js = `
      try {
        var H = Math.max(1, document.documentElement.scrollHeight);
        var V = Math.max(1, window.innerHeight);
        var f = ${Math.min(1, Math.max(0, focus))};
        var c = ${Math.min(1, Math.max(0, center))};
        var t = (H * f) - (V * c);
        if (t < 0) t = 0;              // HARD top clamp
        var max = Math.max(0, H - V);
        if (t > max) t = max;          // HARD bottom clamp
        window.scrollTo(0, t);
      } catch (e) {}
      true;
    `;
    webRef.current?.injectJavaScript(js);
    lastFyRef.current = focus;
    lastFcRef.current = center;
  }, []);

  /* -------------------------- messages from page --------------------------- */
  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data || "{}");
      if (msg?.type === "dom") setReadyDom(true);
      if (msg?.type === "load") setReadyLoad(true);
      if (msg?.type === "raf2") { setReadyRaf2(true); hasPaintedRef.current = true; }
      if (msg?.type === "waitDone") setReadyDelay(true);
    } catch { /* ignore */ }
  }, []);

  /* ----------------------- injected script (once per load) ------------------ */
  const injectedJavaScript = useMemo(() => {
    const safeDelay = Math.max(0, Math.floor(captureDelayMs));
    return `
      (function () {
        function post(type, payload){ try{ window.ReactNativeWebView.postMessage(JSON.stringify({type, payload})); }catch(e){} }
        function twoFramesThenDelay(){
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              post('raf2');
              try{ var v=document.querySelector('video'); if(v && !v.paused) v.pause(); }catch(e){}
              setTimeout(function(){ post('waitDone'); }, ${safeDelay});
            });
          });
        }
        if (document.readyState === 'interactive' || document.readyState === 'complete') { post('dom'); }
        else { document.addEventListener('DOMContentLoaded', function(){ post('dom'); }, {once:true}); }
        if (document.readyState === 'complete') { post('load'); twoFramesThenDelay(); }
        else { window.addEventListener('load', function(){ post('load'); twoFramesThenDelay(); }, {once:true}); }

        // initial scroll (with hard clamps)
        try {
          var H = Math.max(1, document.documentElement.scrollHeight);
          var V = Math.max(1, window.innerHeight);
          var f = ${fy};
          var c = ${fc};
          var t = (H * f) - (V * c);
          if (t < 0) t = 0;
          var max = Math.max(0, H - V);
          if (t > max) t = max;
          window.scrollTo(0, t);
        } catch(e){}
      })();
      true;
    `;
  }, [captureDelayMs, fy, fc]);

  /* ----------------------- first attempt: HARD reload ----------------------- */
  useEffect(() => {
    if (!visible) return;
    attemptIdRef.current += 1;          // new attempt
    sentForAttemptRef.current = false;  // one send allowed
    setWebKey((k) => k + 1);            // force reload
    resetReady();
  }, [visible, reloadKey, resetReady]);

  /* -------- safety snap: if page is slow, still give *something* back -------- */
  useEffect(() => {
    if (!visible) return;
    const thisAttempt = attemptIdRef.current;
    const safety = setTimeout(async () => {
      if (attemptIdRef.current !== thisAttempt) return;
      if (isCapturing || sentForAttemptRef.current) return;
      try {
        setIsCapturing(true);
        const uri = await captureRef(shotRef, { format: "jpg", quality: 0.92, result: "tmpfile" });
        if (!sentForAttemptRef.current) { sentForAttemptRef.current = true; onFound(uri); }
      } catch {} finally { setIsCapturing(false); }
    }, 6500);
    return () => clearTimeout(safety);
  }, [visible, webKey, isCapturing, onFound]);

  /* ---------- when ready (dom+load+2 frames+delay) → take the picture -------- */
  useEffect(() => {
    if (!visible) return;
    if (!(readyDom && readyLoad && readyRaf2 && readyDelay)) return;
    if (isCapturing || sentForAttemptRef.current) return;

    const thisAttempt = attemptIdRef.current;
    setIsCapturing(true);
    const t = setTimeout(async () => {
      if (attemptIdRef.current !== thisAttempt) { setIsCapturing(false); return; }
      try {
        const uri = await captureRef(shotRef, { format: "jpg", quality: 0.92, result: "tmpfile" });
        if (!sentForAttemptRef.current) { sentForAttemptRef.current = true; onFound(uri); }
      } catch {} finally { setIsCapturing(false); }
    }, 0); // tiny yield
    return () => clearTimeout(t);
  }, [visible, readyDom, readyLoad, readyRaf2, readyDelay, isCapturing, onFound]);

  /* ----------------- SOFT re-snap (retry without reloading) ----------------- */
  useEffect(() => {
    if (!visible) return;
    if (!hasPaintedRef.current) return;   // need at least one paint

    attemptIdRef.current += 1;
    sentForAttemptRef.current = false;

    // scroll to the focus BEFORE snapping (with hard clamps)
    scrollToFocus(fy, fc);

    const thisAttempt = attemptIdRef.current;
    setIsCapturing(true);
    const t = setTimeout(async () => {
      if (attemptIdRef.current !== thisAttempt) { setIsCapturing(false); return; }
      try {
        const uri = await captureRef(shotRef, { format: "jpg", quality: 0.92, result: "tmpfile" });
        if (!sentForAttemptRef.current) { sentForAttemptRef.current = true; onFound(uri); }
      } catch {} finally { setIsCapturing(false); }
    }, Math.max(0, Math.floor(captureDelayMs)));
    return () => clearTimeout(t);
  }, [resnapKey, visible, captureDelayMs, fy, fc, scrollToFocus, onFound]);

  /* -------- react to focus changes while modal is open (auto re-snap) -------- */
  useEffect(() => {
    if (!visible) return;
    if (!hasPaintedRef.current) return;
    if (Math.abs(fy - lastFyRef.current) < 0.0001 && Math.abs(fc - lastFcRef.current) < 0.0001) return;

    // scroll immediately
    scrollToFocus(fy, fc);

    // auto re-snap after moving
    attemptIdRef.current += 1;
    sentForAttemptRef.current = false;

    const thisAttempt = attemptIdRef.current;
    setIsCapturing(true);
    const t = setTimeout(async () => {
      if (attemptIdRef.current !== thisAttempt) { setIsCapturing(false); return; }
      try {
        const uri = await captureRef(shotRef, { format: "jpg", quality: 0.92, result: "tmpfile" });
        if (!sentForAttemptRef.current) { sentForAttemptRef.current = true; onFound(uri); }
      } catch {} finally { setIsCapturing(false); }
    }, Math.max(0, Math.floor(captureDelayMs)));
    return () => clearTimeout(t);
  }, [fy, fc, visible, captureDelayMs, scrollToFocus, onFound]);

  const shouldStart = useCallback((req: any) => allowHttpHttps(String(req?.url || "")), []);
  const startUrl = useMemo(() => sanitize(url), [url]);

  /* ------------------------------- The UI ----------------------------------- */
  // 👉 TOP-CENTER zoom: scale around the center, then push DOWN so the TOP edge
  // stays put. No horizontal shift, so content remains centered.
  const shiftY = (zoom - 1) * boxH / 2;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        {/* 👇 this box is what we screenshot */}
        <ViewShot
          ref={shotRef}
          style={styles.shotArea}
          options={{ format: "jpg", quality: 0.92 }}
          onLayout={onShotLayout}
        >
          {/* zoom anchored to TOP-CENTER */}
          <View
            style={[
              styles.scaleWrap,
              {
                transform: [
                  { scale: zoom },
                  { translateY: shiftY }, // keep the TOP edge visually fixed
                ],
              },
            ]}
          >
            <WebView
              ref={webRef}
              key={webKey}
              source={{ uri: startUrl }}
              style={styles.webView}
              onMessage={onMessage}
              injectedJavaScript={injectedJavaScript}
              javaScriptEnabled
              domStorageEnabled
              cacheEnabled
              userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36"
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              mixedContentMode="always"
              onShouldStartLoadWithRequest={shouldStart}
              renderError={() => <View style={styles.center}><ActivityIndicator /></View>}
              androidLayerType="software"
              setSupportMultipleWindows={false}
              originWhitelist={["*"]}
              useWebKit
              startInLoadingState
            />
          </View>
        </ViewShot>

        <View style={styles.hud}><ActivityIndicator /></View>
      </View>
    </Modal>
  );
}

/* ---------------------------------- Styles --------------------------------- */
const styles = StyleSheet.create({
  backdrop: { flex:1, backgroundColor:"rgba(0,0,0,0.65)", alignItems:"center", justifyContent:"center", padding:12 },
  shotArea: { width:360, height:640, borderRadius:12, overflow:"hidden", backgroundColor:"#000" },
  scaleWrap: { flex:1 },
  webView: { flex:1, backgroundColor:"#000" },
  hud: { position:"absolute", bottom:24, alignSelf:"center" },
  center: { flex:1, alignItems:"center", justifyContent:"center", backgroundColor:"#000" },
});
