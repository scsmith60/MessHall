// components/ui/ThemedConfirm.tsx
// Themed confirmation dialog (replaces Alert.alert)

import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { COLORS } from "../../lib/theme";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
};

export default function ThemedConfirm({
  visible,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  destructive = false,
}: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          
          <View style={styles.buttonRow}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.button, styles.cancelButton]}
            >
              <Text style={styles.cancelText}>{cancelText}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={onConfirm}
              style={[
                styles.button,
                destructive ? styles.destructiveButton : styles.confirmButton,
              ]}
            >
              <Text style={[
                styles.confirmText,
                destructive ? styles.destructiveText : null,
              ]}>
                {confirmText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  container: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
  },
  title: {
    color: COLORS.text,
    fontWeight: "900",
    fontSize: 18,
    marginBottom: 8,
  },
  message: {
    color: COLORS.subtext,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    minWidth: 100,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: COLORS.elevated,
  },
  confirmButton: {
    backgroundColor: COLORS.accent,
  },
  destructiveButton: {
    backgroundColor: COLORS.danger,
  },
  cancelText: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 14,
  },
  confirmText: {
    color: "#041016",
    fontWeight: "800",
    fontSize: 14,
  },
  destructiveText: {
    color: "#FFFFFF",
  },
});

