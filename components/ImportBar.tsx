// PURPOSE: paste a link (YouTube/TikTok/blog) and auto-fill some fields via stub parser.
import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { parseRecipeUrl } from '../lib/parser';
import { success, tap, warn } from '../lib/haptics';

type Props = {
  onParsed: (p: { title?: string; minutes?: number; image?: string; url?: string }) => void;
};

export default function ImportBar({ onParsed }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const paste = async () => {
    await tap();
    const txt = await Clipboard.getStringAsync();
    setUrl(txt);
  };

  const run = async () => {
    if (!url) return;
    setBusy(true);
    try {
      const p = await parseRecipeUrl(url);
      await success();
      onParsed({ ...p, url });
    } catch {
      await warn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginBottom: SPACING.lg }}>
      <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Import from Link (optional)</Text>
      <View style={{ flexDirection: 'row' }}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="Paste YouTube/TikTok/blog URL"
          placeholderTextColor={COLORS.subtext}
          style={{
            flex: 1,
            backgroundColor: COLORS.card,
            color: COLORS.text,
            borderTopLeftRadius: RADIUS.lg,
            borderBottomLeftRadius: RADIUS.lg,
            paddingHorizontal: 14
          }}
        />
        <TouchableOpacity
          onPress={paste}
          style={{ backgroundColor: COLORS.card, paddingHorizontal: 12, justifyContent: 'center' }}
        >
          <Text style={{ color: COLORS.accent, fontWeight: '800' }}>Paste</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={run}
          disabled={!url || busy}
          style={{
            backgroundColor: busy ? '#0b2530' : COLORS.accent,
            paddingHorizontal: 14,
            justifyContent: 'center',
            borderTopRightRadius: RADIUS.lg,
            borderBottomRightRadius: RADIUS.lg
          }}
        >
          {busy ? <ActivityIndicator /> : <Text style={{ color: '#001018', fontWeight: '800' }}>Import</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}
