// components/TTDomScraper.tsx
//
// 🧒 ELI5
// open TikTok → press “see more” → un-squish (un-clamp) the caption → read the usual
// carriers (DOM/meta/etc) → pick the most recipe-ish → return EXACTLY like before.
// NEW: only logs + unclamp so we can see directions without changing behavior.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";

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

  // 🖥️ Desktop UA helps TikTok deliver the fuller desktop layout (easier to read)
  const DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  // 🔌 this whole string is executed inside the TikTok page
  const injected = useMemo(
    () => `
(function () {
  const send = (type, data) => { try { window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...data })); } catch(_){} };
  const log  = (msg, extra) => send("log", { msg, extra });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const txt = (el) => (el && el.textContent ? el.textContent.trim() : "");
  const preview = (s, n=160) => { const t=(s||"").replace(/\\s+/g," ").trim(); return t.length>n ? t.slice(0,n)+"…" : t; };

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

  // ----------------------------------------------------
  // caption expanders (tap “see more”, “more comments”)
  // ----------------------------------------------------
  async function clickExpanders() {
    let clicks = 0;
    const clickedSelectors = [];

    // caption “see more”
    const captionButtons = new Set();
    qsa("button[data-e2e='expand-desc']").forEach(b => captionButtons.add(b));
    qsa("button, div, span, a").forEach(el => {
      const t = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (t && (t === "see more" || t === "more" || t.includes("see more"))) captionButtons.add(el);
    });
    captionButtons.forEach(b => { try { b.click(); clicks++; clickedSelectors.push("caption:generic"); } catch(_){} });

    // comments “more replies / more comments”
    const moreButtons = new Set();
    qsa("button").forEach(b => {
      const t = (b.innerText || b.textContent || "").trim().toLowerCase();
      if (!t) return;
      if (t === "see more" || t === "more" || t.includes("more replies") || t.includes("more comments")) {
        moreButtons.add(b);
      }
    });
    moreButtons.forEach(b => { try { b.click(); clicks++; clickedSelectors.push("comments:more"); } catch(_){} });

    return { clicks, clickedSelectors };
  }

  // ------------------------------------------------------
  // NEW: unclamp caption so long text becomes readable
  // ------------------------------------------------------
  function unclampCaption() {
    let changed = 0;
    const tweak = (el) => {
      if (!el) return;
      const s = el.style;
      s.webkitLineClamp = "unset";
      s.maxHeight = "none";
      s.overflow = "visible";
      s.whiteSpace = "pre-wrap";
      s.display = "block";
      changed++;
    };
    const nodes = document.querySelectorAll("[data-e2e='video-desc'], [data-e2e='browse-video-desc'], [data-e2e='aweme-desc']");
    nodes.forEach((n) => {
      tweak(n);
      if (n.parentElement) tweak(n.parentElement);
      if (n.parentElement?.parentElement) tweak(n.parentElement.parentElement);
    });
    return changed;
  }

  // ------------------------------------------------------
  // NEW: debug — show clamp + whether caption has “instructions”
  // ------------------------------------------------------
  function dbgCaptionNode() {
    const cap = document.querySelector("[data-e2e='browse-video-desc'], [data-e2e='video-desc'], [data-e2e='aweme-desc']");
    if (!cap) { log("cap:dbg", { found:false }); return; }
    const cs = getComputedStyle(cap);
    const t  = (cap.innerText || "").trim();
    log("cap:dbg", {
      found: true,
      len: t.length,
      hasInstructions: /\\b(instructions?|directions?|steps?|method)\\b/i.test(t),
      clamp: (cs.webkitLineClamp || ""),
      maxH: (cs.maxHeight || ""),
      overflow: (cs.overflow || ""),
      preview: (t.replace(/\\s+/g," ").slice(0,220))
    });
  }

  // ------------------------------------------------------
  // OPTIONAL: peek siblings under caption (where steps often live)
  // ------------------------------------------------------
  function peekStepsNearCaption() {
    const cap = document.querySelector("[data-e2e='browse-video-desc'], [data-e2e='video-desc'], [data-e2e='aweme-desc']");
    if (!cap) return { found:false, sibs:0, lists:0, preview:"" };

    const chunks = [];
    let sibs = 0, lists = 0;
    let s = cap.nextElementSibling, hops = 0;
    while (s && hops < 20) {
      const t = (s.textContent || "").trim();
      if (t) chunks.push(t);
      if (s.querySelectorAll) {
        s.querySelectorAll("ol li, ul li").forEach(li => {
          const lt = (li.textContent || "").trim();
          if (lt) { chunks.push(lt); lists++; }
        });
      }
      s = s.nextElementSibling; hops++; sibs++;
    }
    const joined = chunks.join("\\n").replace(/\\n{2,}/g,"\\n").trim();
    const prev = (joined || "").replace(/\\s+/g, " ").slice(0, 260);
    return { found:true, sibs, lists, preview: prev };
  }

  // ------------------------------------------------------
  // OPTIONAL: show where “18 minutes / 380 / flip” came from
  // ------------------------------------------------------
  function findPhraseWindows(map, phrase) {
    const out = {};
    const needles = Array.isArray(phrase) ? phrase : [phrase];
    const win = (s, i, pad=90) => {
      if (!s || i < 0) return "";
      const a = Math.max(0, i - pad);
      const b = Math.min(s.length, i + pad);
      return s.slice(a,b).replace(/\\s+/g," ");
    };
    Object.entries(map).forEach(([key, s]) => {
      const low = (s || "").toLowerCase();
      let bestI = -1, bestWord = "";
      for (const w of needles) {
        const i = low.indexOf(String(w).toLowerCase());
        if (i !== -1 && (bestI === -1 || i < bestI)) { bestI = i; bestWord = w; }
      }
      if (bestI !== -1) out[key] = { word: bestWord, idx: bestI, around: win(s, bestI, 110) };
    });
    return out;
  }

  // --------------------------------
  // readers (SIGI/NEXT/LD/META/DOM/ALT)
  // --------------------------------
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
  // MAIN flow (unchanged)
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

      // expanders (click “see more”)
      let totalClicks = 0;
      for (let i=0; i<3; i++) {
        const { clicks, clickedSelectors } = await clickExpanders();
        totalClicks += clicks;
        log("expanders:clicked", { clicks, round: i+1, selectors: clickedSelectors.slice(0,6) });
        await sleep(250);
      }

      // NEW: un-clamp the caption a few times so long text is visible
      for (let i=0; i<3; i++) {
        const changed = unclampCaption();
        if (changed) log("caption:unclamp", { changed });
        await sleep(180);
      }
      // NEW: debug what the caption looks like now
      dbgCaptionNode();

      // early reads (same behavior)
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
        return { k, ...obj, rcpScore: score, preview: preview(cap || com) };
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

      // per-source logs
      sources.forEach(s => log("source", { key: s.k, srcLen: s.srcLen || 0, rcpScore: s.rcpScore, preview: s.preview, comCount: (s.comments||[]).length }));

      // OPTIONAL: show where “18 minutes/18 min/380/flip” came from
      const byCarrierText = {};
      sources.forEach(s => {
        const cap = s.caption || "";
        const com = (s.comments || []).join("\\n\\n");
        byCarrierText[s.k] = [cap, com].filter(Boolean).join("\\n\\n");
      });
      const phraseHits = findPhraseWindows(byCarrierText, ["18 minutes","18 minute","18 min","380°","380","flip"]);
      if (Object.keys(phraseHits).length) log("phrase:where", phraseHits);

      // choose: score then length (UNCHANGED)
      sources.sort((a,b)=> (b.rcpScore - a.rcpScore) || ((b.srcLen||0) - (a.srcLen||0)));
      const best = sources[0];
      log("source:chosen", { key: best.k, rcpScore: best.rcpScore, srcLen: best.srcLen });
      log("carrier:chosen", { key: best.k, srcLen: best.srcLen });

      // final quick re-read + promotion (UNCHANGED)
      const altFinal = (() => { const o=readFromAltImages(); const p=pack("altF", o); p.rcpScore=Math.round(p.rcpScore*altWeight); return p; })();
      const domFinal = pack("domF", readFromDOM());
      log("final:dom", { rcpScore: domFinal.rcpScore, srcLen: domFinal.srcLen, preview: domFinal.preview, comCount: (domFinal.comments||[]).length });
      log("final:alt", { rcpScore: altFinal.rcpScore, srcLen: altFinal.srcLen, preview: altFinal.preview, comCount: (altFinal.comments||[]).length });

      let finalKey = best.k;
      let finalCaption = (best.caption || "").trim();
      let finalComments = Array.from(new Set((best.comments || []).map(String).filter(Boolean)));

      const challenger = [domFinal, altFinal].sort((a,b)=> (b.rcpScore - a.rcpScore) || ((b.srcLen||0) - (a.srcLen||0)))[0];
      if (challenger.rcpScore > best.rcpScore) {
        finalCaption = challenger.caption || finalCaption;
        finalComments = Array.from(new Set(finalComments.concat(challenger.comments || [])));
        finalKey = challenger.k;
        log("final:promoted", { from: best.k, to: challenger.k, rcpScore: challenger.rcpScore });
      }

      log("carrier:final", { key: finalKey, capLen: finalCaption.length, comLen: finalComments.join(" ").length });

      // peek neighbors only if DOM is the final carrier (no behavior change)
      if (finalKey.startsWith("dom")) {
        const peek = peekStepsNearCaption();
        log("steps:peek", { sibs: peek.sibs, lists: peek.lists, preview: peek.preview });
      }

      // compact debug string (UNCHANGED)
      const dbgParts = [
        \`scores|\${sources.map(s=>\`\${s.k}:\${s.rcpScore}/\${s.srcLen||0}\`).join(",")}\`,
        \`chosen:\${best.k}\`,
        \`clicks:\${totalClicks}\`,
      ];
      const debug = dbgParts.join(" | ");

      // ✅ return payload (UNCHANGED shape + selection)
      const payload = {
        ok: (finalCaption.length + finalComments.join(" ").length) > 0,
        caption: finalCaption,
        comments: finalComments,
        bestComment: bestCommentFromList(finalComments),
        text: [finalCaption, finalComments.join("\n\n")].filter(Boolean).join("\n\n"),
        debug
      };
      send("done", payload);
    } catch (e) {
      log("exception", { message: String(e && e.message || e) });
      send("done", { ok:false, caption:"", comments:[], bestComment:"", text:"", debug:"exception" });
    }
  }

  run();
})();`,
    [runKey]
  );

  // 📨 receive logs + final payload
  const onMessage = (e: WebViewMessageEvent) => {
    let data: any = null;
    try { data = JSON.parse(e.nativeEvent.data); } catch { return; }

    if (data.type === "log") {
      const head = typeof data.msg === "string" ? data.msg : "log";
      const extra = data.extra != null ? ` ${JSON.stringify(data.extra)}` : "";
      // eslint-disable-next-line no-console
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

  // rerun when modal opens
  useEffect(() => {
    if (visible) {
      setLoading(true);
      setRunKey(k => k + 1);
    }
  }, [visible, url]);

  // simple http(s) guard (avoid regex flag issues)
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
  // simple pretty box
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
