// app/(tabs)/owner/create-rail.tsx
// ELI5: This is the form to make or edit a Shelf.
// - Give it a name (like "Quick Dinners" or "Game Day").
// - (Optional) Add sponsor info: brand, logo url, CTA text+link.
// - Pick up to 7 recipes. Tap results to add; tap in "Selected" to remove.
// - Set dates, weight, and Active toggle. Save.

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Image, Alert, ScrollView, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { COLORS, SPACING } from "../../../lib/theme";

type RecipeRow = { id: string; title: string; image_url: string | null };

export default function CreateRail() {
  const { id } = useLocalSearchParams<{ id?: string }>();

  // form state
  const [title, setTitle] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [weight, setWeight] = useState("1");

  const [sponsorBrand, setSponsorBrand] = useState("");
  const [sponsorLogo, setSponsorLogo] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");

  const [search, setSearch] = useState("");
  const [finding, setFinding] = useState(false);
  const [results, setResults] = useState<RecipeRow[]>([]);
  const [selected, setSelected] = useState<RecipeRow[]>([]); // up to 7

  const isEditing = !!id;

  // load existing shelf if editing
  useEffect(() => {
    async function load() {
      if (!isEditing) return;
      const { data: shelf } = await supabase
        .from("rail_shelves")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (shelf) {
        setTitle(shelf.title ?? "");
        setIsActive(!!shelf.is_active);
        setStart(shelf.starts_at ?? "");
        setEnd(shelf.ends_at ?? "");
        setWeight(String(shelf.weight ?? 1));
        setSponsorBrand(shelf.sponsor_brand ?? "");
        setSponsorLogo(shelf.sponsor_logo_url ?? "");
        setCtaText(shelf.sponsor_cta_text ?? "");
        setCtaUrl(shelf.sponsor_cta_url ?? "");
      }
      const { data: items } = await supabase
        .from("rail_shelf_items")
        .select("recipe_id, position")
        .eq("shelf_id", id)
        .order("position", { ascending: true });
      const ids = (items ?? []).map((x: any) => x.recipe_id);
      if (ids.length) {
        const { data: recs } = await supabase
          .from("recipes")
          .select("id, title, image_url")
          .in("id", ids);
        setSelected((recs ?? []).map((r: any) => ({ id: String(r.id), title: r.title, image_url: r.image_url ?? null })));
      }
    }
    load();
  }, [id]);

  // search recipes by title
  async function runSearch() {
    setFinding(true);
    const q = (search || "").trim();
    if (!q) { setResults([]); setFinding(false); return; }
    const { data, error } = await supabase
      .from("recipes")
      .select("id, title, image_url")
      .eq("is_private", false)
      .ilike("title", `%${q}%`)
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error) {
      const rows = (data ?? []).map((r: any) => ({ id: String(r.id), title: r.title ?? "", image_url: r.image_url ?? null }));
      setResults(rows);
    }
    setFinding(false);
  }

  // add/remove selected (max 7)
  function addRecipe(r: RecipeRow) {
    if (selected.find((x) => x.id === r.id)) return;
    if (selected.length >= 7) {
      Alert.alert("Max 7", "The shelf can show up to 7 recipes.");
      return;
    }
    setSelected((prev) => [...prev, r]);
  }
  function removeRecipe(id: string) {
    setSelected((prev) => prev.filter((x) => x.id !== id));
  }
  function move(id: string, dir: -1 | 1) {
    setSelected((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const arr = [...prev];
      const newIdx = Math.max(0, Math.min(arr.length - 1, idx + dir));
      const tmp = arr[idx];
      arr[idx] = arr[newIdx];
      arr[newIdx] = tmp;
      return arr;
    });
  }

  // save (insert or update)
  async function save() {
    if (!title.trim()) {
      Alert.alert("Give it a title", "Like Quick Dinners or Game Day.");
      return;
    }
    if (!selected.length) {
      Alert.alert("Pick recipes", "Add at least 1 recipe for the shelf.");
      return;
    }

    const shelfRow = {
      title: title.trim(),
      is_active: isActive,
      starts_at: start || null,
      ends_at: end || null,
      weight: Number(weight || "1") || 1,
      sponsor_brand: sponsorBrand || null,
      sponsor_logo_url: sponsorLogo || null,
      sponsor_cta_text: ctaText || null,
      sponsor_cta_url: ctaUrl || null,
    };

    let shelfId = id as string | undefined;

    if (isEditing) {
      const { error } = await supabase.from("rail_shelves").update(shelfRow).eq("id", id);
      if (error) { Alert.alert("Save failed", error.message); return; }
    } else {
      const { data, error } = await supabase.from("rail_shelves").insert(shelfRow).select("id").single();
      if (error) { Alert.alert("Save failed", error.message); return; }
      shelfId = data?.id;
    }

    // upsert items (simple: clear + insert positions)
    if (shelfId) {
      await supabase.from("rail_shelf_items").delete().eq("shelf_id", shelfId);
      const rows = selected.map((r, i) => ({
        shelf_id: shelfId,
        recipe_id: r.id,
        position: i,
        is_active: true,
      }));
      const { error: itemsErr } = await supabase.from("rail_shelf_items").insert(rows);
      if (itemsErr) { Alert.alert("Items save failed", itemsErr.message); return; }
    }

    Alert.alert("Saved!", "Your shelf is ready.");
    router.back();
  }

  const canSave = useMemo(() => title.trim().length > 0 && selected.length > 0, [title, selected]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 40 }}>
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22, marginBottom: 12 }}>
          {isEditing ? "Edit Shelf" : "New Shelf"}
        </Text>

        {/* Title */}
        <Text style={{ color: "rgba(255,255,255,0.7)" }}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Quick Dinners"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 12, borderRadius: 12, marginTop: 6, marginBottom: 12 }}
        />

        {/* Active + weight */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
            <Text style={{ color: "rgba(255,255,255,0.8)", marginRight: 8 }}>Active</Text>
            <Switch value={isActive} onValueChange={setIsActive} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: "rgba(255,255,255,0.8)", marginRight: 8 }}>Weight</Text>
            <TextInput
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
              style={{ width: 60, backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 10, borderRadius: 10 }}
            />
          </View>
        </View>

        {/* Dates */}
        <Text style={{ color: "rgba(255,255,255,0.7)" }}>Start Date (YYYY-MM-DD)</Text>
        <TextInput
          value={start}
          onChangeText={setStart}
          placeholder="2025-09-01"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 12, borderRadius: 12, marginTop: 6, marginBottom: 12 }}
        />
        <Text style={{ color: "rgba(255,255,255,0.7)" }}>End Date (YYYY-MM-DD)</Text>
        <TextInput
          value={end}
          onChangeText={setEnd}
          placeholder="2025-10-01"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 12, borderRadius: 12, marginTop: 6, marginBottom: 12 }}
        />

        {/* Sponsor info (optional) */}
        <Text style={{ color: "rgba(255,255,255,0.7)", marginTop: 6 }}>Sponsor Brand (optional)</Text>
        <TextInput
          value={sponsorBrand}
          onChangeText={setSponsorBrand}
          placeholder="Acme Foods"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 12, borderRadius: 12, marginTop: 6, marginBottom: 12 }}
        />
        <Text style={{ color: "rgba(255,255,255,0.7)" }}>Sponsor Logo URL (optional)</Text>
        <TextInput
          value={sponsorLogo}
          onChangeText={setSponsorLogo}
          placeholder="https://example.com/logo.png"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 12, borderRadius: 12, marginTop: 6, marginBottom: 12 }}
        />
        <Text style={{ color: "rgba(255,255,255,0.7)" }}>CTA Text (optional)</Text>
        <TextInput
          value={ctaText}
          onChangeText={setCtaText}
          placeholder="Learn more"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 12, borderRadius: 12, marginTop: 6, marginBottom: 12 }}
        />
        <Text style={{ color: "rgba(255,255,255,0.7)" }}>CTA Link (optional)</Text>
        <TextInput
          value={ctaUrl}
          onChangeText={setCtaUrl}
          placeholder="https://brand.com/product"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 12, borderRadius: 12, marginTop: 6, marginBottom: 12 }}
        />

        {/* Selected recipes (draggable-lite using up/down buttons) */}
        <Text style={{ color: "#fff", fontWeight: "900", marginTop: 8, marginBottom: 6 }}>Selected (max 7)</Text>
        {selected.map((r, i) => (
          <View key={r.id} style={{
            flexDirection: "row", alignItems: "center",
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 8, marginBottom: 8
          }}>
            <Image source={{ uri: r.image_url ?? undefined }} style={{ width: 40, height: 40, borderRadius: 6, marginRight: 10 }} />
            <Text style={{ color: "#fff", flex: 1 }} numberOfLines={1}>{r.title}</Text>
            <TouchableOpacity onPress={() => move(r.id, -1)} style={{ padding: 6 }}><Text style={{ color: "#fff" }}>↑</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => move(r.id, +1)} style={{ padding: 6 }}><Text style={{ color: "#fff" }}>↓</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => removeRecipe(r.id)} style={{ padding: 6 }}><Text style={{ color: COLORS.accent }}>✕</Text></TouchableOpacity>
          </View>
        ))}

        {/* Search box */}
        <Text style={{ color: "#fff", fontWeight: "900", marginTop: 12 }}>Add recipes</Text>
        <View style={{ flexDirection: "row", marginTop: 6, marginBottom: 8 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="search by title…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.08)", color: "#fff", padding: 12, borderRadius: 12 }}
          />
          <TouchableOpacity onPress={runSearch} style={{ marginLeft: 8, backgroundColor: "rgba(255,255,255,0.12)", paddingHorizontal: 14, borderRadius: 12, justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "800" }}>Search</Text>
          </TouchableOpacity>
        </View>

        {finding ? <ActivityIndicator /> : null}
        {results.map((r) => (
          <TouchableOpacity
            key={r.id}
            onPress={() => addRecipe(r)}
            style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8 }}
          >
            <Image source={{ uri: r.image_url ?? undefined }} style={{ width: 40, height: 40, borderRadius: 6, marginRight: 10 }} />
            <Text style={{ color: "#fff", flex: 1 }} numberOfLines={1}>{r.title}</Text>
            <Text style={{ color: COLORS.accent, fontWeight: "800" }}>Add</Text>
          </TouchableOpacity>
        ))}

        {/* Save button */}
        <TouchableOpacity
          onPress={save}
          disabled={!canSave}
          style={{
            marginTop: 18,
            backgroundColor: canSave ? COLORS.accent : "rgba(255,255,255,0.2)",
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: canSave ? "#001018" : "rgba(255,255,255,0.5)", fontWeight: "900" }}>
            Save Shelf
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
