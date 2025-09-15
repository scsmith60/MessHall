// app/(admin)/creator-approvals.tsx
// PURPOSE: Show a list of creator applications for admins to approve/reject.
// KID-EXPLAIN: Grown-ups see all the "please can I earn money?" notes and pick Yes/No.

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, TextInput, FlatList, Alert } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
);

type AppRow = {
  application_id: number;
  user_id: string;
  application_status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  submitted_at: string;
  reviewed_at: string | null;
  reviewer: string | null;
  notes: string | null;
  username: string | null;
  email: string | null;
  creator_status: 'none' | 'eligible' | 'applied' | 'active' | 'rejected';
  account_created_at: string;
  two_factor_enabled: boolean;
  followers: number | null;
  views_30d: number | null;
  recipes_published: number | null;
  avg_rating: number | null;
  affiliate_conversions_60d: number | null;
  stripe_account_id: string | null;
  details_submitted: boolean | null;
};

export default function CreatorApprovals() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AppRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'withdrawn' | ''>('pending');
  const [noteById, setNoteById] = useState<Record<number, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  // make sure only admins can see
  const checkAdmin = async () => {
    const { data: me } = await supabase.from('profiles').select('is_admin').single();
    setIsAdmin(!!me?.is_admin);
  };

  const load = async () => {
    setLoading(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;

    const url = new URL(process.env.EXPO_PUBLIC_SUPABASE_URL! + '/functions/v1/admin-list-creator-apps');
    if (statusFilter) url.searchParams.set('status', statusFilter);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (json?.items) setItems(json.items);
    setLoading(false);
  };

  useEffect(() => {
    checkAdmin().then(load);
  }, [statusFilter]);

  const approve = async (application_id: number) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const note = noteById[application_id] || '';
    const res = await fetch(process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1/admin-approve-creator', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ application_id, note }),
    });
    const json = await res.json();
    if (json?.ok) {
      Alert.alert('Approved', 'Application approved.');
      load();
    } else {
      Alert.alert('Error', json?.error || 'Something went wrong.');
    }
  };

  const reject = async (application_id: number) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const note = noteById[application_id] || '';
    const res = await fetch(process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1/admin-reject-creator', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ application_id, note }),
    });
    const json = await res.json();
    if (json?.ok) {
      Alert.alert('Rejected', 'Application rejected.');
      load();
    } else {
      Alert.alert('Error', json?.error || 'Something went wrong.');
    }
  };

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 16 }}>Admins only.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>Creator Applications</Text>

      {/* Filter row */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['pending','approved','rejected'] as const).map(s => (
          <Pressable
            key={s}
            onPress={() => setStatusFilter(s)}
            style={{
              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
              backgroundColor: statusFilter === s ? '#22c55e' : '#222'
            }}
          >
            <Text style={{ color: statusFilter === s ? '#fff' : '#ddd' }}>{s}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.application_id)}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <View style={{ padding: 12, backgroundColor: '#111', borderRadius: 12, gap: 6 }}>
              <Text style={{ fontWeight: '700', fontSize: 16 }}>
                {item.username || item.email} • {item.application_status.toUpperCase()}
              </Text>
              <Text>Recipes: {item.recipes_published ?? 0} • Followers: {item.followers ?? 0} • Views30d: {item.views_30d ?? 0}</Text>
              <Text>Avg Rating: {item.avg_rating ?? '—'} • Conversions60d: {item.affiliate_conversions_60d ?? 0}</Text>
              <Text>2FA: {item.two_factor_enabled ? '✅' : '❌'} • Stripe: {item.details_submitted ? '✅ Onboarded' : '⭕ Not done'}</Text>

              {/* Note box */}
              <TextInput
                placeholder="Admin note (optional)…"
                placeholderTextColor="#999"
                value={noteById[item.application_id] || ''}
                onChangeText={(t) => setNoteById((s) => ({ ...s, [item.application_id]: t }))}
                style={{ borderWidth: 1, borderColor: '#333', borderRadius: 8, padding: 8, color: 'white' }}
              />

              {/* Buttons */}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <Pressable
                  onPress={() => approve(item.application_id)}
                  style={{ backgroundColor: '#22c55e', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 }}
                >
                  <Text style={{ color: 'white', fontWeight: '700' }}>Approve</Text>
                </Pressable>
                <Pressable
                  onPress={() => reject(item.application_id)}
                  style={{ backgroundColor: '#ef4444', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 }}
                >
                  <Text style={{ color: 'white', fontWeight: '700' }}>Reject</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
