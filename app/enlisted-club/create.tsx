// app/enlisted-club/create.tsx
// Create a new Enlisted Club cooking session

import React, { useState, useEffect } from "react";
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
  Modal,
  FlatList,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerAndroid,
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
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
  
  // Recipe picker state
  const [showRecipePicker, setShowRecipePicker] = useState(false);
  const [recipeSearchQuery, setRecipeSearchQuery] = useState("");
  const [recipeSearchResults, setRecipeSearchResults] = useState<any[]>([]);
  const [recipeSearchLoading, setRecipeSearchLoading] = useState(false);

  const openStartTimePicker = async () => {
    await tap();
    const defaultDate = new Date(Date.now() + 30 * 60000);
    const initialDate = scheduledStartAt ? new Date(scheduledStartAt) : defaultDate;

    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: initialDate,
        mode: "date",
        minimumDate: new Date(),
        onChange: (event, date) => {
          if (event.type !== "set" || !date) {
            return;
          }
          const pickedDate = new Date(date);
          DateTimePickerAndroid.open({
            value: initialDate,
            mode: "time",
            is24Hour: false,
            onChange: (timeEvent, timeValue) => {
              if (timeEvent.type !== "set" || !timeValue) {
                return;
              }
              const finalDate = new Date(pickedDate);
              finalDate.setHours(timeValue.getHours(), timeValue.getMinutes(), 0, 0);
              setScheduledStartAt(finalDate.toISOString());
            },
          });
        },
      });
      return;
    }

    setTempDate(initialDate);
    setShowDatePicker(true);
  };

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

    if (!scheduledStartAt) {
      await warn();
      setNotice({ visible: true, title: "Start Time Required", message: "Please select a start time for your session." });
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
      const status = "scheduled"; // Always scheduled since start time is required
      const startedAt = null; // Will be set when session actually starts

      const { data, error } = await supabase
        .from("enlisted_club_sessions")
        .insert({
          host_id: userId,
          title: title.trim(),
          description: description.trim() || null,
          recipe_id: recipeId || null,
          max_participants: max,
          scheduled_start_at: scheduledStartAt,
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

  // Recipe search function
  const searchRecipes = async () => {
    try {
      setRecipeSearchLoading(true);
      const query = recipeSearchQuery.trim();
      let dbQuery = supabase
        .from("recipes")
        .select("id, title, image_url, minutes, servings")
        .eq("is_private", false)
        .limit(50);
      
      if (query) {
        dbQuery = dbQuery.ilike("title", `%${query}%`);
      }
      
      const { data, error } = await dbQuery;
      if (error) throw error;
      setRecipeSearchResults(data ?? []);
    } catch (err: any) {
      setNotice({ visible: true, title: "Search Error", message: err?.message || "Failed to search recipes." });
    } finally {
      setRecipeSearchLoading(false);
    }
  };

  // Search recipes when query changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (showRecipePicker) {
        searchRecipes();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [recipeSearchQuery, showRecipePicker]);

  // Load initial recipes when picker opens
  useEffect(() => {
    if (showRecipePicker) {
      searchRecipes();
    }
  }, [showRecipePicker]);

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
                setShowRecipePicker(true);
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
                  onPress={(e) => {
                    e.stopPropagation();
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

          {/* Scheduled Start (Required) */}
          <View style={{ marginBottom: SPACING.xl }}>
            <Text style={{ color: COLORS.text, fontWeight: "800", fontSize: 16, marginBottom: 8 }}>
              Start Time *
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={openStartTimePicker}
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
                    : "Select start time"}
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
          {Platform.OS === "ios" && showDatePicker && (
            <DateTimePicker
              value={tempDate}
              mode="datetime"
              is24Hour={false}
              minimumDate={new Date()}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
                if (event.type === "set" && selectedDate) {
                  setTempDate(selectedDate);
                  setScheduledStartAt(selectedDate.toISOString());
                }
                if (event.type === "dismissed") {
                  setShowDatePicker(false);
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

      {/* Recipe Picker Modal */}
      <Modal
        visible={showRecipePicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRecipePicker(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top"]}>
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
            <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 18 }}>
              Select Recipe
            </Text>
            <TouchableOpacity onPress={() => setShowRecipePicker(false)}>
              <Ionicons name="close" size={28} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {/* Search Input */}
          <View style={{ padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
            <TextInput
              value={recipeSearchQuery}
              onChangeText={setRecipeSearchQuery}
              placeholder="Search recipes..."
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
              autoFocus
            />
          </View>

          {/* Recipe List */}
          {recipeSearchLoading ? (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color={COLORS.accent} />
            </View>
          ) : (
            <FlatList
              data={recipeSearchResults}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: SPACING.lg }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={async () => {
                    await tap();
                    setRecipeId(item.id);
                    setRecipeTitle(item.title);
                    setShowRecipePicker(false);
                    setRecipeSearchQuery("");
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: COLORS.card,
                    padding: SPACING.md,
                    borderRadius: 12,
                    marginBottom: SPACING.md,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                  }}
                >
                  {item.image_url && (
                    <Image
                      source={{ uri: item.image_url }}
                      style={{ width: 60, height: 60, borderRadius: 8, marginRight: SPACING.md }}
                      resizeMode="cover"
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.text, fontWeight: "700", fontSize: 16 }}>
                      {item.title}
                    </Text>
                    {(item.minutes || item.servings) && (
                      <Text style={{ color: COLORS.subtext, fontSize: 12, marginTop: 4 }}>
                        {item.minutes ? `${item.minutes} min` : ""}
                        {item.minutes && item.servings ? " • " : ""}
                        {item.servings ? `${item.servings} servings` : ""}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={COLORS.subtext} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={{ padding: SPACING.xl, alignItems: "center" }}>
                  <Text style={{ color: COLORS.subtext, fontSize: 16 }}>
                    {recipeSearchQuery ? "No recipes found" : "Search for recipes to link"}
                  </Text>
                </View>
              }
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
