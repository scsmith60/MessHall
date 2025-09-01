// components/ui/BayonetRating.tsx
// LIKE I'M 5: this draws 0..5 little bayonets like stars.
// It supports halves (e.g., 3.5) by clipping the filled icon.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import BayonetIcon from "../icons/BayonetIcon";

type Props = {
  value: number;            // 0..5 (can be 3.5)
  ratingCount?: number;     // optional "(123)"
  size?: number;            // icon size (default 14)
  gap?: number;             // space between icons
  filledColor?: string;     // filled color
  emptyColor?: string;      // empty/outline color
  showCount?: boolean;      // show "(123)"
};

export default function BayonetRating({
  value,
  ratingCount,
  size = 14,
  gap = 4,
  filledColor = "#CFF8D6",
  emptyColor = "rgba(255,255,255,0.28)",
  showCount = true,
}: Props) {
  const v = Math.max(0, Math.min(5, value));
  const fills = Array.from({ length: 5 }, (_, i) => Math.min(Math.max(v - i, 0), 1));

  return (
    <View style={[styles.row, { columnGap: gap }]}>
      {fills.map((fill, i) => (
        <Cell key={i} fill={fill} size={size} filledColor={filledColor} emptyColor={emptyColor} />
      ))}
      {showCount && typeof ratingCount === "number" && (
        <Text style={[styles.count, { lineHeight: size }]}>{`(${ratingCount})`}</Text>
      )}
    </View>
  );
}

function Cell({
  fill,
  size,
  filledColor,
  emptyColor,
}: {
  fill: number; size: number; filledColor: string; emptyColor: string;
}) {
  const clipW = Math.round(size * fill);
  return (
    <View style={{ width: size, height: size }}>
      {/* bottom: empty (outline) */}
      <View style={StyleSheet.absoluteFill}>
        <BayonetIcon size={size} color={emptyColor} stroke={emptyColor} strokeWidth={1} variant="mini" />
      </View>
      {/* top: filled, clipped */}
      <View style={{ width: clipW, height: size, overflow: "hidden" }}>
        <BayonetIcon size={size} color={filledColor} stroke="#0B1220" strokeWidth={1} variant="mini" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  count: { marginLeft: 6, color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
});
