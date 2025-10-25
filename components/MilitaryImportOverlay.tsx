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
const MESSHALL_GREEN = "#2FAE66"; // brand green
const HUD_BACKDROP = "rgba(5, 12, 18, 0.96)"; // darker, more immersive backdrop
const HUD_BG = "#0B1120"; // matches primary app backdrop
const GRID = "rgba(47, 174, 102, 0.18)"; // soft radar grid
const RADAR_WEDGE_COLOR = "rgba(47, 174, 102, 0.28)";
const RADAR_LOCK_COLOR = "rgba(255, 76, 102, 0.34)";
const LOCK_RED = "#ff4c69";

// ==============================
// 3) Tiny helper: random blip positions (little dots)
// ==============================
const { width: SCREEN_W } = Dimensions.get("window");
const RADAR_SIZE = Math.min(SCREEN_W * 0.82, 360); // keep it nicely sized
const WEDGE_WIDTH = RADAR_SIZE * 0.14;
const WEDGE_LENGTH = RADAR_SIZE * 0.52;

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
  headline = "SCANNING... STAND BY",
}: Props) {
  // ==============================
  // 4) Animations: grid glow, reticle pulse, little "blips"
  // ==============================
  const pulse = React.useRef(new Animated.Value(0)).current; // 0→1 loop
  const shimmer = React.useRef(new Animated.Value(0)).current; // for the progress shimmer
  const sweep = React.useRef(new Animated.Value(0)).current; // radar sweep rotation
  const sweepLoopRef = React.useRef<Animated.CompositeAnimation | null>(null);
  const lockGlow = React.useRef(new Animated.Value(0)).current;

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

  const lockAcquired = stageIndex >= steps.length;

  useEffect(() => {
    if (!visible) {
      sweepLoopRef.current?.stop();
      sweepLoopRef.current = null;
      sweep.stopAnimation(() => sweep.setValue(0));
      return;
    }
    if (lockAcquired) {
      sweepLoopRef.current?.stop();
      sweepLoopRef.current = null;
      return;
    }
    if (!sweepLoopRef.current) {
      sweep.setValue(0);
      const loop = Animated.loop(
        Animated.timing(sweep, {
          toValue: 1,
          duration: 3200,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      sweepLoopRef.current = loop;
      loop.start();
    }
    return () => {
      sweepLoopRef.current?.stop();
      sweepLoopRef.current = null;
    };
  }, [visible, lockAcquired, sweep]);

  useEffect(() => {
    Animated.timing(lockGlow, {
      toValue: lockAcquired ? 1 : 0,
      duration: lockAcquired ? 260 : 180,
      easing: lockAcquired ? Easing.out(Easing.quad) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [lockAcquired, lockGlow]);

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

  const sweepRotation = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const statusHeadline = lockAcquired ? "TARGET ACQUIRED" : headline;
  const statusSubtitle = lockAcquired ? "Mission complete. Recipe secured." : "Scanning for recipe intel...";
  const wedgeColor = lockAcquired ? RADAR_LOCK_COLOR : RADAR_WEDGE_COLOR;

  // ==============================
  // 5) UI
  // ==============================
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      hardwareAccelerated
      presentationStyle="overFullScreen"
    >
      {/* Dark see-through background */}
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Headline */}
          <Text style={[styles.headline, lockAcquired && styles.headlineLocked]}>{statusHeadline}</Text>
          <Animated.Text
            style={[
              styles.subheadline,
              lockAcquired ? styles.subheadlineLocked : styles.subheadlineActive,
              lockAcquired ? { opacity: lockGlow } : { opacity: 0.88 },
            ]}
          >
            {statusSubtitle}
          </Animated.Text>

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

            <View pointerEvents="none" style={styles.wedgeLayer}>
              <Animated.View
                style={[
                  styles.wedge,
                  {
                    borderTopColor: wedgeColor,
                    opacity: lockAcquired ? 0.9 : 0.6,
                    transform: [
                      { rotate: sweepRotation },
                      { translateY: -WEDGE_LENGTH },
                    ],
                  },
                  lockAcquired && styles.wedgeLocked,
                ]}
              />
            </View>

            {/* Center glowing dot (Animated.View on top of SVG) */}
            <Animated.View
              style={[
                styles.centerDot,
                {
                  transform: [{ scale: centerScale }, { scale: lockAcquired ? 1.15 : 1 }],
                  shadowColor: lockAcquired ? LOCK_RED : MESSHALL_GREEN,
                  backgroundColor: lockAcquired ? LOCK_RED : MESSHALL_GREEN,
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
                    {done ? <Text style={styles.checkmark}>✓</Text> : active ? <Text style={styles.dot}>●</Text> : null}
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
    alignSelf: "stretch",
    backgroundColor: HUD_BACKDROP,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: "center",
    alignItems: "stretch",
  },
  card: {
    flex: 1,
    width: "100%",
    backgroundColor: HUD_BG,
    paddingHorizontal: 28,
    paddingTop: 56,
    paddingBottom: 36,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: "rgba(47, 174, 102, 0.22)",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 22 },
    alignItems: "center",
  },
  headline: {
    color: "#E7FFF3",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 6,
  },
  headlineLocked: {
    color: LOCK_RED,
  },
  subheadline: {
    fontSize: 14,
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: 28,
  },
  subheadlineActive: {
    color: "rgba(206, 255, 230, 0.92)",
  },
  subheadlineLocked: {
    color: LOCK_RED,
  },
  radarWrap: {
    alignSelf: "center",
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 28,
  },
  wedgeLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  wedge: {
    position: "absolute",
    top: RADAR_SIZE / 2,
    left: RADAR_SIZE / 2,
    width: 0,
    height: 0,
    borderTopWidth: WEDGE_LENGTH,
    borderTopColor: RADAR_WEDGE_COLOR,
    borderLeftWidth: WEDGE_WIDTH,
    borderLeftColor: "transparent",
    borderRightWidth: WEDGE_WIDTH,
    borderRightColor: "transparent",
    marginLeft: -WEDGE_WIDTH,
  },
  wedgeLocked: {
    shadowColor: LOCK_RED,
    shadowOpacity: 0.48,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
  },
  centerDot: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 8,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  stepsBox: {
    width: "100%",
    backgroundColor: "rgba(47, 174, 102, 0.08)",
    borderColor: "rgba(47, 174, 102, 0.25)",
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 24,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(47, 174, 102, 0.4)",
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxDone: {
    backgroundColor: "rgba(47, 174, 102, 0.25)",
    borderColor: MESSHALL_GREEN,
  },
  checkboxActive: {
    borderColor: "#a7f3d0",
  },
  checkmark: {
    color: "#d1fae5",
    fontSize: 14,
    fontWeight: "700",
  },
  dot: {
    color: MESSHALL_GREEN,
    fontSize: 18,
    lineHeight: 20,
  },
  stepText: {
    color: "#cbd5e1",
    fontSize: 14,
    flexShrink: 1,
  },
  stepTextDone: {
    color: "#a7f3d0",
  },
  stepTextActive: {
    color: "#f8fafc",
    fontWeight: "600",
  },
  progressOuter: {
    width: "100%",
    height: 10,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "rgba(47, 174, 102, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(47, 174, 102, 0.28)",
  },
  progressInner: {
    height: "100%",
    backgroundColor: MESSHALL_GREEN,
  },
  progressShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "28%",
    backgroundColor: "rgba(255,255,255,0.25)",
    opacity: 0.22,
  },
  cancelBtn: {
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 24,
  },
  cancelText: {
    color: "#94a3b8",
    fontSize: 14,
    letterSpacing: 0.6,
  },
});


