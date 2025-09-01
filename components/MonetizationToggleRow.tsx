// components/MonetizationToggleRow.tsx
// LIKE I'M 5: this shows a switch for "Monetization".
// If the recipe is private OR has a source_url (imported),
// we lock the switch OFF and explain why.

import React, { useMemo } from 'react';
import { View, Text, Switch } from 'react-native';
import { COLORS } from '@/lib/theme';
import type { Recipe } from '@/lib/types';

type Props = {
  // the recipe we're editing
  recipe: Pick<Recipe, 'is_private' | 'monetization_eligible' | 'source_url'>;

  // when the user flips the switch (only possible if not locked),
  // we call onChange with the new partial fields to save
  onChange: (patch: Partial<Recipe>) => void;
};

export default function MonetizationToggleRow({ recipe, onChange }: Props) {
  // LIKE I'M 5: lock if private OR imported (has a non-empty source_url)
  const isLocked = useMemo(() => {
    const imported = !!(recipe.source_url && recipe.source_url.trim() !== '');
    return recipe.is_private || imported;
  }, [recipe.is_private, recipe.source_url]);

  // when locked, always show false; otherwise show the real value
  const effectiveValue = isLocked ? false : !!recipe.monetization_eligible;

  return (
    <View style={{ paddingVertical: 12 }}>
      {/* Title + tiny explanation when locked */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: '600' }}>
          Monetization
        </Text>
        {isLocked && (
          <Text style={{ color: COLORS.subtext, fontSize: 12 }}>
            🔒 {recipe.is_private ? 'Private' : 'Imported (has source link)'} • Monetization off
          </Text>
        )}
      </View>

      {/* Switch line */}
      <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: COLORS.subtext, fontSize: 13 }}>
          Earn from ads/affiliates on this recipe
        </Text>

        <Switch
          value={effectiveValue}
          disabled={isLocked}
          onValueChange={(v) => onChange({ monetization_eligible: v })}
        />
      </View>

      {/* Helper text when locked */}
      {isLocked && (
        <Text style={{ marginTop: 6, color: COLORS.subtext, fontSize: 12, lineHeight: 16 }}>
          To monetize: make it public AND use your own original photos and steps
          (not copied from other sites).
        </Text>
      )}
    </View>
  );
}
