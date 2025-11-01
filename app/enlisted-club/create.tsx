// app/enlisted-club/create.tsx
// Create a new Enlisted Club cooking session

import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "../../lib/supabase";
import { COLORS, SPACING } from "../../lib/theme";
import { useUserId } from "../../lib/auth";
import { success, tap, warn } from "../../lib/haptics";
import ThemedNotice from "../../components/ui/ThemedNotice";

export default function CreateSessionScreen() {
  const { userId } = useUserId();
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ visible: boolean; title: string; message: string }>({
    visible: false,
    title: "",
    message: "",
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [recipeTitle, setRecipeTitle] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("50");
  const [scheduledStartAt, setScheduledStartAt] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());

  const onCreate = async () => {
    if (!userId) {
      setNotice({ visible: true, title: "Sign In Required", message: "Please sign in to create a session." });
      return;
    }

    if (!title.trim()) {
      await warn();
      setNotice({ visible: true, title: "Title Required", message: "Please enter a session title." });
      return;
    }

    const max = parseInt(maxParticipants, 10);
    if (isNaN(max) || max < 1 || max > 1000) {
      await warn();
      setNotice({ visible: true, title: "Invalid Limit", message: "Max participants must be between 1 and 1000." });
      return;
    }

    setLoading(true);
    try {
      const status = scheduledStartAt ? "scheduled" : "active";
      const startedAt = scheduledStartAt ? null : new Date().toISOString();

      const { data, error } = await supabase
        .from("enlisted_club_sessions")
        .insert({
          host_id: userId,
          title: title.trim(),
          description: description.trim() || null,
          recipe_id: recipeId || null,
          max_participants: max,
          scheduled_start_at: scheduledStartAt || null,
          started_at: startedAt,
          status: status,
        })
        .select()
        .single();

      if (error) throw error;

      await success();
      setNotice({
        visible: true,
        title: "Session Created",
        message: "Your cooking session is ready!",
      });
      setTimeout(() => router.replace(`/enlisted-club/${data.id}`), 1500);
    } catch (err: any) {
      await warn();
      setNotice({ visible: true, title: "Error", message: err?.message || "Failed to create session." });
    } finally {
      setLoading(false);
    }
  };

  const onCancel = () => {
    router.back();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top"]}>
      <ThemedNotice
        visible={notice.visible}
        title={notice.title}
        message={notice.message}
        onClose={() => setNotice({ visible: false, title: "", message: "" })}
        confirmText="OK"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.md,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.border,
          }}
        >
          <TouchableOpacity onPress={onCancel}>
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 18 }}>
            Create Session
          </Text>
          <View style={{ width: 28 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: SPACING.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <View style={{ marginBottom: SPACING.lg }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: 8 }}>
              Session Title *
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Cooking Authentic Pasta"
              placeholderTextColor={COLORS.subtext}
              style={{
                backgroundColor: COLORS.card,
                color: COLORS.text,
                padding: SPACING.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                fontSize: 16,
              }}
              maxLength={100}
            />
          </View>

          {/* Description */}
          <View style={{ marginBottom: SPACING.lg }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: 8 }}>
              Description
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What will you be cooking? Share details..."
              placeholderTextColor={COLORS.subtext}
              multiline
              numberOfLines={4}
              style={{
                backgroundColor: COLORS.card,
                color: COLORS.text,
                padding: SPACING.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                fontSize: 16,
                minHeight: 100,
                textAlignVertical: "top",
              }}
              maxLength={500}
            />
          </View>

          {/* Recipe Link (Optional) */}
          <View style={{ marginBottom: SPACING.lg }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: 8 }}>
              Recipe (Optional)
            </Text>
            <TouchableOpacity
              onPress={async () => {
                await tap();
                // TODO: Open recipe picker/search
                setNotice({ visible: true, title: "Coming Soon", message: "Recipe linking will be available soon." });
              }}
              style={{
                backgroundColor: COLORS.card,
                padding: SPACING.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: recipeTitle ? COLORS.text : COLORS.subtext, fontSize: 16 }}>
                {recipeTitle || "Link a recipe"}
              </Text>
              {recipeTitle && (
                <TouchableOpacity
                  onPress={() => {
                    setRecipeId(null);
                    setRecipeTitle("");
                  }}
                  style={{ marginLeft: 8 }}
                >
                  <Ionicons name="close-circle" size={20} color={COLORS.subtext} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Max Participants */}
          <View style={{ marginBottom: SPACING.lg }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: 8 }}>
              Max Participants
            </Text>
            <TextInput
              value={maxParticipants}
              onChangeText={setMaxParticipants}
              placeholder="50"
              placeholderTextColor={COLORS.subtext}
              keyboardType="numeric"
              style={{
                backgroundColor: COLORS.card,
                color: COLORS.text,
                padding: SPACING.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.border,
                fontSize: 16,
              }}
            />
            <Text style={{ color: COLORS.subtext, fontSize: 12, marginTop: 6 }}>
              Maximum 1000 participants
            </Text>
          </View>

          {/* Scheduled Start (Optional) */}
          <View style={{ marginBottom: SPACING.xl }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: 8 }}>
              Start Time (Optional)
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={async () => {
                  await tap();
                  const now = new Date();
                  setTempDate(new Date(now.getTime() + 30 * 60000)); // Default to 30 min from now
                  setShowDatePicker(true);
                }}
                style={{
                  flex: 1,
                  backgroundColor: COLORS.card,
                  padding: SPACING.md,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}
              >
                <Text style={{ color: scheduledStartAt ? COLORS.text : COLORS.subtext, fontSize: 16 }}>
                  {scheduledStartAt
                    ? new Date(scheduledStartAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "Schedule for later"}
                </Text>
              </TouchableOpacity>
              {scheduledStartAt && (
                <TouchableOpacity
                  onPress={async () => {
                    await tap();
                    setScheduledStartAt(null);
                  }}
                  style={{
                    backgroundColor: COLORS.elevated,
                    padding: SPACING.md,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="close" size={20} color={COLORS.text} />
                </TouchableOpacity>
              )}
            </View>
            {scheduledStartAt && (
              <Text style={{ color: COLORS.subtext, fontSize: 12, marginTop: 6 }}>
                Session will start automatically at scheduled time
              </Text>
            )}
          </View>

          {/* Date/Time Picker */}
          {showDatePicker && (
            <DateTimePicker
              value={tempDate}
              mode="datetime"
              is24Hour={false}
              minimumDate={new Date()}
              onChange={(event, selectedDate) => {
                setShowDatePicker(false);
                if (event.type === "set" && selectedDate) {
                  setScheduledStartAt(selectedDate.toISOString());
                }
              }}
            />
          )}

          {/* Create Button */}
          <Pressable
            onPress={onCreate}
            disabled={loading}
            style={{
              backgroundColor: loading ? COLORS.elevated : COLORS.accent,
              padding: SPACING.md,
              borderRadius: 12,
              alignItems: "center",
              marginTop: SPACING.lg,
            }}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={{ color: "#000", fontWeight: "800", fontSize: 16 }}>
                Create Session
              </Text>
            )}
          </Pressable>

          <Text style={{ color: COLORS.subtext, fontSize: 12, marginTop: SPACING.md, textAlign: "center" }}>
            Participants can join and tip you during the session
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

