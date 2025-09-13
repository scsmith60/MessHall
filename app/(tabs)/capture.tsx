// app/(tabs)/capture.tsx
// 🧒 "Like I'm 5" Guide:
// - Tap Import ➜ HUD shows radar that spins smoothly by itself.
// - If the picture fails, the Import button works again right away (we reset everything safely).
// - HUD now has little glowing targets so it looks alive.
// - TikTok still uses the super-reliable WebView snapper, and we gently fix tiny images.

import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image as RNImage,
  Animated,
  Easing,
  Dimensions,
  Modal,
  StyleSheet,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { Swipeable, RectButton } from "react-native-gesture-handler";
import { useFocusEffect } from "@react-navigation/native";

import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";

import { supabase } from "@/lib/supabase";
import { fetchOgForUrl } from "@/lib/og";
import { uploadFromUri } from "@/lib/uploads";
import { fetchMeta } from "@/lib/fetch_meta";
import { normalizeIngredientLines } from "@/lib/ingredients";
import { captionToIngredientLines } from "@/lib/caption_to_ingredients";

import TikTokSnap, { tiktokOEmbedThumbnail } from "@/lib/tiktok";
import TitleSnap from "@/lib/TitleSnap";

import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";

import Svg, { Line, Circle } from "react-native-svg";

/* ---------------------------- colors ---------------------------- */
const COLORS = {
  bg: "#0B1120",
  card: "#111827",
  sunken: "#1F2937",
  text: "#E5E7EB",
  sub: "#9CA3AF",
  accent: "#60A5FA",
  green: "#22c55e",
  red: "#EF4444",
  border: "#243042",
};
const MESSHALL_GREEN = "#2FAE66";

/* ---------------------------- tuning knobs ---------------------------- */
const CAPTURE_DELAY_MS = 700;
const BETWEEN_SHOTS_MS = 120;
const SNAP_ATTEMPTS = 3;

const MIN_IMG_W = 600;
const MIN_IMG_H = 600;
const SOFT_MIN_W = 360;
const SOFT_MIN_H = 360;

const MIN_LOCAL_BYTES = 30_000;
const IMPROVEMENT_FACTOR = 1.12;

const IMPORT_HARD_TIMEOUT_MS = 20000;
const ATTEMPT_TIMEOUT_FIRST_MS = 8000;
const ATTEMPT_TIMEOUT_SOFT_MS = 2200;

const FOCUS_Y_DEFAULT = 0.4;

/* ---------------------------- helpers ---------------------------- */
function extractFirstUrl(s: string): string | null {
  const m = (s || "").match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}
function isTikTokLike(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "www.tiktok.com" || host.endsWith(".tiktok.com") || host === "tiktok.com" || host === "vm.tiktok.com";
  } catch {
    return /tiktok\.com/i.test(url);
  }
}
function isWeakTitle(t?: string | null) {
  const s = (t || "").trim();
  return !s || /^tiktok$/i.test(s) || (/\btiktok\b/i.test(s) && /make your day/i.test(s)) || /^\d{6,}$/.test(s) || s.length < 4;
}
type ImageSourceState =
  | { kind: "none" }
  | { kind: "url-og"; url: string; resolvedImageUrl: string }
  | { kind: "picker"; localUri: string }
  | { kind: "camera"; localUri: string };

function ensureHttps(u: string) {
  return /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`;
}
function extractTikTokIdFromUrl(u: string): string | null {
  const m = u.match(/\/(?:video|photo)\/(\d{6,})/);
  return m ? m[1] : null;
}
async function resolveFinalUrl(u: string) {
  try {
    const r = await fetch(u, { method: "GET" });
    if ((r as any)?.url) return (r as any).url as string;
  } catch {}
  return u;
}
async function resolveTikTokEmbedUrl(rawUrl: string) {
  const start = ensureHttps(rawUrl.trim());
  const final = await resolveFinalUrl(start);
  let id = extractTikTokIdFromUrl(final);
  if (!id) {
    try {
      const res = await fetch(final);
      const html = await res.text();
      let m =
        html.match(/"videoId"\s*:\s*"(\d{6,})"/) ||
        html.match(/"itemId"\s*:\s*"(\d{6,})"/) ||
        html.match(/<link\s+rel="canonical"\s+href="https?:\/\/www\.tiktok\.com\/@[^\/]+\/(?:video|photo)\/(\d{6,})"/i);
      if (m) id = m[1];
    } catch {}
  }
  return { embedUrl: id ? `https://www.tiktok.com/embed/v2/${id}` : null, finalUrl: final };
}
function canonicalizeUrl(u: string): string {
  try {
    const raw = ensureHttps(u.trim());
    const url = new URL(raw);
    url.protocol = "https:";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const kill = ["fbclid", "gclid", "ref"];
    for (const [k] of url.searchParams.entries()) {
      if (k.toLowerCase().startsWith("utm_") || kill.includes(k)) url.searchParams.delete(k);
    }
    url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return u.trim();
  }
}
async function buildDuplicateCandidatesFromRaw(raw: string): Promise<string[]> {
  const ensured = ensureHttps(raw.trim());
  const finalResolved = await resolveFinalUrl(ensured);
  let tiktokFinal = finalResolved;
  if (isTikTokLike(finalResolved)) {
    const { finalUrl } = await resolveTikTokEmbedUrl(finalResolved);
    if (finalUrl) tiktokFinal = finalUrl;
  }
  const candidates = [ensured, finalResolved, tiktokFinal, canonicalizeUrl(ensured), canonicalizeUrl(finalResolved), canonicalizeUrl(tiktokFinal)]
    .filter(Boolean) as string[];
  return Array.from(new Set(candidates));
}
async function checkDuplicateSourceUrl(rawUrl: string): Promise<boolean> {
  try {
    const candidates = await buildDuplicateCandidatesFromRaw(rawUrl);
    if (!candidates.length) return false;
    const { data, error } = await supabase.from("recipes").select("id, title, source_url").in("source_url", candidates).limit(1);
    if (error) return false;
    return !!(data && data.length);
  } catch {
    return false;
  }
}
function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
async function fetchTitleQuick(url: string): Promise<string | null> {
  try {
    const res = await withTimeout(fetch(url), 6000);
    const html = await res.text();
    const m1 =
      html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+name=["']title["'][^>]*content=["']([^"']+)["']/i);
    const m2 = html.match(/<title[^>]*>([^<]{3,160})<\/title>/i);
    const candidate = decodeEntities((m1?.[1] || m2?.[1] || "").trim());
    return candidate || null;
  } catch {
    return null;
  }
}
async function fetchTikTokOEmbedTitle(url: string): Promise<string | null> {
  try {
    const { finalUrl } = await resolveTikTokEmbedUrl(url);
    const target = finalUrl || url;
    const o = await withTimeout(fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(target)}`), 5000);
    if (!o.ok) return null;
    const j = await o.json();
    const t: string | undefined = j?.title;
    return (t && t.trim()) || null;
  } catch {
    return null;
  }
}

/* ---------------------------- tiny anim helpers ---------------------------- */
function useLoop(duration = 1200, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: duration / 2, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, delay]);
  return v;
}
function useBlipAnims(count: number, baseDelay = 220) {
  const animsRef = useRef<Animated.Value[]>([]);
  if (animsRef.current.length !== count) {
    animsRef.current = Array.from({ length: count }, () => new Animated.Value(0));
  }
  useEffect(() => {
    // 🛠 FIX: run forever, not tied to steps
    const loops = animsRef.current.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * baseDelay),
          Animated.timing(v, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 800, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
          Animated.delay(300),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [count, baseDelay]);
  return animsRef.current;
}
function useSpin(duration = 1800) {
  // 🛠 FIX: spin is created once and never reset (smooth sweep)
  const v = useRef<Animated.Value | null>(null);
  if (!v.current) v.current = new Animated.Value(0);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v.current!, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [duration]);
  const deg = v.current!.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return { transform: [{ rotate: deg }] } as const;
}

/* ---------------------------- HUD overlay ---------------------------- */
const { width: SCREEN_W } = Dimensions.get("window");
const RADAR_SIZE = Math.min(SCREEN_W * 0.8, 340);
const BLIP_COUNT = 7; // a few sweet dots
type HUDPhase = "scanning" | "acquired";

function MilitaryImportOverlay({
  visible,
  phase = "scanning",
  stageIndex,
  steps = ["Importing photo", "Reading title", "Parsing ingredients", "Parsing steps"],
  headline = "SCANNING… STAND BY",
}: {
  visible: boolean;
  phase?: HUDPhase;
  stageIndex: number;
  steps?: string[];
  headline?: string;
}) {
  const spinStyle = useSpin(2000); // 🛠 FIX: runs smoothly on its own
  const centerPulse = useLoop(1400, 0);
  const blipAnims = useBlipAnims(BLIP_COUNT, 200);

  // make random target positions once (so they don't hop)
  const blipPositions = useMemo(() => {
    const arr: { x: number; y: number }[] = [];
    for (let i = 0; i < BLIP_COUNT; i++) {
      const r = (RADAR_SIZE / 2) * (0.22 + Math.random() * 0.68);
      const theta = Math.random() * Math.PI * 2;
      const x = RADAR_SIZE / 2 + r * Math.cos(theta);
      const y = RADAR_SIZE / 2 + r * Math.sin(theta);
      arr.push({ x, y });
    }
    return arr;
  }, []);

  const progressPct = Math.max(0, Math.min(stageIndex / steps.length, 1)) * 100;

  const acquiredAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible && phase === "acquired") {
      acquiredAnim.setValue(0);
      Animated.sequence([
        Animated.timing(acquiredAnim, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(acquiredAnim, { toValue: 0, duration: 640, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [visible, phase, acquiredAnim]);
  const acquiredScale = acquiredAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.06] });
  const acquiredOpacity = acquiredAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  if (!visible) return null;

  return (
    <Modal visible animationType="none" transparent statusBarTranslucent presentationStyle="overFullScreen" hardwareAccelerated>
      <View style={hudStyles.backdrop}>
        <View style={hudStyles.card}>
          <Text style={hudStyles.headline}>{phase === "acquired" ? "LOCK CONFIRMED" : headline}</Text>

          {/* radar */}
          <View style={hudStyles.radarWrap}>
            {/* rings + crosshair */}
            <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.48} stroke="rgba(47,174,102,0.18)" strokeWidth={1} fill="none" />
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.34} stroke="rgba(47,174,102,0.18)" strokeWidth={1} fill="none" />
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.20} stroke="rgba(47,174,102,0.18)" strokeWidth={1} fill="none" />
              <Line x1={RADAR_SIZE * 0.1} y1={RADAR_SIZE / 2} x2={RADAR_SIZE * 0.9} y2={RADAR_SIZE / 2} stroke="rgba(47,174,102,0.18)" strokeWidth={1} />
              <Line x1={RADAR_SIZE / 2} y1={RADAR_SIZE * 0.1} x2={RADAR_SIZE / 2} y2={RADAR_SIZE * 0.9} stroke="rgba(47,174,102,0.18)" strokeWidth={1} />
            </Svg>

            {/* 🛠 FIX: smooth sweeping beam (independent of steps) */}
            <Animated.View style={[hudStyles.beamPivot, spinStyle]}>
              <View style={hudStyles.beamArm} />
              <View style={hudStyles.beamGlow} />
            </Animated.View>

            {/* 🛠 FIX: add targets */}
            {blipPositions.map((pos, i) => {
              const a = blipAnims[i % blipAnims.length];
              const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.4] });
              const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
              return (
                <Animated.View
                  key={`blip-${i}`}
                  style={{
                    position: "absolute",
                    left: pos.x - 6,
                    top: pos.y - 6,
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: "rgba(47,174,102,0.9)",
                    opacity,
                    transform: [{ scale }],
                  }}
                />
              );
            })}

            {/* pulsing center dot */}
            <Animated.View
              style={[
                hudStyles.centerDot,
                { transform: [{ scale: centerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] }) }] },
              ]}
            />

            {/* acquired badge */}
            {phase === "acquired" && (
              <Animated.View style={[hudStyles.acquiredWrap, { opacity: acquiredOpacity, transform: [{ scale: acquiredScale }] }]}>
                <Text style={hudStyles.acquiredText}>TARGET ACQUIRED</Text>
              </Animated.View>
            )}
          </View>

          {/* steps + progress */}
          <View style={[hudStyles.stepsBox, phase === "acquired" && { opacity: 0.5 }]}>
            {steps.map((label, i) => {
              const done = i < stageIndex;
              const active = i === stageIndex;
              return (
                <View key={label} style={hudStyles.stepRow}>
                  <View
                    style={[
                      hudStyles.checkbox,
                      done && { backgroundColor: "rgba(46,204,113,0.2)", borderColor: MESSHALL_GREEN },
                      active && { borderColor: "#a7f3d0" },
                    ]}
                  >
                    {done ? <Text style={{ color: "#a7f3d0", fontSize: 14, fontWeight: "700" }}>✓</Text> : active ? <Text style={{ color: MESSHALL_GREEN, fontSize: 18, lineHeight: 18 }}>•</Text> : null}
                  </View>
                  <Text style={[hudStyles.stepText, done && { color: "#a7f3d0" }, active && { color: "#e2e8f0", fontWeight: "600" }]}>{label}</Text>
                </View>
              );
            })}
          </View>

          <View style={hudStyles.progressOuter}>
            <View style={[hudStyles.progressInner, { width: `${progressPct}%` }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const hudStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 540, backgroundColor: COLORS.bg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "rgba(147,197,114,0.15)" },
  headline: { color: "#d1fae5", fontSize: 18, textAlign: "center", letterSpacing: 1, marginBottom: 12 },
  radarWrap: { alignSelf: "center", width: RADAR_SIZE, height: RADAR_SIZE, alignItems: "center", justifyContent: "center", marginBottom: 12, overflow: "hidden", borderRadius: RADAR_SIZE / 2, backgroundColor: "rgba(20,31,25,0.35)" },
  beamPivot: { position: "absolute", left: 0, top: 0, width: RADAR_SIZE, height: RADAR_SIZE },
  beamArm: { position: "absolute", left: RADAR_SIZE / 2, top: RADAR_SIZE / 2 - 1, width: RADAR_SIZE / 2, height: 2, backgroundColor: "rgba(47,174,102,0.9)" },
  beamGlow: { position: "absolute", left: RADAR_SIZE / 2, top: RADAR_SIZE / 2 - 8, width: RADAR_SIZE / 2, height: 16, backgroundColor: "rgba(47,174,102,0.12)" },
  centerDot: { position: "absolute", width: 10, height: 10, borderRadius: 6, backgroundColor: MESSHALL_GREEN },
  acquiredWrap: { position: "absolute", top: "42%", alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)" },
  acquiredText: { color: "#fef08a", fontSize: 22, fontWeight: "900", letterSpacing: 1.2 },
  stepsBox: { backgroundColor: "rgba(46,204,113,0.06)", borderColor: "rgba(46,204,113,0.15)", borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 12 },
  stepRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: "rgba(46,204,113,0.35)", marginRight: 8, alignItems: "center", justifyContent: "center" },
  stepText: { color: "#cbd5e1", fontSize: 14 },
  progressOuter: { height: 10, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(46,204,113,0.1)", borderWidth: 1, borderColor: "rgba(46,204,113,0.2)" },
  progressInner: { height: "100%", backgroundColor: MESSHALL_GREEN },
});

/* ---------------------------- abort popup ---------------------------- */
function MissionAbortedPopup({
  visible,
  text = "MISSION ABORTED",
  onRequestClose,
}: {
  visible: boolean;
  text?: string;
  onRequestClose: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 180, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 0.96, duration: 120, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, scale]);
  if (!visible) return null;
  return (
    <Modal transparent statusBarTranslucent animationType="none">
      <TouchableWithoutFeedback onPress={onRequestClose}>
        <View style={abortStyles.backdrop}>
          <Animated.View style={[abortStyles.pillWrap, { opacity, transform: [{ scale }] }]}>
            <Text style={abortStyles.pillText}>{text}</Text>
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
const abortStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 24 },
  pillWrap: { paddingVertical: 14, paddingHorizontal: 24, borderRadius: 999, backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: COLORS.red, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  pillText: { color: COLORS.red, fontSize: 18, fontWeight: "900", letterSpacing: 1.2, textAlign: "center" },
});

/* ---------------------------- image fixer ---------------------------- */
async function getLocalDimensions(uri: string): Promise<{ w: number; h: number }> {
  try {
    const r = await ImageManipulator.manipulateAsync(uri, [], { compress: 0, format: ImageManipulator.SaveFormat.JPEG });
    return { w: r.width ?? 0, h: r.height ?? 0 };
  } catch {
    return { w: 0, h: 0 };
  }
}
async function ensureMinLocalImage(uri: string, wantW = MIN_IMG_W, wantH = MIN_IMG_H): Promise<string | null> {
  const { w, h } = await getLocalDimensions(uri);
  if (!w || !h) return null;
  if (w >= wantW && h >= wantH) return uri;
  if (w >= SOFT_MIN_W && h >= SOFT_MIN_H) {
    const scale = Math.max(wantW / w, wantH / h);
    const newW = Math.round(w * scale);
    const newH = Math.round(h * scale);
    try {
      const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: newW, height: newH } }], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
      return out.uri || null;
    } catch {
      return null;
    }
  }
  return null;
}

/* ---------------------------- main screen ---------------------------- */
export default function CaptureScreen() {
  const [pastedUrl, setPastedUrl] = useState("");
  const [title, setTitle] = useState("");
  const [timeMinutes, setTimeMinutes] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState<string[]>([""]);
  const [steps, setSteps] = useState<string[]>([""]);
  const [img, setImg] = useState<ImageSourceState>({ kind: "none" });

  // HUD
  const [hudVisible, setHudVisible] = useState(false);
  const [hudPhase, setHudPhase] = useState<HUDPhase>("scanning");

  // saving spinner
  const [saving, setSaving] = useState(false);

  // TikTok snapper
  const [snapVisible, setSnapVisible] = useState(false);
  const [snapUrl, setSnapUrl] = useState("");
  const [snapReloadKey, setSnapReloadKey] = useState(0);
  const [snapResnapKey, setSnapResnapKey] = useState(0);
  const [improvingSnap, setImprovingSnap] = useState(false);

  // TitleSnap
  const [titleSnapVisible, setTitleSnapVisible] = useState(false);
  const [queuedTitleSnapUrl, setQueuedTitleSnapUrl] = useState<string | null>(null);

  // import flow
  const [pendingImportUrl, setPendingImportUrl] = useState<string | null>(null);
  const [abortVisible, setAbortVisible] = useState(false);

  const snapResolverRef = useRef<null | ((uri: string) => void)>(null);
  const snapRejectRef = useRef<null | ((e: any) => void)>(null);
  const snapCancelledRef = useRef(false);

  const importRunIdRef = useRef(0);
  const gotSomethingForRunRef = useRef(false);
  const lastResolvedUrlRef = useRef<string>("");
  const lastGoodPreviewRef = useRef<string>("");

  const getImageDims = useCallback(async (uri: string) => {
    if (!uri) return { w: 0, h: 0 };
    if (uri.startsWith("file://")) return await getLocalDimensions(uri);
    return await new Promise<{ w: number; h: number }>((ok) => RNImage.getSize(uri, (w, h) => ok({ w, h }), () => ok({ w: 0, h: 0 })));
  }, []);

  const validateOrRepairLocal = useCallback(async (uri: string): Promise<string | null> => {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || (info.size ?? 0) < MIN_LOCAL_BYTES) {
        const resaved = await ImageManipulator.manipulateAsync(uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }).catch(() => null);
        if (!resaved?.uri) return null;
        uri = resaved.uri;
      }
    } catch {
      return null;
    }
    const fixed = await ensureMinLocalImage(uri, MIN_IMG_W, MIN_IMG_H);
    return fixed;
  }, []);

  const isValidCandidate = useCallback(async (uri: string): Promise<{ ok: boolean; useUri?: string }> => {
    if (!uri) return { ok: false };
    if (uri.startsWith("file://")) {
      const fixed = await validateOrRepairLocal(uri);
      if (!fixed) return { ok: false };
      const { w, h } = await getImageDims(fixed);
      if (w < MIN_IMG_W || h < MIN_IMG_H) return { ok: false };
      return { ok: true, useUri: fixed };
    } else {
      try { await withTimeout(RNImage.prefetch(uri), 1800).catch(() => null); } catch {}
      const { w, h } = await getImageDims(uri);
      if ((w >= MIN_IMG_W && h >= MIN_IMG_H) || (w === 0 && h === 0)) return { ok: true, useUri: uri };
      try {
        const dl = await FileSystem.downloadAsync(uri, FileSystem.cacheDirectory + `snap_${Date.now()}.jpg`);
        const fixed = await validateOrRepairLocal(dl.uri);
        if (fixed) return { ok: true, useUri: fixed };
      } catch {}
      return { ok: false };
    }
  }, [getImageDims, validateOrRepairLocal]);

  const currentPreviewUri = useCallback(() => {
    if (img.kind === "url-og") return img.resolvedImageUrl;
    if (img.kind === "picker" || img.kind === "camera") return img.localUri;
    return "";
  }, [img]);

  const IMPORT_STEPS = ["Importing photo", "Reading title", "Parsing ingredients", "Parsing steps"];
  const [stageIndex, setStageIndex] = useState(0);
  const bumpStage = useCallback((n: number) => setStageIndex((s) => (n > s ? n : s)), []);

  const setGoodPreview = useCallback((uri: string, originUrl: string) => {
    bumpStage(1);
    if (uri.startsWith("http")) setImg({ kind: "url-og", url: originUrl, resolvedImageUrl: uri });
    else setImg({ kind: "picker", localUri: uri });
    lastGoodPreviewRef.current = uri;
    lastResolvedUrlRef.current = originUrl;
    gotSomethingForRunRef.current = true;
  }, [bumpStage]);

  const maybeUpgradePreview = useCallback(async (candidate: string, originUrl: string) => {
    const test = await isValidCandidate(candidate);
    if (!test.ok || !test.useUri) return;
    const cur = currentPreviewUri();
    if (!cur) return setGoodPreview(test.useUri, originUrl);
    const [a, b] = await Promise.all([getImageDims(cur), getImageDims(test.useUri)]);
    if (b.w * b.h > a.w * a.h * IMPROVEMENT_FACTOR) setGoodPreview(test.useUri, originUrl);
  }, [currentPreviewUri, getImageDims, isValidCandidate, setGoodPreview]);

  // 🛠 FIX: hard reset so Import can be tapped again (clears any stuck overlays/locks)
  const hardResetImport = useCallback(() => {
    snapCancelledRef.current = false;
    snapResolverRef.current = null;
    snapRejectRef.current = null;
    setHudVisible(false);
    setHudPhase("scanning");
    setSnapVisible(false);
    setTitleSnapVisible(false);
    setQueuedTitleSnapUrl(null);
    setImprovingSnap(false);
    setAbortVisible(false);
    setStageIndex(0);
  }, []);

  // ⬇️ Removed the old “bump HUD layer” key logic so the beam stays smooth.

  useEffect(() => {
    if (hudVisible && pendingImportUrl) {
      const url = pendingImportUrl;
      setPendingImportUrl(null);
      (async () => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await startImport(url);
      })();
    }
  }, [hudVisible, pendingImportUrl]); // do not add other deps

  const autoSnapTikTok = useCallback(async (rawUrl: string, maxAttempts = SNAP_ATTEMPTS) => {
    const { embedUrl, finalUrl } = await resolveTikTokEmbedUrl(rawUrl);
    const target = embedUrl || ensureHttps(rawUrl);
    lastResolvedUrlRef.current = finalUrl || rawUrl;

    snapCancelledRef.current = false;
    setSnapUrl(target);
    setSnapVisible(true);
    setImprovingSnap(true);

    let best: string | null = null;

    for (let i = 1; i <= maxAttempts; i++) {
      if (snapCancelledRef.current) break;
      if (i === 1) setSnapReloadKey((k) => k + 1);
      else setSnapResnapKey((k) => k + 1);

      const attemptPromise: Promise<string | null> = new Promise((resolve, reject) => {
        snapResolverRef.current = (uri) => resolve(uri);
        snapRejectRef.current = (e) => reject(e);
      }).then((u) => u as string).catch(() => null);

      const timeoutMs = i === 1 ? ATTEMPT_TIMEOUT_FIRST_MS : ATTEMPT_TIMEOUT_SOFT_MS;
      const winner = await Promise.race([attemptPromise, new Promise<string | null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);

      if (winner) {
        gotSomethingForRunRef.current = true;
        const fixed = await validateOrRepairLocal(winner);
        if (fixed) {
          const dims = await getImageDims(fixed);
          if (dims.w >= MIN_IMG_W && dims.h >= MIN_IMG_H) {
            setGoodPreview(fixed, lastResolvedUrlRef.current);
            best = fixed;
            break;
          }
        }
        const test = await isValidCandidate(winner);
        if (test.ok && test.useUri) {
          setGoodPreview(test.useUri, lastResolvedUrlRef.current);
          best = test.useUri;
          break;
        }
      }
      if (snapCancelledRef.current) break;
      await new Promise((r) => setTimeout(r, BETWEEN_SHOTS_MS));
    }

    setImprovingSnap(false);
    return best;
  }, [getImageDims, setGoodPreview, validateOrRepairLocal, isValidCandidate]);

  const tryImageUrl = useCallback(async (url: string, originUrl: string) => {
    const test = await isValidCandidate(url);
    if (test.ok && test.useUri) {
      bumpStage(1);
      if (test.useUri.startsWith("http")) setImg({ kind: "url-og", url: originUrl, resolvedImageUrl: test.useUri });
      else setImg({ kind: "picker", localUri: test.useUri });
      lastGoodPreviewRef.current = test.useUri;
      lastResolvedUrlRef.current = originUrl;
      gotSomethingForRunRef.current = true;
      return true;
    }
    return false;
  }, [isValidCandidate, bumpStage]);

  const startImport = useCallback(async (url: string) => {
    const runId = ++importRunIdRef.current;
    gotSomethingForRunRef.current = false;

    const watchdog = setTimeout(() => {
      if (importRunIdRef.current !== runId) return;
      if (!gotSomethingForRunRef.current) {
        // 🛠 FIX: ensure everything is fully closed so Import is tappable again
        hardResetImport();
        Alert.alert("Import took too long", "We tried our best. You can try again.");
      }
    }, IMPORT_HARD_TIMEOUT_MS);

    let success = false;
    try {
      lastResolvedUrlRef.current = url;

      fetchTitleQuick(url).then((t) => t && setTitle((prev) => (isWeakTitle(prev) ? t : prev))).catch(() => {});
      if (isTikTokLike(url)) fetchTikTokOEmbedTitle(url).then((t) => t && setTitle((prev) => (isWeakTitle(prev) ? t : prev))).catch(() => {});

      if (isTikTokLike(url)) {
        const shot = await autoSnapTikTok(url, SNAP_ATTEMPTS);
        if (shot) success = true;
      }

      const metaP = fetchMeta(url);
      const ogP = fetchOgForUrl(url);
      setStageIndex((s) => Math.max(s, 2));

      const [metaRes, ogRes] = await Promise.allSettled([metaP, ogP]);
      const meta = metaRes.status === "fulfilled" ? metaRes.value : null;
      const og   = ogRes.status === "fulfilled" ? ogRes.value   : null;

      const candT = (meta?.title || og?.title || "").trim();
      if (candT) setTitle((prev) => (isWeakTitle(prev) ? candT : prev));

      if (meta?.ingredients?.length) {
        const parsed = normalizeIngredientLines(meta.ingredients);
        const canon = parsed.map((p) => p.canonical).filter(Boolean);
        if (canon.length) setIngredients(canon);
      } else if (meta?.caption) {
        const guess = captionToIngredientLines(meta.caption);
        if (guess.length) setIngredients(guess);
      }
      setStageIndex((s) => Math.max(s, 3));
      if (meta?.steps?.length) setSteps(meta.steps.filter(Boolean));
      setStageIndex((s) => Math.max(s, 4));

      if (!success && !gotSomethingForRunRef.current) {
        let used = false;
        if (meta?.image) used = await tryImageUrl(meta.image, url);
        if (!used && og?.image) used = await tryImageUrl(og.image, url);
        if (!used && isTikTokLike(url)) {
          const thumb = await withTimeout(tiktokOEmbedThumbnail(url), 2000).catch(() => null);
          if (thumb) used = await tryImageUrl(thumb, url);
        }
        if (used) success = true;
      }
    } catch (e: any) {
      if (!gotSomethingForRunRef.current) setImg({ kind: "none" });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Import error", e?.message || "Could not read that webpage.");
    } finally {
      clearTimeout(watchdog);

      if (success || gotSomethingForRunRef.current) {
        setHudPhase("acquired");
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await new Promise((r) => setTimeout(r, 800));
      }

      // 🛠 FIX: always close everything so Import is free to be tapped again
      setHudVisible(false);
      setTitleSnapVisible(false);
      setSnapVisible(false);
    }
  }, [autoSnapTikTok, tryImageUrl, hardResetImport]);

  const resolveOg = useCallback(async (raw: string) => {
    // 🛠 FIX: clean up any stuck overlays BEFORE starting new import
    hardResetImport();

    const url = extractFirstUrl(raw?.trim() || "");
    if (!url) {
      setImg({ kind: "none" });
      return Alert.alert("Link error", "Please paste a full link that starts with http(s)://");
    }

    const isDup = await checkDuplicateSourceUrl(url);
    if (isDup) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setAbortVisible(true);
      setTimeout(() => setAbortVisible(false), 1700);
      return;
    }

    setStageIndex(0);
    setHudPhase("scanning");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (isTikTokLike(url) && isWeakTitle(title)) {
      setQueuedTitleSnapUrl(url);
      setTitleSnapVisible(true);
    }
    if (isTikTokLike(url)) {
      const { embedUrl } = await resolveTikTokEmbedUrl(url);
      setSnapUrl(embedUrl || ensureHttps(url));
      setSnapVisible(true);
    }

    // IMPORTANT: open HUD last so it sits on top; we don't remount it afterwards.
    setHudVisible(true);
    setPendingImportUrl(url);
  }, [title, hardResetImport]);

  const onPaste = useCallback(async () => {
    const t = await Clipboard.getStringAsync();
    if (t) setPastedUrl(t.trim());
  }, []);

  const pickOrCamera = useCallback(async () => {
    Alert.alert("Add Photo", "Choose where to get your picture", [
      {
        text: "Camera",
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") return Alert.alert("Camera permission is required.");
          const r = await ImagePicker.launchCameraAsync({ quality: 0.92, allowsEditing: true, aspect: [4, 3] });
          if (!r.canceled && r.assets?.[0]?.uri) setImg({ kind: "camera", localUri: r.assets[0].uri });
        },
      },
      {
        text: "Gallery",
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") return Alert.alert("Photo permission is required.");
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.92, allowsEditing: true, aspect: [4, 3] });
          if (!r.canceled && r.assets?.[0]?.uri) setImg({ kind: "picker", localUri: r.assets[0].uri });
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  const previewUri = useMemo(() => currentPreviewUri(), [currentPreviewUri]);

  const onSave = useCallback(async () => {
    if (!title.trim()) return Alert.alert("Please add a title");
    setSaving(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const cleanedSourceUrl = lastResolvedUrlRef.current ? canonicalizeUrl(lastResolvedUrlRef.current) : null;

      const { data: created, error: createErr } = await supabase
        .from("recipes")
        .insert({ title: title.trim(), minutes: timeMinutes ? Number(timeMinutes) : null, servings: servings ? Number(servings) : null, source_url: cleanedSourceUrl })
        .select("id")
        .single();

      if (createErr) throw createErr;
      const recipeId = created?.id as string;
      if (!recipeId) throw new Error("Could not create recipe.");

      if (previewUri) {
        const path = `recipes/${recipeId}/images/${Date.now()}.jpg`;
        const publicUrl = await uploadFromUri({ uri: previewUri, storageBucket: "recipe-images", path, contentType: "image/jpeg" });
        await supabase.from("recipes").update({ image_url: publicUrl }).eq("id", recipeId);
      }

      const ing = ingredients.map((s) => (s || "").trim()).filter(Boolean);
      if (ing.length) await supabase.from("recipe_ingredients").insert(ing.map((text, i) => ({ recipe_id: recipeId, pos: i + 1, text })));

      const stp = steps.map((s) => (s || "").trim()).filter(Boolean);
      if (stp.length) await supabase.from("recipe_steps").insert(stp.map((text, i) => ({ recipe_id: recipeId, pos: i + 1, text, seconds: null })));

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved!");
    } catch (e: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Save failed", e?.message ?? "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [title, timeMinutes, servings, ingredients, steps, previewUri]);

  const renderRightActions = (onDelete: () => void) => (
    <View style={styles.swipeRightActionContainer}>
      <RectButton onPress={onDelete} style={styles.swipeDeleteButton}>
        <Text style={styles.swipeDeleteText}>Delete</Text>
      </RectButton>
    </View>
  );

  const resetForm = useCallback(() => {
    setPastedUrl("");
    setTitle("");
    setTimeMinutes("");
    setServings("");
    setIngredients([""]);
    setSteps([""]);
    setImg({ kind: "none" });
    hardResetImport();
  }, [hardResetImport]);

  useFocusEffect(
    useCallback(() => {
      return () => { resetForm(); };
    }, [resetForm])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
          <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900", marginBottom: 16 }}>Add Recipe</Text>

          {/* Title */}
          <Text style={{ color: COLORS.text, marginBottom: 6 }}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="My Tasty Pizza"
            placeholderTextColor="#64748b"
            style={{ color: "white", backgroundColor: COLORS.sunken, borderRadius: 12, padding: 12, marginBottom: 12 }}
          />

          {/* Import box */}
          <View style={{ backgroundColor: COLORS.card, borderRadius: 14, borderColor: COLORS.border, borderWidth: 1, padding: 12, marginBottom: 12 }}>
            <Text style={{ color: COLORS.sub, marginBottom: 6 }}>Import from a link (YouTube/TikTok/blog)…</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <TextInput
                value={pastedUrl}
                onChangeText={setPastedUrl}
                placeholder="Paste page URL…"
                placeholderTextColor={COLORS.sub}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ flex: 1, color: COLORS.text, backgroundColor: COLORS.sunken, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginRight: 8 }}
              />
              <TouchableOpacity
                onPress={onPaste}
                disabled={hudVisible}
                style={{ backgroundColor: COLORS.sunken, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginRight: 8, opacity: hudVisible ? 0.6 : 1 }}
              >
                <Text style={{ color: COLORS.text, fontWeight: "600" }}>Paste</Text>
              </TouchableOpacity>

              {/* 🛠 FIX: This button is only disabled while HUD is showing.
                  We also hard-reset before each run so you can tap again if last try failed. */}
              <TouchableOpacity
                onPress={() => resolveOg(pastedUrl)}
                disabled={hudVisible}
                style={{ backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, opacity: hudVisible ? 0.6 : 1 }}
              >
                <Text style={{ color: "#0B1120", fontWeight: "700" }}>{hudVisible ? "Importing…" : "Import"}</Text>
              </TouchableOpacity>
            </View>

            {/* Preview */}
            <View style={{ marginTop: 10 }}>
              {!hudVisible ? (
                (() => {
                  const uri = currentPreviewUri();
                  return uri ? (
                    <>
                      <Image source={{ uri }} style={{ width: "100%", height: 220, borderRadius: 12 }} contentFit="cover" />
                      {improvingSnap && <Text style={{ color: COLORS.sub, marginTop: 6, textAlign: "center" }}>Improving image…</Text>}
                    </>
                  ) : (
                    <View style={{ height: 220, borderRadius: 12, backgroundColor: COLORS.sunken, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ color: COLORS.sub }}>No imported image yet</Text>
                    </View>
                  );
                })()
              ) : null}
            </View>
          </View>

          {/* Add your own photo */}
          <TouchableOpacity onPress={pickOrCamera} style={{ backgroundColor: COLORS.card, padding: 12, borderRadius: 12, alignItems: "center", marginBottom: 12 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>Add/Choose Photo…</Text>
          </TouchableOpacity>

          {/* Ingredients */}
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>Ingredients</Text>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 }}>
            {ingredients.map((ing, i) => (
              <Swipeable key={`ing-${i}`} renderRightActions={() => renderRightActions(() => setIngredients((a) => a.filter((_, idx) => idx !== i)))} overshootRight={false} friction={2}>
                <View style={styles.row}>
                  <Text style={styles.rowIndex}>{i + 1}.</Text>
                  <TextInput
                    value={ing}
                    onChangeText={(v) => setIngredients((a) => a.map((x, idx) => (idx === i ? v : x)))}
                    placeholder="2 cups flour…"
                    placeholderTextColor="#64748b"
                    style={styles.rowInput}
                  />
                </View>
                {i !== ingredients.length - 1 && <View style={styles.thinLine} />}
              </Swipeable>
            ))}
          </View>
          <TouchableOpacity onPress={() => setIngredients((a) => [...a, ""])} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center", marginBottom: 16 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Ingredient</Text>
          </TouchableOpacity>

          {/* Steps */}
          <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "900", marginBottom: 8 }}>Steps</Text>
          <View style={{ backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 }}>
            {steps.map((st, i) => (
              <Swipeable key={`step-${i}`} renderRightActions={() => renderRightActions(() => setSteps((a) => a.filter((_, idx) => idx !== i)))} overshootRight={false} friction={2}>
                <View style={styles.row}>
                  <Text style={styles.rowIndex}>{i + 1}.</Text>
                  <TextInput
                    value={st}
                    onChangeText={(t) => setSteps((a) => a.map((x, idx) => (idx === i ? t : x)))}
                    placeholder="Mix everything…"
                    placeholderTextColor="#64748b"
                    multiline
                    style={[styles.rowInput, { minHeight: 60 }]}
                  />
                </View>
                {i !== steps.length - 1 && <View style={styles.thinLine} />}
              </Swipeable>
            ))}
          </View>
          <TouchableOpacity onPress={() => setSteps((a) => [...a, ""])} style={{ marginTop: 6, backgroundColor: COLORS.card, paddingVertical: 12, borderRadius: 12, alignItems: "center", marginBottom: 24 }}>
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>+ Add Step</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Save bar */}
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: COLORS.bg, borderTopWidth: 1, borderColor: COLORS.border }}>
          <TouchableOpacity
            onPress={onSave}
            disabled={saving}
            style={{ backgroundColor: saving ? "#475569" : COLORS.green, paddingVertical: 14, borderRadius: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, opacity: saving ? 0.7 : 1 }}
          >
            {saving && <ActivityIndicator size="small" color="#fff" />}
            <Text style={{ color: "#fff", fontWeight: "800" }}>{saving ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>

        {/* TikTok snapper */}
        <TikTokSnap
          url={snapUrl}
          visible={snapVisible}
          reloadKey={snapReloadKey}
          resnapKey={snapResnapKey}
          zoom={1.55}
          focusY={FOCUS_Y_DEFAULT}
          captureDelayMs={CAPTURE_DELAY_MS}
          onCancel={() => {
            snapCancelledRef.current = true;
            setSnapVisible(false);
            setImprovingSnap(false);
            if (snapRejectRef.current) {
              snapRejectRef.current(new Error("snap-cancelled"));
              snapRejectRef.current = null;
            }
          }}
          onFound={async (uri) => {
            gotSomethingForRunRef.current = true;
            const fixed = await validateOrRepairLocal(uri);
            if (fixed) setGoodPreview(fixed, lastResolvedUrlRef.current);
            else {
              const test = await isValidCandidate(uri);
              if (test.ok && test.useUri) setGoodPreview(test.useUri, lastResolvedUrlRef.current);
            }
            if (snapResolverRef.current) {
              const resolve = snapResolverRef.current;
              snapResolverRef.current = null;
              if (snapRejectRef.current) snapRejectRef.current = null;
              resolve(fixed || uri);
            } else {
              (async () => {
                if (fixed) await maybeUpgradePreview(fixed, lastResolvedUrlRef.current);
                else await maybeUpgradePreview(uri, lastResolvedUrlRef.current);
              })();
            }
          }}
        />

        {/* TitleSnap */}
        <TitleSnap
          visible={titleSnapVisible}
          url={queuedTitleSnapUrl || ""}
          onFound={(good) => {
            if (good) setTitle((prev) => (isWeakTitle(prev) ? good : prev));
            setTitleSnapVisible(false);
            setQueuedTitleSnapUrl(null);
          }}
          onClose={() => {
            setTitleSnapVisible(false);
            setQueuedTitleSnapUrl(null);
          }}
        />

        {/* HUD */}
        <MilitaryImportOverlay visible={hudVisible} phase={hudPhase} stageIndex={stageIndex} steps={IMPORT_STEPS} headline="SCANNING… STAND BY" />

        {/* duplicate popup */}
        <MissionAbortedPopup visible={abortVisible} onRequestClose={() => setAbortVisible(false)} text="MISSION ABORTED" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------------------- styles ---------------------------- */
const styles = StyleSheet.create({
  swipeRightActionContainer: { justifyContent: "center", alignItems: "flex-end" },
  swipeDeleteButton: { backgroundColor: COLORS.red, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", minWidth: 88, borderTopRightRadius: 12, borderBottomRightRadius: 12 },
  swipeDeleteText: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 10 },
  rowIndex: { color: COLORS.sub, width: 22, textAlign: "right", marginRight: 6 },
  rowInput: { flex: 1, color: COLORS.text, backgroundColor: COLORS.sunken, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16, borderWidth: 1, borderColor: COLORS.border },
  thinLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border, marginHorizontal: 10 },
});
