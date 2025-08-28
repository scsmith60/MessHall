// PURPOSE: pick or take a photo, then resize for speed.
import React from 'react';
import { Image, Text, View, TouchableOpacity } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { tap, success, warn } from '../lib/haptics';

type Props = {
  uri?: string;
  onChange: (uri?: string) => void;
};

export default function PhotoPicker({ uri, onChange }: Props) {
  const pick = async (from: 'camera' | 'library') => {
    await tap();
    const ask = from === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (ask.status !== 'granted') {
      await warn();
      return;
    }
    const res = from === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
    if (res.canceled) return;

    // resize to ~1200w max (16:9 target looks great in feed)
    const base = res.assets[0];
    const scaled = await Manipulator.manipulateAsync(base.uri, [{ resize: { width: 1200 } }], { compress: 0.85 });
    await success();
    onChange(scaled.uri);
  };

  return (
    <View style={{ marginBottom: SPACING.lg }}>
      <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Photo</Text>
      {uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: 200, borderRadius: RADIUS.lg, marginBottom: 8 }} />
      ) : (
        <View style={{ height: 200, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, marginBottom: 8, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: COLORS.subtext }}>No photo yet</Text>
        </View>
      )}
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
    </View>
  );
}
