// CAPTURE / ADD SCREEN (now with "Save to Cloud")
// - Paste link (stub parser) -> prefill fields
// - Pick/take photo -> resize
// - Validate -> Save Draft (local) OR Save to Cloud (Supabase)
// - Cloud flow: ensure profile -> upload image -> insert recipe -> insert ingredients/steps

import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View, ActivityIndicator } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../lib/theme';
import FormField from '../../components/ui/FormField';
import RowButton from '../../components/ui/RowButton';
import IngredientRow from '../../components/IngredientRow';
import StepRow from '../../components/StepRow';
import PhotoPicker from '../../components/PhotoPicker';
import ImportBar from '../../components/ImportBar';
import { needPositiveInt, needText } from '../../lib/validators';
import { addDraft } from '../../lib/localDrafts';
import { success, warn, tap } from '../../lib/haptics';
import { uploadRecipeImage } from '../../lib/uploads';
import { supabase } from '../../lib/supabase';
import { ensureMyProfile } from '../../lib/profile';

type Ing = { id: string; text: string };
type Stp = { id: string; text: string; seconds?: number }; // seconds is optional
function nid() { return Math.random().toString(36).slice(2); }

export default function Capture() {
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState<string>('');
  const [servings, setServings] = useState<string>('');
  const [image, setImage] = useState<string | undefined>(undefined);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [ingredients, setIngredients] = useState<Ing[]>([{ id: nid(), text: '' }]);
  const [steps, setSteps] = useState<Stp[]>([{ id: nid(), text: '', seconds: 0 }]);
  const [busy, setBusy] = useState(false);

  const minutesNum = useMemo(() => Number.parseInt(minutes, 10), [minutes]);
  const servingsNum = useMemo(() => Number.parseInt(servings, 10), [servings]);

  const onParsed = (p: { title?: string; minutes?: number; image?: string; url?: string }) => {
    if (p.title && !title) setTitle(p.title);
    if (typeof p.minutes === 'number' && !minutes) setMinutes(String(p.minutes));
    if (p.image && !image) setImage(p.image);
    if (p.url) setSourceUrl(p.url);
  };

  const changeIng = (id: string, text: string) => setIngredients(prev => prev.map(it => it.id === id ? { ...it, text } : it));
  const addIng = () => setIngredients(prev => [...prev, { id: nid(), text: '' }]);
  const delIng = (id: string) => setIngredients(prev => prev.filter(it => it.id !== id));

  const changeStep = (id: string, text: string) => setSteps(prev => prev.map(it => it.id === id ? { ...it, text } : it));
  const addStep = () => setSteps(prev => [...prev, { id: nid(), text: '' }]);
  const delStep = (id: string) => setSteps(prev => prev.filter(it => it.id !== id));

  const validate = () => {
    const goodTitle = needText(title, 2);
    const goodIngs = ingredients.some(i => needText(i.text, 2));
    const goodSteps = steps.some(s => needText(s.text, 2));
    const goodMinutes = !minutes || needPositiveInt(minutesNum);
    const goodServings = !servings || needPositiveInt(servingsNum);
    return { goodTitle, goodIngs, goodSteps, goodMinutes, goodServings };
  };

  const onSaveDraft = async () => {
    const { goodTitle, goodIngs, goodSteps, goodMinutes, goodServings } = validate();
    if (!goodTitle || !goodIngs || !goodSteps || !goodMinutes || !goodServings) {
      await warn();
      Alert.alert('Please fix:', [
        !goodTitle && '• Title needs at least 2 letters',
        !goodIngs && '• Add at least one ingredient',
        !goodSteps && '• Add at least one step',
        !goodMinutes && '• Time must be a whole number > 0',
        !goodServings && '• Servings must be a whole number > 0'
      ].filter(Boolean).join('\n'));
      return;
    }
    await addDraft({
      id: nid(),
      title: title.trim(),
      minutes: minutes ? minutesNum : undefined,
      servings: servings ? servingsNum : undefined,
      image,
      ingredients: ingredients.filter(i => needText(i.text, 2)),
      steps: steps.filter(s => needText(s.text, 2)),
      sourceUrl,
      createdAt: Date.now()
    });
    await success();
    Alert.alert('Saved locally!', 'Your recipe draft is saved on this device.');
  };

  const onSaveCloud = async () => {
    const { goodTitle, goodIngs, goodSteps, goodMinutes, goodServings } = validate();
    if (!goodTitle || !goodIngs || !goodSteps || !goodMinutes || !goodServings) {
      await warn();
      Alert.alert('Please fix the form first 🙏');
      return;
    }
    setBusy(true);
    try {
      // 1) ensure signed in + profile row
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error('Please sign in first.');
      await ensureMyProfile();

      // 2) upload image if we have one
      let publicUrl: string | undefined = undefined;
      if (image) publicUrl = await uploadRecipeImage(image);

      // 3) insert recipe
      const { data: me } = await supabase.auth.getUser();
      const { data: rec, error: recErr } = await supabase.from('recipes')
        .insert({
          user_id: me!.user!.id,
          title: title.trim(),
          minutes: minutes ? minutesNum : null,
          servings: servings ? servingsNum : null,
          image_url: publicUrl ?? null,
          source_url: sourceUrl ?? null
        })
        .select('id')
        .single();
      if (recErr) throw recErr;

      // 4) insert ingredients (ordered)
      const ingRows = ingredients
        .map((i, idx) => i.text.trim())
        .filter(t => t.length >= 2)
        .map((t, idx) => ({ recipe_id: rec.id, pos: idx + 1, text: t }));
      if (ingRows.length) {
        const { error } = await supabase.from('recipe_ingredients').insert(ingRows);
        if (error) throw error;
      }

      // 5) insert steps (ordered)
      const stepRows = steps
     .filter(s => (s.text || '').trim().length >= 2)
     .map((s, idx) => ({
       recipe_id: rec.id,
       pos: idx + 1,
       text: s.text.trim(),
       seconds: typeof s.seconds === 'number' ? s.seconds : null
      }));

      await success();
      Alert.alert('Saved to Cloud!', 'Your recipe is live. 🎉');
      // optional: reset form
      setTitle(''); setMinutes(''); setServings('');
      setIngredients([{ id: nid(), text: '' }]);
      setSteps([{ id: nid(), text: '' }]);
      setSourceUrl(undefined); // keep image to feel friendly? your call
      // You could also navigate to its detail page using rec.id
      // router.push(`/recipe/${rec.id}`)
    } catch (e: any) {
      await warn();
      Alert.alert('Could not save', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: SPACING.lg }}>
      <ImportBar onParsed={onParsed} />
      <PhotoPicker uri={image} onChange={setImage} />

      <FormField label="Title" value={title} placeholder="e.g., Creamy Garlic Pasta" onChangeText={setTitle} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Time (minutes)" value={minutes} placeholder="e.g., 25" onChangeText={setMinutes} keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Servings" value={servings} placeholder="e.g., 4" onChangeText={setServings} keyboardType="numeric" />
        </View>
      </View>

      <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', marginTop: SPACING.lg, marginBottom: SPACING.md }}>Ingredients</Text>
      {ingredients.map((it) => (
        <IngredientRow key={it.id} value={it.text} onChange={(t) => changeIng(it.id, t)} onRemove={() => delIng(it.id)} />
      ))}
      <RowButton title="+ Add Ingredient" onPress={addIng} />

      <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', marginTop: SPACING.lg, marginBottom: SPACING.md }}>Steps</Text>
      {steps.map((it, idx) => (
        <StepRow key={it.id} index={idx} value={it.text} seconds={it.seconds ?? 0} onChange={(t) => changeStep(it.id, t)} onChangeSeconds={(n) => setSteps(prev => prev.map(s => s.id === it.id ? { ...s, seconds: n } : s))}
         onRemove={() => delStep(it.id)} />
    ))}
      <RowButton title="+ Add Step" onPress={addStep} />

      {/* ACTIONS */}
      <View style={{ height: 16 }} />
      <View style={{ backgroundColor: COLORS.card, paddingVertical: 14, borderRadius: RADIUS.xl, alignItems: 'center', marginBottom: 10 }}>
        <Text onPress={onSaveDraft} style={{ color: COLORS.text, fontWeight: '900', fontSize: 16 }}>Save Draft (Local)</Text>
      </View>

      <View style={{ backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: RADIUS.xl, alignItems: 'center', marginBottom: SPACING.xl, opacity: busy ? 0.6 : 1 }}>
        {busy
          ? <ActivityIndicator />
          : <Text onPress={onSaveCloud} style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>Save to Cloud</Text>}
      </View>

      <Text style={{ color: COLORS.subtext, textAlign: 'center', marginBottom: 28 }}>
        Tip: “Save to Cloud” needs you to be signed in. We’ll add the Auth screen next.
      </Text>
    </ScrollView>
  );
}
