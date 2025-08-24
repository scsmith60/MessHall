// screens/Profile.tsx
// MessHall — Profile screen (robust save + avatar upload)
// + SafeArea padding
// + Tap-to-enlarge avatar (modal)

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, TextInput, Image, Pressable, Alert, ActivityIndicator, ScrollView, StyleSheet, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabaseClient';
import { useThemeController } from '../lib/theme';

type ProfileRow = {
  id: string;
  display_name?: string | null;
  handle?: string | null;
  bio?: string | null;
  tag?: string | null;
  avatar_path?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

const AVATAR_BUCKET = 'avatars';

export default function Profile() {
  const { mode, setMode, isDark } = useThemeController();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [tag, setTag] = useState('');
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string>(''); // signed (or public) URL

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  // fullscreen avatar viewer
  const [avatarModal, setAvatarModal] = useState(false);

  const makeAvatarUrl = useCallback(async (path?: string | null) => {
    if (!path) return '';
    const { data: signed, error } =
      await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
    if (!error && signed?.signedUrl) return signed.signedUrl;
    const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return pub?.publicUrl || '';
  }, []);

  // --------- Load user + profile ----------
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const me = auth.user;
        if (!me) {
          Alert.alert('Sign in required', 'Please sign in to edit your profile.');
          return;
        }
        if (!mounted) return;

        setUserId(me.id);

        const { data: row, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', me.id)
          .maybeSingle<ProfileRow>();

        if (error) throw error;

        if (!row) {
          const { error: insErr } = await supabase
            .from('profiles')
            .upsert({ id: me.id }, { onConflict: 'id' });
          if (insErr) throw insErr;

          setDisplayName('');
          setHandle('');
          setBio('');
          setTag('');
          setAvatarPath(null);
          setAvatarUrl('');
        } else {
          setDisplayName((row.display_name ?? '').trim());
          setHandle((row.handle ?? '').trim());
          setBio((row.bio ?? '').trim());
          setTag((row.tag ?? '').trim());
          setAvatarPath(row.avatar_path ?? null);
          setAvatarUrl(await makeAvatarUrl(row.avatar_path));
        }
      } catch (e: any) {
        console.warn('[profile:load]', e);
        Alert.alert('Load failed', e?.message ?? 'Could not load your profile.');
      } finally {
        mounted && setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [makeAvatarUrl]);

  // --------- Save profile ----------
  const saveProfile = useCallback(async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const payload = {
        id: userId,
        display_name: displayName.trim() || null,
        handle: handle.trim() || null,
        bio: bio.trim() || null,
        tag: tag.trim() || null,
        avatar_path: avatarPath || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
      if (error) throw error;

      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: any) {
      console.warn('[profile:save]', e);
      Alert.alert('Save failed', e?.message ?? 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }, [avatarPath, bio, displayName, handle, tag, userId]);

  // --------- Avatar pick + upload ----------
  const onPickAvatar = useCallback(async () => {
    if (!userId) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Enable Photos permission to change your avatar.');
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (res.canceled || !res.assets?.length) return;

      setAvatarLoading(true);

      const asset = res.assets[0];
      const manip = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );

      const blob = await (await fetch(manip.uri)).blob();
      const filename = `${userId}/avatar.jpg`;

      const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(filename, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (upErr) throw upErr;

      setAvatarPath(filename);
      setAvatarUrl(await makeAvatarUrl(filename));

      const { error: profErr } = await supabase
        .from('profiles')
        .upsert({ id: userId, avatar_path: filename, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (profErr) throw profErr;
    } catch (e: any) {
      console.warn('[profile:avatar]', e);
      Alert.alert('Upload failed', e?.message ?? 'Could not update your photo. Try again.');
    } finally {
      setAvatarLoading(false);
    }
  }, [makeAvatarUrl, userId]);

  // --------- Password change ----------
  const onChangePassword = useCallback(async () => {
    if (!pw1 || !pw2) return Alert.alert('Missing password', 'Enter your new password twice.');
    if (pw1 !== pw2) return Alert.alert('Mismatch', 'Passwords do not match.');
    if (pw1.length < 8) return Alert.alert('Too short', 'Use at least 8 characters.');
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      setPw1(''); setPw2('');
      Alert.alert('Password updated', 'Your password has been changed.');
    } catch (e: any) {
      console.warn('[profile:password]', e);
      Alert.alert('Update failed', e?.message ?? 'Could not update your password.');
    }
  }, [pw1, pw2]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: isDark ? '#0B0F19' : '#F9FAFB', paddingTop: Math.max(insets.top, 8) }}
      edges={['top', 'left', 'right']}
    >
      <ScrollView contentContainerStyle={[styles.container, { backgroundColor: isDark ? '#0B0F19' : '#F9FAFB' }]}>
        <Text style={[styles.h1, { color: isDark ? '#E5E7EB' : '#111827' }]}>Profile</Text>

        {/* Avatar */}
        <View style={styles.row}>
          <Pressable style={styles.avatarWrap} onPress={() => avatarUrl && setAvatarModal(true)}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]} />
            )}
          </Pressable>
          <Pressable onPress={onPickAvatar} style={styles.btn}>
            {avatarLoading ? <ActivityIndicator /> : <Text style={styles.btnText}>Change photo</Text>}
          </Pressable>
        </View>

        {/* Display Name */}
        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Display name</Text>
        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />

        {/* Handle */}
        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Handle</Text>
        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          value={handle}
          onChangeText={setHandle}
          placeholder="@yourhandle"
          autoCapitalize="none"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />

        {/* Bio */}
        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Bio</Text>
        <TextInput
          style={[styles.input, styles.multiline, isDark ? styles.inputDark : styles.inputLight]}
          value={bio}
          onChangeText={setBio}
          placeholder="Tell people a bit about you"
          multiline
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />

        {/* Tag */}
        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Tag</Text>
        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          value={tag}
          onChangeText={setTag}
          placeholder="#bbq #keto #weeknight"
          autoCapitalize="none"
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />

        {/* Theme selector */}
        <Text style={[styles.label, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Theme</Text>
        <View style={styles.themeRow}>
          <Pressable style={[styles.chip, mode === 'system' && styles.chipActive]} onPress={() => setMode('system')}>
            <Text style={[styles.chipText, mode === 'system' && styles.chipTextActive]}>System</Text>
          </Pressable>
          <Pressable style={[styles.chip, mode === 'light' && styles.chipActive]} onPress={() => setMode('light')}>
            <Text style={[styles.chipText, mode === 'light' && styles.chipTextActive]}>Light</Text>
          </Pressable>
          <Pressable style={[styles.chip, mode === 'dark' && styles.chipActive]} onPress={() => setMode('dark')}>
            <Text style={[styles.chipText, mode === 'dark' && styles.chipTextActive]}>Dark</Text>
          </Pressable>
        </View>

        {/* Save */}
        <Pressable style={[styles.saveBtn, saving && styles.btnDisabled]} onPress={saveProfile} disabled={saving}>
          {saving ? <ActivityIndicator /> : <Text style={styles.saveBtnText}>Save Profile</Text>}
        </Pressable>

        {/* Password change */}
        <Text style={[styles.h2, { color: isDark ? '#E5E7EB' : '#111827' }]}>Change Password</Text>
        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          value={pw1}
          onChangeText={setPw1}
          placeholder="New password"
          secureTextEntry
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />
        <TextInput
          style={[styles.input, isDark ? styles.inputDark : styles.inputLight]}
          value={pw2}
          onChangeText={setPw2}
          placeholder="Confirm new password"
          secureTextEntry
          placeholderTextColor={isDark ? '#6B7280' : '#9CA3AF'}
        />
        <Pressable style={styles.btn} onPress={onChangePassword}>
          <Text style={styles.btnText}>Update Password</Text>
        </Pressable>

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* Fullscreen avatar modal */}
      <Modal visible={avatarModal} transparent animationType="fade" onRequestClose={() => setAvatarModal(false)}>
        <Pressable style={styles.avatarBackdrop} onPress={() => setAvatarModal(false)}>
          {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatarFullscreen} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// --------- Styles ----------
const styles = StyleSheet.create({
  container: { padding: 16, minHeight: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  h1: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  h2: { fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 8 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 12 },

  avatarWrap: {
    width: 84, height: 84, borderRadius: 84 / 2, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1F2937', backgroundColor: '#111827',
  },
  avatar: { width: '100%', height: '100%' },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },

  // Fullscreen avatar viewer
  avatarBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  avatarFullscreen: { width: '100%', height: '80%', borderRadius: 12 },

  label: { marginTop: 12, marginBottom: 6, fontSize: 13 },

  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  inputDark: { backgroundColor: '#111827', borderColor: '#1F2937', color: '#E5E7EB' },
  inputLight: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', color: '#111827' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },

  btn: { backgroundColor: '#374151', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, alignSelf: 'flex-start' },
  btnText: { color: '#F3F4F6', fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },

  saveBtn: { backgroundColor: '#4F46E5', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  saveBtnText: { color: 'white', fontWeight: '700' },

  themeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: { borderWidth: 1, borderColor: '#334155', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9999 },
  chipActive: { backgroundColor: '#334155' },
  chipText: { color: '#94A3B8', fontWeight: '600' },
  chipTextActive: { color: '#E5E7EB' },
});
