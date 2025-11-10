// app/(account)/settings/security.tsx
// Screen for users to enable/disable 2FA (Two-Factor Authentication)

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { COLORS } from "@/lib/theme";

type MFAFactor = {
  id: string;
  factor_type: "totp" | "phone" | "webauthn";
  status: "verified" | "unverified";
  friendly_name?: string;
};

export default function SecuritySettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [loading, setLoading] = useState(true);
  const [factors, setFactors] = useState<MFAFactor[]>([]);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (userId) {
      loadMFAFactors();
    }
  }, [userId]);

  async function loadMFAFactors() {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();

      if (error) {
        console.error("Error loading MFA factors:", error);
        // If MFA is not enabled in Supabase, show a helpful message
        if (error.message?.includes("not enabled") || error.message?.includes("MFA")) {
          setFactors([]);
          setLoading(false);
          return;
        }
        Alert.alert("Error", "Couldn't load 2FA settings. Please try again.");
        setLoading(false);
        return;
      }

      setFactors(data?.totp || []);
    } catch (e: any) {
      console.error("Error loading MFA factors:", e);
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function enrollTOTP() {
    if (!userId) return;
    setEnrolling(true);
    try {
      // Start TOTP enrollment
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "MessHall Authenticator",
      });

      if (error) {
        // Check if MFA is not enabled in Supabase config
        if (
          error.message?.includes("not enabled") ||
          error.message?.includes("MFA") ||
          error.code === "mfa_not_enabled"
        ) {
          Alert.alert(
            "2FA Not Enabled",
            "Two-factor authentication is not enabled for this project. Please contact support or enable it in your Supabase dashboard:\n\n" +
              "1. Go to Authentication > Settings\n" +
              "2. Enable MFA (Multi-Factor Authentication)\n" +
              "3. Enable TOTP (Time-based One-Time Password)\n\n" +
              "For more info: https://supabase.com/docs/guides/auth/mfa",
            [
              { text: "OK" },
              {
                text: "Open Docs",
                onPress: () =>
                  Linking.openURL("https://supabase.com/docs/guides/auth/mfa"),
              },
            ]
          );
          setEnrolling(false);
          return;
        }
        Alert.alert("Error", error.message || "Couldn't start 2FA setup. Please try again.");
        setEnrolling(false);
        return;
      }

      if (!data) {
        Alert.alert("Error", "No enrollment data received. Please try again.");
        setEnrolling(false);
        return;
      }

      // Show QR code and secret to user
      const { qr_code, secret } = data;

      Alert.alert(
        "Scan QR Code",
        `Open your authenticator app (Google Authenticator, Authy, etc.) and scan this QR code:\n\n` +
          `Or enter this code manually: ${secret}\n\n` +
          `After scanning, you'll need to verify the code to complete setup.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "I've Scanned It",
            onPress: () => verifyTOTP(data.id, secret),
          },
        ]
      );
    } catch (e: any) {
      console.error("Error enrolling TOTP:", e);
      Alert.alert("Error", e?.message || "Something went wrong. Please try again.");
    } finally {
      setEnrolling(false);
    }
  }

  async function verifyTOTP(factorId: string, secret: string) {
    Alert.prompt(
      "Verify Code",
      "Enter the 6-digit code from your authenticator app:",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Verify",
          onPress: async (code) => {
            if (!code || code.length !== 6) {
              Alert.alert("Invalid Code", "Please enter a 6-digit code.");
              return;
            }

            try {
              const { error } = await supabase.auth.mfa.verify({
                factorId,
                code,
              });

              if (error) {
                Alert.alert("Error", error.message || "Invalid code. Please try again.");
                return;
              }

              Alert.alert("Success", "2FA has been enabled! Your account is now more secure.", [
                { text: "OK", onPress: () => loadMFAFactors() },
              ]);
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Something went wrong. Please try again.");
            }
          },
        },
      ],
      "plain-text"
    );
  }

  async function unenrollFactor(factorId: string) {
    Alert.alert(
      "Disable 2FA?",
      "Are you sure you want to disable two-factor authentication? Your account will be less secure.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disable",
          style: "destructive",
          onPress: async () => {
            try {
              const { error } = await supabase.auth.mfa.unenroll({ factorId });

              if (error) {
                Alert.alert("Error", error.message || "Couldn't disable 2FA. Please try again.");
                return;
              }

              Alert.alert("Success", "2FA has been disabled.", [
                { text: "OK", onPress: () => loadMFAFactors() },
              ]);
            } catch (e: any) {
              Alert.alert("Error", e?.message || "Something went wrong. Please try again.");
            }
          },
        },
      ]
    );
  }

  const hasVerified2FA = factors.some((f) => f.status === "verified");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top"]}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ padding: 8, marginRight: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </Pressable>
        <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: "800" }}>
          Security Settings
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <Text
            style={{
              color: COLORS.text,
              fontSize: 16,
              fontWeight: "600",
              marginBottom: 8,
            }}
          >
            Two-Factor Authentication (2FA)
          </Text>
          <Text
            style={{
              color: COLORS.subtext,
              fontSize: 14,
              marginBottom: 24,
              lineHeight: 20,
            }}
          >
            Add an extra layer of security to your account. When enabled, you'll need
            to enter a code from your authenticator app when signing in.
          </Text>

          {/* 2FA Status */}
          <View
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: hasVerified2FA ? COLORS.accent : COLORS.border,
              padding: 16,
              marginBottom: 24,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Ionicons
                name={hasVerified2FA ? "shield-checkmark" : "shield-outline"}
                size={24}
                color={hasVerified2FA ? COLORS.accent : COLORS.subtext}
              />
              <Text
                style={{
                  color: COLORS.text,
                  fontSize: 16,
                  fontWeight: "600",
                  marginLeft: 12,
                }}
              >
                {hasVerified2FA ? "2FA Enabled" : "2FA Disabled"}
              </Text>
            </View>
            <Text style={{ color: COLORS.subtext, fontSize: 14 }}>
              {hasVerified2FA
                ? "Your account is protected with two-factor authentication."
                : "Enable 2FA to make your account more secure."}
            </Text>
          </View>

          {/* Active Factors */}
          {factors.length > 0 && (
            <View style={{ marginBottom: 24 }}>
              <Text
                style={{
                  color: COLORS.text,
                  fontSize: 14,
                  fontWeight: "600",
                  marginBottom: 12,
                }}
              >
                Active Authenticators
              </Text>
              {factors.map((factor) => (
                <View
                  key={factor.id}
                  style={{
                    backgroundColor: COLORS.card,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    padding: 16,
                    marginBottom: 12,
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.text, fontSize: 14, fontWeight: "600" }}>
                      {factor.friendly_name || "Authenticator App"}
                    </Text>
                    <Text style={{ color: COLORS.subtext, fontSize: 12, marginTop: 4 }}>
                      {factor.status === "verified" ? "Verified" : "Not verified"}
                    </Text>
                  </View>
                  {factor.status === "verified" && (
                    <Pressable
                      onPress={() => unenrollFactor(factor.id)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8,
                        backgroundColor: COLORS.border,
                      }}
                    >
                      <Text style={{ color: COLORS.text, fontSize: 12, fontWeight: "600" }}>
                        Remove
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Enable/Disable Button */}
          <Pressable
            onPress={hasVerified2FA ? () => factors.forEach((f) => unenrollFactor(f.id)) : enrollTOTP}
            disabled={enrolling}
            style={{
              backgroundColor: hasVerified2FA ? COLORS.border : COLORS.accent,
              borderRadius: 12,
              padding: 16,
              alignItems: "center",
              opacity: enrolling ? 0.5 : 1,
            }}
          >
            {enrolling ? (
              <ActivityIndicator size="small" color={COLORS.text} />
            ) : (
              <Text
                style={{
                  color: COLORS.text,
                  fontSize: 16,
                  fontWeight: "800",
                }}
              >
                {hasVerified2FA ? "Disable 2FA" : "Enable 2FA"}
              </Text>
            )}
          </Pressable>

          {/* Help Text */}
          <View
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: COLORS.border,
              padding: 16,
              marginTop: 24,
            }}
          >
            <Text
              style={{
                color: COLORS.text,
                fontSize: 14,
                fontWeight: "600",
                marginBottom: 8,
              }}
            >
              How it works:
            </Text>
            <Text style={{ color: COLORS.subtext, fontSize: 12, lineHeight: 18 }}>
              1. Download an authenticator app (Google Authenticator, Authy, Microsoft
              Authenticator, etc.){"\n"}
              2. Tap "Enable 2FA" and scan the QR code{"\n"}
              3. Enter the 6-digit code to verify{"\n"}
              4. You'll need this code when signing in
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

