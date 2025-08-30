// /app/(tabs)/owner-slot-creatives.tsx
// 🧸 ELI5: See all creatives for this slot. Add new ones. Edit weights. Toggle active.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { COLORS, RADIUS, SPACING } from '../../../lib/theme';
import HapticButton from '../../../components/ui/HapticButton';
import PhotoPicker from '../../../components/PhotoPicker';
import { uploadAdImage } from '../../../lib/uploads';

type MaybeAsset = string | { uri?: string | null; mimeType?: string | null; fileName?: string | null };

type Creative = {
  id: string;
  title: string;
  image_url: string;
  cta: string | null;
  cta_url: string | null;
  weight: number;
  is_active: boolean;
};

export default function OwnerSlotCreatives() {
  const { id: slotId, brand } = useLocalSearchParams<{ id: string; brand?: string }>();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Creative[]>([]);

  // new creative draft
  const [title, setTitle] = useState('');
  const [ctaText, setCtaText] = useState('Learn more');
  const [ctaUrl, setCtaUrl] = useState('');
  const [weight, setWeight] = useState('1');
  const [image, setImage] = useState<MaybeAsset | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('sponsored_creatives')
        .select('id, title, image_url, cta, cta_url, weight, is_active')
        .eq('slot_id', slotId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setItems(data ?? []);
    } catch (e: any) {
      Alert.alert('Could not load', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [slotId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!title.trim()) { Alert.alert('Need title'); return; }
    if (!image) { Alert.alert('Need image'); return; }
    const wn = parseInt(weight, 10); const weightNum = Number.isFinite(wn) && wn > 0 ? wn : 1;

    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id!;
      const url = await uploadAdImage(uid, image);
      const { error } = await supabase
        .from('sponsored_creatives')
        .insert({
          slot_id: slotId,
          title: title.trim(),
          image_url: url,
          cta: ctaText.trim(),
          cta_url: ctaUrl.trim(),
          weight: weightNum,
          is_active: true
        });
      if (error) throw error;
      setTitle(''); setCtaText('Learn more'); setCtaUrl(''); setWeight('1'); setImage(undefined);
      await load();
    } catch (e: any) {
      Alert.alert('Create failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: Creative) => {
    try {
      const { error } = await supabase.from('sponsored_creatives').update({ is_active: !c.is_active }).eq('id', c.id);
      if (error) throw error;
      setItems(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !c.is_active } : x));
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? 'Unknown error');
    }
  };

  const saveWeight = async (c: Creative, v: string) => {
    const n = parseInt(v, 10);
    const w = Number.isFinite(n) && n > 0 ? n : 1;
    try {
      const { error } = await supabase.from('sponsored_creatives').update({ weight: w }).eq('id', c.id);
      if (error) throw error;
      setItems(prev => prev.map(x => x.id === c.id ? { ...x, weight: w } : x));
    } catch (e: any) {
      Alert.alert('Weight update failed', e?.message ?? 'Unknown error');
    }
  };

  const remove = async (c: Creative) => {
    try {
      const { error } = await supabase.from('sponsored_creatives').delete().eq('id', c.id);
      if (error) throw error;
      setItems(prev => prev.filter(x => x.id !== c.id));
    } catch (e: any) {
      Alert.alert('Delete failed', e?.message ?? 'Unknown error');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ color: COLORS.subtext, marginTop: 8 }}>Loading creatives…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}>
      <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 12 }}>
        {brand ? `${brand} — ` : ''}Creatives
      </Text>

      {/* List existing creatives */}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={({ item: c }) => (
          <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: 12, marginBottom: 10 }}>
            <Text style={{ color: COLORS.text, fontWeight: '900', marginBottom: 6 }}>{c.title}</Text>
            <Text style={{ color: COLORS.subtext, marginBottom: 6 }} numberOfLines={1}>{c.cta_url || 'no link'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: COLORS.subtext }}>Weight</Text>
              <TextInput
                defaultValue={String(c.weight)}
                onEndEditing={(e) => saveWeight(c, e.nativeEvent.text)}
                keyboardType="number-pad"
                style={{ backgroundColor: '#0f172a', color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 10, paddingVertical: 6, minWidth: 60, textAlign: 'center' }}
              />
              <Text onPress={() => toggleActive(c)} style={{ marginLeft: 'auto', color: c.is_active ? COLORS.accent : '#a3a3a3', fontWeight: '900' }}>
                {c.is_active ? 'Active (tap to disable)' : 'Inactive (tap to enable)'}
              </Text>
              <Text onPress={() => remove(c)} style={{ color: '#ffb4b4', fontWeight: '900', marginLeft: 10 }}>Delete</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={{ color: COLORS.subtext, marginBottom: 12 }}>No creatives yet.</Text>}
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: COLORS.text, fontSize: 16, fontWeight: '900', marginBottom: 8 }}>Add New Creative</Text>
            <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Title</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="Ad headline" placeholderTextColor={COLORS.subtext}
              style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />
            <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Image</Text>
            <PhotoPicker uriOrAsset={image} onChange={setImage} />
            <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>CTA Text</Text>
            <TextInput value={ctaText} onChangeText={setCtaText} placeholder="Learn more" placeholderTextColor={COLORS.subtext}
              style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />
            <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>CTA Link (full URL)</Text>
            <TextInput value={ctaUrl} onChangeText={setCtaUrl} placeholder="https://brand.com/page" placeholderTextColor={COLORS.subtext} autoCapitalize="none" keyboardType="url"
              style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />
            <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Weight</Text>
            <TextInput value={weight} onChangeText={setWeight} placeholder="1" placeholderTextColor={COLORS.subtext} keyboardType="number-pad"
              style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />
            <HapticButton onPress={create} style={{ backgroundColor: COLORS.accent, padding: 14, borderRadius: RADIUS.lg, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
              {busy ? <ActivityIndicator /> : <Text style={{ color: '#001018', fontWeight: '900' }}>Add Creative</Text>}
            </HapticButton>
          </View>
        }
      />
    </View>
  );
}
