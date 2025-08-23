// screens/SignIn.tsx
// MessHall — Email/password auth + reset link sender
// ✅ Sign in with email + password
// ✅ Create account (sign up) with same fields
// ✅ Forgot password → sends recovery link to deep link: messhall://reset-password
// ✅ Accepts navigation param { emailPrefill } to seed the email box
// ✅ Theming consistent with ThemeProvider

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';

type RouteParams = { emailPrefill?: string };

export default function SignIn() {
  const nav = useNavigation();
  const { isDark } = useThemeController();
  const route = useRoute();
  const params = (route.params as RouteParams) || {};

  const [email, setEmail] = useState(params.emailPrefill || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  useEffect(() => {
    if (params.emailPrefill && !email) setEmail(params.emailPrefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.emailPrefill]);

  const onSignIn = useCallback(async () => {
    if (!email || !password) {
      Alert.alert('Missing info', 'Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      // @ts-ignore
      nav.navigate('Home');
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [email, password, nav]);

  const onSignUp = useCallback(async () => {
    if (!email || !password) {
      Alert.alert('Missing info', 'Enter your email and a password (8+ characters).');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Weak password', 'Use at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: Linking.createURL('/'), // after confirm, open app
        },
      });
      if (error) throw error;
      Alert.alert('Check your email', 'We sent you a confirmation link.');
    } catch (e: any) {
      Alert.alert('Sign up failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [email, password]);

  const onForgot = useCallback(async () => {
    if (!email) {
      Alert.alert('Email required', 'Enter your email first so we know where to send the reset link.');
      return;
    }
    setBusy(true);
    try {
      // Deep link target handled by ResetPasswordScreen via App.tsx linking config
      const redirect = Linking.createURL('reset-password');
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect });
      if (error) throw error;
      Alert.alert('Email sent', 'Check your inbox for a password reset link.');
    } catch (e: any) {
      Alert.alert('Could not send reset', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [email]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.flex, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
      <View style={styles.container}>
        <Text style={[styles.h1, { color: isDark ? '#E5E7EB' : '#111827' }]}>MessHall</Text>
        <Text style={[styles.h2, { color: isDark ? '#9CA3AF' : '#374151' }]}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>

        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          placeholder="email@example.com"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          placeholder="Password"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Pressable
          style={[styles.primaryBtn, busy && styles.btnDisabled]}
          onPress={mode === 'signin' ? onSignIn : onSignUp}
          disabled={busy}
        >
          {busy ? <ActivityIndicator /> : <Text style={styles.primaryBtnText}>{mode === 'signin' ? 'Sign In' : 'Sign Up'}</Text>}
        </Pressable>

        <View style={styles.row}>
          <Pressable onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            <Text style={[styles.link, { color: isDark ? '#93C5FD' : '#1D4ED8' }]}>
              {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable onPress={onForgot}>
            <Text style={[styles.link, { color: isDark ? '#93C5FD' : '#1D4ED8' }]}>Forgot password?</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 16, maxWidth: 560, width: '100%', alignSelf: 'center' },
  h1: { fontSize: 24, fontWeight: '800', marginTop: 10, marginBottom: 8 },
  h2: { fontSize: 16, fontWeight: '700', marginBottom: 12 },

  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  inputDark: { backgroundColor: '#111827', borderColor: '#1F2937', color: '#E5E7EB' },
  inputLight: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', color: '#111827' },

  primaryBtn: { backgroundColor: '#4F46E5', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },

  row: { marginTop: 10, alignItems: 'center' },
  link: { fontWeight: '700' },
});
