import React from "react";
import { TouchableOpacity, View, Text } from "react-native";
import Svg, { Path, G } from "react-native-svg";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

function GoogleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <G fill="none">
        <Path
          d="M17.64 9.2045c0-.638-.0573-1.251-.164-1.836H9v3.472h4.844a4.136 4.136 0 01-1.796 2.713v2.251h2.904c1.701-1.566 2.688-3.874 2.688-6.6z"
          fill="#4285F4"
        />
        <Path
          d="M9 18c2.43 0 4.467-.806 5.956-2.195l-2.904-2.251c-.806.54-1.84.861-3.052.861-2.347 0-4.334-1.584-5.042-3.724H.957v2.34A9 9 0 009 18z"
          fill="#34A853"
        />
        <Path
          d="M3.958 10.691A5.41 5.41 0 013.677 9c0-.587.101-1.154.281-1.691V4.969H.957A9 9 0 000 9c0 1.46.35 2.84.957 4.031l3.001-2.34z"
          fill="#FBBC05"
        />
        <Path
          d="M9 3.579c1.321 0 2.514.455 3.452 1.35l2.59-2.59C13.464.891 11.43 0 9 0A9 9 0 00.957 4.969l3.001 2.34C4.666 5.169 6.653 3.579 9 3.579z"
          fill="#EA4335"
        />
      </G>
    </Svg>
  );
}

export function GoogleButton({ label = "Sign in with Google", onPress, disabled }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: "#1F1F1F",
        borderRadius: 999,
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        opacity: disabled ? 0.6 : 1,
        width: "100%",
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: "#fff",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <GoogleIcon />
      </View>
      <Text style={{ color: "#fff", fontWeight: "700" }}>{label}</Text>
    </TouchableOpacity>
  );
}

function AppleIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d="M16.365 2.43c0 1.14-.45 2.22-1.261 3.03-.9.9-1.98 1.29-3.06 1.23-.06-1.08.45-2.22 1.26-3.03.9-.9 2.07-1.44 3.06-1.23zm4.17 15.57c-.63 1.47-1.41 2.79-2.28 3.9-1.02 1.23-1.92 2.28-3.45 2.28-1.53 0-1.95-.75-3.63-.75-1.68 0-2.16.75-3.69.75-1.53 0-2.49-1.05-3.51-2.28C2.97 20.97 1.2 17.52 1.2 14.34c0-3.48 2.25-5.34 4.26-5.34 1.59 0 2.73.84 3.57.84.78 0 2.13-.93 3.69-.93 1.26 0 2.46.54 3.27 1.47-2.79 1.59-2.34 5.7.81 6.84.18.06.36.12.6.15-.18.51-.39 1.02-.6 1.47z"
        fill="#fff"
      />
    </Svg>
  );
}

export function AppleButton({ label = "Continue with Apple", onPress, disabled }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: "#1F1F1F",
        borderRadius: 999,
        paddingVertical: 14,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        opacity: disabled ? 0.6 : 1,
        width: "100%",
      }}
    >
      <View style={{ width: 22, alignItems: "center" }}>
        <AppleIcon />
      </View>
      <Text style={{ color: "#fff", fontWeight: "700" }}>{label}</Text>
    </TouchableOpacity>
  );
}


