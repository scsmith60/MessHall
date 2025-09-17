// components/PhotoPicker.tsx
// 🧸 ELI5: this box lets you pick a picture and shows it.
// CHANGE: use new ImagePicker enum so warnings go away.

import React, { useMemo } from 'react';
import { Image, Text, View, TouchableOpacity, Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { tap, success, warn } from '../lib/haptics';

// ✅ We keep supporting both old and new parent prop styles.
export type MaybeAsset =
  | string
  | { uri?: string | null; mimeType?: string | null; fileName?: string | null };

type Props = {
  uri?: string;                    // legacy: parent passes a plain string
  uriOrAsset?: MaybeAsset;         // new: parent passes string OR object
  onChange: (next?: MaybeAsset) => void; // we return the same "style" they used
};

// ---------- helpers to guess names/types ----------
function guessFileNameFromUri(uri: string) {
  try {
    const last = uri.split(/[\/\\]/).pop() || '';
    return last && last.includes('.') ? last : (last ? `${last}.jpg` : 'image.jpg');
  } catch {
    return 'image.jpg';
  }
}
function guessMimeFromFilename(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
  if (n.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

// ---------- normalize picker outputs (old/new shapes) ----------
function normalizePickerResult(res: ImagePicker.ImagePickerResult | any) {
  if (res && typeof (res as any).uri === 'string') {
    const fileName = res.fileName || guessFileNameFromUri(res.uri);
    const mimeType = res.mimeType || guessMimeFromFilename(fileName);
    return { uri: res.uri, fileName, mimeType };
  }
  if (res?.canceled) return undefined;
  const asset = res?.assets?.[0];
  if (asset?.uri) {
    const fileName = asset.fileName || guessFileNameFromUri(asset.uri);
    const mimeType = asset.mimeType || guessMimeFromFilename(fileName);
    return { uri: asset.uri, fileName, mimeType };
  }
  return undefined;
}

export default function PhotoPicker({ uri, uriOrAsset, onChange }: Props) {
  // what picture should we show?
  const previewUri = useMemo(() => {
    if (typeof uriOrAsset === 'string') return uriOrAsset || undefined;
    if (uriOrAsset && typeof uriOrAsset === 'object' && uriOrAsset.uri) return uriOrAsset.uri || undefined;
    if (uri) return uri || undefined; // legacy
    return undefined;
  }, [uri, uriOrAsset]);

  // send back either a string (legacy) or object (new), matching what the parent used
  const emit = async (pickedUri: string) => {
    const fileName = guessFileNameFromUri(pickedUri);
    const mimeType = guessMimeFromFilename(fileName);
    if (typeof uriOrAsset !== 'undefined') {
      await success();
      onChange({ uri: pickedUri, fileName, mimeType });
    } else {
      await success();
      onChange(pickedUri);
    }
  };

  const ensureMediaPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      await warn();
      Alert.alert('Permission needed', 'Please allow photo access to pick an image.');
      return false;
    }
    return true;
  };

  const ensureCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      await warn();
      Alert.alert('Permission needed', 'Please allow camera access to take a photo.');
      return false;
    }
    return true;
  };

  // pick from camera or library (keeps your resize)
  const pick = async (from: 'camera' | 'library') => {
    await tap();

    if (from === 'library') {
      const ok = await ensureMediaPermission();
      if (!ok) return;
    } else {
      const ok = await ensureCameraPermission();
      if (!ok) return;
    }

    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({
            // 👇 NEW API — no more deprecation warnings
            mediaTypes: ImagePicker.MediaType.image, // or [ImagePicker.MediaType.image]
            quality: 0.9,
            exif: false,
          });

    const normalized = normalizePickerResult(result);
    if (!normalized) return;

    const manipulated = await Manipulator.manipulateAsync(
      normalized.uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.85 }
    );

    emit(manipulated.uri);
  };

  return (
    <View style={{ marginBottom: SPACING.lg }}>
      {/* label */}
      <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Photo</Text>

      {/* preview area */}
      {previewUri ? (
        <Image
          source={{ uri: previewUri }}
          style={{ width: '100%', height: 200, borderRadius: RADIUS.lg, marginBottom: 8 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            height: 200,
            backgroundColor: COLORS.card,
            borderRadius: RADIUS.lg,
            marginBottom: 8,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: COLORS.subtext }}>No photo yet</Text>
        </View>
      )}

      {/* buttons */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity
          onPress={() => pick('library')}
          style={{ backgroundColor: COLORS.card, paddingVertical: 10, paddingHorizontal: 14, borderRadius: RADIUS.lg, marginRight: 8 }}
        >
          <Text style={{ color: COLORS.text, fontWeight: '800' }}>Pick from Library</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => pick('camera')}
          style={{ backgroundColor: COLORS.accent, paddingVertical: 10, paddingHorizontal: 14, borderRadius: RADIUS.lg }}
        >
          <Text style={{ color: '#001018', fontWeight: '800' }}>Take Photo</Text>
        </TouchableOpacity>
      </View>

      {Platform.OS === 'android' && (
        <Text style={{ color: COLORS.subtext, fontSize: 12, marginTop: 6 }}>
          If picking fails, open Settings → App → Permissions and allow Photos.
        </Text>
      )}
    </View>
  );
}
