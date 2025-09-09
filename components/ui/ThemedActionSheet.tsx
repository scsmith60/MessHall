// components/ui/ThemedActionSheet.tsx
// like I'm 5: this is our cute dark pop-up menu.
// we open it when you long-press a comment.
// tap outside to close. it's round and matches our app colors.

import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TouchableWithoutFeedback,
  Platform,
} from "react-native";

// tiny color kit so this file works anywhere
const COLORS = {
  bgDim: "rgba(2,10,18,0.6)", // see-through dark backdrop
  card: "#1e293b",            // slate-800
  edge: "#233041",            // subtle border
  text: "#f1f5f9",            // slate-100
  sub: "#94a3b8",             // slate-400
};
const RADIUS = { lg: 14, xl: 22 };

export type SheetAction = {
  // words on the button
  label: string;
  // what happens when we tap
  onPress: () => void;
  // if scary, make it pinky-red
  destructive?: boolean;
};

export default function ThemedActionSheet({
  visible,
  title = "Options",
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      {/* dim the world */}
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={{ flex: 1, backgroundColor: COLORS.bgDim, justifyContent: "center", alignItems: "center", padding: 18 }}>
          {/* stop taps from closing when inside the card */}
          <TouchableWithoutFeedback>
            <View
              style={{
                width: "86%",
                backgroundColor: COLORS.card,
                borderRadius: RADIUS.xl,
                borderWidth: 1,
                borderColor: COLORS.edge,
                padding: 12,
                ...(Platform.OS === "android"
                  ? { elevation: 6 }
                  : {
                      shadowColor: "#000",
                      shadowOpacity: 0.25,
                      shadowRadius: 12,
                      shadowOffset: { width: 0, height: 8 },
                    }),
              }}
            >
              {/* title */}
              <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 16, textAlign: "center", marginBottom: 8 }}>
                {title}
              </Text>

              {/* buttons stack */}
              <View style={{ backgroundColor: "#0f172a", borderRadius: RADIUS.lg, overflow: "hidden" }}>
                {actions.map((a, i) => {
                  const last = i === actions.length - 1;
                  return (
                    <Pressable
                      key={i}
                      android_ripple={{ color: "#1f2a37" }}
                      onPress={() => {
                        onClose();                    // close sheet first
                        requestAnimationFrame(a.onPress); // then do action
                      }}
                      style={{
                        paddingVertical: 14,
                        paddingHorizontal: 14,
                        borderBottomWidth: last ? 0 : 1,
                        borderBottomColor: "#1f2a37",
                      }}
                    >
                      <Text style={{ color: a.destructive ? "#ffb4b4" : COLORS.text, fontWeight: "800", textAlign: "center" }}>
                        {a.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* cancel */}
              <Pressable
                onPress={onClose}
                android_ripple={{ color: "#1f2a37" }}
                style={{ marginTop: 10, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.edge, paddingVertical: 12 }}
              >
                <Text style={{ color: COLORS.text, fontWeight: "900", textAlign: "center" }}>Cancel</Text>
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
