// like I'm 5: this is a little popup that asks "where should we send it?"
// it shows: Shopping List + any enabled stores. you pick one, we call onChoose.

import React from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type StoreKey = "walmart" | "kroger" | "amazon" | "heb";

export function StoreChooserSheet({
  visible,
  enabledStores,
  onClose,
  onChoose,
  includeShoppingList = true,
}: {
  visible: boolean;
  enabledStores: StoreKey[];           // e.g. ["kroger"] or ["walmart","amazon"]
  onClose: () => void;
  onChoose: (choice: StoreKey | "shopping_list") => void;
  includeShoppingList?: boolean;
}) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Where should we send it?</Text>

          {includeShoppingList && (
            <TouchableOpacity style={styles.row} onPress={() => onChoose("shopping_list")}>
              <Ionicons name="list" size={22} />
              <Text style={styles.rowText}>Shopping List</Text>
              <Ionicons name="chevron-forward" size={18} />
            </TouchableOpacity>
          )}

          {enabledStores.map((s) => (
            <TouchableOpacity key={s} style={styles.row} onPress={() => onChoose(s)}>
              <Ionicons name="cart" size={22} />
              <Text style={styles.rowText}>{labelForStore(s)}</Text>
              <Ionicons name="chevron-forward" size={18} />
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function labelForStore(s: StoreKey) {
  if (s === "kroger") return "Kroger Cart";
  if (s === "walmart") return "Walmart Cart";
  if (s === "amazon") return "Amazon";
  if (s === "heb") return "HEB";
  return s;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#0f172a",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
  },
  handle: { width: 40, height: 4, backgroundColor: "#334155", borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  title: { color: "#f1f5f9", fontSize: 18, fontWeight: "600", marginBottom: 8, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#334155",
    gap: 10,
  },
  rowText: { color: "#e2e8f0", fontSize: 16, flex: 1 },
  cancel: { paddingVertical: 12, alignItems: "center" },
  cancelText: { color: "#94a3b8", fontSize: 14 },
});
