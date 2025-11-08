// components/PlannerSlots.tsx
// Like I'm 5: This box lets us pick times for Breakfast/Lunch/Dinner.
// NEW: variant="chips" shows tiny rounded buttons (chips) so it uses less space.
// - Tap a chip to set the "Ready" time.
// - Tap the little bell on the chip to turn the reminder on/off.
// - We show one small line underneath telling you when to START cooking.

import React, { useEffect, useMemo, useState, useRef } from "react";
import { View, Text, Pressable, Switch, StyleSheet, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Notifications from "expo-notifications";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/lib/theme";
import { logDebug, logError, logWarn } from "@/lib/logger";

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
async function ensureNotificationPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === "granted") return true;
  
  const { status } = await Notifications.requestPermissionsAsync();
  
  // Set up Android notification channel if needed
  if (Platform.OS === "android" && status === "granted") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Meal Reminders",
      description: "Reminders for when to start cooking meals",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
    });
  }
  
  return status === "granted";
}

function defaultTimeForLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("breakfast")) return "08:00";
  if (lower.includes("lunch")) return "12:30";
  return "18:30"; // dinner default
}

function combineDateAndTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  // Create a new date using the year, month, and day from the provided date
  // This avoids timezone issues when the day Date might have time components
  const year = day.getFullYear();
  const month = day.getMonth();
  const date = day.getDate();
  const d = new Date(year, month, date, h || 0, m || 0, 0, 0);
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

  // Store notification IDs so we can cancel them later
  const notificationIdsRef = useRef<Record<string, string>>({});

  // Which chip is "active" (we show its start time in the one-line summary)
  const [activeId, setActiveId] = useState<string>(() => rows[0]?.id ?? "");

  // Time picker state
  const [pickerState, setPickerState] = useState<{ openForId?: string; current?: Date }>({});
  const isMountedRef = useRef(true);
  
  // Track mount status to prevent state updates during unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Close picker immediately on unmount to prevent Android dismiss error
      if (Platform.OS === "android" && pickerState.openForId) {
        setPickerState({});
      }
    };
  }, [pickerState.openForId]);

      // Ask for notification permission once and set up Android channel
  useEffect(() => {
    ensureNotificationPermissions().catch((err) => {
      logWarn("⚠️ NOTIFICATION PERMISSION DENIED:", err);
    });
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

  // When a time is picked, save it and reschedule notification if needed
  const onTimePicked = async (event: any, selected?: Date) => {
    if (!pickerState.openForId || !isMountedRef.current) return;
    // On Android, always close immediately to prevent unmount errors
    if (Platform.OS === "android") {
      setPickerState({});
    } else if (event.type === "set" || event.type === "dismissed") {
      // On iOS, close on set or dismiss
      setPickerState({});
    }
    if (!selected) return;

    const hh = selected.getHours().toString().padStart(2, "0");
    const mm = selected.getMinutes().toString().padStart(2, "0");
    const newTime = `${hh}:${mm}`;

    setRows((prev) => {
      const updated = prev.map((r) => (r.id === pickerState.openForId ? { ...r, targetTime: newTime } : r));
      // If this slot has notifications enabled, reschedule with the new time
      const updatedSlot = updated.find((r) => r.id === pickerState.openForId);
      if (updatedSlot?.notify) {
        scheduleReminder(updatedSlot).catch((err) => {
          logError("⚠️ RESCHEDULE FAILED — TIME CHANGE:", err);
        });
      }
      return updated;
    });
  };

  // 🔔 Schedule a reminder at the START time
  const scheduleReminder = async (slot: MealSlot): Promise<void> => {
    try {
      // First, ensure we have permissions
      const hasPermission = await ensureNotificationPermissions();
      if (!hasPermission) {
        logWarn("⚠️ PERMISSION DENIED — REMINDER NOT SCHEDULED");
        return;
      }

      let readyAt = combineDateAndTime(date, slot.targetTime || defaultTimeForLabel(slot.label));
      const mins = totalRecipeMinutes(slot.recipe);
      let startAt = new Date(readyAt.getTime() - (mins + bufferMinutes) * 60000);

      const now = Date.now();
      const startAtTime = startAt.getTime();

      if (isNaN(startAtTime)) {
        logWarn("⚠️ INVALID DATE — REMINDER ABORTED");
        return;
      }

      // Check if the start time is in the past
      if (startAtTime < now) {
        const timeDiff = Math.round((now - startAtTime) / 1000 / 60); // minutes
        logWarn(
          `⚠️ TIME INVALID — SCHEDULE IN PAST (${timeDiff} min ago). Start: ${startAt.toLocaleString()}, Now: ${new Date(now).toLocaleString()}`
        );
        // If it's less than 1 hour in the past, schedule for the next day instead
        if (timeDiff < 60) {
          const nextDay = new Date(readyAt);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayReadyAt = combineDateAndTime(nextDay, slot.targetTime || defaultTimeForLabel(slot.label));
          const nextDayStartAt = new Date(nextDayReadyAt.getTime() - (mins + bufferMinutes) * 60000);
          
          if (nextDayStartAt.getTime() > now) {
            logDebug(`⚠️ AUTO-RESCHEDULE — NEXT DAY: ${nextDayStartAt.toLocaleString()}`);
            // Update readyAt and startAt to next day
            readyAt = nextDayReadyAt;
            startAt = nextDayStartAt;
          } else {
            return; // Can't schedule even for next day
          }
        } else {
          return; // Too far in the past, skip
        }
      }

      // Cancel any existing notification for this slot
      const existingId = notificationIdsRef.current[slot.id];
      if (existingId) {
        await Notifications.cancelScheduledNotificationAsync(existingId);
      }

      const slotName = slot.label || "Meal";
      const recipePart = slot.recipe?.title ? ` • Start cooking ${slot.recipe.title}` : "";
      const title = `${slotName}${recipePart}`;

      // Verify the trigger date is valid
      if (startAt.getTime() <= now) {
        logWarn(`⚠️ ALARM TIME TOO CLOSE — Scheduling ${Math.round((startAt.getTime() - now) / 1000)}s in the future`);
      }

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body: `Start now to eat by ${hhmm(readyAt)}.`,
          data: { slotId: slot.id, slotName, readyAt: readyAt.toISOString(), dateISO: date.toISOString() },
          sound: true,
        },
        trigger: { date: startAt } as Notifications.NotificationTriggerInput,
      });

      // Store the notification ID so we can cancel it later
      notificationIdsRef.current[slot.id] = notificationId;
      
      const timeUntil = Math.round((startAt.getTime() - Date.now()) / 1000 / 60); // minutes
      logDebug(`✅ REMINDER SCHEDULED — ${slotName}`);
      logDebug(`   Ready: ${hhmm(readyAt)} | Alarm: ${hhmm(startAt)} (${timeUntil} min from now)`);
      logDebug(`   Buffer: ${bufferMinutes} min${mins > 0 ? ` + ${mins} min recipe` : ''}`);
      logDebug(`   Notification ID: ${notificationId}`);
      
      // Verify notification was actually scheduled (with delay for system to process)
      setTimeout(async () => {
        try {
          const scheduled = await Notifications.getAllScheduledNotificationsAsync();
          logDebug(`   Total scheduled: ${scheduled.length}`);
          // Log first few to see structure
          if (scheduled.length > 0) {
            logDebug(`   Sample notification identifiers:`, scheduled.slice(0, 3).map(n => n.identifier));
          }
          
          // Check both string and potential number formats
          const found = scheduled.find((n) => {
            const id = String(n.identifier || '');
            const notificationIdStr = String(notificationId);
            return id === notificationIdStr || id === notificationId;
          });
          
          logDebug(`   Verified in schedule: ${found ? 'YES ✅' : 'NO ⚠️'}`);
          
          if (found) {
            logDebug(`   Trigger date: ${found.trigger && typeof found.trigger === 'object' && 'date' in found.trigger ? new Date(found.trigger.date as number).toLocaleString() : 'unknown'}`);
          } else if (scheduled.length > 0) {
            // Debug: check if any match by content
            const byTitle = scheduled.find((n) => n.content?.title === title);
            if (byTitle) {
              logDebug(`   ⚠️ Found by title but ID mismatch: ${byTitle.identifier} vs ${notificationId}`);
            }
          }
        } catch (verifyError) {
          logWarn(`⚠️ Could not verify notification:`, verifyError);
        }
      }, 1000);
    } catch (error) {
      logError("⚠️ SCHEDULE FAILED — REMINDER NOT SET:", error);
    }
  };

  // Toggle notify on/off
  const onToggleNotify = async (id: string, value: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, notify: value } : r)));
    const slot = rows.find((r) => r.id === id);
    
    if (value && slot) {
      // Schedule new notification
      await scheduleReminder(slot);
    } else {
      // Cancel existing notification
      const notificationId = notificationIdsRef.current[id];
      if (notificationId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
          delete notificationIdsRef.current[id];
          logDebug(`✅ REMINDER CANCELLED — Slot ${id}`);
        } catch (error) {
          logError("⚠️ CANCELLATION FAILED:", error);
        }
      }
    }
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
          key={Platform.OS === "android" ? `android-time-${pickerState.openForId}` : "ios-time"}
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
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: `${COLORS.accent}26`, // 15% opacity
    borderColor: COLORS.accent,
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
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
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
