// app/(tabs)/public-profile.tsx
// 👶 Like I'm 5: This screen shows a user's recipes.
// - If it's MY page: show all my toys (recipes).
// - If it's SOMEONE ELSE'S page: show only the toys they marked "public".
// - We also count things correctly so numbers match what you see.
// - We map DB column "cover_image" to prop "image" so no "recipes.image" error.

import React, { useEffect, useState } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
// ⬇️ Make sure this points to YOUR Supabase client export
import { supabase } from "../../lib/supabase"; // <-- adjust path
// ⬇️ Your card component
import RecipeCard from "../../components/RecipeCard";

// 🧸 CHANGE THIS if your owner column is named differently in public.recipes
const OWNER_COLUMN = "author_id";

// 🧃 These are the DB columns we read. Note we use cover_image (NOT image).
const RECIPE_FIELDS = "id,title,cover_image,created_at,is_private,author_id";

// 🔎 Turn DB row into the shape your card expects
function toCardItem(row: any) {
  return {
    id: row.id,
    title: row.title,
    image: row.cover_image ?? null, // map cover_image -> image
    creator: "", // fill if you join profiles; safe to leave empty for now
    knives: 0,   // fill if you store medals/knives per recipe
    cooks: 0,    // fill if you track cooks per recipe
    likes: 0,    // fill if you track likes
    commentCount: 0, // fill if you track comments
    createdAt: row.created_at,
    ownerId: row.author_id,
    is_private: row.is_private,
  };
}

type Props = {
  profileId: string; // 👈 The user whose page we’re viewing (their auth uid or profile id)
};

export default function PublicProfile({ profileId }: Props) {
  // 🧠 who is looking (the viewer)?
  const [viewerId, setViewerId] = useState<string | null>(null);

  // 📦 the recipes to show
  const [recipes, setRecipes] = useState<any[]>([]);

  // 🔢 counts that match what we render
  const [visibleCount, setVisibleCount] = useState(0);
  const [ownerTotal, setOwnerTotal] = useState(0);

  // ⏳ loading + error
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 1) Find out who is logged in (the viewer)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setViewerId(data.session?.user?.id ?? null);
    });
  }, []);

  // 2) Load recipes + counts with privacy rules
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const viewingOwn = viewerId && viewerId === profileId;

        // 🥇 Recipes list (owner sees all; others see only public)
        let listQuery = supabase
          .from("recipes")
          .select(RECIPE_FIELDS)
          .eq(OWNER_COLUMN, profileId)
          .order("created_at", { ascending: false });

        if (!viewingOwn) {
          listQuery = listQuery.eq("is_private", false);
        }

        const { data: listRows, error: listErr } = await listQuery;
        if (listErr) throw listErr;
        setRecipes((listRows ?? []).map(toCardItem));

        // 🔢 Count visible recipes (what THIS viewer can actually see)
        let visCountQ = supabase
          .from("recipes")
          .select("id", { count: "exact", head: true })
          .eq(OWNER_COLUMN, profileId);

        if (!viewingOwn) {
          visCountQ = visCountQ.eq("is_private", false);
        }

        const { count: visCount, error: visErr } = await visCountQ;
        if (visErr) throw visErr;
        setVisibleCount(visCount ?? 0);

        // 📊 Count ALL of owner’s recipes (only used when owner views their own page)
        const { count: totalCount, error: totalErr } = await supabase
          .from("recipes")
          .select("id", { count: "exact", head: true })
          .eq(OWNER_COLUMN, profileId);

        if (totalErr) throw totalErr;
        setOwnerTotal(totalCount ?? 0);
      } catch (e: any) {
        setErr(e?.message ?? "Could not load profile");
      } finally {
        setLoading(false);
      }
    })();
  }, [profileId, viewerId]);

  if (loading) return <ActivityIndicator />;
  if (err) return <Text style={{ color: "red", padding: 16 }}>{err}</Text>;

  const viewingOwn = viewerId && viewerId === profileId;

  return (
    <View style={{ flex: 1, padding: 16 }}>
      {/* 🏷️ The title changes based on who is looking */}
      <Text style={{ fontSize: 20, marginBottom: 8 }}>
        {viewingOwn
          ? `Your recipes (${ownerTotal} total)`
          : `Public recipes (${visibleCount})`}
      </Text>

      <FlatList
        data={recipes}
        keyExtractor={(it) => it.id}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <View>
            {/* 🔒 Show a lock label for your own private recipes (just so YOU know) */}
            {viewingOwn && item.is_private ? (
              <Text style={{ opacity: 0.6, marginBottom: 4 }}>🔒 Private</Text>
            ) : null}
            <RecipeCard
              id={item.id}
              title={item.title}
              image={item.image}
              creator={item.creator}
              knives={item.knives}
              cooks={item.cooks}
              likes={item.likes}
              commentCount={item.commentCount}
              createdAt={new Date(item.createdAt).getTime()}
              ownerId={item.ownerId}
              onOpen={() => {}}
              onSave={() => {}}
              onOpenCreator={() => {}}
              onEdit={() => {}}
            />
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ opacity: 0.7 }}>
            {viewingOwn ? "You have no recipes yet." : "No public recipes yet."}
          </Text>
        }
      />
    </View>
  );
}
