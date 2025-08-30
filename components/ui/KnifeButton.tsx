// /components/ui/KnifeButton.tsx
// 🧸 ELI5: A button that toggles your "knife" (like) on a recipe.
// - Shows count.
// - Buzzes on add, soft warn if not signed in.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, RADIUS } from '../../lib/theme';
import { getKnifeStatus, toggleKnife } from '../../lib/social';
import { success, warn } from '../../lib/haptics';

export default function KnifeButton({ recipeId }: { recipeId: string }) {
  const [count, setCount] = useState<number>(0);
  const [liked, setLiked] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await getKnifeStatus(recipeId);
        if (!alive) return;
        setCount(s.count);
        setLiked(s.iLike);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [recipeId]);

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await toggleKnife(recipeId);
      if (res.iLike) {
        setLiked(true);
        setCount(c => c + 1);
        await success();
      } else {
        setLiked(false);
        setCount(c => Math.max(0, c - 1));
      }
    } catch (e: any) {
      await warn();
      // ignore alert spam; the capture screen tip already explains sign-in
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: liked ? COLORS.accent : '#1f2937',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: RADIUS.lg
      }}
    >
      {busy ? (
        <ActivityIndicator />
      ) : (
        <View style={{
          width: 10, height: 10, borderRadius: 999,
          backgroundColor: liked ? '#001018' : '#9ca3af'
        }} />
      )}
      <Text style={{ color: liked ? '#001018' : COLORS.text, fontWeight: '900' }}>
        {count} Knife{count === 1 ? '' : 's'}
      </Text>
    </TouchableOpacity>
  );
}
