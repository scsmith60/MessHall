// components/MilitaryImportOverlay.tsx
// 💂 "Military HUD" Import Overlay
// Think: Big green screen with a radar-ish reticle, pulsing dots, progress bar, and step checkmarks.
// We show this ON TOP of your screen while we import stuff, so users see something fun instead of a static image.

// ==============================
// 1) Imports we need
// ==============================
import React, { useEffect, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import Svg, { Line, Circle } from "react-native-svg";

// ==============================
// 2) Simple color theme (tweak if you want)
// ==============================
const MESSHALL_GREEN = "#2FAE66"; // <- use your brand green here
const BG = "#0f172a";             // slate-900 vibe
const GRID = "rgba(47, 174, 102, 0.15)"; // soft green lines

// ==============================
// 3) Tiny helper: random blip positions (little dots)
// ==============================
const { width: SCREEN_W } = Dimensions.get("window");
const RADAR_SIZE = Math.min(SCREEN_W * 0.8, 340); // keep it nicely sized

type Props = {
  // Show or hide the overlay
  visible: boolean;

  // Which step are we on right now? (0 = nothing done yet)
  // Example mapping:
  // 0: starting...
  // 1: photo done
  // 2: title done
  // 3: ingredients done
  // 4: steps done (finished)
  stageIndex: number;

  // The list of steps to show/check off
  steps?: string[];

  // User can cancel if you want (optional)
  onCancel?: () => void;

  // Nice: optional headline text
  headline?: string;
};

const DEFAULT_STEPS = [
  "Importing photo",
  "Reading title",
  "Parsing ingredients",
  "Parsing steps",
];

export default function MilitaryImportOverlay({
  visible,
  stageIndex,
  steps = DEFAULT_STEPS,
  onCancel,
  headline = "SCANNING… STAND BY",
}: Props) {
  // ==============================
  // 4) Animations: grid glow, reticle pulse, little "blips"
  // ==============================
  const pulse = React.useRef(new Animated.Value(0)).current; // 0→1 loop
  const shimmer = React.useRef(new Animated.Value(0)).current; // for the progress shimmer

  useEffect(() => {
    // Reticle pulse loop (makes the center glow breathe)
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
      ])
    );
    pulseLoop.start();

    // Progress shimmer loop
    const shimLoop = Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 1600, useNativeDriver: true, easing: Easing.linear })
    );
    shimLoop.start();

    return () => {
      pulseLoop.stop();
      shimLoop.stop();
    };
  }, [pulse, shimmer]);

  // Make 5 pulsing "blips"
  const blips = useMemo(() => {
    return new Array(5).fill(0).map((_, i) => {
      const a = new Animated.Value(0);
      // Each blip gets its own offset so they don't all pulse together
      const delay = 200 * i;
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(a, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
          Animated.timing(a, { toValue: 0, duration: 800, useNativeDriver: true, easing: Easing.in(Easing.quad) }),
          Animated.delay(600),
        ])
      ).start();
      // random position inside the circle
      const r = (RADAR_SIZE / 2) * (0.2 + Math.random() * 0.75);
      const theta = Math.random() * Math.PI * 2;
      const x = RADAR_SIZE / 2 + r * Math.cos(theta);
      const y = RADAR_SIZE / 2 + r * Math.sin(theta);
      return { a, x, y, key: `blip-${i}` };
    });
  }, []);

  // Progress math (0..1)
  const clamped = Math.max(0, Math.min(stageIndex / steps.length, 1));

  // Animated width for progress bar
  const progressWidth = useMemo(() => new Animated.Value(0), []);
  useEffect(() => {
    Animated.timing(progressWidth, {
      toValue: clamped,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // width can't use native driver
    }).start();
  }, [clamped, progressWidth]);

  // Shimmer translate for progress bar
  const shimmerX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: ["-30%", "130%"],
  });

  // Pulse scale for center dot
  const centerScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.2],
  });

  // ==============================
  // 5) UI
  // ==============================
  return (
    <Modal visible={visible} animationType="fade" transparent>
      {/* Dark see-through background */}
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Headline: "Scanning…" */}
          <Text style={styles.headline}>{headline}</Text>

          {/* Radar/HUD block */}
          <View style={styles.radarWrap}>
            <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
              {/* Concentric rings (like sonar) */}
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.48} stroke={GRID} strokeWidth={1} fill="none" />
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.34} stroke={GRID} strokeWidth={1} fill="none" />
              <Circle cx={RADAR_SIZE / 2} cy={RADAR_SIZE / 2} r={RADAR_SIZE * 0.20} stroke={GRID} strokeWidth={1} fill="none" />

              {/* Crosshair lines */}
              <Line x1={RADAR_SIZE * 0.1} y1={RADAR_SIZE / 2} x2={RADAR_SIZE * 0.9} y2={RADAR_SIZE / 2} stroke={GRID} strokeWidth={1} />
              <Line x1={RADAR_SIZE / 2} y1={RADAR_SIZE * 0.1} x2={RADAR_SIZE / 2} y2={RADAR_SIZE * 0.9} stroke={GRID} strokeWidth={1} />

              {/* Little blips (animated via opacity & scale) */}
              {blips.map((b) => {
                const rAnim = b.a.interpolate({ inputRange: [0, 1], outputRange: [3, 6] });
                const opacity = b.a.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });
                return (
                  <AnimatedCircle
                    key={b.key}
                    cx={b.x}
                    cy={b.y}
                    r={rAnim as any}
                    fill={MESSHALL_GREEN}
                    opacity={opacity as any}
                  />
                );
              })}
            </Svg>

            {/* Center glowing dot (Animated.View on top of SVG) */}
            <Animated.View
              style={[
                styles.centerDot,
                {
                  transform: [{ scale: centerScale }],
                  shadowColor: MESSHALL_GREEN,
                },
              ]}
            />
          </View>

          {/* Step checklist */}
          <View style={styles.stepsBox}>
            {steps.map((label, i) => {
              const done = i < stageIndex;
              const active = i === stageIndex;
              return (
                <View key={label} style={styles.stepRow}>
                  <View style={[styles.checkbox, done && styles.checkboxDone, active && styles.checkboxActive]}>
                    {done ? <Text style={styles.checkmark}>✓</Text> : active ? <Text style={styles.dot}>•</Text> : null}
                  </View>
                  <Text style={[styles.stepText, done && styles.stepTextDone, active && styles.stepTextActive]}>
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Progress bar */}
          <View style={styles.progressOuter}>
            <Animated.View style={[styles.progressInner, { width: progressWidth.interpolate({
              inputRange: [0, 1],
              outputRange: ["0%", "100%"],
            }) }]} />
            {/* Shimmer sweep */}
            <Animated.View style={[styles.progressShimmer, { transform: [{ translateX: shimmerX }] }]} />
          </View>

          {/* Optional Cancel */}
          {onCancel ? (
            <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// We need an Animated SVG Circle for blips
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ==============================
// 6) Pretty styles
// ==============================
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 540,
    backgroundColor: BG,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(147, 197, 114, 0.15)",
  },
  headline: {
    color: "#d1fae5",
    fontSize: 18,
    textAlign: "center",
    letterSpacing: 1,
    marginBottom: 12,
  },
  radarWrap: {
    alignSelf: "center",
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  centerDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 6,
    backgroundColor: MESSHALL_GREEN,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  stepsBox: {
    backgroundColor: "rgba(46, 204, 113, 0.06)",
    borderColor: "rgba(46, 204, 113, 0.15)",
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(46, 204, 113, 0.35)",
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxDone: {
    backgroundColor: "rgba(46, 204, 113, 0.2)",
    borderColor: MESSHALL_GREEN,
  },
  checkboxActive: {
    borderColor: "#a7f3d0",
  },
  checkmark: {
    color: "#a7f3d0",
    fontSize: 14,
    fontWeight: "700",
  },
  dot: {
    color: MESSHALL_GREEN,
    fontSize: 20,
    lineHeight: 20,
  },
  stepText: {
    color: "#cbd5e1",
    fontSize: 14,
  },
  stepTextDone: {
    color: "#a7f3d0",
    textDecorationLine: "none",
  },
  stepTextActive: {
    color: "#e2e8f0",
    fontWeight: "600",
  },
  progressOuter: {
    height: 10,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(46, 204, 113, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(46, 204, 113, 0.2)",
  },
  progressInner: {
    height: "100%",
    backgroundColor: MESSHALL_GREEN,
  },
  progressShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "30%",
    backgroundColor: "rgba(255,255,255,0.25)",
    opacity: 0.25,
  },
  cancelBtn: {
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  cancelText: {
    color: "#9ca3af",
    fontSize: 14,
  },
});
