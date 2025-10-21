// components/IngredientPicker.tsx
// LIKE I'M 5:
// This shows your ingredients in a slim list.
// - Swipe RIGHT = ADD (auto)
// - Swipe LEFT  = REMOVE (auto)
// - Tap row toggles too
// FIX: By default, we DO NOT show the tiny quantity line so
//      you won't see duplicate numbers. (You can turn it on with a prop.)

import React, { useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";

// A row has a pretty name we show, and an optional dbName we use when saving
export type IngredientRow = {
  id: string;           // "1", "2", ...
  name: string;         // pretty text we show (usually "qty + item name")
  quantity?: string;    // like "4", "1/3 cup", etc. (optional)
  dbName?: string;      // cleaned name saved in DB (e.g., "eggs", "flour")
};

type RowRef = Swipeable | null;

export function IngredientPicker({
  items,
  checkedIds,
  onToggleCheck,
  // NEW: if true, show quantity on a second tiny line. Default is false (sleek).
  showQtyBelow = false,
}: {
  items: IngredientRow[];
  checkedIds: Set<string>;
  onToggleCheck: (id: string, next: boolean) => void;
  showQtyBelow?: boolean;
}) {
  const rowRefs = useRef<Record<string, RowRef>>({}).current;

  return (
    <View /* transparent container */>
      {items.map((it, idx) => {
        const added = checkedIds.has(it.id);

        // Blue panel when you swipe RIGHT (opens LEFT actions) → ADD
        const renderLeft = () => (
          <ActionPanel
            label="Add"
            icon="cart"
            positive
            onPress={() => {
              onToggleCheck(it.id, true);
              rowRefs[it.id]?.close?.();
            }}
          />
        );

        // Orange panel when you swipe LEFT (opens RIGHT actions) → REMOVE
        const renderRight = () => (
          <ActionPanel
            label="Remove"
            icon="close"
            onPress={() => {
              onToggleCheck(it.id, false);
              rowRefs[it.id]?.close?.();
            }}
          />
        );

        return (
          <View key={it.id}>
            <Swipeable
              ref={(r) => { rowRefs[it.id] = r; }}
              friction={2}
              leftThreshold={28}
              rightThreshold={28}
              overshootLeft={false}
              overshootRight={false}
              renderLeftActions={renderLeft}
              renderRightActions={renderRight}
              onSwipeableOpen={(side) => {
                // FULL swipe auto-toggles (no tap)
                if (side === "left") onToggleCheck(it.id, true);   // swiped RIGHT → open LEFT actions → ADD
                if (side === "right") onToggleCheck(it.id, false); // swiped LEFT  → open RIGHT actions → REMOVE
                requestAnimationFrame(() => rowRefs[it.id]?.close?.());
              }}
            >
              <TouchableOpacity
                activeOpacity={0.8}
                style={styles.row}
                onPress={() => onToggleCheck(it.id, !added)} // tap row toggles too
              >
                <View style={{ flex: 1 }}>
                  {/* MAIN LINE (already includes quantity for readability) */}
                  <Text style={styles.name} numberOfLines={2}>
                    {it.name}
                  </Text>

                  {/* OPTIONAL tiny subline for quantity (OFF by default to avoid duplication) */}
                  {showQtyBelow && it.quantity ? (
                    <Text style={styles.qty}>{it.quantity}</Text>
                  ) : null}
                </View>

                {added ? (
                  <View style={styles.addedPill}>
                    <Ionicons name="checkmark" size={12} color="#0f172a" />
                    <Text style={styles.addedText}>Added</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            </Swipeable>

            {/* thin divider */}
            {idx < items.length - 1 ? <View style={styles.divider} /> : null}
          </View>
        );
      })}
    </View>
  );
}

// Pressable swipe action panel
function ActionPanel({
  label,
  icon,
  positive,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  positive?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.panel, positive ? styles.panelAdd : styles.panelRemove]}
    >
      <Ionicons name={icon} size={18} color="#0f172a" />
      <Text style={styles.panelText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  name: { color: "#e2e8f0", fontSize: 15, fontWeight: "600" },
  qty: { color: "#94a3b8", fontSize: 12, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#334155", marginLeft: 4 },
  panel: { width: 96, height: "100%", alignItems: "center", justifyContent: "center", gap: 6 },
  panelAdd: { backgroundColor: "#38bdf8" },   // blue
  panelRemove: { backgroundColor: "#f59e0b" },// amber
  panelText: { color: "#0f172a", fontWeight: "800" },
  addedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#38bdf8",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  addedText: { color: "#0f172a", fontWeight: "800", fontSize: 12 },
});
