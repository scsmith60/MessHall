import React from "react";
import { Modal, View, Text, TouchableOpacity } from "react-native";
import { COLORS } from "../../lib/theme";

type Props = {
  visible: boolean;
  title?: string;
  message?: string;
  onClose: () => void;
  confirmText?: string;
};

export default function ThemedNotice({ visible, title = "", message = "", onClose, confirmText = "OK" }: Props) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: COLORS.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            padding: 16,
          }}
        >
          {!!title && (
            <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 18, marginBottom: 6 }}>{title}</Text>
          )}
          {!!message && (
            <Text style={{ color: COLORS.subtext, marginBottom: 14 }}>{message}</Text>
          )}

          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 }}
            >
              <Text style={{ color: "#001018", fontWeight: "900" }}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}


