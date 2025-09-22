// /components/Comments.tsx
// LIKE I'M 5 🧸
// This file used to be a simple comments list.
// NOW it just wraps the fancy RecipeComments so the app only has ONE comments UI.
//
// What this wrapper does:
// 1) Figures out who you are (viewer id)
// 2) Figures out who owns the recipe (owner id)
// 3) Tells RecipeComments if you're the owner (so you get Mute/Unmute + Delete powers)
// 4) Renders the full-featured threaded comments with avatars + moderation

import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { supabase } from "../lib/supabase";
import { dataAPI } from "../lib/data";
import RecipeComments from "./RecipeComments";

export default function Comments({ recipeId }: { recipeId: string }) {
  // 👶 who am I?
  const [viewerId, setViewerId] = useState<string | null>(null);
  // 👑 who owns this recipe?
  const [ownerId, setOwnerId] = useState<string | null>(null);
  // ⏳ tiny loading while we fetch ids
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // get my user id
        const { data } = await supabase.auth.getUser();
        if (!alive) return;
        setViewerId(data.user?.id ?? null);

        // get recipe owner id
        const rid = await dataAPI.getRecipeOwnerId(recipeId);
        if (!alive) return;
        setOwnerId(rid);
      } catch {
        // ignore errors here; UI still loads
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [recipeId]);

  if (!ready) {
    return (
      <View style={{ padding: 12 }}>
        <ActivityIndicator />
      </View>
    );
  }

  // am I the owner? (owner gets extra moderation like Mute-on-recipe)
  const isRecipeOwner = !!viewerId && !!ownerId && viewerId === ownerId;

  // 🎉 Render the ONE comments UI (threads + avatars + moderation)
  // - insideScroll=true because this usually lives inside a modal/scroll view
  return <RecipeComments recipeId={recipeId} isRecipeOwner={isRecipeOwner} insideScroll />;
}
