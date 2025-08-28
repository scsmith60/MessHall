// CAPTURE / ADD SCREEN
// WHAT IT DOES (like I'm 5):
// - You can paste a link; we guess some info for you.
// - You can pick or take a photo; we make it not-too-big.
// - You can type the recipe: title, time, servings, ingredients, steps.
// - Press Save. If you forgot something important, it tells you nicely and buzzes.

import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../../lib/theme';
import FormField from '../../components/ui/FormField';
import RowButton from '../../components/ui/RowButton';
import IngredientRow from '../../components/IngredientRow';
import StepRow from '../../components/StepRow';
import PhotoPicker from '../../components/PhotoPicker';
import ImportBar from '../../components/ImportBar';
import { needPositiveInt, needText } from '../../lib/validators';
import { addDraft } from '../../lib/localDrafts';
import { success, warn } from '../../lib/haptics';

type Ing = { id: string; text: string };
type Stp = { id: string; text: string };

function nid() { return Math.random().toString(36).slice(2); }

export default function Capture() {
  // FORM STATE (all in one spot)
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState<string>(''); // keep as string for input
  const [servings, setServings] = useState<string>('');
  const [image, setImage] = useState<string | undefined>(undefined);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [ingredients, setIngredients] = useState<Ing[]>([{ id: nid(), text: '' }]);
  const [steps, setSteps] = useState<Stp[]>([{ id: nid(), text: '' }]);

  // derived numbers
  const minutesNum = useMemo(() => Number.parseInt(minutes, 10), [minutes]);
  const servingsNum = useMemo(() => Number.parseInt(servings, 10), [servings]);

  // when ImportBar returns parsed info
  const onParsed = (p: { title?: string; minutes?: number; image?: string; url?: string }) => {
    if (p.title && !title) setTitle(p.title);
    if (typeof p.minutes === 'number' && !minutes) setMinutes(String(p.minutes));
    if (p.image && !image) setImage(p.image);
    if (p.url) setSourceUrl(p.url);
  };

  // change helpers for list items
  const changeIng = (id: string, text: string) => setIngredients(prev => prev.map(it => it.id === id ? { ...it, text } : it));
  const addIng = () => setIngredients(prev => [...prev, { id: nid(), text: '' }]);
  const delIng = (id: string) => setIngredients(prev => prev.filter(it => it.id !== id));

  const changeStep = (id: string, text: string) => setSteps(prev => prev.map(it => it.id === id ? { ...it, text } : it));
  const addStep = () => setSteps(prev => [...prev, { id: nid(), text: '' }]);
  const delStep = (id: string) => setSteps(prev => prev.filter(it => it.id !== id));

  // validate & save
  const onSave = async () => {
    // RULES (simple):
    // - title has at least 2 letters
    // - at least 1 ingredient with text
    // - at least 1 step with text
    // - minutes/servings are optional but must be positive if filled
    const goodTitle = needText(title, 2);
    const goodIngs = ingredients.some(i => needText(i.text, 2));
    const goodSteps = steps.some(s => needText(s.text, 2));
    const goodMinutes = !minutes || needPositiveInt(minutesNum);
    const goodServings = !servings || needPositiveInt(servingsNum);

    if (!goodTitle || !goodIngs || !goodSteps || !goodMinutes || !goodServings) {
      await warn();
      const msgs = [];
      if (!goodTitle) msgs.push('• Title needs at least 2 letters');
      if (!goodIngs) msgs.push('• Add at least one ingredient');
      if (!goodSteps) msgs.push('• Add at least one step');
      if (!goodMinutes) msgs.push('• Time must be a whole number > 0');
      if (!goodServings) msgs.push('• Servings must be a whole number > 0');
      Alert.alert('Please fix:', msgs.join('\n'));
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
    Alert.alert('Saved!', 'Your recipe draft is saved on this device.\nLater we’ll sync to the cloud.');
    // quick reset (keep photo to make it feel friendly)
    setTitle('');
    setMinutes('');
    setServings('');
    setIngredients([{ id: nid(), text: '' }]);
    setSteps([{ id: nid(), text: '' }]);
    setSourceUrl(undefined);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: SPACING.lg }}>
      {/* IMPORT A LINK (optional) */}
      <ImportBar onParsed={onParsed} />

      {/* PHOTO PICKER */}
      <PhotoPicker uri={image} onChange={setImage} />

      {/* BASIC FIELDS */}
      <FormField label="Title" value={title} placeholder="e.g., Creamy Garlic Pasta" onChangeText={setTitle} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Time (minutes)" value={minutes} placeholder="e.g., 25" onChangeText={setMinutes} keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Servings" value={servings} placeholder="e.g., 4" onChangeText={setServings} keyboardType="numeric" />
        </View>
      </View>

      {/* INGREDIENTS */}
      <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', marginTop: SPACING.lg, marginBottom: SPACING.md }}>
        Ingredients
      </Text>
      {ingredients.map((it) => (
        <IngredientRow key={it.id} value={it.text} onChange={(t) => changeIng(it.id, t)} onRemove={() => delIng(it.id)} />
      ))}
      <RowButton title="+ Add Ingredient" onPress={addIng} />

      {/* STEPS */}
      <Text style={{ color: COLORS.text, fontSize: 18, fontWeight: '800', marginTop: SPACING.lg, marginBottom: SPACING.md }}>
        Steps
      </Text>
      {steps.map((it, idx) => (
        <StepRow key={it.id} index={idx} value={it.text} onChange={(t) => changeStep(it.id, t)} onRemove={() => delStep(it.id)} />
      ))}
      <RowButton title="+ Add Step" onPress={addStep} />

      {/* SAVE BUTTON */}
      <View style={{ height: 16 }} />
      <View
        style={{
          backgroundColor: COLORS.accent,
          paddingVertical: 14,
          borderRadius: RADIUS.xl,
          alignItems: 'center',
          marginBottom: SPACING.xl
        }}
      >
        <Text onPress={onSave} style={{ color: '#001018', fontWeight: '900', fontSize: 16 }}>
          Save Draft
        </Text>
      </View>

      {/* friendly hint */}
      <Text style={{ color: COLORS.subtext, textAlign: 'center', marginBottom: 28 }}>
        Tip: You can paste a link to auto-fill basics. We’ll make this super smart later.
      </Text>
    </ScrollView>
  );
}
