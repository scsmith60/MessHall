// app/(account)/profile/edit-birthdate.tsx
// Screen for users to set/update their birthdate for age verification

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { COLORS as THEME } from "@/lib/theme";
import SafeDateTimePicker from "@/components/SafeDateTimePicker";

const COLORS = {
  bg: THEME.bg,
  card: THEME.card,
  border: THEME.border,
  text: THEME.text,
  subtext: THEME.subtext,
  accent: THEME.accent,
  good: THEME.accent,
  bad: '#EF4444',
};

export default function EditBirthdateScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [birthdate, setBirthdate] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(Platform.OS === "ios");
  const [showSuccess, setShowSuccess] = useState(false);

  // Calculate age from birthdate
  const age = birthdate
    ? Math.floor((Date.now() - birthdate.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  // Load current birthdate
  useEffect(() => {
    if (!userId) return;
    loadBirthdate();
  }, [userId]);

  async function loadBirthdate() {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("birthdate")
        .eq("id", userId)
        .single();

      if (error) {
        // Handle different error cases
        if (error.code === "42703") {
          // Column doesn't exist - show helpful message
          Alert.alert(
            "Migration Required",
            "The birthdate column hasn't been added to the database yet. Please run the migration:\n\n" +
            "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birthdate DATE;",
            [{ text: "OK" }]
          );
          setLoading(false);
          return;
        } else if (error.code !== "PGRST116") {
          // PGRST116 = no rows returned, which is fine
          console.error("Error loading birthdate:", error);
        }
      }

      if (data?.birthdate) {
        setBirthdate(new Date(data.birthdate));
      } else {
        // Default to 18 years ago if not set
        const defaultDate = new Date();
        defaultDate.setFullYear(defaultDate.getFullYear() - 18);
        setBirthdate(defaultDate);
      }
    } catch (e) {
      console.error("Error loading birthdate:", e);
    } finally {
      setLoading(false);
    }
  }

  async function saveBirthdate() {
    if (!userId || !birthdate) return;

    // Validate age (must be 18+)
    const calculatedAge = Math.floor(
      (Date.now() - birthdate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    );

    if (calculatedAge < 18) {
      Alert.alert(
        "Age Requirement",
        "You must be at least 18 years old to apply for monetization.",
        [{ text: "OK" }]
      );
      return;
    }

    setSaving(true);
    try {
      // Format as YYYY-MM-DD for PostgreSQL DATE type
      const dateString = birthdate.toISOString().split("T")[0];

      const { error } = await supabase
        .from("profiles")
        .update({ birthdate: dateString })
        .eq("id", userId);

      if (error) {
        Alert.alert("Error", error.message || "Couldn't save birthdate. Please try again.");
        return;
      }

      setShowSuccess(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      </SafeAreaView>
    );
  }

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
          Date of Birth
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Text
          style={{
            color: COLORS.text,
            fontSize: 18,
            fontWeight: "800",
            marginBottom: 8,
          }}
        >
          When were you born?
        </Text>
        <Text
          style={{
            color: COLORS.subtext,
            fontSize: 14,
            marginBottom: 24,
            lineHeight: 20,
          }}
        >
          We need to verify you're at least 18 years old to apply for monetization.
          This information is kept private and secure.
        </Text>

        {/* Date Picker */}
        {Platform.OS === "ios" ? (
          <View
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: COLORS.border,
              padding: 16,
              marginBottom: 24,
            }}
          >
            <SafeDateTimePicker
              value={birthdate || new Date()}
              mode="date"
              display="spinner"
              maximumDate={new Date()}
              minimumDate={new Date(1900, 0, 1)}
              onChange={(event, date) => {
                if (date) setBirthdate(date);
              }}
            />
          </View>
        ) : (
          <>
            <Pressable
              onPress={() => setShowPicker(true)}
              style={{
                backgroundColor: COLORS.card,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                padding: 16,
                marginBottom: 24,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: "600" }}>
                {birthdate
                  ? birthdate.toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "Select date"}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={COLORS.subtext} />
            </Pressable>
            {showPicker && (
              <SafeDateTimePicker
                value={birthdate || new Date()}
                mode="date"
                display="default"
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                onChange={(event, date) => {
                  setShowPicker(Platform.OS === "ios");
                  if (date) setBirthdate(date);
                }}
              />
            )}
          </>
        )}

        {/* Age Display */}
        {birthdate && age !== null && (
          <View
            style={{
              backgroundColor: age >= 18 ? COLORS.good : COLORS.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: age >= 18 ? COLORS.good : COLORS.bad,
              padding: 16,
              marginBottom: 24,
            }}
          >
            <Text
              style={{
                color: age >= 18 ? "#041016" : COLORS.text,
                fontSize: 16,
                fontWeight: "800",
                marginBottom: 4,
              }}
            >
              Age: {age} years old
            </Text>
            {age >= 18 ? (
              <Text style={{ color: "#041016", fontSize: 14, fontWeight: "600" }}>
                ✅ You meet the age requirement
              </Text>
            ) : (
              <Text style={{ color: COLORS.bad, fontSize: 14, fontWeight: "600" }}>
                You must be at least 18 years old
              </Text>
            )}
          </View>
        )}

        {/* Save Button */}
        <Pressable
          onPress={saveBirthdate}
          disabled={saving || !birthdate || (age !== null && age < 18)}
          style={{
            backgroundColor: birthdate && age !== null && age >= 18 ? COLORS.accent : COLORS.border,
            borderRadius: 999,
            padding: 16,
            alignItems: "center",
            justifyContent: "center",
            opacity: saving || !birthdate || (age !== null && age < 18) ? 0.5 : 1,
            marginTop: 8,
          }}
        >
          {saving ? (
            <ActivityIndicator size="small" color={age !== null && age >= 18 ? "#041016" : COLORS.text} />
          ) : (
            <Text
              style={{
                color: birthdate && age !== null && age >= 18 ? "#041016" : COLORS.subtext,
                fontSize: 16,
                fontWeight: "900",
              }}
            >
              Save Birthdate
            </Text>
          )}
        </Pressable>
      </ScrollView>

      {/* Success Modal */}
      <Modal
        visible={showSuccess}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowSuccess(false);
          router.back();
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 420,
              backgroundColor: COLORS.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: COLORS.border,
              padding: 20,
            }}
          >
            <Text
              style={{
                color: COLORS.text,
                fontWeight: "900",
                fontSize: 18,
                marginBottom: 12,
              }}
            >
              Success
            </Text>
            <Text
              style={{
                color: COLORS.subtext,
                fontSize: 14,
                lineHeight: 20,
                marginBottom: 20,
              }}
            >
              Your birthdate has been saved.
            </Text>
            <Pressable
              onPress={() => {
                setShowSuccess(false);
                router.back();
              }}
              style={{
                alignSelf: "flex-end",
                paddingVertical: 10,
                paddingHorizontal: 20,
                borderRadius: 999,
                backgroundColor: COLORS.accent,
              }}
            >
              <Text style={{ color: "#041016", fontWeight: "900" }}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

