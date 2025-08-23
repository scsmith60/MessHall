import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useThemeController } from '../lib/theme';

type Toast = { id: number; text: string };
type Ctx = { show: (text: string, ms?: number) => void };

const ToastCtx = createContext<Ctx | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { isDark } = useThemeController();
  const [items, setItems] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const y = useRef(new Animated.Value(80)).current;
  const op = useRef(new Animated.Value(0)).current;

  const show = useCallback((text: string, ms = 2000) => {
    const id = idRef.current++;
    setItems((prev) => [{ id, text }, ...prev.slice(0, 2)]);
    Animated.parallel([
      Animated.timing(y, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(op, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(y, { toValue: 80, duration: 200, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setItems((prev) => prev.filter((t) => t.id !== id));
      });
    }, ms);
  }, [op, y]);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <Animated.View pointerEvents="none" style={[styles.wrap, { transform: [{ translateY: y }], opacity: op }]}>
        {items[0] ? (
          <View style={[styles.toast, { backgroundColor: isDark ? '#111827' : '#111827', borderColor: isDark ? '#1F2937' : '#1F2937' }]}>
            <Text style={{ color: '#F9FAFB', fontWeight: '700' }}>{items[0].text}</Text>
          </View>
        ) : null}
      </Animated.View>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center' },
  toast: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, maxWidth: '92%' },
});
