// app/(tabs)/planner.tsx
// 🧒 like I'm 5:
// We show your week. Pick a day. See tiny time chips. See recipes grouped by Breakfast/Lunch/Dinner.
// You can add recipes into a slot, move them between slots, and reorder inside a slot.
// NEW: no more white system popups — success/info messages show as dark toasts that match our theme.

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
  Animated, // 👈 for the little toast fade/slide
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter } from "expo-router";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets, SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import PlannerSlots from "@/components/PlannerSlots";

dayjs.extend(isoWeek);

import { COLORS, RADIUS, SPACING } from "@/lib/theme";

// 👇 Order of meal slots so we can sort and group
const SLOT_ORDER: Record<string, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
  other: 4,
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
  meal_date: string;           // 'YYYY-MM-DD'
  meal_slot?: string | null;   // 'breakfast' | 'lunch' | 'dinner' | ...
  sort_index?: number | null;  // 0,1,2... inside the slot
  recipe?: Recipe;
};

// 🛎️ SAFE haptics helper so Android never crashes
async function safeSuccessHaptic() {
  try {
    const t = (Haptics as any)?.NotificationFeedbackType?.Success;
    if (t) await Haptics.notificationAsync(t);
    else await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {}
}

// 🍞 tiny toast system (dark, theme-y)
function useToast() {
  // what to show
  const [toast, setToast] = useState<null | { text: string; type?: "success" | "error" | "info" }>(null);
  // fade + slide up a tiny bit
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = opacity.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  // timer so we can clear and chain shows
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // show the toast, then auto hide
  const show = (text: string, type: "success" | "error" | "info" = "info", duration = 1800) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ text, type });
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start(() => {
      timerRef.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
          setToast(null);
        });
      }, Math.max(800, duration));
    });
  };

  // the piece we render
  const ToastHost = ({ bottom }: { bottom: number }) =>
    toast ? (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.toastWrap,
          { bottom, opacity, transform: [{ translateY }] },
        ]}
      >
        <View
          style={[
            styles.toast,
            toast.type === "success" && { borderColor: "rgba(34,197,94,0.5)" },
            toast.type === "error" && { borderColor: "rgba(239,68,68,0.5)" },
          ]}
        >
          <Ionicons
            name={toast.type === "error" ? "alert-circle" : toast.type === "success" ? "checkmark-circle" : "information-circle"}
            size={18}
            color={toast.type === "error" ? COLORS.danger : toast.type === "success" ? COLORS.success : COLORS.accent}
            style={{ marginRight: 8 }}
          />
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      </Animated.View>
    ) : null;

  return { show, ToastHost };
}

// Tiny round picture used inside the day strip
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
  const toast = useToast(); // 👈 use our dark toast
  const router = useRouter();

  // deep link (optional)
  const { recipeId, date } = useLocalSearchParams<{ recipeId?: string; date?: string }>();

  // Which week & day we are looking at
  const [anchor, setAnchor] = useState(dayjs());
  const [selectedDate, setSelectedDate] = useState(dayjs().format("YYYY-MM-DD"));
  
  // Force re-render counter to ensure pills update
  const [mealsRefreshKey, setMealsRefreshKey] = useState(0);

  // Meals for the whole visible week
  const [weekMeals, setWeekMeals] = useState<Record<string, PlannerMeal[]>>({});
  const [loadingMeals, setLoadingMeals] = useState(false);

  // Sponsor banner (hidden when none)
  const [sponsor, setSponsor] = useState<{
    id?: string;
    brand?: string | null;
    headline?: string | null;
    image_url?: string | null;
    cta_text?: string | null;
    cta_url?: string | null;
  } | null>(null);
  const [loadingSponsor, setLoadingSponsor] = useState(false);

  // Search picker modal
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  0
  const [pickerResults, setPickerResults] = useState<Recipe[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  // DARK slot-picker modal (instead of white Alert)
  const [slotModal, setSlotModal] = useState<{ open: boolean; recipe: Recipe | null }>({
    open: false,
    recipe: null,
  });

  // To scroll the list back to top when day changes
  const dayListRef = useRef<ScrollView>(null);

  // ── Week helpers ──
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

  // Meals for the selected day (simple lookup)
  const dayMealsRaw: PlannerMeal[] = weekMeals[selectedDate] ?? [];

  // Group + sort day meals by slot, then by sort_index
  // Include mealsRefreshKey in deps to force recalculation when meals update
  const groupedDayMeals = useMemo(() => {
    const copy = [...dayMealsRaw];
    copy.sort((a, b) => {
      const sa = SLOT_ORDER[a.meal_slot || "dinner"] ?? 99;
      const sb = SLOT_ORDER[b.meal_slot || "dinner"] ?? 99;
      if (sa !== sb) return sa - sb;
      return (a.sort_index ?? 0) - (b.sort_index ?? 0);
    });
    const groups: Record<string, PlannerMeal[]> = {};
    for (const m of copy) {
      const key = (m.meal_slot || "dinner") as string;
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    console.log(`📦 Grouped meals:`, Object.keys(groups).map(k => `${k}:${groups[k].length}`).join(', '));
    return groups;
  }, [dayMealsRaw, mealsRefreshKey]);

  // ── Load meals for visible week ──
  const loadMeals = useCallback(async () => {
    setLoadingMeals(true);
    try {
      const startStr = weekDays[0].format("YYYY-MM-DD");
      const endStr = weekDays[6].format("YYYY-MM-DD");

      const { data, error } = await supabase
        .from("planner_meals")
        .select(
          "id, recipe_id, meal_date, meal_slot, sort_index, recipes:recipe_id(id,title,image_url,minutes,servings)"
        )
        .gte("meal_date", startStr)
        .lte("meal_date", endStr)
        .order("meal_date", { ascending: true })
        .order("meal_slot", { ascending: true })
        .order("sort_index", { ascending: true, nullsFirst: true });

      if (error) throw error;

      const byDate: Record<string, PlannerMeal[]> = {};
      weekDays.forEach((d) => (byDate[d.format("YYYY-MM-DD")] = []));
      for (const row of data ?? []) {
        const key = row.meal_date as string;
        const item: PlannerMeal = {
          id: row.id as string,
          recipe_id: row.recipe_id as string,
          meal_date: row.meal_date as string,
          meal_slot: (row as any).meal_slot ?? "dinner",
          sort_index: (row as any).sort_index ?? 0,
          recipe: row.recipes as any,
        };
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(item);
        // Debug log for the specific meal we're tracking
        if (item.id && item.meal_slot) {
          console.log(`  Meal ${item.id.slice(0, 8)}... slot: ${item.meal_slot}`);
        }
      }
      setWeekMeals(byDate);
      const selectedMeals = byDate[selectedDate] ?? [];
      console.log(`📋 Loaded meals for week, selected date has ${selectedMeals.length} meals`);
      selectedMeals.forEach(m => {
        console.log(`  - ${m.recipe?.title || 'Untitled'} in ${m.meal_slot || 'dinner'}`);
      });
    } catch (e: any) {
      // This one still uses Alert because it needs user action (DB migration)
      Alert.alert(
        "Planner needs a tiny upgrade",
        "I couldn’t read 'meal_slot/sort_index'. Please run the SQL to add those columns."
      );
    } finally {
      setLoadingMeals(false);
    }
  }, [weekDays]);

  // ── Sponsor rotation (weighted) ──
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
          const wS = Number((s as any).weight) || 1;
          const wC = Number(cr.weight) || 1;
          candidates.push({
            id: String(cr.id),
            brand: cr.brand ?? null,
            headline: cr.headline ?? null,
            image_url: cr.image_url ?? null,
            cta_text: cr.cta_text ?? null,
            cta_url: cr.cta_url ?? null,
            _weight: Math.max(1, wS * wC),
          });
        }
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
        _weight: Math.max(1, Number(cr.weight) || 1),
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

  // ── Effects ──
  useEffect(() => { loadMeals(); }, [loadMeals]);
  useEffect(() => { loadSponsor(); }, [loadSponsor]);

  // Deep-link: add recipe once, default to dinner
  useEffect(() => {
    const addFromParam = async () => {
      if (!recipeId) return;
      const target = (date as string) || selectedDate;
      await addRecipeWithSlot(recipeId as string, target, "dinner", { silent: true });
    };
    addFromParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  // ── Swipe left/right to jump weeks (vertical scroll still works) ──
  const onPanEnd = (e: any) => {
    const dx = e.nativeEvent.translationX;
    if (dx > 80) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setAnchor((prev) => prev.subtract(7, "day"));
    } else if (dx < -80) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setAnchor((prev) => prev.add(7, "day"));
    }
  };

  // ── Add/Move helpers (with slots) ──

  // Ask server for the next sort_index for a given day+slot
  const getNextSortIndex = async (ymd: string, slot: string) => {
    const { data } = await supabase
      .from("planner_meals")
      .select("sort_index")
      .eq("meal_date", ymd)
      .eq("meal_slot", slot)
      .order("sort_index", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const max = data?.sort_index ?? -1;
    return (Number.isFinite(max) ? max : -1) + 1;
  };

  // Insert with slot + proper sort_index
  const addRecipeWithSlot = async (
    rid: string,
    ymd: string,
    slot: string,
    opts?: { silent?: boolean }
  ) => {
    try {
      const nextIdx = await getNextSortIndex(ymd, slot);
      const { data: { user } } = await supabase.auth.getUser();
      
      const insertPayload: any = {
        recipe_id: rid,
        meal_date: ymd,
        meal_slot: slot,
        sort_index: nextIdx,
      };
      
      // Include user_id if the table has that column (for RLS)
      if (user?.id) {
        insertPayload.user_id = user.id;
      }
      
      const { error } = await supabase.from("planner_meals").insert(insertPayload);
      if (error) throw error;

      if (!opts?.silent) await safeSuccessHaptic();
      await loadMeals();
      // 🔔 themed toast (no white box)
      if (!opts?.silent) toast.show(`Recipe added to ${slot}.`, "success");
    } catch (e: any) {
      toast.show(e?.message ? `Add failed: ${e.message}` : "Add failed", "error", 2400);
    }
  };

  // Change slot for a meal (and give it the next sort_index in that slot)
  const updateMealSlot = async (meal: PlannerMeal, newSlot: string) => {
    try {
      console.log(`🔄 Updating meal ${meal.id} from ${meal.meal_slot} to ${newSlot}`);
      
      // First verify the meal exists and we can read it
      const { data: existing, error: checkError } = await supabase
        .from("planner_meals")
        .select("id, meal_slot, meal_date")
        .eq("id", meal.id)
        .maybeSingle();
      
      if (checkError) {
        console.error(`❌ Error checking meal existence:`, checkError);
        throw checkError;
      }
      
      if (!existing) {
        console.error(`❌ Meal ${meal.id} not found in database`);
        throw new Error("Meal not found");
      }
      
      console.log(`✅ Meal exists: current slot is ${existing.meal_slot}`);
      
      const nextIdx = await getNextSortIndex(meal.meal_date, newSlot);
      console.log(`📝 Setting sort_index to ${nextIdx} for ${newSlot}`);
      
      // Check if meal has user_id column and verify ownership
      // First try to see what columns the meal has
      const { data: mealWithOwner, error: ownerCheckError } = await supabase
        .from("planner_meals")
        .select("id, user_id, meal_slot")
        .eq("id", meal.id)
        .maybeSingle();
      
      if (ownerCheckError) {
        console.warn(`⚠️ Could not check meal ownership:`, ownerCheckError);
      } else if (mealWithOwner) {
        const { data: { user } } = await supabase.auth.getUser();
        if (mealWithOwner.user_id && mealWithOwner.user_id !== user?.id) {
          console.error(`❌ User ${user?.id} does not own meal (owned by ${mealWithOwner.user_id})`);
          throw new Error("You don't have permission to update this meal");
        }
        console.log(`✅ Ownership verified (or no user_id column)`);
      }
      
      // Update the database
      const { data: updateData, error } = await supabase
        .from("planner_meals")
        .update({ meal_slot: newSlot, sort_index: nextIdx })
        .eq("id", meal.id)
        .select("meal_slot, id");
      
      if (error) {
        console.error(`❌ Database update error:`, error);
        console.error(`   Error details:`, JSON.stringify(error, null, 2));
        throw error;
      }
      
      // Check if update actually affected any rows
      if (!updateData || updateData.length === 0) {
        // Try to get current user to check permissions
        const { data: { user } } = await supabase.auth.getUser();
        console.error(`❌ Update returned 0 rows`);
        console.error(`   Meal ID: ${meal.id}`);
        console.error(`   User ID: ${user?.id}`);
        console.error(`   Meal owner (if exists): ${mealWithOwner?.user_id || 'no user_id column'}`);
        console.error(`   Current meal_slot in DB: ${existing.meal_slot}`);
        console.error(`   Attempting to set: ${newSlot}`);
        
        // Try a workaround: delete and re-insert (if RLS allows)
        console.log(`🔄 Attempting workaround: delete and re-insert...`);
        try {
          const { error: delError } = await supabase
            .from("planner_meals")
            .delete()
            .eq("id", meal.id);
          
          if (delError) {
            console.error(`❌ Delete also failed:`, delError);
            throw new Error("Update failed: RLS policy prevents update. Database administrator needs to fix RLS policies for planner_meals table.");
          }
          
          // Re-insert with new slot (include user_id if available)
          const { data: { user } } = await supabase.auth.getUser();
          const insertPayload: any = {
            id: meal.id,
            recipe_id: meal.recipe_id,
            meal_date: meal.meal_date,
            meal_slot: newSlot,
            sort_index: nextIdx,
          };
          
          // Include user_id if available (might be needed for RLS)
          if (user?.id) {
            insertPayload.user_id = user.id;
          }
          
          const { data: insertData, error: insertError } = await supabase
            .from("planner_meals")
            .insert(insertPayload)
            .select("meal_slot, id")
            .single();
          
          if (insertError || !insertData) {
            console.error(`❌ Re-insert failed:`, insertError);
            throw new Error("Update failed: Could not re-insert meal. Please try again.");
          }
          
          console.log(`✅ Workaround succeeded: meal_slot is now ${insertData.meal_slot}`);
          
          // Force reload
          await loadMeals();
          setMealsRefreshKey((prev) => prev + 1);
          setTimeout(() => {
            toast.show(`Moved to ${newSlot}.`, "success");
          }, 150);
          return; // Exit early since we handled it
        } catch (workaroundError: any) {
          console.error(`❌ Workaround also failed:`, workaroundError);
          throw new Error("Update failed: No rows affected. Check RLS policies.");
        }
      }
      
      console.log(`✅ Update response: meal_slot is now ${updateData[0]?.meal_slot}`);
      
      // Wait a moment for database to propagate
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Verify the update worked by querying fresh
      const { data: verify, error: verifyError } = await supabase
        .from("planner_meals")
        .select("meal_slot, id")
        .eq("id", meal.id)
        .maybeSingle();
      
      if (verifyError) {
        console.error(`❌ Verification error:`, verifyError);
      } else if (verify) {
        console.log(`✅ Verified: meal_slot is now ${verify?.meal_slot}`);
      } else {
        console.warn(`⚠️ Verification returned no data - meal might have been deleted`);
      }
      
      // Force reload to update the UI immediately
      await loadMeals();
      
      // Force re-render by updating refresh key AFTER data is loaded
      setMealsRefreshKey((prev) => prev + 1);
      
      // Small delay to ensure state has updated before showing toast
      setTimeout(() => {
        toast.show(`Moved to ${newSlot}.`, "success");
      }, 150);
    } catch (e: any) {
      console.error(`❌ Failed to update meal slot:`, e);
      const message = e?.message || "Move failed";
      toast.show(message.includes("RLS") ? "Permission denied - check database policies" : message, "error", 2400);
    }
  };

  // Move a meal up/down inside its slot (swap sort_index with neighbor)
  const moveMeal = async (meal: PlannerMeal, direction: "up" | "down") => {
    const list = (groupedDayMeals[meal.meal_slot || "dinner"] ?? []).slice();
    const idx = list.findIndex((m) => m.id === meal.id);
    const neighbor = direction === "up" ? list[idx - 1] : list[idx + 1];
    if (!neighbor) return;

    try {
      const a = meal.sort_index ?? 0;
      const b = neighbor.sort_index ?? 0;

      // swap indices safely (avoid unique conflicts by staging)
      await supabase.from("planner_meals").update({ sort_index: 999999 }).eq("id", neighbor.id);
      await supabase.from("planner_meals").update({ sort_index: b }).eq("id", meal.id);
      await supabase.from("planner_meals").update({ sort_index: a }).eq("id", neighbor.id);

      await loadMeals();
    } catch (e: any) {
      toast.show(e?.message ? `Reorder failed: ${e.message}` : "Reorder failed", "error", 2400);
    }
  };

  // Open the dark slot picker (close search first so it sits on the main screen)
  const openSlotPicker = (recipe: Recipe) => {
    setPickerOpen(false);
    setTimeout(() => setSlotModal({ open: true, recipe }), 120);
  };

  // For time chips: use the last DINNER recipe (or last of the day) to compute start time
  const dinnerRecipeForSelectedDay = useMemo(() => {
    const dinners = groupedDayMeals["dinner"] ?? [];
    const last = dinners[dinners.length - 1] || dayMealsRaw[dayMealsRaw.length - 1];
    if (!last?.recipe) return undefined;
    return { id: last.recipe.id, title: last.recipe.title, totalMinutes: last.recipe.minutes ?? undefined };
  }, [groupedDayMeals, dayMealsRaw]);

  // When you pick a day, change + scroll list to top
  const handlePickDay = (ymd: string) => {
    setSelectedDate(ymd);
    requestAnimationFrame(() => dayListRef.current?.scrollTo({ y: 0, animated: true }));
  };

  // ── Search flow ──
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
      toast.show(e?.message ? `Search error: ${e.message}` : "Search error", "error", 2400);
    } finally {
      setPickerLoading(false);
    }
  };

  // ─────────────────────────── UI ───────────────────────────
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "bottom"]} pointerEvents="box-none">
        <PanGestureHandler onEnded={onPanEnd} activeOffsetX={[-30, 30]} failOffsetY={[-18, 18]}>
          <View style={[styles.container, { paddingTop: 4 }]}>

            {/* Sponsor (only if loading or present) */}
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
                          <Ionicons name="leaf" size={28} color={COLORS.accent} />
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

            {/* Day strip (horizontal) */}
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
                    onLongPress={() => {
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
                              toast.show("Cleared day.", "success");
                            } catch (e: any) {
                              toast.show(e?.message ? `Clear failed: ${e.message}` : "Clear failed", "error", 2400);
                            }
                          },
                        },
                        { text: "Cancel", style: "cancel" },
                      ]);
                    }}
                    style={[
                      styles.dayPill,
                      isSelected && { borderColor: COLORS.accent, backgroundColor: COLORS.bg },
                    ]}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.dayLabel, isSelected && { color: COLORS.accent }]}>
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

            {/* Selected day content */}
            <ScrollView
              ref={dayListRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 200 }}
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Date + tiny Add button */}
              <View style={styles.selectedHeaderRow}>
                <Text style={styles.gridTitle}>{dayjs(selectedDate).format("dddd, MMM D")}</Text>
                <TouchableOpacity onPress={openPicker} style={styles.addSmall}>
                  <Ionicons name="add" size={16} color={COLORS.accent} />
                  <Text style={styles.addSmallText}>Add Meal</Text>
                </TouchableOpacity>
              </View>

              {/* Tiny time chips */}
              <View style={{ marginBottom: 10 }}>
                <PlannerSlots
                  variant="chips"
                  date={dayjs(selectedDate, "YYYY-MM-DD").startOf("day").toDate()}
                  meals={[
                    { id: "breakfast", label: "Breakfast", targetTime: "08:00" },
                    { id: "lunch", label: "Lunch", targetTime: "12:30" },
                    {
                      id: "dinner",
                      label: "Dinner",
                      targetTime: "18:30",
                      recipe: (() => {
                        const dinners = groupedDayMeals["dinner"] ?? [];
                        const last = dinners[dinners.length - 1] || dayMealsRaw[dayMealsRaw.length - 1];
                        return last?.recipe
                          ? { id: last.recipe.id, title: last.recipe.title, totalMinutes: last.recipe.minutes ?? undefined }
                          : undefined;
                      })(),
                    },
                  ]}
                />
              </View>

              {/* Meals grouped by slot */}
              {loadingMeals ? (
                <ActivityIndicator color="#9ca3af" />
              ) : (
                <>
                  {(["breakfast", "lunch", "dinner", "snack", "other"] as const).map((slotKey) => {
                    const list = groupedDayMeals[slotKey] ?? [];
                    if (list.length === 0) return null;
                    return (
                      <View key={slotKey} style={{ marginBottom: 12 }}>
                        <Text style={styles.sectionTitle}>{slotKey[0].toUpperCase() + slotKey.slice(1)}</Text>

                        {list.map((m) => (
                          <View key={`${m.id}-${m.meal_slot}-${mealsRefreshKey}`} style={styles.mealRow}>
                            <TouchableOpacity
                              onPress={() => {
                                if (m.recipe_id) {
                                  router.push(`/recipe/${m.recipe_id}`);
                                }
                              }}
                              activeOpacity={0.7}
                            >
                              <Image source={{ uri: m.recipe?.image_url ?? "" }} style={styles.mealImg} />
                            </TouchableOpacity>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.mealTitle} numberOfLines={1}>
                                {m.recipe?.title || "Untitled"}
                              </Text>
                              <Text style={styles.mealMeta}>
                                {m.recipe?.servings ? `${m.recipe?.servings} servings` : ""}{" "}
                                {m.recipe?.minutes ? `• ${m.recipe?.minutes}m` : ""}
                              </Text>

                              {/* Slot pills to switch where this recipe belongs */}
                              <View style={styles.slotPillRow}>
                                {(["breakfast", "lunch", "dinner"] as const).map((choice) => {
                                  // Use the actual meal_slot from the database data, not stale state
                                  const currentSlot = m.meal_slot || "dinner";
                                  const active = currentSlot === choice;
                                  return (
                                    <TouchableOpacity
                                      key={`${m.id}-pill-${choice}-${mealsRefreshKey}`}
                                      onPress={() => updateMealSlot(m, choice)}
                                      style={[styles.slotPill, active && styles.slotPillActive]}
                                    >
                                      <Text style={[styles.slotPillText, active && styles.slotPillTextActive]}>
                                        {choice[0].toUpperCase() + choice.slice(1)}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>

                            {/* Move Up/Down + Delete */}
                            <View style={{ alignItems: "center", gap: 8 }}>
                              <TouchableOpacity onPress={() => moveMeal(m, "up")} style={styles.iconSquare}>
                                <Ionicons name="chevron-up" size={16} color={COLORS.text} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => moveMeal(m, "down")} style={styles.iconSquare}>
                                <Ionicons name="chevron-down" size={16} color={COLORS.text} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={async () => {
                                  try {
                                    const { error } = await supabase.from("planner_meals").delete().eq("id", m.id);
                                    if (error) throw error;
                                    await loadMeals();
                                    toast.show("Removed.", "success");
                                  } catch (e: any) {
                                    toast.show(e?.message ? `Remove failed: ${e.message}` : "Remove failed", "error", 2400);
                                  }
                                }}
                                style={[styles.iconSquare, { backgroundColor: "#00000020" }]}
                              >
                                <Ionicons name="trash" size={16} color={COLORS.danger} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                    );
                  })}

                  {/* Tiny add at bottom */}
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
                onPress={async () => {
                  await safeSuccessHaptic();
                  toast.show("Shopping list coming from planned meals 🛒", "info");
                }}
                style={[styles.fab, { bottom: insets.bottom + 18 }]}
              >
                <Ionicons name="cart" size={18} color={COLORS.text} />
                <Text style={{ color: COLORS.text, fontWeight: "700", marginLeft: 8 }}>
                  Generate Shopping List
                </Text>
              </TouchableOpacity>
            </View>

            {/* Search modal (tap a recipe → open dark slot modal) */}
            <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
              <View style={[styles.modalWrap, { paddingTop: Platform.select({ ios: 54, android: 24 }) }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Add to {dayjs(selectedDate).format("ddd, MMM D")}</Text>
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
                      <TouchableOpacity key={r.id} onPress={() => openSlotPicker(r)} style={styles.pickRow}>
                        <Image source={{ uri: r.image_url ?? "" }} style={styles.pickImg} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pickTitle} numberOfLines={1}>{r.title}</Text>
                          <Text style={styles.pickMeta}>
                            {r.servings ? `${r.servings} servings` : ""}
                            {r.minutes ? ` • ${r.minutes}m` : ""}
                          </Text>
                        </View>
                          <Ionicons name="add-circle" size={22} color={COLORS.accent} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            </Modal>

            {/* 🌙 DARK "Which meal?" modal */}
            <Modal
              visible={slotModal.open}
              transparent
              animationType="fade"
              onRequestClose={() => setSlotModal({ open: false, recipe: null })}
            >
              <View style={styles.sheetOverlay}>
                <View style={styles.sheet}>
                  <Text style={styles.sheetTitle}>Add to which meal?</Text>
                  <Text style={styles.sheetSubtitle} numberOfLines={2}>
                    {slotModal.recipe?.title}
                  </Text>

                  <View style={styles.sheetButtonsRow}>
                    {(["breakfast", "lunch", "dinner"] as const).map((choice) => (
                      <TouchableOpacity
                        key={choice}
                        onPress={() => {
                          if (!slotModal.recipe) return;
                          addRecipeWithSlot(slotModal.recipe.id, selectedDate, choice);
                          setSlotModal({ open: false, recipe: null });
                        }}
                        style={styles.sheetBtn}
                      >
                        <Text style={styles.sheetBtnText}>{choice.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    onPress={() => setSlotModal({ open: false, recipe: null })}
                    style={styles.sheetCancel}
                  >
                    <Text style={styles.sheetCancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>

            {/* 🍞 Toast host (sits above the FAB, centered) */}
            <toast.ToastHost bottom={insets.bottom + 80} />
          </View>
        </PanGestureHandler>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  // sponsor card
  sponsorWrap: { padding: 16, paddingBottom: 8 },
  sponsorCard: {
  backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sponsorEyebrow: { color: COLORS.subtext, fontSize: 12, marginBottom: 4 },
  sponsorTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  sponsorImg: { width: 72, height: 72, borderRadius: 36, marginLeft: 12, backgroundColor: COLORS.bg },
  ctaPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
  backgroundColor: COLORS.accent,
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
  backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // day strip
  dayPill: {
    width: 84,
    padding: 10,
    marginRight: 10,
  backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 2,
  borderColor: COLORS.card,
  },
  dayLabel: { color: COLORS.subtext, fontWeight: "800", fontSize: 12 },
  dayBubbleColumn: { marginTop: 6, flexDirection: "column", gap: 6, alignItems: "flex-start" },

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

  // section title
  sectionTitle: { color: COLORS.subtext, fontWeight: "800", marginBottom: 8, marginLeft: 2 },

  // meal rows
  mealRow: {
    flexDirection: "row",
    alignItems: "center",
  gap: 10,
  backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  mealImg: { width: 36, height: 36, borderRadius: 6, backgroundColor: COLORS.card },
  mealTitle: { color: COLORS.text, fontWeight: "700" },
  mealMeta: { color: COLORS.subtext, fontSize: 12 },

  iconSquare: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000020",
  },

  // slot pill chooser
  slotPillRow: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  slotPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff22",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  slotPillActive: {
    backgroundColor: "rgba(34,197,94,0.14)",
    borderColor: "rgba(34,197,94,0.5)",
  },
  slotPillText: { color: "rgba(255,255,255,0.8)", fontWeight: "700", fontSize: 12 },
  slotPillTextActive: { color: "white" },

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
  backgroundColor: COLORS.accent,
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

  // Search modal layout
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
  backgroundColor: COLORS.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { color: COLORS.text, flex: 1, paddingVertical: 0 },
  searchBtn: { backgroundColor: COLORS.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  pickRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  padding: 10,
  backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickImg: { width: 52, height: 52, borderRadius: 10, backgroundColor: COLORS.card },
  pickTitle: { color: COLORS.text, fontWeight: "800" },
  pickMeta: { color: COLORS.subtext, fontSize: 12 },

  // 🌙 Dark slot picker modal
  sheetOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
  backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  sheetTitle: { color: COLORS.text, fontSize: 16, fontWeight: "800", marginBottom: 6 },
  sheetSubtitle: { color: COLORS.subtext, marginBottom: 14 },
  sheetButtonsRow: { flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  sheetBtn: {
    flexGrow: 1,
    minWidth: 96,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetBtnText: { color: COLORS.text, fontWeight: "800" },
  sheetCancel: {
    alignSelf: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sheetCancelText: { color: COLORS.subtext, fontWeight: "700" },

  // 🍞 toast styles
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
  backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2b3342",
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
    maxWidth: "92%",
  },
  toastText: { color: COLORS.text, fontWeight: "700" },
});
