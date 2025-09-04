// components/SearchFab.tsx
// LIKE I'M 5:
// - This is the tiny bubble you tap to search.
// - It's smaller, semi-transparent, and matches your theme.
// - Long-press shows little helper chips you can tap.

import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  onPress: (prefill?: string) => void; // open search (maybe with prefilled words)
  bottomOffset?: number;               // space above tab bar
};

export default function SearchFab({ onPress, bottomOffset = 24 }: Props) {
  const [showQuick, setShowQuick] = useState(false);

  // helper tiny chip
  const Quick = ({ label }: { label: string }) => (
    <TouchableOpacity
      onPress={() => onPress(label)}
      style={styles.quickChip}
      activeOpacity={0.85}
    >
      <Text style={styles.quickText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* quick chips stack (only visible on long-press) */}
      {showQuick && (
        <View style={[styles.quickWrap, { bottom: bottomOffset + 56 + 8 }]}>
          <Quick label="30 Min" />
          <Quick label="Vegan" />
          <Quick label="Chicken" />
        </View>
      )}

      {/* the floating bubble */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Open search"
        onPress={() => onPress()}
        onLongPress={() => setShowQuick((s) => !s)} // long-press to toggle quick chips
        activeOpacity={0.9}
        style={[
          styles.fab,
          {
            bottom: bottomOffset,
          },
        ]}
      >
        <Ionicons name="search" size={22} color="#38bdf8" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 18,
    width: 48,
    height: 48,
    borderRadius: 24,
    // soft translucent bubble that fits your dark theme
    backgroundColor: 'rgba(56,189,248,0.15)', // sky-400 @ 15%
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    // soft shadow
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  quickWrap: {
    position: 'absolute',
    right: 18,
    gap: 8,
  },
  quickChip: {
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(15,23,42,0.9)', // slate-900 glass
    borderWidth: 1,
    borderColor: '#1e293b', // slate-800
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickText: { color: '#cbd5e1', fontWeight: '600', fontSize: 13 },
});
