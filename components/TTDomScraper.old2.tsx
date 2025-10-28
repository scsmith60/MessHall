// TTDomScraper.tsx - Enhanced with improved title extraction
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import { extractRecipeTitle } from "../lib/titleExtractor";

type ResultPayload = {
  ok: boolean;
  caption: string;
  comments: string[];
  bestComment: string;
  text: string;
  debug: string;
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

  const DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  const injected = useMemo(
    () => `
(function () {
  const send = (type, data) => { try { window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...data })); } catch(_){} };
  const log  = (msg, extra) => send("log", { msg, extra });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const txt = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const preview = (s, n=160) => { const t=(s||"").replace(/\\s+/g," ").trim(); return t.length>n ? t.slice(0,n)+"…" : t; };

  // NEW: Shared title extraction logic
  function extractTitle(text) {
    const RecipeWords = /\\b(?:recipe|pasta|bread|sauce|chicken|beef|pork|fish|soup|salad|sandwich|cake|cookies)\\b/i;
    const IntroVerbs = /^(?:made|making|try|trying|cook|cooking|baking|how\\s+to\\s+make)\\s+/i;
    const HandlesTags = /^(?:[#@][\\w._-]+\\b[\\s,:-]*){1,4}/;
    
    const cleanText = text;
    
    // Strategy 1: Recipe-specific patterns
    const recipeMatches = [
      // "Recipe for [dish]" or "[dish] recipe"
      cleanText.match(/(?:recipe(?:\\s+for)?[\\s:-]+)?([^.,!?\\n@#]{5,60}(?:\\s+recipe\\b))/i),
      // Dish name followed by recipe keyword
      cleanText.match(/([^.,!?\\n@#]{5,60})\\s+(?:recipe|pasta|bread|sauce)\\b/i),
      // "How to make [dish]"
      cleanText.match(/how\\s+to\\s+make\\s+([^.,!?\\n@#]{5,60})/i),
      // Recipe-like phrases after "this" or "delicious"
      cleanText.match(/\\b(?:this|delicious|homemade|easy)\\s+([^.,!?\\n@#]{5,50}(?:\\b(?:recipe|pasta|bread|sauce|chicken|beef|pork|fish|soup|salad|sandwich|cake|cookies)\\b))/i)
    ];
    
    for (const match of recipeMatches) {
      if (match && match[1]) {
        const candidate = cleanUpTitle(match[1]);
        if (isValidTitle(candidate)) return candidate;
      }
    }

    // Strategy 2: Quoted text
    const quotedMatch = cleanText.match(/[""']([^""']{3,80})[""']/);
    if (quotedMatch && quotedMatch[1]) {
      const candidate = cleanUpTitle(quotedMatch[1]);
      if (isValidTitle(candidate)) return candidate;
    }

    // Strategy 3: First line or sentence that looks recipe-like
    const lines = cleanText.split(/\\s*[~|\\n\\u2022]\\s*/);
    for (const line of lines) {
      const candidate = cleanUpTitle(line);
      if (isValidTitle(candidate) && RecipeWords.test(candidate)) {
        return candidate;
      }
    }

    // Strategy 4: Capitalized phrases
    const capitalMatch = cleanText.match(/\\b([A-Z][a-z]+(?:\\s+[A-Za-z][a-z]+){1,4})\\b(?=\\s|$)/);
    if (capitalMatch && capitalMatch[1]) {
      const candidate = cleanUpTitle(capitalMatch[1]);
      if (isValidTitle(candidate)) return candidate;
    }

    // Strategy 5: First non-weak line as fallback
    for (const line of lines) {
      const candidate = cleanUpTitle(line);
      if (isValidTitle(candidate)) return candidate;
    }

    return "Recipe";
  }

  function cleanUpTitle(text) {
    const IntroVerbs = /^(?:made|making|try|trying|cook|cooking|baking|how\\s+to\\s+make)\\s+/i;
    const HandlesTags = /^(?:[#@][\\w._-]+\\b[\\s,:-]*){1,4}/;
    return text
      .replace(HandlesTags, "") // Remove leading hashtags/handles
      .replace(IntroVerbs, "") // Remove intro verbs
      .replace(/\\s*[.,!?]\\s*$/, "") // Remove trailing punctuation
      .replace(/[""''"<>]/g, "") // Remove quotes and brackets
      .trim();
  }

  function isValidTitle(text) {
    const WeakTitles = /^(?:recipe|food|yummy|delicious|tasty|homemade|amazing|good|tiktok|instagram|youtube|facebook|pinterest|food\\s*network|allrecipes)$/i;
    
    const clean = text.trim();
    if (!clean || clean.length < 3 || clean.length > 72) return false;
    if (WeakTitles.test(clean)) return false;
    if (/^[@#][\\w._-]+$/.test(clean)) return false; // Just a handle
    if (/^\\d{6,}$/.test(clean)) return false; // Just numbers
    if (/^\\s*ingredients?:/i.test(clean)) return false; // Ingredients list
    return true;
  }

  // ---------------------------------------
  // recipe-ish score (kept simple + stable)
  // ---------------------------------------
  function scoreRecipeText(s) {
    if (!s) return 0;
    const low = s.toLowerCase();
    let sc = 0;
    if (/\\bingredients?\\b/.test(low)) sc += 500;
    if (/\\b(steps?|directions?|method|instructions?)\\b/.test(low)) sc += 360;
    const unitHits = (low.match(/\\b(cups?|cup|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|lit(er|re)|clove|cloves|egg|eggs|stick|sticks)\\b/g) || []).length;
    sc += unitHits * 70;
    if (/[0-9¼½¾⅓⅔⅛⅜⅝⅞]/.test(s)) sc += 80;
    if (/^[\\s]*[-*•]/m.test(s)) sc += 80;
    if (/^[\\s]*\\d+[.)]/m.test(s)) sc += 90;
    if (/🛒|📝|🍽️|⏰|➡️|—|–|⸻/.test(s)) sc += 40;
    const hashDensity = (s.match(/#/g) || []).length / Math.max(1, s.length);
    if (hashDensity > 0.02) sc -= 60;
    if (/tour|tickets|anniversary|merch|follow|subscribe|link in bio/i.test(s)) sc -= 120;
    sc += Math.min(s.length, 1600) / 8;
    return sc;
  }

  function filterRecipeyLines(arr) {
    return (arr || []).filter(Boolean).map(String).filter((t) => scoreRecipeText(t) >= 140);
  }

  // -----------------------------
  // Read from different sources
  // -----------------------------
  function readFromSIGI() {
    try {
      const s = (window).SIGI_STATE;
      if (!s) return { caption:"", comments:[], srcLen:0 };
      let caption = "";
      const comments = [];
      try {
        const itemModule = s.ItemModule || {};
        const ids = Object.keys(itemModule);
        for (const id of ids) {
          const obj = itemModule[id];
          if (obj && obj.desc) { caption = String(obj.desc); break; }
        }
      } catch {}
      try {
        const cm = s.Comment || s.Comments || s.CommentModule || {};
        if (cm && typeof cm === "object") {
          Object.values(cm).forEach((v) => {
            try {
              const t = (v && (v.text || v.content || v.comment)) ? (v.text || v.content || v.comment) : "";
              if (t && typeof t === "string") comments.push(t);
            } catch {}
          });
        }
      } catch {}
      const srcLen = caption.length + comments.reduce((a,b)=>a+b.length,0);
      return { caption, comments, srcLen };
    } catch { return { caption:"", comments:[], srcLen:0 }; }
  }

  function readFromNext() {
    try {
      const tag = document.querySelector("script#__NEXT_DATA__");
      if (!tag) return { caption:"", comments:[], srcLen:0 };
      const j = JSON.parse(tag.textContent || "{}");
      let caption = "";
      try {
        const p = j.props?.pageProps || j.pageProps || j.props;
        const item = p?.itemInfo?.itemStruct || p?.itemDetail?.itemInfo?.itemStruct;
        if (item?.desc) caption = String(item.desc);
      } catch {}
      const comments = [];
      try {
        const cm = j?.props?.pageProps?.comments || j?.pageProps?.comments || [];
        cm.forEach((c) => {
          const t = c?.text || c?.content || "";
          if (t && typeof t === "string") comments.push(t);
        });
      } catch {}
      const srcLen = caption.length + comments.reduce((a,b)=>a+b.length,0);
      return { caption, comments, srcLen };
    } catch { return { caption:"", comments:[], srcLen:0 }; }
  }

  function readFromLdJson() {
    try {
      const blocks = qsa('script[type="application/ld+json"]');
      let caption = "";
      for (const s of blocks) {
        try {
          const j = JSON.parse(s.textContent || "{}");
          if (!caption && typeof j.description === "string") caption = j.description;
        } catch {}
      }
      return { caption, comments:[], srcLen: caption.length };
    } catch { return { caption:"", comments:[], srcLen:0 }; }
  }

  function readFromMeta() {
    try {
      const m = (name) => {
        const el = document.querySelector(\`meta[name="\${name}"], meta[property="\${name}"]\`);
        return el ? (el.getAttribute("content") || "") : "";
      };
      const caption = m("og:description") || m("twitter:description") || m("description") || "";
      return { caption, comments:[], srcLen: caption.length };
    } catch { return { caption:"", comments:[], srcLen:0 }; }
  }

  function readFromDOM() {
    try {
      let caption = "";
      const capNodes = qsa("[data-e2e='browse-video-desc'], [data-e2e='video-desc'], [data-e2e='aweme-desc'], [data-e2e='expand-desc'] ~ *");
      for (const n of capNodes) {
        const t = txt(n);
        if (t && t.length > caption.length) caption = t;
      }
      if (!caption) {
        const capFall = qsa("strong, p, h1, h2, h3").map(txt).filter(Boolean);
        caption = capFall.sort((a,b)=>b.length-a.length)[0] || "";
      }
      const comments = [];
      const cmNodes = qsa("[data-e2e='comment-item'] [data-e2e='comment-text'], [data-e2e='comment-level-1'], [data-e2e='comment-level-2'], li div[role='comment'], li[role='listitem']");
      cmNodes.forEach((el) => {
        const t = txt(el);
        if (t && t.length > 3) comments.push(t);
      });
      const filtered = filterRecipeyLines(comments);
      const srcLen = caption.length + filtered.reduce((a,b)=>a+b.length,0);
      return { caption, comments: filtered, srcLen, cmCount: cmNodes.length };
    } catch { return { caption:"", comments:[], srcLen:0, cmCount:0 }; }
  }

  function readFromAltImages() {
    try {
      const alts = new Set();
      qsa("img[alt]").forEach(img => {
        const t = (img.getAttribute("alt") || "").trim();
        if (t) alts.add(t);
      });
      qsa("[role='img'][aria-label]").forEach(el => {
        const t = (el.getAttribute("aria-label") || "").trim();
        if (t) alts.add(t);
      });
      qsa("figure figcaption").forEach(fc => {
        const t = txt(fc);
        if (t) alts.add(t);
      });
      const m = (name) => {
        const el = document.querySelector(\`meta[name="\${name}"], meta[property="\${name}"]\`);
        return el ? (el.getAttribute("content") || "") : "";
      };
      const metaAlt = (m("og:image:alt") || m("twitter:image:alt") || "").trim();
      if (metaAlt) alts.add(metaAlt);

      const arr = filterRecipeyLines(Array.from(alts).filter(Boolean));
      const caption = arr.join("\\n");
      const comments = arr.slice(0, 8);
      const srcLen = caption.length + comments.reduce((a,b)=>a+b.length,0);
      return { caption, comments, srcLen, altCount: arr.length, altFirst: arr.slice(0,3) };
    } catch { return { caption:"", comments:[], srcLen:0, altCount:0, altFirst:[] }; }
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

  // ----------------------
  // Main flow with enhanced title extraction
  // ----------------------
  async function run() {
    try {
      const isPhoto = /\\/photo\\//.test((location && location.pathname) || "");

      // wait for page skeleton
      let tries = 0;
      while (tries < 30) {
        const haveRoot = document.querySelector("#app, #__next, main, [data-e2e='feed']") || document.body.childElementCount > 3;
        if (haveRoot) break;
        await sleep(200); tries++;
      }
      log("page:ready", { bodyChildren: document.body.childElementCount, isPhoto });

      // Click expanders and wait for content
      let totalClicks = 0;
      for (let i=0; i<3; i++) {
        // Click "see more" buttons
        qsa("button, div, span, a").forEach(el => {
          const t = (el.innerText || el.textContent || "").trim().toLowerCase();
          if (t === "see more" || t === "more" || t.includes("more replies") || t.includes("more comments")) {
            try { el.click(); totalClicks++; } catch{}
          }
        });
        await sleep(250);
      }

      // early reads
      const early = {
        sigi: readFromSIGI(),
        next: readFromNext(),
        ld:   readFromLdJson(),
        meta: readFromMeta(),
        dom:  { caption:"", comments:[], srcLen:0, cmCount:0 },
        alt:  { caption:"", comments:[], srcLen:0, altCount:0, altFirst:[] }
      };

      await sleep(250);
      early.dom = readFromDOM();
      early.alt = readFromAltImages();

      // score + pack
      const pack = (k, obj) => {
        const cap = obj.caption || "";
        const com = (obj.comments || []).join("\\n\\n");
        const text = [cap, com].filter(Boolean).join("\\n\\n");
        const score = scoreRecipeText(text);
        const title = extractTitle(text); // Use our new title extractor
        return { k, ...obj, rcpScore: score, preview: preview(cap || com), title };
      };

      const altWeight = isPhoto ? 1.0 : 0.5;
      const sources = [
        pack("sigi", early.sigi),
        pack("next", early.next),
        pack("ld",   early.ld),
        pack("meta", early.meta),
        pack("dom",  early.dom),
        (() => { const p = pack("alt", early.alt); p.rcpScore = Math.round(p.rcpScore * altWeight); return p; })(),
      ];

      sources.forEach(s => log("source", { 
        key: s.k, 
        srcLen: s.srcLen || 0, 
        rcpScore: s.rcpScore, 
        preview: s.preview,
        title: s.title,
        comCount: (s.comments||[]).length 
      }));

      // choose best source based on recipe score
      sources.sort((a,b)=> (b.rcpScore - a.rcpScore) || ((b.srcLen||0) - (a.srcLen||0)));
      const best = sources[0];
      
      // Prepare final payload with enhanced title
      const payload = {
        ok: (best.caption || "").length > 0,
        caption: best.caption || "",
        comments: best.comments || [],
        bestComment: bestCommentFromList(best.comments || []),
        text: [best.caption, (best.comments || []).join("\\n\\n")].filter(Boolean).join("\\n\\n"),
        cleanTitle: best.title, // Include extracted title
        debug: \`scores|\${sources.map(s=>\`\${s.k}:\${s.rcpScore}/\${s.srcLen||0}\`).join(",")} | chosen:\${best.k} | clicks:\${totalClicks}\`
      };

      send("done", payload);
    } catch (e) {
      log("exception", { message: String(e && e.message || e) });
      send("done", { ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"exception" });
    }
  }

  run();
})()`, [runKey]);

  const onMessage = (e: WebViewMessageEvent) => {
    let data: any = null;
    try { data = JSON.parse(e.nativeEvent.data); } catch { return; }

    if (data.type === "log") {
      const head = typeof data.msg === "string" ? data.msg : "log";
      const extra = data.extra != null ? ` ${JSON.stringify(data.extra)}` : "";
      console.log("[TTDOM]", head + extra);
      return;
    }
    if (data.type === "done") {
      const out: ResultPayload = {
        ok: !!data.ok,
        caption: String(data.caption || ""),
        comments: Array.isArray(data.comments) ? data.comments.map(String) : [],
        bestComment: String(data.bestComment || ""),
        text: String(data.text || ""),
        debug: String(data.debug || ""),
      };
      onResult(out);
    }
  };

  useEffect(() => {
    if (visible) {
      setLoading(true);
      setRunKey(k => k + 1);
    }
  }, [visible, url]);

  useEffect(() => {
    try {
      const s = String(url || "");
      const bad = !s || !(s.startsWith("http://") || s.startsWith("https://"));
      if (visible && bad) {
        onResult({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"guard:no-url" });
        onClose();
      }
    } catch {}
  }, [visible, url, onClose, onResult]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.card}>
          <View style={S.header}>
            <Text style={S.title}>Reading TikTok…</Text>
            <TouchableOpacity onPress={onClose} style={S.closeBtn}>
              <Text style={S.closeTxt}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={S.webWrap}>
            {visible && !!url && (
              <WebView
                ref={webRef}
                key={runKey}
                source={{ uri: url }}
                userAgent={DESKTOP_UA}
                setSupportMultipleWindows={false}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                injectedJavaScript={injected}
                onMessage={onMessage}
                onLoadEnd={() => setLoading(false)}
                onError={() => {
                  onResult({ ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"load-error" });
                  onClose();
                }}
              />
            )}
            {loading && (
              <View style={S.loading}>
                <ActivityIndicator />
                <Text style={S.loadingText}>Opening page…</Text>
              </View>
            )}
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