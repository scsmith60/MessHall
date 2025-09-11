// components/RemixMiniButton.tsx
// like I'm 5:
// this is a small, calm green "Remix" button.
// when tapped, we go to /remix/[parentId].
// we don't change your layout; you decide where to place it.

import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import HapticButton from "@/components/ui/HapticButton";
import { COLORS, RADIUS } from "@/lib/theme";

export default function RemixMiniButton({ parentId }: { parentId: string }) {
  const router = useRouter();

  return (
    <HapticButton
      onPress={() => router.push(`/remix/${parentId}`)}
      // small, tidy, matches your dark theme — not shouty
      style={{
        backgroundColor: "#183B2B",
        borderWidth: 1,
        borderColor: "#2BAA6B",
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: RADIUS.lg,
        alignItems: "center",
        flexDirection: "row",
        gap: 6,
      }}
      accessibilityRole="button"
      accessibilityLabel="Remix this recipe"
    >
      <Ionicons name="git-branch-outline" size={14} color="#CFF8D6" />
      <Text style={{ color: "#CFF8D6", fontWeight: "900", fontSize: 13 }}>
        Remix
      </Text>
    </HapticButton>
  );
}
