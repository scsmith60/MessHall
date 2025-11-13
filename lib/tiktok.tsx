// lib/tiktok.tsx
// ðŸ§’ like I'm 5:
// - We open the TikTok page inside a tiny window.
// - We wait for DOM + load + 2 frames + your delay.
// - We take a picture of that window.
// - resnapKey = take another picture without reloading (fast).
// - focusY tells us where on the page to look; we scroll there and re-snap.
// - SMART bits:
//     â€¢ â€œHard topâ€ clamp: if the math goes above the very top, we use top=0.
//     â€¢ Zoom is anchored to the TOP-CENTER (not top-left), so â€œTopâ€ really
//       shows the hero image and doesnâ€™t shove content to the left.

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
  zoom?: number;               // 1.0 normal, 1.5â€“2.0 closer
  focusY?: number;             // 0..1 = where on the page we want to look
  focusCenter?: number;        // 0..1 = target spot inside viewport (0=top, 0.5=center)
  captureDelayMs?: number;     // wait INSIDE the page before each snap
  fullSnapshot?: boolean;      // if true, take full snapshot without zoom/focus adjustments
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
  fullSnapshot = false,   // if true, skip zoom/focus and take full page snapshot
  onCancel,
  onFound,
}: TikTokSnapProps) {
  // clamp values safely (but ignore if fullSnapshot mode)
  const fy = fullSnapshot ? 0 : Math.min(1, Math.max(0, focusY ?? 0.60));
  const fc = fullSnapshot ? 0 : Math.min(1, Math.max(0, focusCenter));
  const effectiveZoom = fullSnapshot ? 1.0 : zoom;

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

  // â€œready?â€ flags for the HARD load
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
  //   then clamp HARD to [0, H-V] so "Top" can be truly the top.
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
    const hideTimeout = fullSnapshot ? 8000 : 5000;
    return `
      (function () {
        function post(type, payload){ try{ window.ReactNativeWebView.postMessage(JSON.stringify({type, payload})); }catch(e){} }
        
        function classStr(el){
          if (!el) return '';
          var cn = typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '';
          return String(cn || '').toLowerCase();
        }

        function attrLower(el, name){
          return el && el.getAttribute ? String(el.getAttribute(name) || '').toLowerCase() : '';
        }

        function innerTextLower(el){
          return (el && (el.innerText || el.textContent) || '').trim().toLowerCase();
        }

        function isHugeContainer(el){
          try {
            var rect = el.getBoundingClientRect();
            return rect && rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9;
          } catch(e) { return false; }
        }

        function isAggressiveOverlay(el){
          if (!el) return false;
          var classes = classStr(el);
          var dataE2e = attrLower(el, 'data-e2e');
          var dataName = attrLower(el, 'data-name');
          var text = innerTextLower(el);
          if (/tux|popupopen|launch-popup|launchpopup|matrix-smart|matrixsmart|bottom-button|footerc|divbottombutton|divbuttonsection|divfootertxt|watchnowbtn|watch_btn|watchcta|open-btn|divplaybtnpos|playbtnpos|play-btn|playbtn/.test(classes)) return true;
          if (dataE2e && /launch|popup|watch|open/.test(dataE2e)) return true;
          if (dataName && /launch|popup|watch|open/.test(dataName)) return true;
          if (/watch now|watch on|watch this video|open app|use the app|enjoy more content|global video community/.test(text)) return true;
          return false;
        }

        function hidePlayElement(el) {
          if (!el) return;
          if (el === document.body || el === document.documentElement) return;
          var tag = (el.tagName || '').toLowerCase();
          var overlay = isAggressiveOverlay(el);
          if (overlay) {
            try { el.remove(); return; } catch(e) {}
          } else {
            if (tag === 'img' || tag === 'video' || tag === 'picture' || tag === 'canvas') return;
            try {
              if (!el.matches || !el.matches('svg, path, polygon')) {
                if (el.querySelector && el.querySelector('video, picture, canvas')) return;
                if (el.querySelector && el.querySelector('img')) {
                  if (!/watch|tux|popup|launch|bottom|matrix|play/.test(classStr(el))) return;
                }
              }
            } catch(e) {}
          }
          try {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('opacity', '0', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
            el.style.setProperty('width', '0', 'important');
            el.style.setProperty('height', '0', 'important');
            el.style.setProperty('position', 'absolute', 'important');
            el.style.setProperty('left', '-9999px', 'important');
          } catch(e) {}
        }

        function looksLikeTikTokPlayPath(path) {
          if (!path) return false;
          var data = (path.getAttribute('d') || '').trim();
          if (!data) return false;
          var normalized = data.replace(/\s+/g, ' ').toUpperCase();
          if (!/M/.test(normalized) || !/L/.test(normalized) || !/Z/.test(normalized)) return false;
          if (/[CQASTHV]/.test(normalized)) return false;
          var lineCount = (normalized.match(/L/g) || []).length;
          if (lineCount < 2 || lineCount > 3) return false;
          try {
            var box = path.getBBox();
            var ratio = box.width / Math.max(1, box.height);
            if (ratio < 0.35 || ratio > 0.95) return false;
            if (box.width < 18 || box.height < 18) return false;
          } catch(e) {}
          return true;
        }

        function looksLikeTikTokPlayPolygon(poly) {
          if (!poly) return false;
          var points = (poly.getAttribute('points') || '').trim();
          if (!points) return false;
          var coords = points.split(/[ ,]+/).filter(Boolean);
          if (coords.length < 6 || coords.length > 8) return false;
          try {
            var box = poly.getBBox();
            var ratio = box.width / Math.max(1, box.height);
            if (ratio < 0.3 || ratio > 1.05) return false;
            if (box.width < 18 || box.height < 18) return false;
          } catch(e) {}
          return true;
        }

        function elementContainsTriangle(el) {
          if (!el) return false;
          var targets = [];
          if (el.matches && el.matches('path,polygon')) targets.push(el);
          if (el.querySelectorAll) {
            var found = el.querySelectorAll('path, polygon');
            for (var i = 0; i < found.length; i++) targets.push(found[i]);
          }
          for (var j = 0; j < targets.length; j++) {
            var node = targets[j];
            var tag = (node.tagName || '').toLowerCase();
            if (tag === 'path' && looksLikeTikTokPlayPath(node)) return true;
            if (tag === 'polygon' && looksLikeTikTokPlayPolygon(node)) return true;
          }
          return false;
        }

        function hideTriangleSvgs(root) {
          try {
            var scope = root && root.querySelectorAll ? root : document;
            var svgPaths = scope.querySelectorAll('svg path, svg polygon');
            for (var j = 0; j < svgPaths.length; j++) {
              var path = svgPaths[j];
              var tag = (path.tagName || '').toLowerCase();
              var isTriangle = tag === 'path' ? looksLikeTikTokPlayPath(path) : looksLikeTikTokPlayPolygon(path);
              if (!isTriangle) continue;
              var svg = path.closest('svg') || path;
              hidePlayElement(svg);
              if (svg && svg.parentElement) {
                var parent = svg.parentElement;
                if (!parent.querySelector('video, picture, canvas')) {
                  var parentClasses = (parent.className || '').toLowerCase();
                  if (parentClasses.includes('play')) {
                    hidePlayElement(parent);
                  }
                }
              }
            }
          } catch(e) {}
        }

        function hideCenteredTriangle() {
          try {
            var centerEls = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            for (var i = 0; i < centerEls.length; i++) {
              var el = centerEls[i];
              if (!el || el === document.body || el === document.documentElement) continue;
              if (el.tagName && el.tagName.toLowerCase() === 'video') continue;
              var classes = (el.className || '').toLowerCase();
              var aria = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
              if (classes.includes('play') || aria.includes('play')) {
                if (!el.querySelector || !el.querySelector('video, picture, canvas')) {
                  hidePlayElement(el);
                }
                continue;
              }
              var svg = el.tagName && el.tagName.toLowerCase() === 'svg' ? el : (el.querySelector ? el.querySelector('svg') : null);
              if (svg && elementContainsTriangle(svg)) {
                hidePlayElement(svg);
                hidePlayElement(el);
              }
            }
          } catch(e) {}
        }

        function hideByCenterBounds() {
          try {
            var cx = window.innerWidth / 2;
            var cy = window.innerHeight / 2;
            var stack = document.elementsFromPoint(cx, cy) || [];
            for (var i = 0; i < stack.length; i++) {
              var el = stack[i];
              if (!el || el === document.body || el === document.documentElement) continue;
              if (el.tagName && el.tagName.toLowerCase() === 'video') continue;
              var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
              if (!rect) continue;
              var width = rect.width || 0;
              var height = rect.height || 0;
              if (width < 18 || height < 18) continue;
              if (width > window.innerWidth * 0.6 || height > window.innerHeight * 0.6) continue;
              var ratio = width / Math.max(1, height);
              if (ratio < 0.3 || ratio > 3) continue;
              var area = width * height;
              if (area > 120000) continue;
              hidePlayElement(el);
              if (el.parentElement && !el.parentElement.querySelector('video, picture, canvas')) {
                hidePlayElement(el.parentElement);
              }
            }
          } catch(e) {}
        }

        function looksLikePlayButton(el) {
          if (!el) return false;
          var overlay = isAggressiveOverlay(el);
          var text = innerTextLower(el);
          var aria = attrLower(el, 'aria-label');
          var title = attrLower(el, 'title');
          var dataE2e = attrLower(el, 'data-e2e');
          var dataLoc = attrLower(el, 'data-e2e-loc');
          var classes = classStr(el);
          var combined = text + ' ' + aria + ' ' + title + ' ' + dataE2e + ' ' + dataLoc + ' ' + classes;
          if (overlay) return true;
          if (/watch now|watch more|watch on|watch this|tap to watch|tap to play|open app|open in app|get the app|launch app|use the app|play video|resume|replay/.test(combined)) {
            if (isHugeContainer(el)) return false;
            return true;
          }
          if (/enjoy more content in the app|global video community/.test(combined)) {
            if (isHugeContainer(el)) return false;
            return true;
          }
          if (dataE2e.includes('watch') || dataE2e.includes('launch') || dataE2e.includes('popup') || dataE2e.includes('open')) {
            if (isHugeContainer(el)) return false;
            return true;
          }
          if (elementContainsTriangle(el)) return true;
          if (el.tagName && el.tagName.toLowerCase() === 'button' && el.querySelector && el.querySelector('svg')) return true;
          return false;
        }

        function hidePlayCandidatesInRoot(root) {
          if (!root || !root.querySelectorAll) return;
          var selectors = [
            '[data-e2e="browse-play-button"]',
            '[data-e2e="video-play-button"]',
            '[data-e2e="player-play-button"]',
            '[data-e2e="video-player-mask"]',
            '[data-e2e*="play"]',
            '.play-button',
            '.video-play-button',
            '[class*="playIcon"]',
            '[class*="PlayIcon"]',
            'button[aria-label*="Play" i]',
            'button[aria-label*="play" i]',
            '[class*="PlayButton"]',
            '[class*="play-button"]',
            '[class*="Play"]',
            '[class*="play"]',
            '[class*="xgplayer"] button',
            '[class*="xgplayer"] [class*="play"]',
            '[role="button"][aria-label*="play" i]',
            '[role="button"][aria-label*="Play" i]',
            'button svg',
            '[class*="VideoPlayer"] button',
            '[class*="video-player"] button',
            '[class*="VideoContainer"] button',
            '[class*="video-container"] button',
            '.matrix-smart-wrapper',
            '[class*="BottomButton"]',
            '[class*="bottom-button"]',
            '[class*="DivBottomButtonSection"]',
            '[class*="DivButtonTxt"]',
            '[class*="DivFooterCTA"]',
            '[class*="FooterCTA"]',
            '[class*="footer-cta"]',
            '[class*="DivPlayBtnPos"]',
            '[class*="PlayBtnPos"]',
            '[class*="popup-open"]',
            '[class*="PopupOpen"]',
            '[class*="PopupOpenButton"]',
            '[class*="popupopenbutton"]',
            '[class*="tux-base-dialog"]',
            '[class*="tux-dialog"]',
            '[data-e2e*="launch"]',
            '[data-e2e*="popup"]',
            '[data-e2e*="open"]',
            '[class*="LaunchPopup"]',
            '[class*="launch-popup"]'
          ];
          selectors.forEach(function(sel) {
            try {
              var els = root.querySelectorAll(sel);
              for (var i = 0; i < els.length; i++) {
                var el = els[i];
                hidePlayElement(el);
                if (el.parentElement) {
                  var parent = el.parentElement;
                    if (parent.querySelector && parent.querySelector('video, picture, canvas')) continue;
                  var parentClasses = (parent.className || '').toLowerCase();
                  if (parentClasses.includes('play') || parentClasses.includes('button')) {
                    hidePlayElement(parent);
                  }
                }
              }
            } catch(e) {}
          });
          try {
            var candidates = root.querySelectorAll('button, [role="button"], svg, div[aria-label], span[aria-label]');
            for (var j = 0; j < candidates.length; j++) {
              var candidate = candidates[j];
              if (looksLikePlayButton(candidate)) hidePlayElement(candidate);
            }
          } catch(e) {}
          try {
            var textNodes = root.querySelectorAll('div, span, button, a, section, header, footer');
            var maxScan = 5000;
            for (var k = 0; k < textNodes.length && k < maxScan; k++) {
              var node = textNodes[k];
              if (looksLikePlayButton(node)) {
                hidePlayElement(node);
                try {
                  if (node.parentElement && !node.parentElement.querySelector('video, picture, canvas')) {
                    hidePlayElement(node.parentElement);
                  }
                } catch(e) {}
              }
            }
          } catch(e) {}
          hideTriangleSvgs(root);
        }

        function hideShadowPlayButtons() {
          try {
            var nodes = document.querySelectorAll('*');
            for (var i = 0; i < nodes.length; i++) {
              var node = nodes[i];
              if (node && node.shadowRoot) {
                hidePlayCandidatesInRoot(node.shadowRoot);
              }
            }
          } catch(e) {}
        }

        var lastFlashTs = 0;
        function flashVideoPlayback(forceNow) {
          try {
            var now = Date.now();
            if (!forceNow && now - lastFlashTs < 1200) return;
            var video = document.querySelector('video');
            if (!video) return;
            lastFlashTs = now;
            video.muted = true;
            var request = video.play();
            var pauseLater = function() {
              setTimeout(function(){
                try { video.pause(); } catch(e) {}
              }, 350);
            };
            if (request && request.then) {
              request.then(pauseLater).catch(function(){});
            } else {
              pauseLater();
            }
          } catch(e) {}
        }

        // Hide play buttons immediately when DOM is ready
        function hidePlayButtons(opts) {
          try {
            var styleId = 'hide-play-buttons-style';
            if (!document.getElementById(styleId)) {
              var style = document.createElement('style');
              style.id = styleId;
              style.textContent = '[data-e2e="browse-play-button"], [data-e2e="video-play-button"], [data-e2e="player-play-button"], [data-e2e="video-player-mask"], [data-e2e*="play"], .play-button, .video-play-button, button[aria-label*="Play" i], button[aria-label*="play" i], [class*="PlayButton"], [class*="play-button"], [class*="PlayIcon"], [class*="play-icon"], [class*="Play"], [class*="play"], [class*="xgplayer"] button, [class*="xgplayer"] [class*="play"], svg[class*="play"], [class*="VideoPlayer"] button, [class*="video-player"] button, [class*="VideoContainer"] button, [class*="video-container"] button, [class*="BottomButton"], [class*="bottom-button"], [class*="DivBottomButtonSection"], [class*="DivButtonTxt"], [class*="DivFooterCTA"], [class*="DivPlayBtnPos"], [class*="PlayBtnPos"], [class*="PopupOpen"], [class*="popup-open"], [class*="LaunchPopup"], [class*="launch-popup"], svg[width="24"][height="24"], svg[width="48"][height="48"] { display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; width: 0 !important; height: 0 !important; position: absolute !important; left: -9999px !important; }';
              if (document.head) document.head.appendChild(style);
              else document.documentElement.appendChild(style);
            }
            hidePlayCandidatesInRoot(document);
            hideShadowPlayButtons();
            hideCenteredTriangle();
            hideByCenterBounds();
            if (opts && opts.flashVideo) flashVideoPlayback(true);
          } catch(e) {}
        }
        window.__messhallHideTikTokPlay = hidePlayButtons;
        
        function twoFramesThenDelay(){
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              post('raf2');
              try{ var v=document.querySelector('video'); if(v && !v.paused) v.pause(); }catch(e){}
              // Aggressively hide play buttons before screenshot
              hidePlayButtons({ flashVideo: true });
              // Final aggressive pass right before delay
              hidePlayButtons();
              setTimeout(function(){ 
                // One more pass just before we signal ready
                hidePlayButtons();
                post('waitDone'); 
              }, ${safeDelay});
            });
          });
        }
        if (document.readyState === 'interactive' || document.readyState === 'complete') { 
          post('dom'); 
          hidePlayButtons();
        }
        else { 
          document.addEventListener('DOMContentLoaded', function(){ 
            post('dom'); 
            hidePlayButtons();
          }, {once:true}); 
        }
        if (document.readyState === 'complete') { post('load'); twoFramesThenDelay(); }
        else { window.addEventListener('load', function(){ post('load'); twoFramesThenDelay(); }, {once:true}); }
        
        // Hide play buttons periodically in case they re-appear (but stop after 8 seconds for full snapshot)
        var hideInterval = setInterval(hidePlayButtons, 150);
        var hideTimeout = ${hideTimeout};
        setTimeout(function() { clearInterval(hideInterval); }, hideTimeout);
        
        // Use MutationObserver to catch play buttons that appear dynamically
        var observer = new MutationObserver(function(mutations) {
          hidePlayButtons();
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'data-e2e']
        });
        setTimeout(function() { observer.disconnect(); }, hideTimeout);

        // initial scroll (with hard clamps) - skip if fullSnapshot
        ${fullSnapshot ? '' : 'try { var H = Math.max(1, document.documentElement.scrollHeight); var V = Math.max(1, window.innerHeight); var f = ' + fy + '; var c = ' + fc + '; var t = (H * f) - (V * c); if (t < 0) t = 0; var max = Math.max(0, H - V); if (t > max) t = max; window.scrollTo(0, t); } catch(e){}'}
      })();
      true;
    `;
  }, [captureDelayMs, fy, fc, fullSnapshot]);

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

  /* ---------- when ready (dom+load+2 frames+delay) â†’ take the picture -------- */
  useEffect(() => {
    if (!visible) return;
    if (!(readyDom && readyLoad && readyRaf2 && readyDelay)) return;
    if (isCapturing || sentForAttemptRef.current) return;

    const thisAttempt = attemptIdRef.current;
    setIsCapturing(true);
    // Hide play button right before capture - use shared helper
    try {
      if (webRef.current) {
        webRef.current.injectJavaScript(`
          (function() {
            try {
              if (window.__messhallHideTikTokPlay) {
                window.__messhallHideTikTokPlay({ flashVideo: true });
              }
            } catch(e) {}
          })();
          true;
        `);
      }
    } catch(e) {}
    // Final aggressive pass right before capture
    const finalHideDelay = fullSnapshot ? 250 : 100;
    const finalHide = setTimeout(() => {
      if (webRef.current) {
        webRef.current.injectJavaScript(`
          (function() {
            try {
              if (window.__messhallHideTikTokPlay) {
                window.__messhallHideTikTokPlay({ flashVideo: true });
              }
            } catch(e) {}
          })();
          true;
        `);
      }
    }, finalHideDelay);
    
    const t = setTimeout(async () => {
      clearTimeout(finalHide);
      if (attemptIdRef.current !== thisAttempt) { setIsCapturing(false); return; }
      try {
        // For full snapshots, ensure we're at the top of the page and images are visible
        if (fullSnapshot && webRef.current) {
          webRef.current.injectJavaScript(`
            (function() {
              window.scrollTo(0, 0);
              // Ensure images are visible
              var images = document.querySelectorAll('img');
              for (var i = 0; i < images.length; i++) {
                var img = images[i];
                if (img.style.display === 'none') img.style.display = '';
                if (img.style.visibility === 'hidden') img.style.visibility = 'visible';
                if (img.style.opacity === '0') img.style.opacity = '1';
              }
              return true;
            })();
          `);
          // Small delay to let scroll and image visibility changes take effect
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        const uri = await captureRef(shotRef, { format: "jpg", quality: 0.92, result: "tmpfile" });
        if (!sentForAttemptRef.current) { sentForAttemptRef.current = true; onFound(uri); }
      } catch {} finally { setIsCapturing(false); }
    }, fullSnapshot ? 600 : 150); // Reduced delay - capture before page changes too much
    return () => {
      clearTimeout(t);
      clearTimeout(finalHide);
    };
  }, [visible, readyDom, readyLoad, readyRaf2, readyDelay, isCapturing, onFound, fullSnapshot]);

  /* ----------------- SOFT re-snap (retry without reloading) ----------------- */
  useEffect(() => {
    if (!visible) return;
    if (!hasPaintedRef.current) return;   // need at least one paint

    attemptIdRef.current += 1;
    sentForAttemptRef.current = false;

    // scroll to the focus BEFORE snapping (with hard clamps) - skip if fullSnapshot
    if (!fullSnapshot) {
      scrollToFocus(fy, fc);
    }

    const thisAttempt = attemptIdRef.current;
    setIsCapturing(true);
    // Hide play button right before capture - use shared helper
    try {
      if (webRef.current) {
        webRef.current.injectJavaScript(`
          (function() {
            try {
              if (window.__messhallHideTikTokPlay) {
                window.__messhallHideTikTokPlay({ flashVideo: true });
              }
            } catch(e) {}
          })();
          true;
        `);
      }
    } catch(e) {}
    const t = setTimeout(async () => {
      if (attemptIdRef.current !== thisAttempt) { setIsCapturing(false); return; }
      try {
        const uri = await captureRef(shotRef, { format: "jpg", quality: 0.92, result: "tmpfile" });
        if (!sentForAttemptRef.current) { sentForAttemptRef.current = true; onFound(uri); }
      } catch {} finally { setIsCapturing(false); }
    }, Math.max(fullSnapshot ? 300 : 150, Math.floor(captureDelayMs))); // Longer delay for full snapshot
    return () => clearTimeout(t);
  }, [resnapKey, visible, captureDelayMs, fy, fc, scrollToFocus, onFound, fullSnapshot]);

  /* -------- react to focus changes while modal is open (auto re-snap) -------- */
  useEffect(() => {
    if (!visible) return;
    if (fullSnapshot) return; // skip focus adjustments in full snapshot mode
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
  }, [fy, fc, visible, captureDelayMs, scrollToFocus, onFound, fullSnapshot]);

  const shouldStart = useCallback((req: any) => allowHttpHttps(String(req?.url || "")), []);
  const startUrl = useMemo(() => sanitize(url), [url]);

  /* ------------------------------- The UI ----------------------------------- */
  // ðŸ‘‰ TOP-CENTER zoom: scale around the center, then push DOWN so the TOP edge
  // stays put. No horizontal shift, so content remains centered.
  const shiftY = (effectiveZoom - 1) * boxH / 2;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        {/* ðŸ‘‡ this box is what we screenshot */}
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
                  { scale: effectiveZoom },
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
              injectedJavaScriptBeforeContentLoaded={`
                // Inject CSS early to hide play buttons
                (function() {
                  var style = document.createElement('style');
                  style.textContent = '[data-e2e="browse-play-button"], [data-e2e="video-play-button"], .play-button, .video-play-button, button[aria-label*="Play" i], button[aria-label*="play" i], [class*="PlayButton"], [class*="play-button"], [class*="PlayIcon"], [class*="play-icon"], [class*="DivPlayBtnPos"], [class*="PlayBtnPos"], [class*="BottomButton"], [class*="bottom-button"], [class*="DivBottomButtonSection"], [class*="DivButtonTxt"], [class*="DivFooterCTA"], [class*="PopupOpen"], [class*="popup-open"], [class*="LaunchPopup"], [class*="launch-popup"], svg[class*="play"] { display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }';
                  if (document.head) document.head.appendChild(style);
                  else if (document.documentElement) document.documentElement.appendChild(style);
                })();
              `}
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
