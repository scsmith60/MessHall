// app/(tabs)/owner/product-suggestions.tsx
// ELI5: Owner screen to manage product suggestions (ingredient → store product mappings)
// Owners can add/edit/delete which products are suggested when users add ingredients to shopping lists

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
  Modal,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { COLORS, SPACING } from "../../../lib/theme";
import type { ProviderId } from "../../../lib/cart/providers";

type ProductSuggestion = {
  id: string;
  ingredient_name: string;
  store: ProviderId;
  product_title: string;
  product_id: string;
  brand: string | null;
  variant: string | null;
  is_default: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
};

const STORES: { id: ProviderId; label: string }[] = [
  { id: "walmart", label: "Walmart" },
  { id: "amazon", label: "Amazon" },
  { id: "kroger", label: "Kroger" },
  { id: "heb", label: "H-E-B" },
  { id: "albertsons", label: "Albertsons" },
];

export default function ProductSuggestions() {
  const [rows, setRows] = useState<ProductSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStore, setFilterStore] = useState<ProviderId | "all">("all");
  const [filterIngredient, setFilterIngredient] = useState("");
  const [editing, setEditing] = useState<ProductSuggestion | null>(null);
  const [showModal, setShowModal] = useState(false);

  async function load() {
    setLoading(true);
    let query = supabase
      .from("product_suggestions")
      .select("*")
      .order("ingredient_name", { ascending: true })
      .order("store", { ascending: true })
      .order("priority", { ascending: false })
      .order("is_default", { ascending: false });

    if (filterStore !== "all") {
      query = query.eq("store", filterStore);
    }

    if (filterIngredient.trim()) {
      query = query.ilike("ingredient_name", `%${filterIngredient.trim()}%`);
    }

    const { data, error } = await query.limit(500);

    if (!error && data) {
      setRows(data.map((r: any) => ({ ...r, id: String(r.id) })));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [filterStore, filterIngredient]);

  const handleDelete = async (id: string) => {
    Alert.alert("Delete Suggestion", "Are you sure you want to delete this product suggestion?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("product_suggestions").delete().eq("id", id);
          if (!error) {
            load();
          } else {
            Alert.alert("Error", "Could not delete suggestion.");
          }
        },
      },
    ]);
  };

  const handleSave = async (form: Partial<ProductSuggestion>) => {
    if (!form.ingredient_name || !form.store || !form.product_title || !form.product_id) {
      Alert.alert("Error", "Please fill in all required fields.");
      return;
    }

    const { data: user } = await supabase.auth.getUser();
    const payload: any = {
      ingredient_name: form.ingredient_name.toLowerCase().trim(),
      store: form.store,
      product_title: form.product_title.trim(),
      product_id: form.product_id.trim(),
      brand: form.brand?.trim() || null,
      variant: form.variant?.trim() || null,
      is_default: form.is_default ?? true,
      priority: form.priority ?? 0,
      created_by: user.user?.id || null,
    };

    if (editing) {
      const { error } = await supabase.from("product_suggestions").update(payload).eq("id", editing.id);
      if (error) {
        Alert.alert("Error", "Could not update suggestion.");
        return;
      }
    } else {
      // If setting as default, unset other defaults for this ingredient+store
      if (payload.is_default) {
        await supabase
          .from("product_suggestions")
          .update({ is_default: false })
          .eq("ingredient_name", payload.ingredient_name)
          .eq("store", payload.store)
          .neq("id", editing?.id || "new", "new");
      }

      const { error } = await supabase.from("product_suggestions").insert(payload);
      if (error) {
        Alert.alert("Error", "Could not create suggestion. " + (error.message || ""));
        return;
      }
    }

    setShowModal(false);
    setEditing(null);
    load();
  };

  const openEdit = (item?: ProductSuggestion) => {
    setEditing(item || null);
    setShowModal(true);
  };

  const getStoreLabel = (store: ProviderId) => {
    return STORES.find((s) => s.id === store)?.label || store;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={{ padding: SPACING.lg, paddingBottom: SPACING.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 22, flex: 1 }}>
            Product Suggestions
          </Text>
          <TouchableOpacity
            onPress={() => openEdit()}
            style={{ backgroundColor: COLORS.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 }}
          >
            <Text style={{ color: "#001018", fontWeight: "900" }}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {/* Filters */}
        <View style={{ gap: 10 }}>
          {/* Store filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={() => setFilterStore("all")}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: filterStore === "all" ? COLORS.accent : "rgba(255,255,255,0.08)",
                  borderWidth: 1,
                  borderColor: filterStore === "all" ? COLORS.accent : "rgba(255,255,255,0.12)",
                }}
              >
                <Text style={{ color: filterStore === "all" ? "#001018" : COLORS.text, fontWeight: "800" }}>
                  All Stores
                </Text>
              </TouchableOpacity>
              {STORES.map((store) => (
                <TouchableOpacity
                  key={store.id}
                  onPress={() => setFilterStore(store.id)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: filterStore === store.id ? COLORS.accent : "rgba(255,255,255,0.08)",
                    borderWidth: 1,
                    borderColor: filterStore === store.id ? COLORS.accent : "rgba(255,255,255,0.12)",
                  }}
                >
                  <Text style={{ color: filterStore === store.id ? "#001018" : COLORS.text, fontWeight: "800" }}>
                    {store.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Ingredient search */}
          <TextInput
            placeholder="Search ingredient..."
            placeholderTextColor={COLORS.subtext}
            value={filterIngredient}
            onChangeText={setFilterIngredient}
            style={{
              backgroundColor: "rgba(255,255,255,0.06)",
              borderColor: "rgba(255,255,255,0.08)",
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              color: COLORS.text,
            }}
          />
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={COLORS.accent} />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl }}>
          <Ionicons name="cart-outline" size={48} color={COLORS.subtext} />
          <Text style={{ color: COLORS.subtext, marginTop: 12, textAlign: "center" }}>
            No product suggestions found.
          </Text>
          <Text style={{ color: COLORS.subtext, marginTop: 4, textAlign: "center", fontSize: 12 }}>
            {filterIngredient || filterStore !== "all"
              ? "Try adjusting your filters."
              : "Add your first suggestion to get started."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: SPACING.lg, paddingTop: 0 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <View
              style={{
                backgroundColor: "rgba(255,255,255,0.06)",
                borderColor: "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderRadius: 14,
                padding: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 8 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 16 }}>
                      {item.ingredient_name}
                    </Text>
                    <View
                      style={{
                        backgroundColor: "rgba(0,200,120,0.15)",
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 999,
                      }}
                    >
                      <Text style={{ color: COLORS.accent, fontWeight: "800", fontSize: 11 }}>
                        {getStoreLabel(item.store)}
                      </Text>
                    </View>
                    {item.is_default && (
                      <View
                        style={{
                          backgroundColor: "rgba(59,130,246,0.15)",
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 999,
                        }}
                      >
                        <Text style={{ color: "#60a5fa", fontWeight: "800", fontSize: 11 }}>Default</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: COLORS.text, fontWeight: "700", fontSize: 15, marginBottom: 4 }}>
                    {item.product_title}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {item.brand && (
                      <Text style={{ color: COLORS.subtext, fontSize: 12 }}>Brand: {item.brand}</Text>
                    )}
                    {item.variant && (
                      <Text style={{ color: COLORS.subtext, fontSize: 12 }}>Size: {item.variant}</Text>
                    )}
                    <Text style={{ color: COLORS.subtext, fontSize: 12 }}>ID: {item.product_id}</Text>
                    {item.priority !== 0 && (
                      <Text style={{ color: COLORS.subtext, fontSize: 12 }}>Priority: {item.priority}</Text>
                    )}
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity onPress={() => openEdit(item)} style={{ padding: 8 }}>
                    <Ionicons name="pencil" size={20} color={COLORS.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(item.id)} style={{ padding: 8 }}>
                    <Ionicons name="trash" size={20} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        />
      )}

      {/* Edit/Create Modal */}
      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: SPACING.lg }}>
          <ScrollView
            style={{
              backgroundColor: COLORS.card,
              borderRadius: 16,
              padding: SPACING.lg,
              maxHeight: "80%",
            }}
          >
            <Text style={{ color: COLORS.text, fontWeight: "900", fontSize: 20, marginBottom: 16 }}>
              {editing ? "Edit Suggestion" : "New Suggestion"}
            </Text>

            <EditForm
              initial={editing}
              onSave={handleSave}
              onCancel={() => {
                setShowModal(false);
                setEditing(null);
              }}
            />
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function EditForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: ProductSuggestion | null;
  onSave: (form: Partial<ProductSuggestion>) => void;
  onCancel: () => void;
}) {
  const [ingredient, setIngredient] = useState(initial?.ingredient_name || "");
  const [store, setStore] = useState<ProviderId>(initial?.store || "walmart");
  const [productTitle, setProductTitle] = useState(initial?.product_title || "");
  const [productId, setProductId] = useState(initial?.product_id || "");
  const [brand, setBrand] = useState(initial?.brand || "");
  const [variant, setVariant] = useState(initial?.variant || "");
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? true);
  const [priority, setPriority] = useState(String(initial?.priority || 0));

  return (
    <View style={{ gap: 12 }}>
      {/* Ingredient Name */}
      <View>
        <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>Ingredient Name *</Text>
        <TextInput
          placeholder="e.g., sugar, flour, eggs"
          placeholderTextColor={COLORS.subtext}
          value={ingredient}
          onChangeText={setIngredient}
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            borderColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            color: COLORS.text,
          }}
        />
      </View>

      {/* Store */}
      <View>
        <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>Store *</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {STORES.map((s) => (
            <TouchableOpacity
              key={s.id}
              onPress={() => setStore(s.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: store === s.id ? COLORS.accent : "rgba(255,255,255,0.08)",
                borderWidth: 1,
                borderColor: store === s.id ? COLORS.accent : "rgba(255,255,255,0.12)",
              }}
            >
              <Text style={{ color: store === s.id ? "#001018" : COLORS.text, fontWeight: "800" }}>
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Product Title */}
      <View>
        <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>Product Title *</Text>
        <TextInput
          placeholder="e.g., Great Value Granulated Sugar"
          placeholderTextColor={COLORS.subtext}
          value={productTitle}
          onChangeText={setProductTitle}
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            borderColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            color: COLORS.text,
          }}
        />
      </View>

      {/* Product ID */}
      <View>
        <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>Product ID *</Text>
        <TextInput
          placeholder="ASIN, item ID, UPC, or SKU"
          placeholderTextColor={COLORS.subtext}
          value={productId}
          onChangeText={setProductId}
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            borderColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            color: COLORS.text,
          }}
        />
        <Text style={{ color: COLORS.subtext, fontSize: 11, marginTop: 4 }}>
          Real product ID from the store (e.g., Amazon ASIN, Walmart item ID)
        </Text>
      </View>

      {/* Brand */}
      <View>
        <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>Brand (optional)</Text>
        <TextInput
          placeholder="e.g., Great Value, Amazon Basics"
          placeholderTextColor={COLORS.subtext}
          value={brand}
          onChangeText={setBrand}
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            borderColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            color: COLORS.text,
          }}
        />
      </View>

      {/* Variant */}
      <View>
        <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>Variant/Size (optional)</Text>
        <TextInput
          placeholder="e.g., 4 lb bag, 12 count"
          placeholderTextColor={COLORS.subtext}
          value={variant}
          onChangeText={setVariant}
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            borderColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            color: COLORS.text,
          }}
        />
      </View>

      {/* Priority */}
      <View>
        <Text style={{ color: COLORS.text, fontWeight: "800", marginBottom: 6 }}>Priority</Text>
        <TextInput
          placeholder="0"
          placeholderTextColor={COLORS.subtext}
          value={priority}
          onChangeText={(v) => {
            if (/^-?\d*$/.test(v)) setPriority(v);
          }}
          keyboardType="numeric"
          style={{
            backgroundColor: "rgba(255,255,255,0.06)",
            borderColor: "rgba(255,255,255,0.08)",
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            color: COLORS.text,
          }}
        />
        <Text style={{ color: COLORS.subtext, fontSize: 11, marginTop: 4 }}>
          Higher priority = shown first (default: 0)
        </Text>
      </View>

      {/* Is Default */}
      <TouchableOpacity
        onPress={() => setIsDefault(!isDefault)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          padding: 12,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: isDefault ? COLORS.accent : COLORS.subtext,
            backgroundColor: isDefault ? COLORS.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
          }}
        >
          {isDefault && <Ionicons name="checkmark" size={16} color="#001018" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: COLORS.text, fontWeight: "800" }}>Set as Default</Text>
          <Text style={{ color: COLORS.subtext, fontSize: 11, marginTop: 2 }}>
            Only one default per ingredient+store combination
          </Text>
        </View>
      </TouchableOpacity>

      {/* Buttons */}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
        <TouchableOpacity
          onPress={onCancel}
          style={{
            flex: 1,
            padding: 14,
            borderRadius: 12,
            backgroundColor: "rgba(255,255,255,0.08)",
            alignItems: "center",
          }}
        >
          <Text style={{ color: COLORS.text, fontWeight: "800" }}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() =>
            onSave({
              ingredient_name: ingredient,
              store,
              product_title: productTitle,
              product_id: productId,
              brand: brand || null,
              variant: variant || null,
              is_default: isDefault,
              priority: parseInt(priority, 10) || 0,
            })
          }
          style={{
            flex: 1,
            padding: 14,
            borderRadius: 12,
            backgroundColor: COLORS.accent,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#001018", fontWeight: "900" }}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

