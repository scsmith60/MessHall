// lib/TitleSnap.tsx
// Like I'm 5: this opens a tiny web window, looks for the big title text on TikTok,
// cleans it, gives it to us. In "silent" mode it shows NOTHING — just does the work.

import React, { useMemo } from 'react';
import { Modal, View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

// -- clean caption to a short title
function captionToTitle(raw?: string) {
  if (!raw) return '';
  let s = String(raw)
    .replace(/\r|\t/g, ' ')
    .replace(/https?:\/\/\S+/gi, '')          // no links
    .replace(/[#@][\w_]+/g, '')               // no #tags/@users
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // no emojis
    .replace(/\s{2,}/g, ' ')
    .trim();

  const cutWords = /(ingredients?|directions?|instructions?|method|prep time|cook time|total time|servings?|yields?|calories?|kcal)/i;
  const m = s.match(cutWords);
  if (m && m.index! > 0) s = s.slice(0, m.index).trim();

  s = (s.split('\n')[0] || s).trim();               // first line
  const firstSentence = s.split(/(?<=\.)\s+/)[0];   // or first sentence
  if (firstSentence && firstSentence.length >= 6) s = firstSentence.trim();

  s = s.replace(/\s*[|–-]\s*(TikTok|YouTube|Instagram|Pinterest|Allrecipes|Food Network|NYT Cooking).*/i, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

function isBadTitleCandidate(s?: string) {
  if (!s) return true;
  const t = s.trim();
  if (!t) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^\d{6,}$/.test(t)) return true;
  if (/(tiktok|make your day)/i.test(t)) return true;
  if ((t.match(/[A-Za-z]/g) || []).length < 3) return true;
  const words = t.split(/\s+/);
  return words.length < 2 || words.length > 14;
}

export default function TitleSnap({
  visible,
  url,
  onFound,
  onClose,
  silent = false, // 👈 new: run with **no overlay**
}: {
  visible: boolean;
  url: string;
  onFound: (title: string) => void;
  onClose: () => void;
  silent?: boolean;
}) {
  const injectedJS = useMemo(() => `
(function() {
  function send(kind, val){
    try { window.ReactNativeWebView.postMessage(kind + '|' + (val||'')); } catch(e) {}
  }
  function textFrom(el){ return (el && (el.innerText || el.textContent || '')).trim(); }

  // A) H1 title blocks TikTok uses on photo/video pages
  var h1 = document.querySelector('h1[class*="H1PhotoTitle"], h1[class*="H1VideoTitle"]');
  if (h1) { send('TITLE', textFrom(h1)); return; }

  // B) common desc/title e2e hooks
  var el = document.querySelector('[data-e2e="search-video-title"],[data-e2e="new-desc-span"],[data-e2e="browse-video-desc"],[data-e2e="video-desc"]');
  if (!el) {
    var list = Array.from(document.querySelectorAll('[data-e2e]'));
    el = list.find(n => /desc|title/i.test(n.getAttribute('data-e2e')||''));
  }

  // C) search around description for a short title-ish string
  if (el) {
    var host = el.offsetParent || el.parentElement || el;
    var candidates = [];
    candidates.push(textFrom(host));
    var sib = host.previousElementSibling;
    for (var i=0;i<3 && sib;i++){ candidates.push(textFrom(sib)); sib = sib.previousElementSibling; }
    var p = host.parentElement;
    if (p && p.firstElementChild && p.firstElementChild !== host) { candidates.push(textFrom(p.firstElementChild)); }

    var best = '', bestScore = -1;
    function score(s){
      if (!s) return -1;
      s = s.trim();
      if (s.length < 6 || s.length > 120) return -1;
      if (/https?:\\/\\/|\\.(jpg|png|webp|gif|mp4)/i.test(s)) return -1;
      if (/^\\d{6,}$/.test(s)) return -1;
      var words = s.split(/\\s+/).length;
      return 100 - Math.abs(7 - words) * 5; // prefer ~5–9 words
    }
    candidates.forEach(function(c){
      var sc = score(c);
      if (sc > bestScore) { bestScore = sc; best = c; }
    });
    if (best) { send('TITLE', best); return; }
  }

  // D) last-ditch: poke React props looking for a string child
  var all = document.getElementsByTagName('*');
  outer: for (var i=0;i<all.length;i++){
    var node = all[i];
    for (var key in node){
      if (Object.prototype.hasOwnProperty.call(node, key) && key.startsWith('__reactProps$')) {
        var rp = node[key];
        var kids = rp && rp.children;
        var s = (typeof kids === 'string') ? kids : '';
        if (s && s.length > 6) { send('TITLE', s); break outer; }
      }
    }
  }
  send('TITLE','');
})();`, [url]);

  if (!visible) return null;

  // 💡 SILENT: just the hidden WebView — no Modal, no overlay.
  if (silent) {
    return (
      <WebView
        source={{ uri: url }}
        injectedJavaScript={injectedJS}
        onMessage={(e) => {
          const data: string = e?.nativeEvent?.data || '';
          if (!data.startsWith('TITLE|')) return;
          const raw = data.slice(6).trim();
          const cleaned = captionToTitle(raw);
          if (cleaned && !isBadTitleCandidate(cleaned)) onFound(cleaned);
          onClose();
        }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        userAgent={'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'}
        style={{ width: 1, height: 1, opacity: 0 }}
      />
    );
  }

  // Normal (non-silent) — small helpful card
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={S.backdrop}>
        <View style={S.card}>
          <Text style={S.h}>Finding title…</Text>
          <ActivityIndicator />
          <Pressable onPress={onClose} style={S.btn}><Text style={S.btnTxt}>Close</Text></Pressable>
        </View>
      </View>
      <WebView
        source={{ uri: url }}
        injectedJavaScript={injectedJS}
        onMessage={(e) => {
          const data: string = e?.nativeEvent?.data || '';
          if (!data.startsWith('TITLE|')) return;
          const raw = data.slice(6).trim();
          const cleaned = captionToTitle(raw);
          if (cleaned && !isBadTitleCandidate(cleaned)) onFound(cleaned);
          onClose();
        }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        userAgent={'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'}
        style={{ width: 1, height: 1, opacity: 0 }}
      />
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { flex:1, backgroundColor:'#0008', alignItems:'center', justifyContent:'center', padding:16 },
  card: { width:'100%', maxWidth:420, backgroundColor:'#111827', borderRadius:12, padding:12, borderWidth:1, borderColor:'#243042', gap:8 },
  h: { color:'#E5E7EB', fontWeight:'700', fontSize:16 },
  btn: { alignSelf:'flex-end', paddingHorizontal:10, paddingVertical:8 },
  btnTxt: { color:'#93c5fd', fontWeight:'600' },
});
