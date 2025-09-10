// components/PlannerSlots.tsx
// Like I'm 5: This shows simple meal time slots.
// NEW: variant="compact" makes the card short so it doesn't take over the page.

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Switch, StyleSheet, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Notifications from "expo-notifications";

type RecipeLite = {
  id: string;
  title: string;
  totalMinutes?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  restMinutes?: number;
};

type MealSlot = {
  id: string;
  label: string;
  targetTime?: string;  // "HH:mm"
  recipe?: RecipeLite;
  notify?: boolean;
};

type Props = {
  date: Date;                     // which day we are setting times for
  meals: MealSlot[];              // one or more slots (Dinner, etc.)
  bufferMinutes?: number;         // extra cushion before cooking (default 10)
  variant?: "default" | "compact";// NEW: "compact" = short, single-line layout
};

// Ask for permission once so reminders can show
async function ensureNotificationPermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    await Notifications.requestPermissionsAsync();
  }
}

// Combine day + "HH:mm" into a Date
function combineDateAndTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const out = new Date(day);
  out.setHours(h || 0, m || 0, 0, 0);
  return out;
}

// Show 6:30 PM nice
function hhmm(date: Date) {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${m} ${ampm}`;
}

// Total minutes = prep + cook + rest (if not provided as totalMinutes)
function totalRecipeMinutes(r?: RecipeLite): number {
  if (!r) return 0;
  if (typeof r.totalMinutes === "number") return r.totalMinutes;
  const prep = r.prepMinutes || 0;
  const cook = r.cookMinutes || 0;
  const rest = r.restMinutes || 0;
  return prep + cook + rest;
}

export default function PlannerSlots({
  date,
  meals,
  bufferMinutes = 10,
  variant = "compact", // 👈 default to compact so the card is small
}: Props) {
  // Local state copy so user can tap/change time or toggle bell
  const [rows, setRows] = useState<MealSlot[]>(() =>
    meals.map((m) => ({
      ...m,
      targetTime: m.targetTime || defaultTimeForLabel(m.label),
      notify: typeof m.notify === "boolean" ? m.notify : false,
    }))
  );

  const [pickerState, setPickerState] = useState<{
    openForId?: string;
    current?: Date;
  }>({});

  // Ask for notification permission the first time
  useEffect(() => {
    ensureNotificationPermissions();
  }, []);

  // Open native time picker
  const openPicker = (id: string, currentHHMM: string) => {
    setPickerState({
      openForId: id,
      current: combineDateAndTime(date, currentHHMM),
    });
  };

  // When time is picked, save it to the right row
  const onTimePicked = (_event: any, selected?: Date) => {
    if (!pickerState.openForId) return;
    if (Platform.OS === "android") setPickerState({});
    if (!selected) return;

    const newHH = selected.getHours().toString().padStart(2, "0");
    const newMM = selected.getMinutes().toString().padStart(2, "0");
    const newTime = `${newHH}:${newMM}`;

    setRows((prev) =>
      prev.map((r) => (r.id === pickerState.openForId ? { ...r, targetTime: newTime } : r))
    );
  };

  // Schedule a reminder at the START time (ready time - (total + buffer))
  const scheduleReminder = async (slot: MealSlot) => {
    const readyAt = combineDateAndTime(date, slot.targetTime || "18:00");
    const mins = totalRecipeMinutes(slot.recipe);
    const startAt = new Date(readyAt.getTime() - (mins + bufferMinutes) * 60000);

    if (!slot.recipe || isNaN(startAt.getTime()) || startAt.getTime() < Date.now()) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Time to start ${slot.recipe.title}`,
        body: `Start now to eat by ${hhmm(readyAt)}.`,
      },
      trigger: { date: startAt },
    });
  };

  // Handle bell toggle
  const onToggleNotify = async (id: string, value: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, notify: value } : r)));
    const slot = rows.find((r) => r.id === id);
    if (value && slot) await scheduleReminder(slot);
  };

  // Choose styles based on variant
  const S = variant === "compact" ? compactStyles : fullStyles;

  return (
    <View style={S.card}>
      <Text style={S.title}>Meal Time Slots</Text>

      {rows.map((slot) => {
        const readyAt = combineDateAndTime(date, slot.targetTime || "18:00");
        const mins = totalRecipeMinutes(slot.recipe);
        const startAt = new Date(readyAt.getTime() - (mins + bufferMinutes) * 60000);
        const hasRecipe = !!slot.recipe;

        return (
          <View key={slot.id} style={S.row}>
            {/* LEFT SIDE: short single line */}
            <View style={{ flex: 1 }}>
              {/* Tap the time to change it */}
              <Pressable onPress={() => openPicker(slot.id, slot.targetTime || "18:30")}>
                {variant === "compact" ? (
                  <Text style={S.line}>
                    <Text style={S.slotName}>{slot.label}</Text>
                    {" • Ready "}
                    <Text style={S.bold}>{hhmm(readyAt)}</Text>
                    {hasRecipe ? (
                      <>
                        {" • Start "}
                        <Text style={S.bold}>{hhmm(startAt)}</Text>
                      </>
                    ) : (
                      " • Pick a recipe"
                    )}
                  </Text>
                ) : (
                  <>
                    <Text style={S.label}>{slot.label}</Text>
                    <Text style={S.time}>
                      Ready by: <Text style={S.bold}>{hhmm(readyAt)}</Text> (tap to change)
                    </Text>
                    <Text style={S.sub}>
                      {hasRecipe ? `Recipe: ${slot.recipe?.title} • Total ${mins} min` : "No recipe picked yet"}
                    </Text>
                    <Text style={S.sub}>
                      {hasRecipe
                        ? `Start cooking: ${hhmm(startAt)} (includes ${bufferMinutes} min buffer)`
                        : "Pick a recipe to auto-calc start time"}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* RIGHT SIDE: Remind me switch */}
            <View style={S.toggleBox}>
              <Text style={S.toggleLabel}>Remind me</Text>
              <Switch value={!!slot.notify} onValueChange={(v) => onToggleNotify(slot.id, v)} />
            </View>
          </View>
        );
      })}

      {/* Native picker (only visible while editing) */}
      {pickerState.openForId && pickerState.current && (
        <DateTimePicker
          value={pickerState.current}
          mode="time"
          is24Hour={false}
          onChange={onTimePicked}
          display={Platform.OS === "ios" ? "spinner" : "default"}
        />
      )}
    </View>
  );
}

function defaultTimeForLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("breakfast")) return "08:00";
  if (lower.includes("lunch")) return "12:30";
  return "18:30";
}

/* -------------------- STYLES -------------------- */
/* Full (original) layout */
const fullStyles = StyleSheet.create({
  card: {
    backgroundColor: "#0f1521",
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  title: { color: "white", fontSize: 16, fontWeight: "700", marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 12,
    gap: 8,
    marginBottom: 8,
  },
  label: { color: "white", fontWeight: "700", marginBottom: 4 },
  time: { color: "rgba(255,255,255,0.9)" },
  bold: { fontWeight: "800", color: "white" },
  sub: { color: "rgba(255,255,255,0.7)", marginTop: 3 },
  toggleBox: { alignItems: "center", gap: 4, paddingLeft: 8 },
  toggleLabel: { color: "rgba(255,255,255,0.9)", fontSize: 12 },
});

/* Compact (short) layout */
const compactStyles = StyleSheet.create({
  card: {
    backgroundColor: "#0f1521",
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  title: { color: "white", fontSize: 14, fontWeight: "800", marginBottom: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  line: { color: "rgba(255,255,255,0.9)" },
  slotName: { color: "white", fontWeight: "800" },
  bold: { color: "white", fontWeight: "800" },
  toggleBox: { alignItems: "center", gap: 2, paddingLeft: 10 },
  toggleLabel: { color: "rgba(255,255,255,0.9)", fontSize: 11 },
  // Unused in compact, but kept for TS compatibility
  label: { color: "white" },
  time: { color: "white" },
  sub: { color: "white" },
});
