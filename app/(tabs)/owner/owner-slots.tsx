// /app/(tabs)/owner-slots.tsx
// 🧸 ELI5: This shows all sponsor slots. Tap one to edit it.
// - Only admins allowed (we check).
// - You can toggle ON/OFF.
// - You can nudge weights (–1 / +1) for A/B balance right here.
// - We show status pills: SCHEDULED / ACTIVE / EXPIRED (uses active_from / active_to + active flag).
// - Pull to refresh reloads the list.
// - SAFE: works with `is_active` OR `active` column names. Optional fields won't crash.
// - SAFE: no DB ORDER on fragile columns; we sort in JS.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { COLORS, RADIUS, SPACING } from '../../../lib/theme';
import { router } from 'expo-router';

// 👉 Optional fields so missing DB columns don't explode.
type Slot = {
  id: string;
  brand?: string | null;
  title?: string | null;
  image_url?: string | null;
  cta?: string | null;
  cta_url?: string | null;
  active_from?: string | null; // start date
  active_to?: string | null;   // end date
  weight?: number | null;
  // Either name for the on/off flag is accepted:
  is_active?: boolean | null;
  active?: boolean | null;
  updated_at?: string | null;
};

// 🧠 Read ON/OFF safely (supports both `is_active` and `active`)
const getActiveFlag = (s: Slot): boolean => {
  if (typeof s.is_active !== 'undefined' && s.is_active !== null) return !!s.is_active;
  if (typeof s.active !== 'undefined' && s.active !== null) return !!s.active;
  return true; // default ON if missing
};

// 🛠 Decide which column to patch when toggling
const getActiveColumnName = (s: Slot): 'is_active' | 'active' => {
  if (typeof s.is_active !== 'undefined' && s.is_active !== null) return 'is_active';
  return 'active';
};

// 🗓️ tiny safe date helper
const toDateSafe = (v?: string | null): Date | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
};

// 🎯 Status from dates + active flag
type SlotStatus = 'SCHEDULED' | 'ACTIVE' | 'EXPIRED';
const getStatus = (s: Slot, now = new Date()): SlotStatus => {
  const start = toDateSafe(s.active_from);
  const end = toDateSafe(s.active_to);
  const on = getActiveFlag(s);
  if (start && now < start) return 'SCHEDULED';
  if (end && now > end) return 'EXPIRED';
  return on ? 'ACTIVE' : 'EXPIRED';
};

export default function OwnerSlots() {
  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // optional quick filter (All / Active / Scheduled / Expired)
  const [filter, setFilter] = useState<'ALL' | SlotStatus>('ALL');

  const load = useCallback(async () => {
    try {
      setLoading(true);

      // ✅ must be admin
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error('Please sign in.');
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', u.user.id)
        .maybeSingle();
      if (profErr) throw profErr;
      if (!prof?.is_admin) throw new Error('Admins only.');

      // ✅ pull everything without naming columns (avoid "column does not exist")
      const { data, error } = await supabase.from('sponsored_slots').select('*').limit(200);
      if (error) throw error;

      const list = (data ?? []) as Slot[];

      // ✅ sort in JS:
      // 1) soonest active_from first (if present)
      // 2) newest updated_at next
      const sorted = [...list].sort((a, b) => {
        const aStart = toDateSafe(a.active_from)?.getTime() ?? Number.POSITIVE_INFINITY;
        const bStart = toDateSafe(b.active_from)?.getTime() ?? Number.POSITIVE_INFINITY;
        if (aStart !== bStart) return aStart - bStart;
        const aUpd = toDateSafe(a.updated_at)?.getTime() ?? 0;
        const bUpd = toDateSafe(b.updated_at)?.getTime() ?? 0;
        return bUpd - aUpd;
      });

      setSlots(sorted);
    } catch (e: any) {
      Alert.alert('Could not load', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // 🔀 Toggle ON/OFF (works with either column name)
  const toggleActive = async (s: Slot) => {
    try {
      const current = getActiveFlag(s);
      const column = getActiveColumnName(s); // 'is_active' or 'active'
      const patch: Record<string, any> = { [column]: !current };

      const { error } = await supabase.from('sponsored_slots').update(patch).eq('id', s.id);
      if (error) throw error;

      // update local state
      setSlots(prev =>
        prev.map(x =>
          x.id === s.id
            ? {
                ...x,
                [column]: !current,
              }
            : x
        )
      );
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? 'Unknown error');
    }
  };

  // 🎛️ Nudge weight (–1 / +1) with clamp to >= 0
  const nudgeWeight = async (s: Slot, delta: number) => {
    try {
      const current = typeof s.weight === 'number' ? s.weight : 0;
      const next = Math.max(0, current + delta); // don’t go below zero
      const { error } = await supabase
        .from('sponsored_slots')
        .update({ weight: next })
        .eq('id', s.id);
      if (error) throw error;

      setSlots(prev =>
        prev.map(x => (x.id === s.id ? { ...x, weight: next } : x))
      );
    } catch (e: any) {
      Alert.alert('Weight change failed', e?.message ?? 'Unknown error');
    }
  };

  // 🧹 apply filter
  const filtered = useMemo(() => {
    if (filter === 'ALL') return slots;
    return slots.filter(s => getStatus(s) === filter);
  }, [slots, filter]);

  const renderItem = ({ item }: { item: Slot }) => {
    const isOn = getActiveFlag(item);
    const start = item.active_from?.slice(0, 10) ?? '—';
    const end = item.active_to?.slice(0, 10) ?? '—';
    const weight = typeof item.weight === 'number' ? item.weight : 0;
    const status = getStatus(item);

    const badgeBg =
      status === 'ACTIVE' ? '#16a34a' : status === 'SCHEDULED' ? '#2563eb' : '#6b7280';

    return (
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/(tabs)/owner-edit-slot', params: { id: item.id } })}
        style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: 12, marginBottom: 10 }}
        activeOpacity={0.9}
      >
        {/* Row 1: brand/title + status pill */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              marginRight: 8,
              backgroundColor: isOn ? COLORS.accent : '#6b7280',
            }}
          />
          <Text style={{ color: COLORS.text, fontWeight: '900', flex: 1 }}>
            {(item.brand ?? 'Unknown Brand')} — {(item.title ?? 'No title')}
          </Text>
          <Text
            style={{
              color: '#001018',
              backgroundColor: badgeBg,
              paddingVertical: 4,
              paddingHorizontal: 10,
              borderRadius: 999,
              fontWeight: '900',
              overflow: 'hidden',
              marginRight: 10,
            }}
          >
            {status}
          </Text>
          <Text onPress={() => toggleActive(item)} style={{ color: COLORS.subtext, fontWeight: '800' }}>
            {isOn ? 'Deactivate' : 'Activate'}
          </Text>
        </View>

        {/* Row 2: dates + weight + nudgers */}
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: COLORS.subtext, flex: 1 }}>
            {start} → {end} • weight {weight}
          </Text>
          {/* –1 button */}
          <TouchableOpacity
            onPress={() => nudgeWeight(item, -1)}
            style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#1f2937', marginRight: 6 }}
          >
            <Text style={{ color: '#e5e7eb', fontWeight: '900' }}>−1</Text>
          </TouchableOpacity>
          {/* +1 button */}
          <TouchableOpacity
            onPress={() => nudgeWeight(item, +1)}
            style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#1f2937' }}
          >
            <Text style={{ color: '#e5e7eb', fontWeight: '900' }}>+1</Text>
          </TouchableOpacity>
        </View>

        {/* Row 3: link (only if present) */}
        {item.cta_url ? (
          <Text style={{ color: COLORS.subtext, marginTop: 6 }} numberOfLines={1}>
            Link: {item.cta_url}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ color: COLORS.subtext, marginTop: 8 }}>Loading slots…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, padding: SPACING.lg }}>
      {/* Header */}
      <Text style={{ color: COLORS.text, fontSize: 22, fontWeight: '900', marginBottom: 12 }}>
        Sponsored Slots
      </Text>

      {/* Quick filter: All / Active / Scheduled / Expired */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        {(['ALL', 'ACTIVE', 'SCHEDULED', 'EXPIRED'] as const).map(k => {
          const isSel = filter === k;
          return (
            <TouchableOpacity
              key={k}
              onPress={() => setFilter(k)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: isSel ? COLORS.accent : '#1f2937',
              }}
            >
              <Text style={{ color: isSel ? '#001018' : '#e5e7eb', fontWeight: '900' }}>{k}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.subtext} />
        }
      />
    </View>
  );
}
