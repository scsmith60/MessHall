// components/CaloriePill.tsx
// LIKE I'M 5 🧃:
// This is a tiny green chip that shows calories.
// • If `compact` is true → it's a small pill (NOT full width).
// • If `compact` is false → it can be a long bar (full width) for old screens.
// We always return null if we have no numbers to show.

import React, { memo } from "react";
import { View, Text, StyleSheet, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  // total calories for the whole recipe
  total?: number | null;
  // calories per serving
  perServing?: number | null;
  // small pill (used on feed + recipe header)
  compact?: boolean;
  // optional extra styles
  style?: ViewStyle;
};

function format(n?: number | null) {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function CaloriePill({ total, perServing, compact = false, style }: Props) {
  const t = format(total);
  const p = format(perServing);

  // nothing to show
  if (t == null && p == null) return null;

  // text to show: prefer per-serving if present
  const text = p != null ? `${p} cal` : `${t} cal`;

  // choose styles
  const wrapStyle = compact
    ? [styles.compactWrap, style]
    : [styles.longWrap, style];

  return (
    <View style={wrapStyle}>
      <Ionicons name="flame" size={12} color="#CFF8D6" />
      <Text style={styles.text}>{text}</Text>
      {/* tiny tag to indicate per-serving when we used that */}
      {p != null && <Text style={styles.sub}>/serv</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  /* SMALL pill — IMPORTANT: never stretch */
  compactWrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",     // <- keep it only as wide as it needs
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#0b3b2e",
    borderWidth: 1,
    borderColor: "#134e4a",
    gap: 6,
  },
  /* OLD long bar for places that still want it */
  longWrap: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",                // full width bar
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#0b3b2e",
    borderWidth: 1,
    borderColor: "#134e4a",
    gap: 8,
  },
  text: {
    color: "#CFF8D6",
    fontWeight: "900",
    fontSize: 12,
  },
  sub: {
    color: "#9CA3AF",
    fontWeight: "800",
    fontSize: 11,
    marginLeft: 2,
  },
});

export default memo(CaloriePill);
