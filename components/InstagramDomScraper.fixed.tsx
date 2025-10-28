// InstagramDomScraper.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import WebView, { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";

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
    if (isDeepLink(u)) return false;
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

      setTimeout(() => { if (!finished) finish({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"timeout" }); }, 12000);

      async function smoothScroll(){ for (const y of [150, 500, 900, 0]) { window.scrollTo({ top: y, behavior: 'instant' }); await sleep(150); } }

      function getPostRoot(){ return document.querySelector('article') || document.querySelector('main') || document.body; }

      async function clickExpanders(){
        const root = getPostRoot(); if (!root) return 0;
        let total = 0; const seen = new Set();
        function visible(el){ const r = el.getBoundingClientRect(); return r.width>0 && r.height>0; }
        for (let round=0; round<3; round++){
          let clicks=0;
          for (const el of qsa('button,[role="button"],span,div').filter(el => root.contains(el))){
            const t=(el.innerText||el.textContent||"").trim().toLowerCase();
            if (!(t==="more"||t==="see more")) continue;
            if (!visible(el)) continue;
            if (seen.has(el)) continue;
            try{ el.click(); seen.add(el); clicks++; total++; }catch{}
            if (total>=6) break;
          }
          send("log", { msg:"expanders:clicked", extra:{ clicks, round: round+1 }});
          if (clicks===0||total>=6) break;
          await sleep(220);
        }
        return total;
      }

      function pickMetaContent(n){
        try{
          const selector='meta[name="' + n + '"], meta[property="' + n + '"]';
          const el=document.querySelector(selector);
          return el?(el.getAttribute("content")||""):"";
        }catch(_){ return ""; }
      }

      function readFromMeta(){
        return pickMetaContent("og:description") || pickMetaContent("twitter:description") || pickMetaContent("description") || "";
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
        const sels = [
          'div._a9zs',
          'div._aagv',
          'div[data-testid="post-content-root"] span',
          'div._a9zr span',
          'div._ae5q span',
          'div.C4VMK span',
          'div[role="button"] div[dir="auto"]',
          'h1[dir="auto"]',
          'span[dir="auto"]',
          'div[role="dialog"] span[dir="auto"]',
          'article h1',
          'article span',
          'span._ap3a'
        ];
        let caption = "";
        for (const s of sels){
          for (const el of qsa(s).filter(el => root.contains(el))){
            const t=(el.innerText||el.textContent||"").trim();
            if (t && t.length>caption.length) caption=t;
          }
        }

        // Find comments
        const comments = [];
        const commentSels = [
          'ul[role="list"] li',
          'div[role="menuitem"]',
          'div._a9zr',
          'div[role="button"]'
        ];
        for (const sel of commentSels) {
          for (const el of qsa(sel).filter(el => root.contains(el))) {
            const t = (el.innerText || el.textContent || "").trim();
            if (t && t.length > 3 && t !== caption) {
              comments.push(t);
            }
          }
        }

        return { caption, comments };
      }

      function stripIGBoilerplate(s){
        if (!s) return s;
        s = s.replace(/^\\s*\\d[\\d,.\\s]*\\s+likes?,?\\s*\\d[\\d,.\\s]*\\s+comments?\\s*-\\s*[^:]+:\\s*/i, "");
        s = s.replace(/^\\s*\\d[\\d,.\\s]*\\s+likes?\\s*$/gim, "").replace(/^\\s*\\d[\\d,.\\s]*\\s+comments?\\s*$/gim, "");
        return s.trim();
      }

      function makeCleanTitle(caption){
        let c = stripIGBoilerplate(String(caption||""));
        
        // Strategy 1: Look for recipe title in ingredients list
        const ingredientsMatch = c.match(/ingredients(?:\\s*:)?\\s*([^\\n.,!?]{5,60})/i);
        if (ingredientsMatch && ingredientsMatch[1]) c = ingredientsMatch[1];
        
        // Strategy 2: Quoted text or recipe indicators
        const patterns = [
          // "Recipe for [dish]" or "[dish] recipe"
          /(?:recipe(?:\\s+for)?[\\s:-]+)?([^.,!?\\n@#]{5,60}?)(?:\\s+recipe\\b)/i,
          // Food words near beginning
          /^([^.,!?\\n@#]{5,60}?)(?=\\s+(?:recipe|pasta|bread|sauce|chicken|beef|pork|fish|soup|salad|sandwich|cake)\\b)/i,
          // Quoted title
          /[""']([^""']{3,80})[""']/,
          // Title before ingredients
          /^([^.,!?\\n@#]{5,60}?)(?=\\s*\\n.*?\\bingredients\\b)/is,
        ];

        for (const pattern of patterns) {
          const match = c.match(pattern);
          if (match && match[1]) {
            const candidate = match[1].trim()
              .replace(/^(?:[#@][\\w._-]+\\b[\\s,:-]*){1,4}/, "") // handles/hashtags
              .replace(/^(?:made|making|try|trying|cook|cooking|baking)\\s+/i, "") // intro verbs
              .replace(/\\s*[.,!?]\\s*$/, ""); // trailing punctuation
            
            if (candidate && !/^(?:recipe|food|yummy|delicious|tasty)$/i.test(candidate)) {
              c = candidate;
              break;
            }
          }
        }

        // Fallback: try to find sequence of capitalized words
        if (!c || /^[@#][\\w._-]+$/.test(c)) {
          const m = String(caption||"").match(/\\b([A-Z][a-z]+(?:\\s+[A-Za-z][a-z]+){1,4})\\b(?=\\s|$)/);
          if (m) c = m[1];
        }

        c = c.replace(/[""''"<>]/g,"").trim();
        if (c.length > 72) c = c.slice(0,72).trim();
        if (!c) c = "Recipe";
        return c;
      }

      function getImageUrl(){
        try{
          let img = pickMetaContent("og:image") || pickMetaContent("twitter:image");
          if (img) return img;
          const imgEl = document.querySelector('article img[srcset], article img[src]') || document.querySelector('img[srcset], img[src]');
          if (imgEl) return imgEl.getAttribute('src') || imgEl.getAttribute('srcset') || "";
        }catch{}
        return "";
      }

      function filterRecipeContent(comments) {
        return comments.filter(c => {
          const low = (c||"").toLowerCase();
          return /\\bingredients?\\b/.test(low) || 
                 /\\b(?:steps?|directions?|method|instructions?)\\b/.test(low) ||
                 /\\b(?:cup|tsp|tbsp|oz|g|ml|kg)s?\\b/.test(low) ||
                 /[0-9¼½¾]/.test(c);
        });
      }

      function bestCommentFromList(comments) {
        if (!comments || !comments.length) return "";
        const score = (s) => {
          let sc = 0;
          const low = s.toLowerCase();
          if (/ingredients?|what you need/.test(low)) sc += 300;
          if (/steps?|directions?|method|instructions?/.test(low)) sc += 200;
          if (/[0-9¼½¾]/.test(s)) sc += 80;
          if (/(cup|cups|tsp|tbsp|oz|g|ml|kg|lb)/i.test(s)) sc += 120;
          if (/^(\\s*[-*•]|\\s*\\d+\\.)/m.test(s)) sc += 60;
          sc += Math.min(s.length, 300) * 0.1;
          return sc;
        };
        return comments.slice().sort((a,b)=>score(b)-score(a))[0] || "";
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

      async function waitForStable(ms=1200){
        let last=document.body.innerText.length, stable=0;
        for (let i=0;i<12;i++){ await sleep(140); const now=document.body.innerText.length; stable = Math.abs(now-last)<20 ? (stable+140) : 0; last=now; if (stable>=ms) break; }
      }

      async function run(){
        send("log",{msg:"page:loading", extra:{url:location.href}});
        for (let i=0;i<25;i++){ if (document.body && document.body.childElementCount>1) break; await sleep(100); }
        await smoothScroll();
        await clickExpanders();
        await waitForStable(1200);

        const metaCap=readFromMeta(), ldCap=readFromJsonLd(), domResult=readFromDOM();
        send("log",{msg:"sources", extra:{ domLen:domResult.caption.length, ldLen:ldCap.length, metaLen:metaCap.length }});

        const candidates=[
          { t: metaCap, s: scoreRecipeText(metaCap) },
          { t: ldCap, s: scoreRecipeText(ldCap) },
          { t: domResult.caption, s: scoreRecipeText(domResult.caption) }
        ].filter(c => c.t).map(c => ({
          ...c,
          isRecipeTitle: /recipe|pasta|bread|cake|chicken|beef|pork|fish|soup|salad|sandwich/i.test(c.t)
        }));

        candidates.forEach(c => { if (c.isRecipeTitle) c.s += 300; });
        candidates.sort((a,b)=>(b.s-a.s) || (b.t.length-a.t.length));
        
        const best = candidates[0]?.t || "";
        send("log",{msg:"result", extra:{ capLen:best.length, score:candidates[0]?.s || 0, isRecipe:candidates[0]?.isRecipeTitle }});

        const MAX_CAPTION=4000;
        const cleanedCaption = stripIGBoilerplate(best||"");
        const safe = cleanedCaption.slice(0, MAX_CAPTION);
        const comments = filterRecipeContent(domResult.comments || []);
        
        const cleanTitle = makeCleanTitle(best||"");
        const pageTitle = (() => {
          try {
            return pickMetaContent("og:title") || pickMetaContent("twitter:title") || document.title || "";
          } catch(_){ return ""; }
        })();
        const imageUrl = getImageUrl();

        finish({
          ok: safe.length>0,
          caption: safe,
          comments,
          bestComment: bestCommentFromList(comments),
          text: [safe, comments.join("\\n\\n")].filter(Boolean).join("\\n\\n"),
          imageUrl, cleanTitle,
          pageTitle,
          debug: \`meta:\${metaCap.length} ld:\${ldCap.length} dom:\${domResult.caption.length}\`
        });
      }
      run();
    })();
  `, []);

  const onMessage = (e: WebViewMessageEvent) => {
    let data: any;
    try { data = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (data.type === "log") { console.log("[INSTAGRAM]", data.msg, data.extra || ""); return; }
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
            <Text style={S.title}>Reading Instagram…</Text>
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