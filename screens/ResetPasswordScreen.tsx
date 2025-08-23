// screens/ResetPasswordScreen.tsx
// MessHall — Password reset flow
// ✅ Handles deep link: messhall://reset-password?access_token=...&email=...
// ✅ Verifies recovery token → creates temp session
// ✅ Lets user set a new password
// ✅ Works for already-authenticated users as well

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabaseClient';
import type { RootStackParamList } from '../App';
import { useThemeController } from '../lib/theme';

type ResetRoute = RouteProp<RootStackParamList, 'ResetPassword'>;

export default function ResetPasswordScreen() {
  const { isDark } = useThemeController();
  const nav = useNavigation();
  const route = useRoute<ResetRoute>();

  const linkEmail = (route.params?.email || '').trim();
  const linkToken = (route.params?.access_token || '').trim(); // recovery token

  const [booting, setBooting] = useState(true);
  const [verified, setVerified] = useState(false);
  const [email, setEmail] = useState(linkEmail);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);

  // On mount: if deep link contains token+email, verify to create a temp session.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setBooting(true);

        const current = (await supabase.auth.getSession()).data.session;
        if (current && !linkToken) {
          // Already logged in, no token required.
          if (mounted) setVerified(true);
          return;
        }

        if (linkToken && linkEmail) {
          // Verify recovery token to create a session scoped for password reset
          const { error } = await supabase.auth.verifyOtp({
            email: linkEmail,
            token: linkToken,
            type: 'recovery',
          });
          if (error) throw error;
          if (mounted) setVerified(true);
          return;
        }

        // No token & not logged in — ask for email (user can request a fresh link from Sign In)
        if (mounted) setVerified(false);
      } catch (e: any) {
        console.warn('[reset:verify]', e?.message || e);
        Alert.alert('Link invalid', 'Your reset link is invalid or expired. Request a new one from the Sign In screen.');
        if (mounted) setVerified(false);
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => { mounted = false; };
  }, [linkEmail, linkToken]);

  const onUpdate = useCallback(async () => {
    if (!pw1 || !pw2) {
      Alert.alert('Missing password', 'Enter your new password twice.');
      return;
    }
    if (pw1 !== pw2) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    if (pw1.length < 8) {
      Alert.alert('Too short', 'Use at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;

      setPw1('');
      setPw2('');
      Alert.alert('Password updated', 'Your password has been changed.');
      // After a recovery session, user will be logged in — send them Home
      // or go back if they came from a modal.
      // @ts-ignore
      nav.navigate('Home');
    } catch (e: any) {
      console.warn('[reset:update]', e?.message || e);
      Alert.alert('Update failed', 'Could not update your password. Try the link again or request a new one.');
    } finally {
      setSaving(false);
    }
  }, [nav, pw1, pw2]);

  if (booting) {
    return (
      <View style={[styles.center, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.flex, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
      <View style={styles.container}>
        <Text style={[styles.h1, { color: isDark ? '#E5E7EB' : '#111827' }]}>Reset Password</Text>

        {!verified ? (
          <>
            <Text style={[styles.body, { color: isDark ? '#9CA3AF' : '#374151' }]}>
              Your reset link appears invalid or expired. Enter your email, then request a new reset link from the Sign In screen.
            </Text>
            <TextInput
              style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
              placeholder="email@example.com"
              placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Pressable
              style={styles.btnGhost}
              onPress={() => {
                // @ts-ignore
                nav.navigate('SignIn', { emailPrefill: email });
              }}
            >
              <Text style={[styles.btnGhostText, { color: isDark ? '#93C5FD' : '#1D4ED8' }]}>Go to Sign In to request a new link</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.body, { color: isDark ? '#9CA3AF' : '#374151' }]}>
              Enter a new password for your account{linkEmail ? ` (${linkEmail})` : ''}.
            </Text>

            <TextInput
              style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
              placeholder="New password"
              placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
              secureTextEntry
              value={pw1}
              onChangeText={setPw1}
            />
            <TextInput
              style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
              placeholder="Confirm new password"
              placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
              secureTextEntry
              value={pw2}
              onChangeText={setPw2}
            />

            <Pressable style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={onUpdate} disabled={saving}>
              {saving ? <ActivityIndicator /> : <Text style={styles.saveBtnText}>Update Password</Text>}
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16 },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 12 },

  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  inputDark: { backgroundColor: '#111827', borderColor: '#1F2937', color: '#E5E7EB' },
  inputLight: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', color: '#111827' },

  btnGhost: { paddingVertical: 10 },
  btnGhostText: { fontWeight: '700' },

  saveBtn: { backgroundColor: '#4F46E5', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  saveBtnText: { color: 'white', fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});
