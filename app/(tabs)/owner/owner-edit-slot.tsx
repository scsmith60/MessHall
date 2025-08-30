// /app/(tabs)/owner-edit-slot.tsx
// 🧸 ELI5: Change a slot's words, picture, dates, link.
// - "Save" updates the row.
// - "Replace Image" uses our uploader.
// - "Delete" removes the slot.

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { COLORS, RADIUS, SPACING } from '../../../lib/theme';
import PhotoPicker from '../../../components/PhotoPicker';
import HapticButton from '../../../components/ui/HapticButton';
import { uploadAdImage } from '../../../lib/uploads';

type MaybeAsset = string | { uri?: string | null; mimeType?: string | null; fileName?: string | null };

function isISODate(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()); }
function need(v: string, min = 1) { return (v ?? '').trim().length >= min; }
function isUrl(v: string) { try { new URL(v.trim()); return true; } catch { return false; } }

export default function OwnerEditSlot() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState('');
  const [title, setTitle] = useState('');
  const [ctaText, setCtaText] = useState('Learn more');
  const [ctaUrl, setCtaUrl] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [weight, setWeight] = useState('5');
  const [active, setActive] = useState(true);
  const [image, setImage] = useState<MaybeAsset | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const weightNum = useMemo(() => {
    const n = parseInt(weight, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [weight]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!id) throw new Error('Missing id');
        // admin check
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error('Please sign in.');
        const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', u.user.id).maybeSingle();
        if (!prof?.is_admin) throw new Error('Admins only.');

        const { data, error } = await supabase
          .from('sponsored_slots')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Not found');

        if (!alive) return;
        setBrand(data.brand ?? '');
        setTitle(data.title ?? '');
        setCtaText(data.cta ?? 'Learn more');
        setCtaUrl(data.cta_url ?? '');
        setStartsAt((data.starts_at ?? '').slice(0,10));
        setEndsAt((data.ends_at ?? '').slice(0,10));
        setWeight(String(data.weight ?? 5));
        setActive(!!data.is_active);
        setImage(data.image_url ?? undefined); // start with current URL (string is okay)
      } catch (e: any) {
        Alert.alert('Could not load', e?.message ?? 'Unknown error', [{ text: 'OK', onPress: () => router.back() }]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const save = async () => {
    if (!need(brand, 2) || !need(title, 2)) { Alert.alert('Missing info', 'Please enter Brand and Title.'); return; }
    if (!isUrl(ctaUrl)) { Alert.alert('Link looks wrong', 'Please paste a full URL like https://example.com'); return; }
    if (!isISODate(startsAt) || !isISODate(endsAt)) { Alert.alert('Date format', 'Use YYYY-MM-DD'); return; }

    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id!;
      let imageUrl: string | undefined;

      // if image is an object or a different string than the original URL, upload/keep accordingly
      if (image && typeof image !== 'string') {
        imageUrl = await uploadAdImage(uid, image);
      } else if (typeof image === 'string') {
        imageUrl = image; // keep existing URL
      } else {
        imageUrl = undefined; // allow clearing
      }

      const payload: any = {
        brand: brand.trim(),
        title: title.trim(),
        cta: ctaText.trim(),
        cta_url: ctaUrl.trim(),
        starts_at: new Date(startsAt + 'T00:00:00Z').toISOString(),
        ends_at: new Date(endsAt + 'T23:59:59Z').toISOString(),
        weight: weightNum,
        is_active: active
      };
      // only send image_url if defined (so we don't overwrite with null by accident)
      if (typeof imageUrl !== 'undefined') payload.image_url = imageUrl;

      const { error } = await supabase
        .from('sponsored_slots')
        .update(payload)
        .eq('id', id);
      if (error) throw error;

      Alert.alert('Saved', 'Slot updated.');
      router.back();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    Alert.alert('Delete Slot', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const { error } = await supabase.from('sponsored_slots').delete().eq('id', id);
          if (error) throw error;
          Alert.alert('Deleted', 'Slot removed.');
          router.back();
        } catch (e: any) {
          Alert.alert('Delete failed', e?.message ?? 'Unknown error');
        }
      } }
    ]);
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ color: COLORS.subtext, marginTop: 8 }}>Loading…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 40 }}>
        <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 12 }}>Edit Sponsored Slot</Text>

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Brand</Text>
        <TextInput value={brand} onChangeText={setBrand} placeholder="Acme" placeholderTextColor={COLORS.subtext}
          style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Title</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="Great Gadget" placeholderTextColor={COLORS.subtext}
          style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Image</Text>
        <PhotoPicker uriOrAsset={image} onChange={setImage} />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>CTA Button Text</Text>
        <TextInput value={ctaText} onChangeText={setCtaText} placeholder="Learn more" placeholderTextColor={COLORS.subtext}
          style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>CTA Link (full URL)</Text>
        <TextInput value={ctaUrl} onChangeText={setCtaUrl} placeholder="https://brand.com" placeholderTextColor={COLORS.subtext} autoCapitalize="none" keyboardType="url"
          style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Start Date (YYYY-MM-DD)</Text>
        <TextInput value={startsAt} onChangeText={setStartsAt} placeholder="2025-09-01" placeholderTextColor={COLORS.subtext}
          style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>End Date (YYYY-MM-DD)</Text>
        <TextInput value={endsAt} onChangeText={setEndsAt} placeholder="2025-10-01" placeholderTextColor={COLORS.subtext}
          style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

        <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>Weight</Text>
        <TextInput value={weight} onChangeText={setWeight} placeholder="5" placeholderTextColor={COLORS.subtext} keyboardType="number-pad"
          style={{ backgroundColor: COLORS.card, color: COLORS.text, borderRadius: RADIUS.lg, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Text style={{ color: COLORS.subtext }}>Active:</Text>
          <Text onPress={() => setActive(a => !a)} style={{ color: active ? COLORS.accent : '#a3a3a3', fontWeight: '900' }}>
            {active ? 'Yes (tap to turn off)' : 'No (tap to turn on)'}
          </Text>
        </View>

        <HapticButton onPress={save} style={{ backgroundColor: COLORS.accent, padding: 14, borderRadius: RADIUS.lg, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
          {busy ? <ActivityIndicator /> : <Text style={{ color: '#001018', fontWeight: '900' }}>Save Changes</Text>}
        </HapticButton>

        <View style={{ height: 12 }} />

        <HapticButton onPress={remove} style={{ backgroundColor: '#5b1111', padding: 14, borderRadius: RADIUS.lg, alignItems: 'center' }}>
          <Text style={{ color: '#ffd1d1', fontWeight: '900' }}>Delete Slot</Text>
        </HapticButton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
