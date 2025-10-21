// app/(tabs)/shop.tsx
// LIKE I'M 5:
// - We added little "buzz" feelings so actions feel real.
// - We ALSO open store links if the server sends one back (redirectUrl).
// - That means Amazon/Walmart affiliate flows can hop to the store app/website.

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
  Pressable,
  Linking, // 🆕 so we can open redirectUrl
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
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
  type AddToCartResult, // 🆕 type of server response
} from "@/lib/cart/providers";

// 🆕 HAPTICS: Expo haptics helpers
import * as Haptics from "expo-haptics";
const hTick = async () => { try { await Haptics.selectionAsync(); } catch {} };
const hThump = async () => { try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {} };
const hWarn = async () => { try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {} };
const hSuccess = async () => { try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {} };

/* ---------------------- tiny types from your DB ---------------------- */
type DBItem = {
  id: string;
  list_id: string;
  ingredient?: string | null;
  quantity?: string | null;
  checked?: boolean | null; // true = in cart (purchased); false/null = to buy
  category?: string | null;
  created_at?: string | null;
};
type Section = { title: string; data: DBItem[] };

/* ---------------------- category ordering (aisle order) ---------------------- */
function orderIndex(cat: string) {
  const order = [
    "Produce",
    "Meat/Protein",
    "Seafood",
    "Dairy/EggS", // keep both spellings safe
    "Dairy/Eggs",
    "Bakery",
    "Baking",
    "Breakfast & Cereal",
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

/* ---------------------- simple view filter ---------------------- */
type Filter = "toBuy" | "inCart" | "all";

/* ---------------------- category options for picker ---------------------- */
const CATEGORY_OPTIONS = [
  "Produce",
  "Meat/Protein",
  "Seafood",
  "Dairy/Eggs",
  "Bakery",
  "Baking",
  "Breakfast & Cereal",
  "Pantry",
  "Spices",
  "Condiments",
  "Frozen",
  "Beverages",
  "Other",
];

export default function ShoppingListTab() {
  const insets = useSafeAreaInsets();

  // who am i / which list
  const [userId, setUserId] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);

  // items + loading
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DBItem[]>([]);

  // view filter
  const [filter, setFilter] = useState<Filter>("toBuy");

  // send-to-cart state
  const [storePickerOpen, setStorePickerOpen] = useState(false);
  const [selectedStore, setSelectedStore] = useState<ProviderId | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionSets, setSuggestionSets] = useState<SuggestionSet[]>([]);

  // ✏️ category editor modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<DBItem | null>(null);

  // ✅ multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedCount = selectedIds.size;

  // ✅ freeze which items are being sent (selected or all) for the suggestion flow
  const [itemsForCart, setItemsForCart] = useState<DBItem[]>([]);

  // connected providers → decide CTA text
  const [connectedProviders, setConnectedProviders] = useState<ProviderId[]>([]);
  const hasConnected = connectedProviders.length > 0;

  /* ---------------------- auth: get user id ---------------------- */
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  /* ---------------------- ensure a default list exists ---------------------- */
  useEffect(() => {
    (async () => {
      if (!userId) return;
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

  /* ---------------------- load connected providers for CTA ---------------------- */
  useEffect(() => {
    (async () => {
      if (!userId) return setConnectedProviders([]);
      try {
        const list = await getConnectedProviders(userId);
        setConnectedProviders(list);
      } catch {
        setConnectedProviders([]);
      }
    })();
  }, [userId]);

  /* ---------------------- fetch items for the list ---------------------- */
  const fetchItems = useCallback(async () => {
    if (!listId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("shopping_list_items")
      .select("*")
      .eq("list_id", listId);

    if (error) {
      setItems([]);
      setLoading(false);
      return;
    }

    // "toBuy"   → show unchecked only
    // "inCart"  → show checked only
    // "all"     → show everything
    const filtered = (data || []).filter((r) => {
      const isChecked = r.checked === true;
      if (filter === "all") return true;
      if (filter === "inCart") return isChecked;
      return !isChecked; // toBuy
    });

    setItems(filtered as DBItem[]);
    setLoading(false);
  }, [listId, filter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  /* ---------------------- realtime updates ---------------------- */
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

  /* ---------------------- keep selection valid when items change ---------------------- */
  useEffect(() => {
    setSelectedIds((prev) => {
      const keep = new Set<string>();
      const ids = new Set(items.map((x) => x.id));
      prev.forEach((id) => {
        if (ids.has(id)) keep.add(id);
      });
      return keep;
    });
  }, [items]);

  /* ---------------------- group rows by category ---------------------- */
  const sections: Section[] = useMemo(() => {
    const by = new Map<string, DBItem[]>();
    for (const it of items) {
      const name = (it.ingredient || "").trim();
      // if DB has a category, use it; otherwise guess
      const cat = (it.category && it.category.trim()) || categorizeIngredient(name);
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

  /* ---------------------- local helper to mutate current view ---------------------- */
  const local = (fn: (xs: DBItem[]) => DBItem[]) => setItems((prev) => fn(prev));

  /* ---------------------- selection helpers (with little ticks) ---------------------- */
  function toggleSelect(row: DBItem) {
    hTick(); // tiny tick when picking/unpicking
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  function toggleSectionSelect(title: string) {
    hTick(); // tiny tick on section select/clear
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const sec = sections.find((s) => s.title === title);
      if (!sec) return next;
      const allSelected = sec.data.length > 0 && sec.data.every((i) => next.has(i.id));
      if (allSelected) {
        sec.data.forEach((i) => next.delete(i.id));
      } else {
        sec.data.forEach((i) => next.add(i.id));
      }
      return next;
    });
  }

  /* ---------------------- 🆕 filter helper = change + tick ---------------------- */
  const setFilterH = (next: Filter) => {
    hTick();        // gentle haptic tap
    setFilter(next); // switch the view
  };

  /* ---------------------- toggle purchased (with thump) ---------------------- */
  const markPurchased = async (row: DBItem, value: boolean) => {
    await hThump(); // soft thump on Purchased/Unmark

    // instant UI update
    local((xs) => {
      const next = xs.map((x) => (x.id === row.id ? { ...x, checked: value } : x));
      // if new state hides it in current filter, drop from view + unselect
      if (filter === "toBuy" && value) {
        setSelectedIds((prev) => {
          const n = new Set(prev);
          n.delete(row.id);
          return n;
        });
        return next.filter((x) => x.id !== row.id);
      }
      if (filter === "inCart" && !value) {
        setSelectedIds((prev) => {
          const n = new Set(prev);
          n.delete(row.id);
          return n;
        });
        return next.filter((x) => x.id !== row.id);
      }
      return next;
    });

    const { error } = await supabase
      .from("shopping_list_items")
      .update({ checked: value })
      .eq("id", row.id);

    if (error) {
      // revert if DB failed
      local((xs) => xs.map((x) => (x.id === row.id ? row : x)));
      Alert.alert("Oops", "Could not update item. Please try again.");
    }
  };

  /* ---------------------- delete item (with warning buzz) ---------------------- */
  const removeItem = async (row: DBItem) => {
    await hWarn(); // warning buzz on delete
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.delete(row.id);
      return n;
    });
    local((xs) => xs.filter((x) => x.id !== row.id));
    const { error } = await supabase.from("shopping_list_items").delete().eq("id", row.id);
    if (error) {
      local((xs) => [row, ...xs]);
      Alert.alert("Oops", "Could not delete item. Please try again.");
    }
  };

  /* ---------------------- edit category ---------------------- */
  const openCategoryEditor = (row: DBItem) => {
    setEditingItem(row);
    setCatModalOpen(true);
  };

  const saveCategory = async (row: DBItem, newCategory: string) => {
    // instant UI move
    local((xs) => xs.map((x) => (x.id === row.id ? { ...x, category: newCategory } : x)));

    const { error } = await supabase
      .from("shopping_list_items")
      .update({ category: newCategory })
      .eq("id", row.id);

    if (error) {
      local((xs) => xs.map((x) => (x.id === row.id ? row : x)));
      Alert.alert("Oops", "Could not save category. Please try again.");
      return;
    }

    setCatModalOpen(false);
    setEditingItem(null);
  };

  /* ---------------------- single row with swipe + edit + select ---------------------- */
  const Row = ({ item }: { item: DBItem }) => {
    const ref = useRef<Swipeable | null>(null);
    const nm = (item.ingredient || "").trim();
    const qty = (item.quantity || "").trim();
    const isChecked = item.checked === true;
    const isSelected = selectedIds.has(item.id);

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
              await markPurchased(item, !isChecked);
              ref.current?.close?.();
            }}
            style={[styles.panel, styles.panelAdd]}
          >
            <Text style={styles.panelText}>{isChecked ? "Unmark" : "Purchased"}</Text>
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
          if (side === "left") await markPurchased(item, !isChecked);
          if (side === "right") await removeItem(item);
          requestAnimationFrame(() => ref.current?.close?.());
        }}
      >
        <Pressable
          onLongPress={async () => {
            await hTick();
            toggleSelect(item);
          }}
          style={[
            styles.itemCard,
            isSelected && { borderColor: "#38bdf8", backgroundColor: "#0c1a2e" },
          ]}
        >
          {/* little checkbox with tick on tap */}
          <Pressable
            onPress={async () => {
              await hTick();
              toggleSelect(item);
            }}
            style={styles.selectBox}
            hitSlop={8}
          >
            <View style={[styles.selectInner, isSelected && styles.selectInnerOn]} />
          </Pressable>

          {/* words */}
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName} numberOfLines={2}>
              {nm}
            </Text>
            {qty ? <Text style={styles.itemQty}>{qty}</Text> : null}
          </View>

          {/* tiny status dot */}
          <View style={[styles.dot, isChecked ? styles.dotPurchased : styles.dotNeeded]} />

          {/* ✏️ edit category */}
          <TouchableOpacity
            onPress={() => openCategoryEditor(item)}
            style={styles.iconBtn}
            hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
          >
            <MaterialCommunityIcons name="pencil" size={18} color="#9fb3c8" />
          </TouchableOpacity>
        </Pressable>
      </Swipeable>
    );
  };

  /* ---------------------- send to cart flow ---------------------- */
  const onSendToCart = async () => {
    if (!userId) {
      Alert.alert("Sign in", "Please sign in.");
      return;
    }

    // decide what we're sending: selected items or everything visible
    const planned = selectedCount > 0 ? items.filter((x) => selectedIds.has(x.id)) : items;
    if (planned.length === 0) {
      Alert.alert("Nothing to send", "Pick some items or add a few first.");
      return;
    }
    setItemsForCart(planned); // freeze the list for the flow

    // try default first
    const { data: def } = await supabase
      .from("store_links")
      .select("provider")
      .eq("user_id", userId)
      .eq("is_connected", true)
      .eq("is_default", true)
      .maybeSingle();

    if (def?.provider) {
      await runSuggestionFlow(def.provider as ProviderId, planned);
      return;
    }

    // pick from connected providers (if any)
    const connected = await getConnectedProviders(userId);
    if (connected.length === 1) {
      await runSuggestionFlow(connected[0], planned);
      return;
    }

    // none or many → open chooser
    setStorePickerOpen(true);
  };

  async function runSuggestionFlow(providerId: ProviderId, whichItems: DBItem[]) {
    if (!userId) return;
    setSelectedStore(providerId);
    setSuggestionsLoading(true);

    // build cart items FROM THE GIVEN LIST (selected or all)
    const cartItems: CartItem[] = whichItems.map((x) => ({
      name: (x.ingredient || "").trim(),
      quantity: (x.quantity || "").trim() || undefined,
      category: (x.category || "") || categorizeIngredient((x.ingredient || "").trim()),
    }));

    const provider = getProviderRegistry()[providerId];
    const sets = await provider.suggest(cartItems, userId);
    setSuggestionSets(sets);
    setSuggestionsLoading(false);
    setSuggestionsOpen(true); // show the REVIEW modal
  }

  async function confirmSend() {
    if (!userId || !selectedStore) return;
    const provider = getProviderRegistry()[selectedStore];
    const chosen: SuggestionCandidate[] = suggestionSets.map((s) => s.candidates[s.selectedIndex]);

    // 🆕 capture the server response (may contain redirectUrl)
    let result: AddToCartResult | undefined;
    try {
      result = await provider.addToCart(chosen, userId);
    } catch (e: any) {
      Alert.alert("Oops", e?.message ?? "Could not add to cart. Please try again.");
      return;
    }

    setSuggestionsOpen(false);
    setSelectedIds(new Set());

    // 🆕 if server wants us to open a link (affiliate/deep link), do it now
    if (result?.redirectUrl) {
      Linking.openURL(result.redirectUrl).catch(() => {});
    }

    await hSuccess(); // happy buzz on success
    Alert.alert("Added", `We sent ${chosen.length} item(s) to your ${provider.label} cart.`);
  }

  function cycleChoice(i: number, dir: number) {
    setSuggestionSets((old) =>
      old.map((s, idx) => {
        if (idx !== i) return s;
        const next = (s.selectedIndex + dir + s.candidates.length) % s.candidates.length;
        return { ...s, selectedIndex: next };
      })
    );
  }

  /* ---------------------- go connect screen helper ---------------------- */
  function goConnectStore(providerId?: ProviderId) {
    try {
      router.push({ pathname: "/profile/stores", params: providerId ? { provider: providerId } : {} } as any);
    } catch {
      Alert.alert("Connect a store", "Go to Profile → Store Connections to link a store.");
    }
  }

  /* ---------------------- render ---------------------- */
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* HEADER */}
      <View
        style={{
          paddingHorizontal: SPACING.lg,
          paddingTop: insets.top + 8,
          paddingBottom: 8,
        }}
      >
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: "900" }}>Shopping List</Text>

        {/* CTA + Filter */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12, alignItems: "center" }}>
          <HapticButton
            onPress={hasConnected ? onSendToCart : () => goConnectStore()}
            style={{
              flex: 1,
              backgroundColor: COLORS.accent,
              paddingVertical: 12,
              borderRadius: RADIUS.lg,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#001018", fontWeight: "900" }}>
              {!hasConnected
                ? "Connect a Store"
                : selectedCount > 0
                ? `Add Selected to Cart (${selectedCount})`
                : "Send All to Cart"}
            </Text>
          </HapticButton>

          {/* To Buy | In Cart | All */}
          <View style={styles.segmentWrap}>
            <TouchableOpacity
              onPress={() => setFilterH("toBuy")}
              activeOpacity={0.9}
              style={[styles.segmentBtn, filter === "toBuy" && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, filter === "toBuy" && styles.segmentTextActive]}>To Buy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setFilterH("inCart")}
              activeOpacity={0.9}
              style={[styles.segmentBtn, filter === "inCart" && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, filter === "inCart" && styles.segmentTextActive]}>In Cart</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setFilterH("all")}
              activeOpacity={0.9}
              style={[styles.segmentBtn, filter === "all" && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, filter === "all" && styles.segmentTextActive]}>All</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* tiny helper text when selected */}
        {selectedCount > 0 && (
          <Text style={{ color: "#93c5fd", marginTop: 6, fontSize: 12 }}>
            Tip: Long-press rows or tap the little box to pick/unpick. Use section “Select” to grab a whole aisle.
          </Text>
        )}
      </View>

      {/* BODY */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: COLORS.subtext }}>Loading…</Text>
        </View>
      ) : sections.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <MaterialCommunityIcons name="cart-outline" size={48} color={COLORS.subtext} />
          <Text style={{ color: COLORS.subtext, marginTop: 10, textAlign: "center" }}>
            {filter === "inCart"
              ? "No purchased items yet."
              : filter === "toBuy"
              ? "Your list is empty. Add ingredients from a recipe!"
              : "Nothing here yet."}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {sections.map((sec) => {
            const allSelected =
              sec.data.length > 0 && sec.data.every((i) => selectedIds.has(i.id));
            return (
              <View key={sec.title} style={styles.sectionBlock}>
                {/* category header */}
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionStripe} />
                  <Text style={styles.sectionTitle}>{sec.title.toUpperCase()}</Text>
                  <Text style={styles.sectionCount}>{sec.data.length}</Text>

                  {/* Select / Clear for this section */}
                  <TouchableOpacity
                    onPress={() => toggleSectionSelect(sec.title)}
                    style={[styles.selectAllBtn, allSelected && { borderColor: "#38bdf8" }]}
                  >
                    <Text style={[styles.selectAllText, allSelected && { color: "#e2e8f0" }]}>
                      {allSelected ? "Clear" : "Select"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ gap: 10 }}>
                  {sec.data.map((item) => (
                    <View key={item.id}>
                      <Row item={item} />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* PICK A STORE */}
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
              {Object.values(getProviderRegistry()).map((p) => {
                const isConnected = connectedProviders.includes(p.id);
                return (
                  <HapticButton
                    key={p.id}
                    onPress={() => {
                      if (!userId) return;
                      if (isConnected) {
                        setStorePickerOpen(false);
                        // use the frozen list if we have it, else fall back to current items/selection
                        const planned =
                          itemsForCart.length > 0
                            ? itemsForCart
                            : selectedCount > 0
                            ? items.filter((x) => selectedIds.has(x.id))
                            : items;
                        runSuggestionFlow(p.id, planned);
                      } else {
                        setStorePickerOpen(false);
                        goConnectStore(p.id);
                      }
                    }}
                    style={[styles.modalBtn, { backgroundColor: "#111827" }]}
                  >
                    <Text style={{ color: "#e5e7eb", fontWeight: "900" }}>
                      {isConnected ? `Use ${p.label}` : `Connect ${p.label}`}
                    </Text>
                  </HapticButton>
                );
              })}
            </View>
            <HapticButton
              onPress={() => setStorePickerOpen(false)}
              style={[styles.modalBtn, { marginTop: 12, backgroundColor: "#0b1220" }]}
            >
              <Text style={{ color: "#cbd5e1", fontWeight: "800" }}>Cancel</Text>
            </HapticButton>

            {!hasConnected && (
              <Text style={{ color: "#94a3b8", marginTop: 10, fontSize: 12, textAlign: "center" }}>
                Tip: You can also connect stores from Profile → Store Connections.
              </Text>
            )}
          </View>
        </View>
      </Modal>

      {/* REVIEW ITEMS */}
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

      {/* ✏️ EDIT CATEGORY MODAL */}
      <Modal
        visible={catModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setCatModalOpen(false);
          setEditingItem(null);
        }}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Pick a Category</Text>
            <Text style={styles.modalHint}>
              {editingItem?.ingredient ? editingItem.ingredient : "Choose where this belongs"}
            </Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {CATEGORY_OPTIONS.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => editingItem && saveCategory(editingItem, cat)}
                  style={styles.catChip}
                  activeOpacity={0.9}
                >
                  <Text style={styles.catChipText}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <HapticButton
              onPress={() => {
                setCatModalOpen(false);
                setEditingItem(null);
              }}
              style={[styles.modalBtn, { marginTop: 16, backgroundColor: "#0b1220" }]}
            >
              <Text style={{ color: "#cbd5e1", fontWeight: "800" }}>Cancel</Text>
            </HapticButton>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------------------- styles ---------------------- */
const styles = StyleSheet.create({
  sectionBlock: { paddingHorizontal: SPACING.lg, paddingTop: 10 },

  // category header
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
  sectionStripe: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: "#38bdf8",
    marginRight: 2,
  },
  sectionTitle: {
    color: "#93c5fd",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1,
    includeFontPadding: false,
    flex: 1,
  },
  sectionCount: {
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

  // Select/Clear section button
  selectAllBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    backgroundColor: "#0b1220",
  },
  selectAllText: { color: "#9fb3c8", fontWeight: "800", fontSize: 12 },

  // item card
  itemCard: {
    backgroundColor: "#0b1220",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  itemName: { color: "#e2e8f0", fontSize: 16, fontWeight: "700" },
  itemQty: { color: "#93c5fd", fontWeight: "800", marginTop: 4, fontSize: 12 },

  // tiny status dot
  dot: { width: 10, height: 10, borderRadius: 5, marginLeft: 8 },
  dotNeeded: { backgroundColor: "#38bdf8" },
  dotPurchased: { backgroundColor: "#22c55e" },

  // tiny round icon button (pencil)
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a1629",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#14233b",
  },

  // swipe panels
  panel: { width: 120, height: "100%", alignItems: "center", justifyContent: "center" },
  panelAdd: { backgroundColor: "#34d399" },
  panelRemove: { backgroundColor: "#f59e0b" },
  panelText: { color: "#0f172a", fontWeight: "800" },

  // modals (shared)
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

  // suggestion review cards
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

  // segmented filter
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: "#0b1220",
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
    overflow: "hidden",
  },
  segmentBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  segmentBtnActive: {
    backgroundColor: "#0e2a47",
  },
  segmentText: { color: "#9fb3c8", fontWeight: "800", fontSize: 12 },
  segmentTextActive: { color: "white" },

  // tiny selection box
  selectBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#2a3a55",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a1629",
  },
  selectInner: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: "transparent",
  },
  selectInnerOn: {
    backgroundColor: "#38bdf8",
  },

  // category chips in edit modal
  catChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#111827",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#1f2937",
  },
  catChipText: { color: "#e5e7eb", fontWeight: "800", fontSize: 12 },
});
