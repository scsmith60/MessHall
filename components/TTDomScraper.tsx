// TTDomScraper.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import WebView, { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import { logDebug, logError } from "../lib/logger";

type ResultPayload = {
  ok: boolean;
  caption: string;
  comments: string[];
  bestComment: string;
  text: string;
  imageUrl?: string;
  cleanTitle?: string;
  pageTitle?: string;
  debug: string;
  sigi?: any;
};

export default function TTDomScraper({
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

  const startUrl = useMemo(() => url, [url]);

  const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";

  const isDeepLink = (u?: string) => !!u && /^(tiktok:|intent:|market:|itms-apps:|itms-appss:)/i.test(u || "");
  const isForeignHost = (u?: string) => {
    try {
      if (!u) return true;
      const { hostname, protocol } = new URL(u);
      if (protocol !== "https:") return true;
      // allow any tiktok host variant (www, m, vm, etc.)
      if (!hostname.toLowerCase().endsWith("tiktok.com")) return true;
      return false;
    } catch { return true; }
  };

  const onShouldStart = (nav: WebViewNavigation) => {
    const u = nav.url;
    if (isDeepLink(u)) return false;
    if (isForeignHost(u)) return false;
    return true;
  };

  // Minimal injectedBefore script — keep small to avoid TSX template complexity
  const injectedBefore = useMemo(() => `
    (function(){
      try { window.open = function(){}; } catch(e) {}
    })();
  `, []);

  // Minimal injected script (reduced complexity) to avoid nested backtick/template issues
  const injected = useMemo(() => `
    (function(){
      try{
        function grabOnce(){
          // Click "See more" button to expand truncated captions
          try{ Array.from(document.querySelectorAll('button')).forEach(b=>{ if(/see more/i.test(b.innerText||b.textContent||'')) try{ b.click(); }catch(e){} }); }catch(e){}
          var q = function(sel){ try{ var el=document.querySelector(sel); return el? (el.innerText||el.textContent||"").trim():""; }catch(e){ return "";} };
          var caption = q('[data-e2e="browse-video-desc"]') || q('[data-e2e="video-desc"]') || q('[data-e2e="new-desc-span"]') || q('[data-testid="post-caption"]') || q('[data-e2e="post-caption"]') || q('.tt-video-meta__desc') || q('.share-desc') || q('h1') || q('.video-meta-title') || q('.post-desc') || "";
          var sig = null;
          try{
            var s = document.getElementById('SIGI_STATE');
            if(s && s.textContent) sig = JSON.parse(s.textContent);
          }catch(e){}
          if(!sig){
            try{
              var u = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
              if(u && u.textContent) sig = JSON.parse(u.textContent);
            }catch(e){}
          }
          if(!sig){
            try{
              var scripts = Array.from(document.getElementsByTagName('script'));
              for(var i=0;i<scripts.length;i++){
                var t = scripts[i].textContent || '';
                var m = t.match(/window\['SIGI_STATE'\]\s*=\s*(\{[\s\S]*?\})\s*;/) || t.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/) || t.match(/SIGI_STATE\s*=\s*(\{[\s\S]*?\})/);
                if(m && m[1]){ try{ sig = JSON.parse(m[1]); break; }catch(e){} }
              }
            }catch(e){}
          }
          var metaImage = (document.querySelector('meta[property="og:image"]') || document.querySelector('meta[name="twitter:image"]')) ? (document.querySelector('meta[property="og:image"]') || document.querySelector('meta[name="twitter:image"]')).getAttribute('content') : '';
          var pageTitle = (document.title||"").trim();
          var bodyText = (document.body && (document.body.innerText||document.body.textContent)) ? (document.body.innerText||document.body.textContent).slice(0,5000) : '';
          var isPhoto = !!document.querySelector('.photo-content, .post-photo, .img-wrap');
          var payload = { type: 'done', ok: true, caption: caption, comments: [], bestComment: '', text: bodyText, debug: sig? 'sigi' : 'none', imageUrl: metaImage, sigi: sig || null, pageTitle: pageTitle, isPhoto: isPhoto };
          // If we found useful content, post and stop retrying
          if(payload.caption || payload.sigi || (payload.text && payload.text.length>200)){
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(payload));
            return true;
          }
          return false;
        }
        // try immediately, then retry a few times to let dynamic content load
        var attempts = 0; var maxAttempts = 8;
        var iv = setInterval(function(){ attempts++; try{ if(grabOnce()){ clearInterval(iv); } else if(attempts>=maxAttempts){ // final post (may be empty)
            var fallback = { type: 'done', ok: true, caption: '', comments: [], bestComment: '', text: (document.body&& (document.body.innerText||document.body.textContent))? (document.body.innerText||document.body.textContent).slice(0,5000):'', debug: 'fallback', imageUrl: (document.querySelector('meta[property="og:image"]')||{}).getAttribute? (document.querySelector('meta[property="og:image"]').getAttribute('content')) : '', sigi: null, pageTitle: (document.title||"").trim(), isPhoto: !!document.querySelector('.photo-content, .post-photo, .img-wrap') };
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(fallback)); clearInterval(iv);
          } }catch(e){ try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'done', ok:false, caption:'', comments:[], bestComment:'', text:'', debug:'err' })); }catch(e){} clearInterval(iv); } }, 500);
      }catch(e){
        try{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'done', ok: false, caption:'', comments:[], bestComment:'', text:'', debug:'err' })); }catch(e){}
      }
    })();
  `, []);

  const onMessage = (e: WebViewMessageEvent) => {
    // Log raw message for debugging
    try { logDebug('[TTDOM] raw message', e.nativeEvent.data && e.nativeEvent.data.slice ? e.nativeEvent.data.slice(0, 200) : e.nativeEvent.data); } catch (e) { }
    let data: any;
    try { data = JSON.parse(e.nativeEvent.data); } catch (err) { logError('[TTDOM] failed to parse message', err); return; }
    if (data.type === "log") { logDebug("[TIKTOK]", data.msg, data.extra || ""); return; }
    if (data.type === "done") {
      const out: ResultPayload = {
        ok: !!data.ok,
        caption: String(data.caption || ""),
        comments: Array.isArray(data.comments) ? data.comments.map(String) : [],
        bestComment: String(data.bestComment || ""),
        text: String(data.text || ""),
        imageUrl: data.imageUrl ? String(data.imageUrl) : undefined,
        cleanTitle: data.cleanTitle ? String(data.cleanTitle) : undefined,
        pageTitle: data.pageTitle ? String(data.pageTitle) : undefined,
        debug: String(data.debug || ""),
        sigi: data.sigi || null,
      };
      onResult(out);
    }
  };

  useEffect(() => { if (visible) { setLoading(true); setRunKey(k => k + 1); } }, [visible, url]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.card}>
          <View style={S.header}>
            <Text style={S.title}>Reading TikTok…</Text>
            <TouchableOpacity onPress={onClose} style={S.closeBtn}><Text style={S.closeTxt}>✕</Text></TouchableOpacity>
          </View>
          <View style={S.webWrap}>
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
                onLoadEnd={() => setLoading(false)}
                onError={() => { onResult({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"load-error" }); onClose(); }}
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
