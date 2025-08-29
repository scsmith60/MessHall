// /app/auth.tsx
// WHAT THIS DOES (like I'm 5):
// - You type your email and press "Send Code".
// - Check your email for a 6-digit code. Type it here.
// - Press "Verify & Sign In". Boom, you're signed in.
// - If you're already signed in, you can press "Sign Out".

import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import HapticButton from '../components/ui/HapticButton';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // watch auth state so we can show "Sign Out" when logged in
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      setUserEmail(data.user?.email ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setUserEmail(sess?.user?.email ?? null);
    });
    return () => { sub.subscription.unsubscribe(); active = false; };
  }, []);

  const sendCode = async () => {
    if (!email.includes('@')) {
      Alert.alert('Oops', 'Please enter a valid email.');
      return;
    }
    try {
      setSending(true);
      // This sends a 6-digit code to the email (no redirect needed)
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true, // auto-create account on first login
          // You could also send a "magic link" by adding "emailRedirectTo"
        }
      });
      if (error) throw error;
      Alert.alert('Check your email', 'Enter the 6-digit code you received.');
    } catch (e: any) {
      Alert.alert('Could not send code', e?.message ?? 'Unknown error');
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    if (!code || code.length < 6) {
      Alert.alert('Oops', 'Please enter the 6-digit code.');
      return;
    }
    try {
      setVerifying(true);
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'email' // means "Email OTP"
      });
      if (error) throw error;
      Alert.alert('Welcome!', 'You are now signed in.');
      setCode('');
    } catch (e: any) {
      Alert.alert('Could not sign in', e?.message ?? 'Wrong code?');
    } finally {
      setVerifying(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    Alert.alert('Signed out', 'See you next time!');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 12 }}>
        {userEmail ? 'Account' : 'Sign In'}
      </Text>

      {userEmail ? (
        <View style={{ gap: 12 }}>
          <Text style={{ color: COLORS.subtext }}>You are signed in as:</Text>
          <View style={{ backgroundColor: COLORS.card, padding: 14, borderRadius: RADIUS.lg }}>
            <Text style={{ color: COLORS.text, fontWeight: '800' }}>{userEmail}</Text>
          </View>
          <HapticButton
            onPress={signOut}
            style={{ backgroundColor: COLORS.card, padding: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}
          >
            <Text style={{ color: '#ffb4b4', fontWeight: '900' }}>Sign Out</Text>
          </HapticButton>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <Text style={{ color: COLORS.subtext }}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.subtext}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{
              backgroundColor: COLORS.card,
              color: COLORS.text,
              borderRadius: RADIUS.lg,
              paddingHorizontal: 14,
              paddingVertical: 12
            }}
          />

          <HapticButton
            onPress={sendCode}
            style={{ backgroundColor: COLORS.accent, padding: 14, borderRadius: RADIUS.lg, alignItems: 'center', opacity: sending ? 0.6 : 1 }}
          >
            <Text style={{ color: '#001018', fontWeight: '900' }}>{sending ? 'Sending…' : 'Send Code'}</Text>
          </HapticButton>

          <Text style={{ color: COLORS.subtext, marginTop: 16 }}>6-digit Code</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={COLORS.subtext}
            keyboardType="number-pad"
            maxLength={6}
            style={{
              backgroundColor: COLORS.card,
              color: COLORS.text,
              borderRadius: RADIUS.lg,
              paddingHorizontal: 14,
              paddingVertical: 12,
              letterSpacing: 4
            }}
          />

          <HapticButton
            onPress={verifyCode}
            style={{ backgroundColor: COLORS.card, padding: 14, borderRadius: RADIUS.lg, alignItems: 'center', opacity: verifying ? 0.6 : 1 }}
          >
            <Text style={{ color: COLORS.text, fontWeight: '900' }}>{verifying ? 'Verifying…' : 'Verify & Sign In'}</Text>
          </HapticButton>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
