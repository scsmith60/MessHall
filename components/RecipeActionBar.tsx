// components/RecipeActionBar.tsx
// LIKE I'M 5: this is the little row of buttons. If it's your recipe, no buttons.
// We keep the layout pretty with a small "Your recipe" chip instead.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  recipeId: string;
  ownerId: string;        // who made the recipe
  currentUserId: string | null; // who is looking right now
  liked: boolean;
  cooked: boolean;
  onToggleLike: () => void;
  onToggleCooked: () => void;
  loading?: boolean;
};

export default function RecipeActionBar({
  recipeId,
  ownerId,
  currentUserId,
  liked,
  cooked,
  onToggleLike,
  onToggleCooked,
  loading = false,
}: Props) {
  // LIKE I'M 5: if the person = the maker, hide buttons.
  const isOwner = useMemo(() => currentUserId && currentUserId === ownerId, [currentUserId, ownerId]);

  if (loading) {
    return (
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8 }}>
        <ActivityIndicator />
        <Text style={{ color: '#94a3b8' }}>Loading…</Text>
      </View>
    );
  }

  if (isOwner) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
        <View
          style={{
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            borderWidth: 1,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
          }}
        >
          <Text style={{ color: '#94a3b8', fontSize: 12 }}>Your recipe</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 8 }}>
      {/* LIKE BUTTON */}
      <TouchableOpacity
        onPress={onToggleLike}
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Unlike recipe' : 'Like recipe'}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: '#1e293b',
          borderRadius: 12,
        }}
      >
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color="#f87171" />
        <Text style={{ color: '#f1f5f9' }}>{liked ? 'Liked' : 'Like'}</Text>
      </TouchableOpacity>

      {/* COOKED BUTTON */}
      <TouchableOpacity
        onPress={onToggleCooked}
        accessibilityRole="button"
        accessibilityLabel={cooked ? 'Unmark cooked' : 'Mark as cooked'}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: '#1e293b',
          borderRadius: 12,
        }}
      >
        <Ionicons name={cooked ? 'restaurant' : 'restaurant-outline'} size={18} color="#38bdf8" />
        <Text style={{ color: '#f1f5f9' }}>{cooked ? 'Cooked' : 'I cooked this'}</Text>
      </TouchableOpacity>
    </View>
  );
}
