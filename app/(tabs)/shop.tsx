// app/(tabs)/shop.tsx
// LIKE I'M 5:
// - We added safe-area padding so the header sits under the clock/battery.
// - Categories now look different from ingredient rows:
//   * left blue Stripe
//   * all-caps label with accent color
//   * tiny rounded count chip
// - Everything else (swipe, send to cart, review modal) stays the same.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context"; // 🧠 safe area
import { supabase } from "@/lib/supabase";
import { COLORS, SPACING, RADIUS } from "@/lib/theme";
import HapticButton from "@/components/ui/HapticButton";
import { categorizeIngredient } from "@/lib/cart/catalog";
import {
  getProviderRegistry,
  getConnectedProviders,
  type CartItem,
  type ProviderId,
  type SuggestionCandidate,
  type SuggestionSet,
} from "@/lib/cart/providers";

type DBItem = {
  id: string;
  list_id: string;
  ingredient?: string | null;
  quantity?: string | null;
  checked?: boolean | null;
  category?: string | null;
  created_at?: string | null;
};
type Section = { title: string; data: DBItem[] };

function orderIndex(cat: string) {
  const order = [
    "Produce",
    "Meat/Protein",
    "Seafood",
    "Dairy/Eggs",
    "Bakery",
    "Pantry",
    "Spices",
    "Condiments",
    "Frozen",
    "Beverages",
    "Other",
  ];
  const i = order.findIndex((x) => x.toLowerCase() === cat.toLowerCase());
  return i === -1 ? order.length : i;
}

export default function ShopTab() {
  const insets = useSafeAreaInsets(); // 👶 keep away from the notch/clock

  const [userId, setUserId] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DBItem[]>([]);
  const [showPurchased, setShowPurchased] = useState(false);

  // cart flow
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState<ProviderId | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionSets, setSuggestionSets] = useState<SuggestionSet[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);
  useEffect(() => {
    (async () => {
      if (!userId) return;
      // ensure default list
      const { data: exists } = await supabase
        .from("shopping_lists")
        .select("id")
        .eq("user_id", userId)
        .eq("is_default", true)
        .maybeSingle();
      let id = exists?.id as string | undefined;
      if (!id) {
        const { data } = await supabase
          .from("shopping_lists")
          .insert({ user_id: userId, title: "My Shopping List", is_default: true })
          .select("id")
          .single();
        id = data?.id;
      }
      setListId(id ?? null);
    })();
  }, [userId]);

  const fetchItems = useCallback(async () => {
    if (!listId) return;
    setLoading(true);
    const { data } = await supabase.from("shopping_list_items").select("*").eq("list_id", listId);
    const filtered = (data || []).filter((r: any) =>
      showPurchased
        ? r.checked === true
        : r.checked === false || r.checked === null || typeof r.checked === "undefined"
    );
    setItems(filtered as DBItem[]);
    setLoading(false);
  }, [listId, showPurchased]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (!listId) return;
    const ch = supabase
      .channel(`shop-${listId}`)
      .on(
        "postgres_changes",
        { schema: "public", table: "shopping_list_items", event: "*", filter: `list_id=eq.${listId}` },
        fetchItems
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [listId, fetchItems]);

  // sections
  const sections: Section[] = useMemo(() => {
    const by = new Map<string, DBItem[]>();
    for (const it of items) {
      const nm = (it.ingredient || "").trim();
      const cat = (it.category && it.category.trim()) || categorizeIngredient(nm);
      if (!by.has(cat)) by.set(cat, []);
      by.get(cat)!.push(it);
    }
    return Array.from(by.entries())
      .map(([title, data]) => ({
        title,
        data: data.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")),
      }))
      .sort((a, b) => orderIndex(a.title) - orderIndex(b.title));
  }, [items]);

  // optimistic helpers
  const local = (fn: (xs: DBItem[]) => DBItem[]) => setItems((prev) => fn(prev));
  const markPurchased = async (row: DBItem, value: boolean) => {
    local((xs) => xs.filter((x) => x.id !== row.id));
    const { error } = await supabase.from("shopping_list_items").update({ checked: value }).eq("id", row.id);
    if (error) local((xs) => [row, ...xs]);
  };
  const removeItem = async (row: DBItem) => {
    local((xs) => xs.filter((x) => x.id !== row.id));
    const { error } = await supabase.from("shopping_list_items").delete().eq("id", row.id);
    if (error) local((xs) => [row, ...xs]);
  };

  const Row = ({ item }: { item: DBItem }) => {
    const ref = useRef<Swipeable | null>(null);
    const nm = (item.ingredient || "").trim();
    const qty = (item.quantity || "").trim();

    return (
      <Swipeable
        ref={ref}
        leftThreshold={28}
        rightThreshold={28}
        overshootLeft={false}
        overshootRight={false}
        renderLeftActions={() => (
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={async () => {
              await markPurchased(item, !showPurchased);
              ref.current?.close?.();
            }}
            style={[styles.panel, styles.panelAdd]}
          >
            <Text style={styles.panelText}>{showPurchased ? "Unmark" : "Purchased"}</Text>
          </TouchableOpacity>
        )}
        renderRightActions={() => (
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={async () => {
              await removeItem(item);
              ref.current?.close?.();
            }}
            style={[styles.panel, styles.panelRemove]}
          >
            <Text style={styles.panelText}>Delete</Text>
          </TouchableOpacity>
        )}
        onSwipeableOpen={async (side) => {
          if (side === "left") await markPurchased(item, !showPurchased);
          if (side === "right") await removeItem(item);
          requestAnimationFrame(() => ref.current?.close?.());
        }}
      >
        <View style={styles.itemCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName} numberOfLines={2}>
              {nm}
            </Text>
            {qty ? <Text style={styles.itemQty}>{qty}</Text> : null}
          </View>
          <View style={[styles.dot, showPurchased ? styles.dotPurchased : styles.dotNeeded]} />
        </View>
      </Swipeable>
    );
  };

  // ————— SEND TO CART —————
  const onSendToCart = async () => {
    if (!userId) {
      Alert.alert("Sign in", "Please sign in.");
      return;
    }
    if (items.length === 0) {
      Alert.alert("Nothing to send", "Add a few ingredients first.");
      return;
    }

    // try default first
    const { data: def } = await supabase
      .from("store_links")
      .select("provider")
      .eq("user_id", userId)
      .eq("is_connected", true)
      .eq("is_default", true)
      .maybeSingle();

    if (def?.provider) {
      await runSuggestionFlow(def.provider as ProviderId);
      return;
    }

    const connected = await getConnectedProviders(userId);
    if (connected.length === 1) {
      await runSuggestionFlow(connected[0]);
      return;
    }
    setStorePickerOpen(true);
  };

  async function runSuggestionFlow(providerId: ProviderId) {
    if (!userId) return;
    setSelectedStore(providerId);
    setSuggestionsLoading(true);

    // Build cart items from visible list
    const cartItems: CartItem[] = items.map((x) => ({
      name: (x.ingredient || "").trim(),
      quantity: (x.quantity || "").trim() || undefined,
      category: (x.category || "") || categorizeIngredient((x.ingredient || "").trim()),
    }));

    const provider = getProviderRegistry()[providerId];
    const sets = await provider.suggest(cartItems, userId);
    setSuggestionSets(sets);
    setSuggestionsLoading(false);
    setSuggestionsOpen(true); // this shows the REVIEW modal
  }

  async function confirmSend() {
    if (!userId || !selectedStore) return;
    const provider = getProviderRegistry()[selectedStore];
    const chosen: SuggestionCandidate[] = suggestionSets.map((s) => s.candidates[s.selectedIndex]);
    await provider.addToCart(chosen, userId);
    setSuggestionsOpen(false);
    Alert.alert("Added", `We sent ${chosen.length} item(s) to your ${provider.label} cart.`);
  }

  // tap ◀︎ / ▶︎ to cycle brand/size
  function cycleChoice(i: number, dir: number) {
    setSuggestionSets((old) =>
      old.map((s, idx) => {
        if (idx !== i) return s;
        const next = (s.selectedIndex + dir + s.candidates.length) % s.candidates.length;
        return { ...s, selectedIndex: next };
      })
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* Header — safe-area padding so it's under the clock */}
      <View
        style={{
          paddingHorizontal: SPACING.lg,
          paddingTop: insets.top + 8, // 👈 tweak the 8 if you want more/less space
          paddingBottom: 8,
        }}
      >
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900" }}>Shop</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <HapticButton
            onPress={onSendToCart}
            style={{
              flex: 1,
              backgroundColor: COLORS.accent,
              paddingVertical: 12,
              borderRadius: RADIUS.lg,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#001018", fontWeight: "900" }}>Send to Cart</Text>
          </HapticButton>
          <TouchableOpacity
            onPress={() => setShowPurchased((v) => !v)}
            activeOpacity={0.9}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: RADIUS.lg,
              backgroundColor: "#0b1220",
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: "#1f2937",
            }}
          >
            <Text style={{ color: COLORS.text, fontWeight: "800" }}>
              {showPurchased ? "Show: Purchased" : "Show: To Buy"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Body */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: COLORS.sub }}>Loading…</Text>
        </View>
      ) : sections.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <MaterialCommunityIcons name="cart-outline" size={48} color={COLORS.sub} />
          <Text style={{ color: COLORS.sub, marginTop: 10, textAlign: "center" }}>
            {showPurchased ? "No purchased items yet." : "Your list is empty. Add ingredients from a recipe!"}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {sections.map((sec) => (
            <View key={sec.title} style={styles.sectionBlock}>
              {/* CATEGORY HEADER — now visually distinct */}
              <View style={styles.sectionHeader}>
                {/* left accent stripe */}
                <View style={styles.sectionStripe} />
                {/* label + count chip */}
                <Text style={styles.sectionTitle}>{sec.title.toUpperCase()}</Text>
                <Text style={styles.sectionCount}>{sec.data.length}</Text>
              </View>

              {/* rows */}
              <View style={{ gap: 10 }}>
                {sec.data.map((item) => (
                  <View key={item.id}>
                    <Row item={item} />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Store picker (if no default) */}
      <Modal
        visible={storePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setStorePickerOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Choose Store</Text>
            <View style={{ gap: 10, marginTop: 12 }}>
              {Object.values(getProviderRegistry()).map((p) => (
                <HapticButton
                  key={p.id}
                  onPress={() => {
                    setStorePickerOpen(false);
                    runSuggestionFlow(p.id);
                  }}
                  style={[styles.modalBtn, { backgroundColor: "#111827" }]}
                >
                  <Text style={{ color: "#e5e7eb", fontWeight: "900" }}>{p.label}</Text>
                </HapticButton>
              ))}
            </View>
            <HapticButton
              onPress={() => setStorePickerOpen(false)}
              style={[styles.modalBtn, { marginTop: 12, backgroundColor: "#0b1220" }]}
            >
              <Text style={{ color: "#cbd5e1", fontWeight: "800" }}>Cancel</Text>
            </HapticButton>
          </View>
        </View>
      </Modal>

      {/* REVIEW ITEMS — cycle choices + smart qty text */}
      <Modal
        visible={suggestionsOpen || suggestionsLoading}
        transparent
        animationType="fade"
        onRequestClose={() => setSuggestionsOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={[styles.modalCard, { maxHeight: "80%" }]}>
            <Text style={styles.modalTitle}>Review Items</Text>
            <Text style={styles.modalHint}>Tap ◀︎ / ▶︎ to pick the brand/size you like.</Text>

            {suggestionsLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <ActivityIndicator />
                <Text style={{ color: "#94a3b8", marginTop: 10 }}>Finding matches…</Text>
              </View>
            ) : (
              <ScrollView style={{ marginTop: 10 }} contentContainerStyle={{ gap: 10 }}>
                {suggestionSets.map((set, i) => {
                  const cur = set.candidates[set.selectedIndex];
                  return (
                    <View key={`${set.itemName}-${i}`} style={styles.suggestionCard}>
                      <Text style={styles.itemName}>{set.itemName}</Text>
                      {set.quantity ? <Text style={styles.itemQty}>Qty: {set.quantity}</Text> : null}

                      <View style={{ marginTop: 8, gap: 6 }}>
                        <Text style={styles.suggestionTitle} numberOfLines={2}>
                          {cur.title}
                        </Text>
                        {cur.variant ? <Text style={styles.suggestionMeta}>{cur.variant}</Text> : null}
                        <Text style={styles.suggestionSource}>
                          From: {cur.source === "catalog" ? "Quick pick" : "Search"}
                        </Text>
                      </View>

                      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                        <HapticButton
                          onPress={() => cycleChoice(i, -1)}
                          style={[styles.modalBtn, { backgroundColor: "#111827" }]}
                        >
                          <Text style={{ color: "#e5e7eb", fontWeight: "800" }}>◀︎</Text>
                        </HapticButton>
                        <HapticButton
                          onPress={() => cycleChoice(i, +1)}
                          style={[styles.modalBtn, { backgroundColor: "#111827" }]}
                        >
                          <Text style={{ color: "#e5e7eb", fontWeight: "800" }}>▶︎</Text>
                        </HapticButton>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <HapticButton onPress={() => setSuggestionsOpen(false)} style={[styles.modalBtn, { backgroundColor: "#111827" }]}>
                <Text style={{ color: "#e5e7eb", fontWeight: "800" }}>Back</Text>
              </HapticButton>
              <HapticButton
                onPress={confirmSend}
                disabled={suggestionsLoading}
                style={[styles.modalBtn, { backgroundColor: COLORS.accent, opacity: suggestionsLoading ? 0.6 : 1 }]}
              >
                <Text style={{ color: "#001018", fontWeight: "900" }}>
                  {selectedStore ? `Add to ${getProviderRegistry()[selectedStore].label}` : "Add to Cart"}
                </Text>
              </HapticButton>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionBlock: { paddingHorizontal: SPACING.lg, paddingTop: 10 },

  // CATEGORY HEADER — made bolder and more "section-y"
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#071225",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    marginBottom: 12,
  },
  // thin accent stripe so your eye catches the section
  sectionStripe: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: "#38bdf8", // same accent hue
    marginRight: 2,
  },
  // All-caps + tracking, smaller than item rows, different color
  sectionTitle: {
    color: "#93c5fd",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1,
    includeFontPadding: false,
  },
  sectionCount: {
    marginLeft: 8,
    color: "#94a3b8",
    fontWeight: "900",
    backgroundColor: "#0b1220",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
  },

  itemCard: {
    backgroundColor: "#0b1220",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  itemName: { color: "#e2e8f0", fontSize: 16, fontWeight: "700" },
  itemQty: { color: "#93c5fd", fontWeight: "800", marginTop: 4, fontSize: 12 },

  dot: { width: 10, height: 10, borderRadius: 5, marginLeft: 8 },
  dotNeeded: { backgroundColor: "#38bdf8" },
  dotPurchased: { backgroundColor: "#22c55e" },

  panel: { width: 120, height: "100%", alignItems: "center", justifyContent: "center" },
  panelAdd: { backgroundColor: "#34d399" },
  panelRemove: { backgroundColor: "#f59e0b" },
  panelText: { color: "#0f172a", fontWeight: "800" },

  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    backgroundColor: "#0b1220",
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
  },
  modalTitle: { color: "#e2e8f0", fontWeight: "900", fontSize: 16 },
  modalHint: { color: "#94a3b8", marginTop: 6, marginBottom: 8, fontSize: 12 },

  suggestionCard: {
    backgroundColor: "#0a1324",
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
  },
  suggestionTitle: { color: "#e2e8f0", fontWeight: "800", fontSize: 15 },
  suggestionMeta: { color: "#93c5fd", fontWeight: "800", fontSize: 12, marginTop: 4 },
  suggestionSource: { color: "#94a3b8", fontSize: 12, marginTop: 2 },

  modalBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: RADIUS.lg,
  },
});
