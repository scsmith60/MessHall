// /app/(tabs)/profile.tsx
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import HapticButton from '../../components/ui/HapticButton';
import { router } from 'expo-router';

export default function Profile() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setEmail(data.user?.email ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      setEmail(sess?.user?.email ?? null);
    });
    return () => { sub.subscription.unsubscribe(); alive = false; };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}>
      <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 12 }}>Profile</Text>

      <View style={{ backgroundColor: COLORS.card, padding: 14, borderRadius: RADIUS.lg, marginBottom: 12 }}>
        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Status</Text>
        <Text style={{ color: COLORS.text, fontWeight: '800' }}>
          {email ? `Signed in as ${email}` : 'Not signed in'}
        </Text>
      </View>

      <HapticButton
        onPress={() => router.push('/auth')}
        style={{ backgroundColor: COLORS.accent, padding: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}
      >
        <Text style={{ color: '#001018', fontWeight: '900' }}>{email ? 'Manage Account' : 'Sign In / Create Account'}</Text>
      </HapticButton>
    </View>
  );
}
