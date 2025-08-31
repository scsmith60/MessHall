// lib/TitleSnap.tsx
// Like I'm 5: this opens a small web window, looks for the big title text on TikTok,
// grabs it, cleans it, gives it to us, and closes.

// 1) Imports to show a popup and WebView
import React, { useMemo } from 'react';
import { Modal, View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

// 2) Little helper: remove URLs/hashtags/emojis and cut off where "Ingredients/Steps" begin
function captionToTitle(raw?: string) {
  if (!raw) return '';
  let s = String(raw)
    .replace(/\r|\t/g, ' ')
    .replace(/https?:\/\/\S+/gi, '')          // remove links
    .replace(/[#@][\w_]+/g, '')               // remove #tags/@users
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // remove emojis
    .replace(/\s{2,}/g, ' ')
    .trim();

  const cutWords = /(ingredients?|directions?|instructions?|method|prep time|cook time|total time|servings?|yields?|calories?|kcal)/i;
  const m = s.match(cutWords);
  if (m && m.index! > 0) s = s.slice(0, m.index).trim();

  // use first line / first sentence
  s = (s.split('\n')[0] || s).trim();
  const firstSentence = s.split(/(?<=\.)\s+/)[0];
  if (firstSentence && firstSentence.length >= 6) s = firstSentence.trim();

  // strip “ | SiteName” tails
  s = s.replace(/\s*[|–-]\s*(TikTok|YouTube|Instagram|Pinterest|Allrecipes|Food Network|NYT Cooking).*/i, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

// 3) When a title is “bad” (too generic/numbery), we try snapping
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

export function TitleSnap({
  visible,
  url,
  onFound,
  onClose,
}: {
  visible: boolean;
  url: string;
  onFound: (title: string) => void;
  onClose: () => void;
}) {
  // 4) This tiny script runs *inside* TikTok page to read the title/caption
  const injectedJS = useMemo(() => `
(function() {
  function send(kind, val){
    try { window.ReactNativeWebView.postMessage(kind + '|' + (val||'')); } catch(e) {}
  }

  function textFrom(el){
    return (el && (el.innerText || el.textContent || '')).trim();
  }

  // A) try the big H1 (photo/video titles sometimes live here)
  var h1 = document.querySelector('h1[class*="H1PhotoTitle"], h1[class*="H1VideoTitle"]');
  if (h1) { send('TITLE', textFrom(h1)); return; }

  // B) try data-e2e targets TikTok uses for desc/title
  var el = document.querySelector('[data-e2e="search-video-title"],[data-e2e="new-desc-span"],[data-e2e="browse-video-desc"],[data-e2e="video-desc"]');
  if (!el) {
    var list = Array.from(document.querySelectorAll('[data-e2e]'));
    el = list.find(n => /desc|title/i.test(n.getAttribute('data-e2e')||''));
  }

  // C) if we found the desc block, look around it (siblings/parent) for a short title-like string
  if (el) {
    var host = el.offsetParent || el.parentElement || el;
    var candidates = [];

    // the block itself
    candidates.push(textFrom(host));

    // a few previous siblings (titles often sit right above the caption)
    var sib = host.previousElementSibling;
    for (var i=0;i<3 && sib;i++){ candidates.push(textFrom(sib)); sib = sib.previousElementSibling; }

    // first child of parent (some layouts)
    var p = host.parentElement;
    if (p && p.firstElementChild && p.firstElementChild !== host) {
      candidates.push(textFrom(p.firstElementChild));
    }

    // pick the shortest reasonable string (> 6 chars, < 120 chars)
    var best = '';
    var bestScore = -1;
    function score(s){
      if (!s) return -1;
      s = s.trim();
      if (s.length < 6 || s.length > 120) return -1;
      if (/https?:\\/\\/|\\.(jpg|png|webp|gif|mp4)/i.test(s)) return -1;
      if (/^\\d{6,}$/.test(s)) return -1;
      var words = s.split(/\\s+/).length;
      var sc = 100 - Math.abs(7 - words) * 5; // prefer 5–9 words
      return sc;
    }
    candidates.forEach(function(c){
      var sc = score(c);
      if (sc > bestScore) { bestScore = sc; best = c; }
    });
    if (best) { send('TITLE', best); return; }
  }

  // D) last effort: look at React's internal props and pull children text near desc/title nodes
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

  // If we couldn't find anything, at least close nicely
  send('TITLE','');
})();`, [url]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* 5) Simple little card so user knows we’re working */}
      <View style={S.backdrop}>
        <View style={S.card}>
          <Text style={S.h}>Finding title…</Text>
          <ActivityIndicator />
          <Pressable onPress={onClose} style={S.btn}><Text style={S.btnTxt}>Close</Text></Pressable>
        </View>
      </View>

      {/* 6) The WebView shows TikTok quietly and runs our injected script */}
      <WebView
        source={{ uri: url }}
        injectedJavaScript={injectedJS}
        onMessage={(e) => {
          const data: string = e?.nativeEvent?.data || '';
          if (!data.startsWith('TITLE|')) return;
          const raw = data.slice(6).trim();
          const cleaned = captionToTitle(raw);
          if (cleaned && !isBadTitleCandidate(cleaned)) {
            onFound(cleaned);
            onClose();
          }
        }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        // pretend to be desktop Chrome (TikTok serves better HTML)
        userAgent={'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'}
        style={{ width: 1, height: 1, opacity: 0 }} // hidden; we only need its DOM
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

export default TitleSnap;
