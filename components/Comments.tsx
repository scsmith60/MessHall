// /components/Comments.tsx
// 🧸 ELI5: Shows a list of comments and a box to add one.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Text, TextInput, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../lib/theme';
import { addComment, fetchComments, deleteComment, Comment } from '../lib/social';
import HapticButton from './ui/HapticButton';
import { supabase } from '../lib/supabase';

export default function Comments({ recipeId }: { recipeId: string }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: au } = await supabase.auth.getUser();
        if (alive) setMe(au?.user?.id ?? null);
        const rows = await fetchComments(recipeId);
        if (alive) setItems(rows);
      } catch (e) {
        // ignore
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [recipeId]);

  const onAdd = async () => {
    try {
      await addComment(recipeId, body);
      setBody('');
      const rows = await fetchComments(recipeId);
      setItems(rows);
    } catch (e: any) {
      Alert.alert('Could not comment', e?.message ?? 'Please sign in first');
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteComment(id);
      setItems(prev => prev.filter(x => x.id !== id));
    } catch {}
  };

  return (
    <View style={{ marginTop: SPACING.lg }}>
      <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Comments</Text>

      {loading ? (
        <ActivityIndicator />
      ) : (
        <View style={{ gap: 10 }}>
          {items.length === 0 && <Text style={{ color: COLORS.subtext }}>Be the first to comment!</Text>}
          {items.map((c) => (
            <View key={c.id} style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: 10 }}>
              <Text style={{ color: COLORS.subtext, marginBottom: 6 }}>
                {/* later: replace user_id with username/avatar */}
                <Text style={{ color: COLORS.accent, fontWeight: '800' }}>{c.user_id.slice(0, 6)}</Text>{' '}
                • {new Date(c.created_at).toLocaleString()}
              </Text>
              <Text style={{ color: COLORS.text }}>{c.body}</Text>
              {me === c.user_id && (
                <Text onPress={() => onDelete(c.id)} style={{ color: '#ffb4b4', fontWeight: '900', marginTop: 6 }}>
                  Delete
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* add box */}
      <View style={{ marginTop: 12, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: 10 }}>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Say something nice…"
          placeholderTextColor={COLORS.subtext}
          multiline
          style={{ color: COLORS.text, minHeight: 40 }}
        />
        <HapticButton
          onPress={onAdd}
          style={{ alignSelf: 'flex-end', backgroundColor: COLORS.accent, paddingVertical: 10, paddingHorizontal: 14, borderRadius: RADIUS.lg, marginTop: 8 }}
        >
          <Text style={{ color: '#001018', fontWeight: '900' }}>Post</Text>
        </HapticButton>
      </View>
    </View>
  );
}
