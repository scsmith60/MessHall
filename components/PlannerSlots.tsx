// components/PlannerSlots.tsx
// Like I'm 5: This box lets us pick times for Breakfast/Lunch/Dinner.
// NEW: variant="chips" shows tiny rounded buttons (chips) so it uses less space.
// - Tap a chip to set the "Ready" time.
// - Tap the little bell on the chip to turn the reminder on/off.
// - We show one small line underneath telling you when to START cooking.

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Switch, StyleSheet, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";

// ---------- Types ----------
type RecipeLite = {
  id: string;
  title: string;
  totalMinutes?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  restMinutes?: number;
};

export type MealSlot = {
  id: string;          // "breakfast", "lunch", "dinner" (or any id)
  label: string;       // what we show, e.g., "Lunch"
  targetTime?: string; // "HH:mm" (24h clock like "18:30")
  recipe?: RecipeLite; // optional, used to compute start time
  notify?: boolean;    // should we schedule a reminder?
};

type Props = {
  date: Date;                        // which day
  meals: MealSlot[];                 // list of slots
  bufferMinutes?: number;            // extra minutes before cooking (default 10)
  variant?: "default" | "compact" | "chips"; // "chips" = super small
};

// ---------- Helpers ----------
async function ensureNotificationPermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") await Notifications.requestPermissionsAsync();
}

function defaultTimeForLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("breakfast")) return "08:00";
  if (lower.includes("lunch")) return "12:30";
  return "18:30"; // dinner default
}

function combineDateAndTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function hhmm(date: Date) {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${m} ${ampm}`;
}

function totalRecipeMinutes(r?: RecipeLite): number {
  if (!r) return 0;
  if (typeof r.totalMinutes === "number") return r.totalMinutes;
  const prep = r.prepMinutes || 0;
  const cook = r.cookMinutes || 0;
  const rest = r.restMinutes || 0;
  return prep + cook + rest;
}

// ---------- Component ----------
const PlannerSlots: React.FC<Props> = ({
  date,
  meals,
  bufferMinutes = 10,
  variant = "chips", // 👈 default to "chips" to save space
}) => {
  // Make an internal, editable copy
  const [rows, setRows] = useState<MealSlot[]>(() =>
    meals.map((m) => ({
      ...m,
      targetTime: m.targetTime || defaultTimeForLabel(m.label),
      notify: typeof m.notify === "boolean" ? m.notify : false,
    }))
  );

  // Which chip is "active" (we show its start time in the one-line summary)
  const [activeId, setActiveId] = useState<string>(() => rows[0]?.id ?? "");

  // Time picker state
  const [pickerState, setPickerState] = useState<{ openForId?: string; current?: Date }>({});

  // Ask for notification permission once
  useEffect(() => {
    ensureNotificationPermissions();
  }, []);

  // Quick lookup helpers
  const mapById = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);
  const activeSlot = mapById[activeId] ?? rows[0];

  // Open native time picker for a slot
  const openPicker = (id: string, currentHHMM: string) => {
    setActiveId(id);
    setPickerState({
      openForId: id,
      current: combineDateAndTime(date, currentHHMM),
    });
  };

  // When a time is picked, save it
  const onTimePicked = (_e: any, selected?: Date) => {
    if (!pickerState.openForId) return;
    if (Platform.OS === "android") setPickerState({});
    if (!selected) return;

    const hh = selected.getHours().toString().padStart(2, "0");
    const mm = selected.getMinutes().toString().padStart(2, "0");
    const newTime = `${hh}:${mm}`;

    setRows((prev) => prev.map((r) => (r.id === pickerState.openForId ? { ...r, targetTime: newTime } : r)));
  };

  // 🔔 Schedule a reminder at the START time
  const scheduleReminder = async (slot: MealSlot) => {
    const readyAt = combineDateAndTime(date, slot.targetTime || defaultTimeForLabel(slot.label));
    const mins = totalRecipeMinutes(slot.recipe);
    const startAt = new Date(readyAt.getTime() - (mins + bufferMinutes) * 60000);

    if (isNaN(startAt.getTime()) || startAt.getTime() < Date.now()) return;

    const slotName = slot.label || "Meal";
    const recipePart = slot.recipe?.title ? ` • Start cooking ${slot.recipe.title}` : "";
    const title = `${slotName}${recipePart}`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: `Start now to eat by ${hhmm(readyAt)}.`,
        data: { slotId: slot.id, slotName, readyAt: readyAt.toISOString(), dateISO: date.toISOString() },
      },
      trigger: { date: startAt },
    });
  };

  // Toggle notify on/off
  const onToggleNotify = async (id: string, value: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, notify: value } : r)));
    const slot = rows.find((r) => r.id === id);
    if (value && slot) await scheduleReminder(slot);
  };

  // ------- RENDER VARIANTS -------
  if (variant === "chips") {
    // Compute start time line for the active chip
    const readyAt = combineDateAndTime(
      date,
      (activeSlot?.targetTime as string) || defaultTimeForLabel(activeSlot?.label || "Meal")
    );
    const mins = totalRecipeMinutes(activeSlot?.recipe);
    const startAt = new Date(readyAt.getTime() - (mins + bufferMinutes) * 60000);

    return (
      <View style={chipStyles.card}>
        <Text style={chipStyles.title}>Meal Time Slots</Text>

        {/* Chips: small rounded buttons, they wrap to more lines if needed */}
        <View style={chipStyles.chipsWrap}>
          {rows.map((slot) => {
            const ready = combineDateAndTime(date, slot.targetTime || defaultTimeForLabel(slot.label));
            const isActive = activeId === slot.id;
            return (
              <View key={slot.id} style={[chipStyles.chip, isActive && chipStyles.chipActive]}>
                {/* LEFT/BODY: label + time (tap to pick time) */}
                <Pressable onPress={() => openPicker(slot.id, slot.targetTime || defaultTimeForLabel(slot.label))} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[chipStyles.chipLabel, isActive && chipStyles.chipLabelActive]}>
                    {slot.label}
                  </Text>
                  <Text style={[chipStyles.dot, isActive && chipStyles.dotActive]}>•</Text>
                  <Text style={[chipStyles.time, isActive && chipStyles.timeActive]}>{hhmm(ready)}</Text>
                </Pressable>

                {/* RIGHT: bell (tap to toggle notify) */}
                <Pressable
                  hitSlop={10}
                  onPress={() => onToggleNotify(slot.id, !slot.notify)}
                  style={{ marginLeft: 8 }}
                >
                  <Ionicons
                    name={slot.notify ? "notifications" : "notifications-off"}
                    size={16}
                    color={slot.notify ? "#22c55e" : "rgba(255,255,255,0.6)"}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>

        {/* One-line summary for the selected chip */}
        {!!activeSlot && (
          <Text style={chipStyles.summary}>
            Start <Text style={chipStyles.summaryStrong}>{hhmm(startAt)}</Text>
            {mins > 0 ? ` • uses ${mins} min + ${bufferMinutes} min buffer` : ` • uses ${bufferMinutes} min buffer`}
          </Text>
        )}

        {/* Native time picker (only open while editing) */}
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

  // Fallback to previous compact/default layouts if asked
  const S = variant === "compact" ? compactStyles : fullStyles;

  return (
    <View style={S.card}>
      <Text style={S.title}>Meal Time Slots</Text>

      {rows.map((slot) => {
        const readyAt = combineDateAndTime(date, slot.targetTime || "18:00");
        const mins = totalRecipeMinutes(slot.recipe);
        const startAt = new Date(readyAt.getTime() - (mins + bufferMinutes) * 60000);

        return (
          <View key={slot.id} style={S.row}>
            <View style={{ flex: 1 }}>
              <Pressable onPress={() => openPicker(slot.id, slot.targetTime || defaultTimeForLabel(slot.label))}>
                {variant === "compact" ? (
                  <Text style={S.line}>
                    <Text style={S.slotName}>{slot.label}</Text>
                    {" • Ready "}
                    <Text style={S.bold}>{hhmm(readyAt)}</Text>
                    {" • Start "}
                    <Text style={S.bold}>{hhmm(startAt)}</Text>
                  </Text>
                ) : (
                  <>
                    <Text style={S.label}>{slot.label}</Text>
                    <Text style={S.time}>
                      Ready by: <Text style={S.bold}>{hhmm(readyAt)}</Text> (tap to change)
                    </Text>
                    <Text style={S.sub}>
                      {slot.recipe
                        ? `Recipe: ${slot.recipe.title} • Total ${mins} min`
                        : `No recipe yet (we’ll use just the ${bufferMinutes} min buffer)`}
                    </Text>
                    <Text style={S.sub}>Start cooking: {hhmm(startAt)}</Text>
                  </>
                )}
              </Pressable>
            </View>

            <View style={S.toggleBox}>
              <Text style={S.toggleLabel}>Remind me</Text>
              <Switch value={!!slot.notify} onValueChange={(v) => onToggleNotify(slot.id, v)} />
            </View>
          </View>
        );
      })}

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
};

/* -------------------- STYLES: CHIPS -------------------- */
const chipStyles = StyleSheet.create({
  card: {
    backgroundColor: "#0f1521",
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  title: { color: "white", fontSize: 14, fontWeight: "800", marginBottom: 2 },

  // Chips sit in a wrapping row so they stay small
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  chipActive: {
    backgroundColor: "rgba(34,197,94,0.14)",
    borderColor: "rgba(34,197,94,0.5)",
  },
  chipLabel: { color: "rgba(255,255,255,0.9)", fontWeight: "800" },
  chipLabelActive: { color: "white" },
  dot: { color: "rgba(255,255,255,0.6)" },
  dotActive: { color: "rgba(255,255,255,0.9)" },
  time: { color: "rgba(255,255,255,0.85)", fontWeight: "700" },
  timeActive: { color: "white" },

  // One-line summary
  summary: { color: "rgba(255,255,255,0.8)", marginTop: 2 },
  summaryStrong: { color: "white", fontWeight: "800" },
});

/* -------------------- STYLES: COMPACT / DEFAULT -------------------- */
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
  line: { color: "white" },
  slotName: { color: "white" },
});

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
  // (compat props)
  label: { color: "white" },
  time: { color: "white" },
  sub: { color: "white" },
});

// ⬇️ default export so you can `import PlannerSlots from "@/components/PlannerSlots"`
export default PlannerSlots;
