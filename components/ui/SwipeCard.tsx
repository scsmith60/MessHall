// /components/ui/SwipeCard.tsx
// PURPOSE: A card you can swipe left/right for quick actions.
import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RectButton, Swipeable } from 'react-native-gesture-handler';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import { success } from '../../lib/haptics';

type Props = {
  title?: string;
  onSave?: () => void;
  onShare?: () => void;
  children?: React.ReactNode; // recipe preview, etc.
};

export default function SwipeCard({ title, onSave, onShare, children }: Props) {
  const ref = useRef<Swipeable>(null);

  const Left = () => (
    <RectButton style={[styles.action, styles.save]} onPress={() => { success(); onSave?.(); ref.current?.close(); }}>
      <Text style={styles.actionText}>Save</Text>
    </RectButton>
  );

  const Right = () => (
    <RectButton style={[styles.action, styles.share]} onPress={() => { success(); onShare?.(); ref.current?.close(); }}>
      <Text style={styles.actionText}>Share</Text>
    </RectButton>
  );

  return (
    <Swipeable ref={ref} renderLeftActions={Left} renderRightActions={Right} overshootLeft={false} overshootRight={false}>
      <View style={styles.card}>
        {typeof title === 'string' && title.length > 0 && (
          <Text style={styles.title}>{title}</Text>
        )}
        {children}
      </View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    padding: SPACING.lg,
    borderRadius: RADIUS.xl,
    marginBottom: 0, // FlatList will handle spacing
  },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  action: { justifyContent: 'center', paddingHorizontal: 24 },
  actionText: { color: 'white', fontSize: 16, fontWeight: '800' },
  save: { backgroundColor: '#16a34a', borderRadius: RADIUS.xl },   // green
  share: { backgroundColor: '#f59e0b', borderRadius: RADIUS.xl }   // amber
});
