// components/ui/Badge.tsx
// LIKE I'M 5: this is the little pill that shows how many bayonets you have.
// it shows the bayonet picture + the number.

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import BayonetIcon from "../icons/BayonetIcon";
import { COLORS } from "../../lib/theme";

type Props = {
  knives: number;         // we keep the prop name to avoid refactors; "knives" == bayonets now
  size?: "sm" | "md";     // small or medium
};

export default function Badge({ knives, size = "md" }: Props) {
  const isSmall = size === "sm";
  const iconSize = isSmall ? 12 : 16;

  return (
    <View style={[styles.wrap, isSmall && styles.wrapSm]}>
      <BayonetIcon size={iconSize} color="#E5E7EB" stroke="#111827" strokeWidth={0.75} />
      <Text style={[styles.txt, isSmall && styles.txtSm]}>{knives}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0b3b2e", // deep green for "earned"
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#134e4a",
  },
  wrapSm: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  txt: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 13,
  },
  txtSm: {
    fontSize: 12,
  },
});
