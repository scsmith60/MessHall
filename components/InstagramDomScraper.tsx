// components/InstagramDomScraper.tsx
//
// 🧒 ELI5: We open the Instagram page in a tiny browser.
// We stop any "jump to app" links, scroll a little, click a FEW "more" buttons,
// read the caption, make a tiny clean title like "Shrimp Scampi", try to grab the image,
// and send it back safely (not too big).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import WebView, { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import { logDebug } from "../lib/logger";
import { captureRef } from "react-native-view-shot";

type ResultPayload = {
  ok: boolean;
  caption: string;
  comments: string[];
  bestComment: string;
  text: string;
  imageUrl?: string;
  cleanTitle?: string;
  debug: string;
};

export default function InstagramDomScraper({
  visible,
  url,
  onClose,
  onResult,
}: {
  visible: boolean;
  url: string;
  onClose: () => void;
  onResult: (r: ResultPayload) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [runKey, setRunKey] = useState(0);
  const webRef = useRef<WebView>(null);
  const shotRef = useRef<View>(null);
  const [pageReady, setPageReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const startUrl = useMemo(() => url, [url]);

  const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";

  const isDeepLink = (u?: string) => !!u && /^(instagram:|intent:|market:|itms-apps:|itms-appss:)/i.test(u || "");
  const isForeignHost = (u?: string) => {
    try {
      if (!u) return true;
      const { hostname, protocol, pathname } = new URL(u);
      if (protocol !== "https:") return true;
      if (hostname !== "www.instagram.com") return true;
      const want = new URL(startUrl).pathname;
      if (pathname !== want) return true;
      return false;
    } catch { return true; }
  };

  const onShouldStart = (nav: WebViewNavigation) => {
    const u = nav.url;
    // Block deep links silently (no warning needed - this is expected behavior)
    if (isDeepLink(u)) {
      // Don't allow navigation to deep link, but don't log a warning
      // The WebView will show its own warning, but we'll detect this in the scraper and fail fast
      return false;
    }
    if (isForeignHost(u)) return false;
    return true;
  };

  const injectedBefore = useMemo(() => `
    (function(){
      try {
        const NOOP = function(){};
        window.open = NOOP;
        const blocked = /^(instagram:|intent:|market:|itms-apps:|itms-appss:)/i;
        document.addEventListener('click', function(e){
          const a = e.target && (e.target.closest ? e.target.closest('a') : null);
          if (a && a.href && blocked.test(a.href)) { e.preventDefault(); e.stopPropagation(); return false; }
        }, true);
        const assign = window.location.assign.bind(window.location);
        window.location.assign = function(u){ if (blocked.test(String(u||''))) return; return assign(u); };
        const replace = window.location.replace.bind(window.location);
        window.location.replace = function(u){ if (blocked.test(String(u||''))) return; return replace(u); };

        const startPath = location.pathname;
        const _ps = history.pushState.bind(history);
        const _rs = history.replaceState.bind(history);
        function safeChange(fn, state, title, url){
          try {
            if (url != null) {
              const a = document.createElement('a'); a.href = url;
              if (a.pathname !== startPath) return;
            }
          } catch(_) {}
          return fn(state, title, url);
        }
        history.pushState = function(state, title, url){ return safeChange(_ps, state, title, url); };
        history.replaceState = function(state, title, url){ return safeChange(_rs, state, title, url); };
      } catch(_) {}
    })();`, []);

  const injected = useMemo(() => `
    (function(){
      const send = (type, data) => { try { window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...data })); } catch(_){} };
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const qsa = (s) => Array.from(document.querySelectorAll(s));

      let finished = false;
      function finish(payload){ if (finished) return; finished = true; send("done", payload); }

      setTimeout(() => { if (!finished) finish({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"timeout" }); }, 8000);

      async function smoothScroll(){ for (const y of [200, 0]) { window.scrollTo({ top: y, behavior: 'instant' }); await sleep(30); } }

      function getPostRoot(){ return document.querySelector('article') || document.querySelector('main') || document.body; }

      async function clickExpanders(){
        const root = getPostRoot(); if (!root) return 0;
        let total = 0; const seen = new Set();
        function visible(el){ const r = el.getBoundingClientRect(); return r.width>0 && r.height>0; }
        for (let round=0; round<1; round++){
          let clicks=0;
          for (const el of qsa('button,[role="button"],span,div').filter(el => root.contains(el))){
            const t=(el.innerText||el.textContent||"").trim().toLowerCase();
            if (!(t==="more"||t==="see more")) continue;
            if (!visible(el)) continue;
            if (seen.has(el)) continue;
            try{ el.click(); seen.add(el); clicks++; total++; }catch{}
            if (total>=2) break;
          }
          send("log", { msg:"expanders:clicked", extra:{ clicks, round: round+1 }});
          if (clicks===0||total>=2) break;
          await sleep(30);
        }
        return total;
      }

      function readFromMeta(){
          const pick=(n)=>{ const el=document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]'); return el ? (el.getAttribute(\"content\") || \"\") : \"\"; };
        return pick("og:description") || pick("twitter:description") || pick("description") || "";
      }
      function readFromJsonLd(){
        try{
          for (const s of qsa('script[type="application/ld+json"]')){
            try{
              const j = JSON.parse(s.textContent||"{}");
              const arr = Array.isArray(j)? j : (j['@graph']? j['@graph'] : [j]);
              for (const it of arr){
                const c = it && (it.description || it.caption);
                if (c && typeof c === "string" && c.length>10) return String(c);
              }
            }catch{}
          }
        }catch{}
        return "";
      }
      function readFromDOM(){
        const root = getPostRoot();
        const sels = ['h1[dir="auto"]','span[dir="auto"]','div[role="dialog"] span[dir="auto"]','article h1','article span','span._ap3a','div.C4VMK span'];
        let best="";
        for (const s of sels){
          for (const el of qsa(s).filter(el => root.contains(el))){
            const t=(el.innerText||el.textContent||"").trim();
            if (t && t.length>best.length) best=t;
          }
        }
        if (!best){
          const alts = qsa("img[alt]").map(img=>String(img.getAttribute("alt")||"").trim()).filter(Boolean);
          if (alts.length) best = alts.sort((a,b)=>b.length-a.length)[0];
        }
        return best;
      }

      function stripIGBoilerplate(s){
        if (!s) return s;
        let out = String(s);
        // Remove "898 likes, 11 comments - username on date:" pattern
        // Pattern must handle: "898 likes, 11 comments - jessicaholland_morethanamom on November 1, 2024:"
        // Match: digits + "likes," + digits + "comments -" + username + optional " on date" + ":"
        const metaPattern = /^\s*\d+[\d,.\s]*\s+likes?,?\s*\d+[\d,.\s]*\s+comments?\s*-\s*[^:]+(?:\s+on\s+[^:]+)?:\s*/i;
        out = out.replace(metaPattern, "");
        // Also handle quoted title pattern: remove prefix before quotes if still present
        // "898 likes...": "Recipe Title" -> "Recipe Title"
        out = out.replace(/^[^"]*["'\u201c\u201d]\s*([^"'\u201d\u201c]+)["'\u201d\u201c]/i, "$1");
        // Remove standalone like/comment lines
        out = out.replace(/^\s*\d+[\d,.\s]*\s+likes?.*$/gim, "");
        out = out.replace(/^\s*\d+[\d,.\s]*\s+comments?.*$/gim, "");
        out = out.replace(/^\s*instagram\s+video\s*$/gim, "");
        return out.trim();
      }
      function makeCleanTitle(caption){
        let c = stripIGBoilerplate(String(caption||""));
        // 1) quoted phrase is best
        const q = c.match(/[""']([^""']{3,80})[""']/);
        if (q && q[1]) c = q[1];
        // 2) split before ~ or newline (but keep first line if it looks like a title)
        const lines = c.split(/\\s*~\\s*|\\r?\\n/);
        const firstLine = lines[0]?.trim() || "";
        // If first line looks like a recipe title (has food words, not too long, not a list item), use it
        if (firstLine && firstLine.length > 10 && firstLine.length < 100 && 
            !/^\\d+[.)]\\s/.test(firstLine) && 
            !/^(ingredients?|steps?|directions?|instructions?|method)/i.test(firstLine) &&
            /\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,6})\\b/.test(firstLine)) {
          c = firstLine;
        } else {
          c = firstLine;
        }
        // 3) drop leading handles/hashtags (with or without trailing space)
        c = c.replace(/^(?:[#@][\\w._-]+\\b[\\s,:-]*){1,4}/, "").trim();
        // 4) if still looks like a handle, nuke it
        if (/^[@#][\\w._-]+$/.test(c)) c = "";
        // 5) try to pull two-to-seven capitalized words as a dish (e.g. "Creamy Parmesan Italian Sausage Ditalini Soup")
        if (!c || c.length < 10) {
          const m = String(caption||"").match(/\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,6})\\b/);
          if (m) c = m[1];
        }
        // 6) final tidy
        c = c.replace(/[""''"<>]/g,"").trim();
        if (c.length>72) c = c.slice(0,72).trim();
        return c || "";
      }
      function getImageUrl(){
        try{
          const pick=(n)=>{ const el=document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]'); return el ? (el.getAttribute("content") || "") : ""; };
          const videoEl = document.querySelector('article video') || document.querySelector('video');
          if (videoEl){
            const poster = videoEl.getAttribute('poster');
            if (poster) return poster;
            const src = videoEl.getAttribute('src');
            if (src) return src;
            const source = videoEl.querySelector('source[src]');
            if (source) return source.getAttribute('src') || '';
          }
          let img = pick('og:image') || pick('twitter:image');
          if (img) return img;
          const imgEl = document.querySelector('article img[srcset], article img[src]') || document.querySelector('img[srcset], img[src]');
          if (imgEl) return imgEl.getAttribute('src') || imgEl.getAttribute('srcset') || "";
        }catch{}
        return "";
      }

      function scoreRecipeText(s){
        if (!s) return 0; const low=s.toLowerCase(); let sc=0;
        if (/\\bingredients?\\b/.test(low)) sc+=500;
        if (/\\b(steps?|directions?|method|instructions?)\\b/.test(low)) sc+=360;
        sc += (low.match(/\\b(cups?|tsp|tbsp|oz|ounce|ounces|lb|lbs|pounds?|g|kg|ml|teaspoons?|tablespoons?)\\b/g)||[]).length*70;
        if (/[0-9¼½¾]/.test(s)) sc+=80;
        if (/^[\\s]*[-*•]/m.test(s)) sc+=80;
        sc += Math.min(s.length, 1600)/10;
        return sc;
      }

      async function waitForStable(ms=150){
        let last=document.body.innerText.length, stable=0;
        for (let i=0;i<3;i++){ await sleep(40); const now=document.body.innerText.length; stable = Math.abs(now-last)<20 ? (stable+40) : 0; last=now; if (stable>=ms) break; }
      }

      async function run(){
        send("log",{msg:"page:loading", extra:{url:location.href}});
        
        // IMMEDIATELY try to extract data from meta tags before any redirects can happen
        // This is critical because Instagram may redirect to deep links
        const immediateMeta = readFromMeta();
        const immediateLd = readFromJsonLd();
        const immediateData = immediateLd && immediateLd.length > immediateMeta.length ? immediateLd : immediateMeta;
        
        if (immediateData && immediateData.length > 50) {
          send("log",{msg:"immediate:data", extra:{len:immediateData.length, source: immediateLd ? "jsonld" : "meta"}});
          const score = scoreRecipeText(immediateData);
          if (score > 100) { // Lower threshold - any reasonable recipe data
            const cleaned = stripIGBoilerplate(immediateData);
            finish({
              ok: true,
              caption: cleaned.slice(0, 4000),
              comments: [], bestComment: "",
              text: cleaned.slice(0, 4000),
              imageUrl: getImageUrl(),
              cleanTitle: makeCleanTitle(cleaned),
              debug: "immediate:meta-or-jsonld"
            });
            return;
          }
        }
        
        // Check if we got redirected to a deep link (this means Instagram blocked us)
        const currentUrl = location.href.toLowerCase();
        if (currentUrl.startsWith("instagram://") || currentUrl.includes("instagram://")) {
          send("log",{msg:"error:deep-link-redirect", extra:{url:currentUrl}});
          // Even if redirected, try to return any data we got from meta/jsonld
          if (immediateData && immediateData.length > 0) {
            const cleaned = stripIGBoilerplate(immediateData);
            finish({
              ok: true,
              caption: cleaned.slice(0, 4000),
              comments: [], bestComment: "",
              text: cleaned.slice(0, 4000),
              imageUrl: getImageUrl(),
              cleanTitle: makeCleanTitle(cleaned),
              debug: "deep-link-redirect:but-had-meta-data"
            });
            return;
          }
          finish({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"error:deep-link-redirect" });
          return;
        }
        
         // Check for error pages or blocked access
        const bodyText = (document.body?.innerText || "").toLowerCase();
         if (bodyText.includes("can't open url") || bodyText.includes("cannot open url") || 
            bodyText.includes("page not found") || bodyText.includes("sorry, this page isn't available") ||
            bodyText.includes("content isn't available") || bodyText.includes("login to continue")) {
          send("log",{msg:"error:blocked", extra:{reason:"page blocked or unavailable"}});
          // Even if blocked, try to return any data we got from meta/jsonld
          if (immediateData && immediateData.length > 0) {
            const cleaned = stripIGBoilerplate(immediateData);
            finish({
              ok: true,
              caption: cleaned.slice(0, 4000),
              comments: [], bestComment: "",
              text: cleaned.slice(0, 4000),
              imageUrl: getImageUrl(),
              cleanTitle: makeCleanTitle(cleaned),
              debug: "blocked:but-had-meta-data"
            });
            return;
          }
          finish({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"error:blocked" });
          return;
        }
        
        // Try to get data from DOM (slower but more complete)
        const quickMeta = readFromMeta();
        const quickLd = readFromJsonLd();
        const quickData = quickLd && quickLd.length > quickMeta.length ? quickLd : quickMeta;
        if (quickData && quickData.length > 100) {
          send("log",{msg:"fast:data", extra:{len:quickData.length}});
          const score = scoreRecipeText(quickData);
          if (score > 200) {
            // Good enough data found quickly, return early
            const cleaned = stripIGBoilerplate(quickData);
            finish({
              ok: true,
              caption: cleaned.slice(0, 4000),
              comments: [], bestComment: "",
              text: cleaned.slice(0, 4000),
              imageUrl: getImageUrl(),
              cleanTitle: makeCleanTitle(cleaned), // Use cleaned version for title extraction
              debug: "fast:data"
            });
            return;
          }
        }
        
        // Otherwise do full scraping
        for (let i=0;i<8;i++){ if (document.body && document.body.childElementCount>1) break; await sleep(40); }
        await smoothScroll();
        await clickExpanders();
        await waitForStable(150);

        const metaCap=readFromMeta(), ldCap=readFromJsonLd(), domCap=readFromDOM();
        send("log",{msg:"sources", extra:{ domLen:domCap.length, ldLen:ldCap.length, metaLen:metaCap.length }});

        const candidates=[metaCap, ldCap, domCap].filter(Boolean).map(t=>({t, s:scoreRecipeText(t)}));
        candidates.sort((a,b)=>(b.s-a.s) || (b.t.length-a.t.length));
        const best=candidates[0]?.t || "";
        send("log",{msg:"result", extra:{ capLen:best.length, score:candidates[0]?.s || 0 }});

        const MAX_CAPTION=4000;
        const cleanedCaption = stripIGBoilerplate(best||"");
        const safe = cleanedCaption.slice(0, MAX_CAPTION);
        const cleanTitle = makeCleanTitle(cleanedCaption || best || ""); // Use cleaned version for title
        const imageUrl = getImageUrl();
        const articleText = stripIGBoilerplate((getPostRoot()?.innerText || "").slice(0, MAX_CAPTION));

        finish({
          ok: (safe.length>0) || (articleText.length>0),
          caption: safe,
          comments: [], bestComment: "",
          text: articleText || safe,
          imageUrl, cleanTitle,
          debug: \`meta:\${metaCap.length} ld:\${ldCap.length} dom:\${domCap.length}\`
        });
      }
      run();
    })();
  `, []);

  const onMessage = (e: WebViewMessageEvent) => {
    let data: any;
    try { data = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (data.type === "log") { logDebug("[INSTAGRAM]", data.msg, data.extra || ""); return; }
    if (data.type === "done") {
      const out: ResultPayload = {
        ok: !!data.ok,
        caption: String(data.caption || ""),
        comments: Array.isArray(data.comments) ? data.comments.map(String) : [],
        bestComment: String(data.bestComment || ""),
        text: String(data.text || ""),
        imageUrl: data.imageUrl ? String(data.imageUrl) : undefined,
        cleanTitle: data.cleanTitle ? String(data.cleanTitle) : undefined,
        debug: String(data.debug || ""),
      };
      onResult(out);
    }
  };

  // Minimal screenshot helper (used elsewhere as needed)
  const captureScreenshot = async () => {
    if (!shotRef.current || isCapturing) return;
    try {
      setIsCapturing(true);
      await new Promise(r => setTimeout(r, 100));
      await captureRef(shotRef, { format: "jpg", quality: 0.92, result: "tmpfile" });
    } catch {}
    finally { setIsCapturing(false); }
  };

  // When opened, reset and prep
  useEffect(() => {
    if (visible) {
      setLoading(true);
      setPageReady(false);
      setRunKey(k => k + 1);
    }
  }, [visible, url]);

  // Allow hooks that depend on capture state to run safely
  useEffect(() => {
    if (!visible || !pageReady || isCapturing) return;
    const t = setTimeout(() => { /* ready to capture if needed */ }, 0);
    return () => clearTimeout(t);
  }, [visible, pageReady, isCapturing]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.card}>
          <View style={S.header}>
            <Text style={S.title}>Reading Instagram…</Text>
            <TouchableOpacity onPress={onClose} style={S.closeBtn}><Text style={S.closeTxt}>✕</Text></TouchableOpacity>
          </View>
          <View style={S.webWrap} ref={shotRef}>
            {visible && !!url && (
              <WebView
                ref={webRef}
                key={runKey}
                source={{ uri: url }}
                userAgent={MOBILE_UA}
                javaScriptEnabled
                domStorageEnabled
                setSupportMultipleWindows={false}
                onShouldStartLoadWithRequest={onShouldStart}
                injectedJavaScriptBeforeContentLoaded={injectedBefore}
                injectedJavaScript={injected}
                injectedJavaScriptForMainFrameOnly
                onMessage={onMessage}
                onLoadEnd={() => { setLoading(false); setPageReady(true); }}
                onError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  const errorMsg = nativeEvent?.description || "Failed to load URL";
                  logDebug("[INSTAGRAM]", "WebView error:", errorMsg);
                  onResult({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"load-error:" + errorMsg });
                  onClose();
                }}
                onHttpError={(syntheticEvent) => {
                  const { nativeEvent } = syntheticEvent;
                  logDebug("[INSTAGRAM]", "WebView HTTP error:", nativeEvent?.statusCode);
                  onResult({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"http-error:" + (nativeEvent?.statusCode || "unknown") });
                  onClose();
                }}
              />
            )}
            {loading && (<View style={S.loading}><ActivityIndicator /><Text style={S.loadingText}>Opening page…</Text></View>)}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 900, height: "84%", backgroundColor: "#0B1120", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#1f2a3a" },
  header: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1f2a3a", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#E5E7EB", fontWeight: "800" },
  closeBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#111827", borderRadius: 8 },
  closeTxt: { color: "#9CA3AF", fontWeight: "900" },
  webWrap: { flex: 1, backgroundColor: "#0a1422" },
  loading: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#9CA3AF" },
});
