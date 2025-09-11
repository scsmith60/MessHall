// app/(tabs)/planner.tsx
// Like I'm 5: Week up top, pick a day, see tiny time chips, then see that day's meals.
// Fixed: meals now always show under the chips for the picked day.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import { useLocalSearchParams } from "expo-router";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets, SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import PlannerSlots from "@/components/PlannerSlots";

dayjs.extend(isoWeek);

// 🎨 theme
const COLORS = {
  bg: "#0f172a",
  card: "#111827",
  card2: "#1f2937",
  border: "#334155",
  text: "#f8fafc",
  subtext: "#94a3b8",
  accent: "#38bdf8",
  messhall: "#22c55e",
};

// ---------- Types ----------
type Recipe = {
  id: string;
  title: string;
  image_url?: string | null;
  minutes?: number | null;
  servings?: number | null;
};

type PlannerMeal = {
  id: string;
  recipe_id: string;
  meal_date: string; // 'YYYY-MM-DD'
  recipe?: Recipe;
};

// tiny round image in day strip
function MiniRecipeBubble({ url }: { url?: string | null }) {
  return (
    <View style={styles.miniBubble}>
      {url ? (
        <Image source={{ uri: url }} style={styles.miniBubbleImg} />
      ) : (
        <View style={[styles.miniBubbleImg, { alignItems: "center", justifyContent: "center" }]}>
          <Ionicons name="restaurant" size={18} color={COLORS.subtext} />
        </View>
      )}
    </View>
  );
}

export default function PlannerScreen() {
  const insets = useSafeAreaInsets();

  // deep link support
  const { recipeId, date } = useLocalSearchParams<{ recipeId?: string; date?: string }>();

  // current week anchor + selected day
  const [anchor, setAnchor] = useState(dayjs());
  const [selectedDate, setSelectedDate] = useState(dayjs().format("YYYY-MM-DD"));

  // week meals
  const [weekMeals, setWeekMeals] = useState<Record<string, PlannerMeal[]>>({});
  const [loadingMeals, setLoadingMeals] = useState(false);

  // sponsor banner
  const [sponsor, setSponsor] = useState<{
    id?: string;
    brand?: string | null;
    headline?: string | null;
    image_url?: string | null;
    cta_text?: string | null;
    cta_url?: string | null;
  } | null>(null);
  const [loadingSponsor, setLoadingSponsor] = useState(false);

  // recipe picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<Recipe[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  // to scroll list to top when day changes
  const dayListRef = useRef<ScrollView>(null);

  // week helpers
  const weekDays = useMemo(() => {
    const start = anchor.startOf("week"); // use .startOf("isoWeek") for Mon–Sun
    return new Array(7).fill(null).map((_, i) => start.add(i, "day"));
  }, [anchor]);

  const dateRangeLabel = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[6];
    const sameMonth = first.month() === last.month();
    return `${first.format("MMM D")} – ${sameMonth ? last.format("D") : last.format("MMM D")}`;
  }, [weekDays]);

  // ✅ ALWAYS read the meals for the picked day straight from state
  const dayMeals = weekMeals[selectedDate] ?? [];

  // load meals
  const loadMeals = useCallback(async () => {
    setLoadingMeals(true);
    try {
      const startStr = weekDays[0].format("YYYY-MM-DD");
      const endStr = weekDays[6].format("YYYY-MM-DD");

      const { data, error } = await supabase
        .from("planner_meals")
        .select("id, recipe_id, meal_date, recipes:recipe_id(id,title,image_url,minutes,servings)")
        .gte("meal_date", startStr)
        .lte("meal_date", endStr)
        .order("meal_date", { ascending: true });

      if (error) throw error;

      const byDate: Record<string, PlannerMeal[]> = {};
      weekDays.forEach((d) => (byDate[d.format("YYYY-MM-DD")] = []));
      for (const row of data ?? []) {
        const key = row.meal_date as string;
        const item: PlannerMeal = {
          id: row.id as string,
          recipe_id: row.recipe_id as string,
          meal_date: row.meal_date as string,
          recipe: row.recipes as any,
        };
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(item);
      }
      setWeekMeals(byDate);
    } catch (e: any) {
      console.error(e);
      Alert.alert("Oops", e.message ?? "Could not load planner meals.");
    } finally {
      setLoadingMeals(false);
    }
  }, [weekDays]);

  // sponsor loader (weighted pick)
  function weightedPick<T extends { _weight: number }>(items: T[]): T {
    const total = items.reduce((s, it) => s + Math.max(0, it._weight), 0);
    if (total <= 0) return items[0];
    let r = Math.random() * total;
    for (const it of items) {
      r -= Math.max(0, it._weight);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  async function getOrSetDailyChoice(key: string, choices: any[]): Promise<any | null> {
    if (!choices.length) return null;
    const today = dayjs().format("YYYY-MM-DD");
    const dateKey = `${key}:date`;
    const idKey = `${key}:creative_id`;
    const [savedDate, savedId] = await Promise.all([AsyncStorage.getItem(dateKey), AsyncStorage.getItem(idKey)]);
    if (savedDate === today && savedId) {
      const found = choices.find((c: any) => String(c.id) === String(savedId));
      if (found) return found;
    }
    const pick = weightedPick(choices);
    await AsyncStorage.multiSet([[dateKey, today], [idKey, String(pick.id)]]);
    return pick;
  }
  const loadSponsor = useCallback(async () => {
    setLoadingSponsor(true);
    try {
      const today = dayjs().format("YYYY-MM-DD");

      const { data: slots } = await supabase
        .from("sponsored_slots")
        .select("id, creative_id, active_from, active_to, weight")
        .lte("active_from", today)
        .gte("active_to", today);

      type Candidate = {
        id: string;
        brand?: string | null;
        headline?: string | null;
        image_url?: string | null;
        cta_text?: string | null;
        cta_url?: string | null;
        _weight: number;
      };

      let candidates: Candidate[] = [];
      const creativeIds = (slots ?? []).map((s: any) => s.creative_id).filter(Boolean);

      if (creativeIds.length) {
        const { data: creatives } = await supabase
          .from("sponsored_creatives")
          .select("id, brand, headline, image_url, cta_text, cta_url, active_from, active_to, weight")
          .in("id", creativeIds)
          .lte("active_from", today)
          .gte("active_to", today);

        const byId = new Map<string, any>();
        for (const cr of creatives ?? []) byId.set(String(cr.id), cr);

        for (const s of slots ?? []) {
          const cr = byId.get(String((s as any).creative_id));
          if (!cr) continue;
          const wS = Number.isFinite((s as any).weight) ? Number((s as any).weight) : 1;
          const wC = Number.isFinite(cr.weight) ? Number(cr.weight) : 1;
          const combined = Math.max(0, wS) * Math.max(0, wC);
          candidates.push({
            id: String(cr.id),
            brand: cr.brand ?? null,
            headline: cr.headline ?? null,
            image_url: cr.image_url ?? null,
            cta_text: cr.cta_text ?? null,
            cta_url: cr.cta_url ?? null,
            _weight: combined > 0 ? combined : 1,
          });
        }

        // de-dupe
        const m = new Map<string, Candidate>();
        for (const c of candidates) {
          const prev = m.get(c.id);
          if (!prev || c._weight > prev._weight) m.set(c.id, c);
        }
        candidates = Array.from(m.values());
      }

      if (candidates.length) {
        const chosen = await getOrSetDailyChoice("planner_top_weighted", candidates);
        if (chosen) return setSponsor(chosen);
      }

      // fallback: any active creative today
      const { data: creativesFallback } = await supabase
        .from("sponsored_creatives")
        .select("id, brand, headline, image_url, cta_text, cta_url, active_from, active_to, weight")
        .lte("active_from", today)
        .gte("active_to", today);

      const fallback = (creativesFallback ?? []).map((cr: any) => ({
        id: String(cr.id),
        brand: cr.brand ?? null,
        headline: cr.headline ?? null,
        image_url: cr.image_url ?? null,
        cta_text: cr.cta_text ?? null,
        cta_url: cr.cta_url ?? null,
        _weight: Number.isFinite(cr.weight) ? Math.max(0, Number(cr.weight)) || 1 : 1,
      }));

      if (fallback.length) {
        const chosen = await getOrSetDailyChoice("planner_top_weighted_fallback", fallback);
        if (chosen) return setSponsor(chosen);
      }

      setSponsor(null);
    } catch {
      setSponsor(null);
    } finally {
      setLoadingSponsor(false);
    }
  }, []);

  // effects
  useEffect(() => { loadMeals(); }, [loadMeals]);
  useEffect(() => { loadSponsor(); }, [loadSponsor]);

  // deep link add-once
  useEffect(() => {
    const addFromParam = async () => {
      if (!recipeId) return;
      const target = (date as string) || selectedDate;
      await handleAddRecipeToDate(recipeId as string, target, { silent: true });
    };
    addFromParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  // swipe left/right weeks but let vertical scroll work
  const onPanEnd = (e: PanGestureHandlerStateChangeEvent) => {
    const dx = e.nativeEvent.translationX;
    if (dx > 80) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setAnchor((prev) => prev.subtract(7, "day"));
    } else if (dx < -80) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setAnchor((prev) => prev.add(7, "day"));
    }
  };
  const panProps = { onEnded: onPanEnd, activeOffsetX: [-30, 30], failOffsetY: [-18, 18] } as const;

  // picker helpers
  const openPicker = () => {
    Haptics.selectionAsync();
    setPickerOpen(true);
    setPickerResults(null);
    setPickerQuery("");
  };
  const searchRecipes = async () => {
    try {
      setPickerLoading(true);
      const q = pickerQuery.trim();
      const query = supabase.from("recipes").select("id,title,image_url,minutes,servings").limit(50);
      if (q) query.ilike("title", `%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      setPickerResults(data ?? []);
    } catch (e: any) {
      Alert.alert("Search error", e.message ?? "Could not search recipes.");
    } finally {
      setPickerLoading(false);
    }
  };
  const handleAddRecipeToDate = async (rid: string, ymd: string, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const { error } = await supabase.from("planner_meals").insert({ recipe_id: rid, meal_date: ymd });
      if (error) throw error;
      await loadMeals();
      if (!opts?.silent) Alert.alert("Added", "Recipe added to your day!");
    } catch (e: any) {
      Alert.alert("Oops", e.message ?? "Could not add recipe.");
    }
  };

  const onDayLongPress = (ymd: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Day options", dayjs(ymd).format("dddd, MMM D"), [
      { text: "Add a recipe", onPress: () => { setSelectedDate(ymd); openPicker(); } },
      {
        text: "Clear all on this day",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase.from("planner_meals").delete().eq("meal_date", ymd);
            if (error) throw error;
            await loadMeals();
          } catch (e: any) {
            Alert.alert("Oops", e.message ?? "Could not clear day.");
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // dinner recipe (use last recipe of the picked day)
  const dinnerRecipeForSelectedDay = useMemo(() => {
    const last = dayMeals[dayMeals.length - 1];
    if (!last?.recipe) return undefined;
    return { id: last.recipe.id, title: last.recipe.title, totalMinutes: last.recipe.minutes ?? undefined };
  }, [dayMeals]);

  // when you tap a day → change and scroll list to top
  const handlePickDay = (ymd: string) => {
    setSelectedDate(ymd);
    requestAnimationFrame(() => dayListRef.current?.scrollTo({ y: 0, animated: true }));
  };

  // ────────────────────── UI ──────────────────────
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "bottom"]} pointerEvents="box-none">
        <PanGestureHandler {...panProps}>
          <View style={[styles.container, { paddingTop: 4 }]}>

            {/* Sponsor: only render when loading OR we have one (prevents ghost “/”) */}
            {!!(loadingSponsor || sponsor) && (
              <View style={styles.sponsorWrap}>
                {loadingSponsor ? (
                  <View style={[styles.sponsorCard, { alignItems: "center", justifyContent: "center" }]}>
                    <ActivityIndicator color="#9ca3af" />
                  </View>
                ) : sponsor ? (
                  <TouchableOpacity
                    onPress={() => { Haptics.selectionAsync(); if (sponsor.cta_url) Linking.openURL(sponsor.cta_url); }}
                    activeOpacity={0.9}
                    style={styles.sponsorCard}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sponsorEyebrow}>Sponsored by {sponsor.brand}</Text>
                        <Text style={styles.sponsorTitle} numberOfLines={1}>
                          {sponsor.headline || "This week’s dinners"}
                        </Text>
                        {!!sponsor.cta_text && (
                          <View style={styles.ctaPill}>
                            <Text style={styles.ctaText}>{sponsor.cta_text}</Text>
                            <Ionicons name="chevron-forward" size={14} color={COLORS.text} />
                          </View>
                        )}
                      </View>
                      {sponsor.image_url ? (
                        <Image source={{ uri: sponsor.image_url }} style={styles.sponsorImg} />
                      ) : (
                        <View style={[styles.sponsorImg, { alignItems: "center", justifyContent: "center" }]}>
                          <Ionicons name="leaf" size={28} color={COLORS.messhall} />
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}

            {/* Week header */}
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setAnchor((p) => p.subtract(7, "day")); }} style={styles.iconBtn}>
                <Ionicons name="chevron-back" size={18} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.headerText}>Week of {dateRangeLabel}</Text>
              <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setAnchor((p) => p.add(7, "day")); }} style={styles.iconBtn}>
                <Ionicons name="chevron-forward" size={18} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            {/* Day strip */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              contentInsetAdjustmentBehavior="automatic"
            >
              {weekDays.map((d) => {
                const ymd = d.format("YYYY-MM-DD");
                const isSelected = selectedDate === ymd;
                const meals = weekMeals[ymd] || [];
                return (
                  <TouchableOpacity
                    key={ymd}
                    onPress={() => handlePickDay(ymd)}
                    onLongPress={() => onDayLongPress(ymd)}
                    style={[
                      styles.dayPill,
                      isSelected && { borderColor: COLORS.messhall, backgroundColor: "#0b1220" },
                    ]}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.dayLabel, isSelected && { color: COLORS.messhall }]}>
                      {d.format("ddd").toUpperCase()}
                    </Text>
                    <View style={styles.dayBubbleColumn}>
                      {(meals.slice(0, 8)).map((m) => (
                        <MiniRecipeBubble key={m.id} url={m.recipe?.image_url} />
                      ))}
                      {meals.length === 0 && <MiniRecipeBubble />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Selected day + meals list */}
            <ScrollView
              ref={dayListRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 200 }}
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* date + Add */}
              <View style={styles.selectedHeaderRow}>
                <Text style={styles.gridTitle}>{dayjs(selectedDate).format("dddd, MMM D")}</Text>
                <TouchableOpacity onPress={openPicker} style={styles.addSmall}>
                  <Ionicons name="add" size={16} color={COLORS.accent} />
                  <Text style={styles.addSmallText}>Add Meal</Text>
                </TouchableOpacity>
              </View>

              {/* time chips */}
              <View style={{ marginBottom: 10 }}>
                <PlannerSlots
                  variant="chips"
                  date={dayjs(selectedDate).toDate()}
                  meals={[
                    { id: "breakfast", label: "Breakfast", targetTime: "08:00" },
                    { id: "lunch", label: "Lunch", targetTime: "12:30" },
                    {
                      id: "dinner",
                      label: "Dinner",
                      targetTime: "18:30",
                      recipe: (() => {
                        const last = dayMeals[dayMeals.length - 1];
                        return last?.recipe
                          ? { id: last.recipe.id, title: last.recipe.title, totalMinutes: last.recipe.minutes ?? undefined }
                          : undefined;
                      })(),
                    },
                  ]}
                />
              </View>

              {/* meals for this picked day */}
              {loadingMeals ? (
                <ActivityIndicator color="#9ca3af" />
              ) : (
                <>
                  {dayMeals.map((m) => (
                    <View key={m.id} style={styles.mealRow}>
                      <Image source={{ uri: m.recipe?.image_url ?? "" }} style={styles.mealImg} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.mealTitle} numberOfLines={1}>
                          {m.recipe?.title || "Untitled"}
                        </Text>
                        <Text style={styles.mealMeta}>
                          {m.recipe?.servings ? `${m.recipe?.servings} servings` : ""}{" "}
                          {m.recipe?.minutes ? `• ${m.recipe?.minutes}m` : ""}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={async () => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          try {
                            const { error } = await supabase.from("planner_meals").delete().eq("id", m.id);
                            if (error) throw error;
                            await loadMeals();
                          } catch (e: any) {
                            Alert.alert("Oops", e.message ?? "Could not remove recipe.");
                          }
                        }}
                        style={styles.deleteBtn}
                      >
                        <Ionicons name="trash" size={16} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ))}

                  {/* tiny add at bottom */}
                  <TouchableOpacity onPress={openPicker} style={styles.addSlot}>
                    <Ionicons name="add" size={18} color={COLORS.accent} />
                    <Text style={styles.addSlotText}>Add Meal</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>

            {/* Floating cart button */}
            <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0 }}>
              <TouchableOpacity
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert("Shopping list", "We’ll generate this from your planned recipes next 🛒");
                }}
                style={[styles.fab, { bottom: insets.bottom + 18 }]}
              >
                <Ionicons name="cart" size={18} color={COLORS.text} />
                <Text style={{ color: COLORS.text, fontWeight: "700", marginLeft: 8 }}>
                  Generate Shopping List
                </Text>
              </TouchableOpacity>
            </View>

            {/* Recipe picker */}
            <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
              <View style={[styles.modalWrap, { paddingTop: Platform.select({ ios: 54, android: 24 }) }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    Add recipe to {dayjs(selectedDate).format("ddd, MMM D")}
                  </Text>
                  <TouchableOpacity onPress={() => setPickerOpen(false)} style={styles.iconBtn}>
                    <Ionicons name="close" size={22} color={COLORS.text} />
                  </TouchableOpacity>
                </View>

                <View style={styles.searchRow}>
                  <Ionicons name="search" size={16} color={COLORS.subtext} />
                  <TextInput
                    placeholder="Search my recipes..."
                    placeholderTextColor={COLORS.subtext}
                    style={styles.searchInput}
                    value={pickerQuery}
                    onChangeText={setPickerQuery}
                    onSubmitEditing={searchRecipes}
                    returnKeyType="search"
                  />
                  <TouchableOpacity onPress={searchRecipes} style={styles.searchBtn}>
                    <Text style={{ color: COLORS.text, fontWeight: "700" }}>Search</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ flex: 1 }}>
                  {pickerLoading && <ActivityIndicator style={{ marginTop: 16 }} color="#9ca3af" />}
                  {!pickerLoading && pickerResults?.length === 0 && (
                    <Text style={{ color: COLORS.subtext, textAlign: "center", marginTop: 24 }}>
                      No recipes found. Try a different word.
                    </Text>
                  )}
                  <View style={{ padding: 16, gap: 12 }}>
                    {(pickerResults ?? []).map((r) => (
                      <TouchableOpacity
                        key={r.id}
                        onPress={() => handleAddRecipeToDate(r.id, selectedDate).then(() => setPickerOpen(false))}
                        style={styles.pickRow}
                      >
                        <Image source={{ uri: r.image_url ?? "" }} style={styles.pickImg} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pickTitle} numberOfLines={1}>
                            {r.title}
                          </Text>
                          <Text style={styles.pickMeta}>
                            {r.servings ? `${r.servings} servings` : ""}
                            {r.minutes ? ` • ${r.minutes}m` : ""}
                          </Text>
                        </View>
                        <Ionicons name="add-circle" size={22} color={COLORS.messhall} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </Modal>
          </View>
        </PanGestureHandler>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  // sponsor
  sponsorWrap: { padding: 16, paddingBottom: 8 },
  sponsorCard: {
    backgroundColor: COLORS.card2,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sponsorEyebrow: { color: COLORS.subtext, fontSize: 12, marginBottom: 4 },
  sponsorTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  sponsorImg: { width: 72, height: 72, borderRadius: 36, marginLeft: 12, backgroundColor: "#0b1220" },
  ctaPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.messhall,
    borderRadius: 999,
    gap: 6,
  },
  ctaText: { color: COLORS.text, fontSize: 12, fontWeight: "800" },

  // header
  headerRow: {
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  headerText: { color: COLORS.text, fontWeight: "800", fontSize: 16 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.card2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // day strip
  dayPill: {
    width: 84,
    padding: 10,
    marginRight: 10,
    backgroundColor: COLORS.card2,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.card2,
  },
  dayLabel: { color: COLORS.subtext, fontWeight: "800", fontSize: 12 },
  dayBubbleColumn: {
    marginTop: 6,
    flexDirection: "column",
    gap: 6,
    alignItems: "flex-start",
  },

  miniBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffffff22",
    backgroundColor: COLORS.card,
    overflow: "hidden",
  },
  miniBubbleImg: { width: "100%", height: "100%" },

  // selected day header
  selectedHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  gridTitle: { color: COLORS.subtext, marginBottom: 0, fontWeight: "700", fontSize: 16 },

  // meal rows
  mealRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: COLORS.card2,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  mealImg: { width: 36, height: 36, borderRadius: 6, backgroundColor: COLORS.card },
  mealTitle: { color: COLORS.text, fontWeight: "700" },
  mealMeta: { color: COLORS.subtext, fontSize: 12 },
  deleteBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#00000020",
  },

  // add buttons
  addSmall: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: COLORS.accent,
    backgroundColor: "transparent",
  },
  addSmallText: { color: COLORS.accent, fontWeight: "700" },
  addSlot: {
    alignSelf: "flex-start",
    borderStyle: "dashed",
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexDirection: "row",
    marginTop: 2,
  },
  addSlotText: { color: COLORS.accent, fontWeight: "700" },

  // floating cart
  fab: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: COLORS.messhall,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },

  // modal (picker)
  modalWrap: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  modalTitle: { color: COLORS.text, fontWeight: "800", fontSize: 16 },
  searchRow: {
    marginTop: 12,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { color: COLORS.text, flex: 1, paddingVertical: 0 },
  searchBtn: {
    backgroundColor: COLORS.messhall,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  pickRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 10,
    backgroundColor: COLORS.card2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickImg: { width: 52, height: 52, borderRadius: 10, backgroundColor: COLORS.card },
  pickTitle: { color: COLORS.text, fontWeight: "800" },
  pickMeta: { color: COLORS.subtext, fontSize: 12 },
});
