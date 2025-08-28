// /app/(tabs)/shop.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { COLORS } from '../../lib/theme';
export default function Shop() {
  return <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems:'center', justifyContent:'center' }}>
    <Text style={{ color: 'white' }}>Shop/Cart — we’ll hook Walmart/Kroger/Instacart later</Text>
  </View>;
}
