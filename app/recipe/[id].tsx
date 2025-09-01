// app/recipe/[id].tsx
// Shows one recipe. NEW: status pills for 🔒 Private / 🌐 Imported.

import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { recipeStore } from '../../lib/store';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';
import HapticButton from '../../components/ui/HapticButton';
import { compactNumber, timeAgo } from '../../lib/utils';
import { success, tap, warn } from '../../lib/haptics';
import { dataAPI } from '../../lib/data';
import { Image } from 'expo-image';
import { supabase } from '@/lib/supabase';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState<{
    id: string;
    title: string;
    image: string;
    creator: string;
    knives: number;
    createdAt: number;
  } | null>(null);

  // who am I / owner
  const [userId, setUserId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const isOwner = !!userId && !!ownerId && userId === ownerId;

  // NEW: flags for pills
  const [isPrivate, setIsPrivate] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const [ingredients, setIngredients] = useState<string[]>([]);
  const [steps, setSteps] = useState<{ text: string; seconds?: number | null }[]>([]);

  const [saved, setSaved] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState<number>(0);
  const [cooksCount, setCooksCount] = useState<number>(0);

  // load main record
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!id) return;
        const r: any = await dataAPI.getRecipeById(id);
        if (!alive) return;

        if (r) {
          setModel({
            id: r.id,
            title: r.title,
            image: r.image_url ?? r.image ?? '',
            creator: r.creator,
            knives: r.knives ?? 0,
            createdAt: new Date(r.createdAt ?? r.created_at).getTime(),
          });

          // NEW: capture privacy/import flags
          setIsPrivate(!!r.is_private);
          setSourceUrl(r.source_url ?? r.sourceUrl ?? null);

          if (Array.isArray(r.steps)) setSteps(r.steps);
          if (Array.isArray(r.ingredients)) setIngredients(r.ingredients);
        } else {
          const s: any = recipeStore.get(id);
          setModel(
            s
              ? {
                  id: s.id,
                  title: s.title,
                  image: (s as any).image_url ?? s.image ?? '',
                  creator: s.creator,
                  knives: s.knives ?? 0,
                  createdAt: s.createdAt,
                }
              : null
          );
          if (Array.isArray(s?.steps)) setSteps(s.steps);
          if (Array.isArray(s?.ingredients)) setIngredients(s.ingredients);
        }
      } catch {
        const s: any = id ? recipeStore.get(id) : undefined;
        if (s) {
          setModel({
            id: s.id,
            title: s.title,
            image: (s as any).image_url ?? s.image ?? '',
            creator: s.creator,
            knives: s.knives ?? 0,
            createdAt: s.createdAt,
          });
          if (Array.isArray(s?.steps)) setSteps(s.steps);
          if (Array.isArray(s?.ingredients)) setIngredients(s.ingredients);
        } else {
          setModel(null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // owner id
  useEffect(() => {
    let gone = false;
    (async () => {
      if (!id) return;
      const owner = await dataAPI.getRecipeOwnerId(id).catch(() => null);
      if (!gone) setOwnerId(owner);
    })();
    return () => { gone = true; };
  }, [id]);

  // load ingredients/steps if not present
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      try {
        const { data } = await supabase
          .from('recipe_ingredients')
          .select('*')
          .eq('recipe_id', id)
          .order('pos');
        if (!cancelled && data) {
          const lines = data.map((row: any) => row.text ?? '').filter(Boolean);
          if (lines.length) setIngredients(lines);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [id]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id || steps.length > 0) return;
      try {
        const { data } = await supabase
          .from('recipe_steps')
          .select('*')
          .eq('recipe_id', id)
          .order('pos');
        if (!cancelled && data) {
          setSteps(data.map((row: any) => ({ text: row.text ?? '', seconds: row.seconds ?? null })));
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [id, steps.length]);

  // sign image url if from storage
  const [signedImageUrl, setSignedImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function signIt(raw: string) {
      if (!raw) { setSignedImageUrl(null); return; }
      if (raw.startsWith('http')) { setSignedImageUrl(raw); return; }
      const path = raw.replace(/^\/+/, '');
      const { data } = await supabase
        .storage.from('recipe-images')
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (!cancelled) setSignedImageUrl(data?.signedUrl ?? null);
    }
    signIt(model?.image || '');
    return () => { cancelled = true; };
  }, [model?.image]);

  // counts
  const fetchEngagement = React.useCallback(async () => {
    if (!id) return;
    const { count: likeCount } = await supabase
      .from('recipe_likes')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', id);
    setLikesCount(likeCount ?? 0);

    if (userId) {
      const { data: myLike } = await supabase
        .from('recipe_likes')
        .select('id')
        .eq('recipe_id', id)
        .eq('user_id', userId)
        .maybeSingle();
      setLiked(!!myLike);
    } else {
      setLiked(false);
    }

    const { count: cookCount } = await supabase
      .from('recipe_cooks')
      .select('id', { count: 'exact', head: true })
      .eq('recipe_id', id);
    setCooksCount(cookCount ?? 0);
  }, [id, userId]);
  useEffect(() => { fetchEngagement(); }, [fetchEngagement]);

  // actions
  const shareIt = async () => { await success(); await Share.share({ message: `${model?.title} on MessHall — messhall://recipe/${id}` }); };
  const toggleSave = async () => { try { const s = await dataAPI.toggleSave(String(id)); setSaved(s); await tap(); } catch { await warn(); Alert.alert('Sign in required'); } };
  const toggleLike = async () => { 
    try { await dataAPI.toggleLike(String(id)); await tap(); await fetchEngagement(); }
    catch (e: any) { await warn(); Alert.alert('Action not allowed', 'Please sign in to like recipes.'); }
  };
  const markCooked = async () => { try { await dataAPI.markCooked(String(id)); await success(); await fetchEngagement(); }
    catch { await warn(); Alert.alert('Action not allowed', 'Please sign in to record cooks.'); } };
  const startCookMode = async () => { await success(); router.push(`/cook/${id}`); };
  const goEdit = async () => { await tap(); router.push(`/recipe/edit/${id}`); };
  const confirmDelete = async () => { await warn(); Alert.alert('Delete?', 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { try { await dataAPI.deleteRecipe(String(id)); await success(); router.back(); } catch { await warn(); Alert.alert('Delete failed'); } } }
  ]); };

  if (loading) return <View style={{ flex:1,backgroundColor:COLORS.bg,alignItems:'center',justifyContent:'center'}}><Text style={{color:COLORS.text}}>Loading…</Text></View>;
  if (!model) return <View style={{ flex:1,backgroundColor:COLORS.bg,alignItems:'center',justifyContent:'center'}}><Text style={{color:COLORS.text}}>Not found</Text></View>;

  const ings = ingredients.length ? ingredients : ['2 tbsp olive oil','2 cloves garlic'];
  const stepList = steps.length ? steps : [{text:'Cook stuff',seconds:null}];

  const CreatorMedalPill = ({ value }: { value: number }) => {
    if (!value) return null;
    return (
      <View style={{
        flexDirection:'row',alignItems:'center',gap:6,
        backgroundColor:'#0b3b2e',paddingHorizontal:10,paddingVertical:4,
        borderRadius:999,borderWidth:1,borderColor:'#134e4a',marginLeft:8
      }}>
        <MaterialCommunityIcons name="medal" size={14} color="#E5E7EB" />
        <Text style={{color:COLORS.text,fontWeight:'800',fontSize:12}}>
          {compactNumber(value)}
        </Text>
      </View>
    );
  };

  // NEW: Status pills
  const StatusPills = ({ isPrivate, sourceUrl }: { isPrivate: boolean; sourceUrl: string | null }) => {
    if (!isPrivate && !(sourceUrl && sourceUrl.trim() !== '')) return null;
    return (
      <View style={{flexDirection:'row', gap:8, marginBottom:12}}>
        {isPrivate && (
          <Text style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, backgroundColor:'#334155', color:'#e2e8f0', fontWeight:'700' }}>
            🔒 Private
          </Text>
        )}
        {sourceUrl && sourceUrl.trim() !== '' && (
          <Text style={{ paddingHorizontal:10, paddingVertical:6, borderRadius:999, backgroundColor:'#334155', color:'#e2e8f0', fontWeight:'700' }}>
            🌐 Imported
          </Text>
        )}
      </View>
    );
  };

  return (
    <ScrollView style={{ flex:1,backgroundColor:COLORS.bg }} contentContainerStyle={{paddingBottom:32}}>
      <Image source={{uri:signedImageUrl||undefined}} style={{width:'100%',height:280,backgroundColor:'#111827'}} contentFit="cover" />

      <View style={{paddingHorizontal:SPACING.lg,paddingTop:SPACING.lg}}>
        <Text style={{color:COLORS.text,fontSize:22,fontWeight:'900',marginBottom:8}}>{model.title}</Text>

        <View style={{flexDirection:'row',alignItems:'center',marginBottom:10}}>
          <Text style={{color:COLORS.text,fontWeight:'700'}}>{model.creator}</Text>
          <CreatorMedalPill value={model.knives} />
          <View style={{flex:1}} />
          <Text style={{color:COLORS.subtext}}>{timeAgo(model.createdAt)}</Text>
        </View>

        {/* NEW: status pills */}
        <StatusPills isPrivate={isPrivate} sourceUrl={sourceUrl} />

        {isOwner && (
          <View style={{flexDirection:'row',gap:10,marginBottom:12}}>
            <HapticButton onPress={goEdit} style={{flex:1,backgroundColor:COLORS.card,paddingVertical:12,borderRadius:RADIUS.lg,alignItems:'center'}}>
              <Text style={{color:COLORS.text,fontWeight:'800'}}>Edit</Text>
            </HapticButton>
            <HapticButton onPress={confirmDelete} style={{width:120,backgroundColor:'#dc2626',paddingVertical:12,borderRadius:RADIUS.lg,alignItems:'center'}}>
              <Text style={{color:'white',fontWeight:'900'}}>Delete</Text>
            </HapticButton>
          </View>
        )}

        <View style={{flexDirection:'row',gap:10,marginBottom:16}}>
          <View style={{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:COLORS.card,paddingHorizontal:12,paddingVertical:6,borderRadius:999}}>
            <MaterialCommunityIcons name="medal" size={16} color={COLORS.accent} />
            <Text style={{color:COLORS.text,fontWeight:'700'}}>{compactNumber(cooksCount)}</Text>
          </View>
          <View style={{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:COLORS.card,paddingHorizontal:12,paddingVertical:6,borderRadius:999}}>
            <Ionicons name="heart" size={16} color="#F87171" />
            <Text style={{color:COLORS.text,fontWeight:'700'}}>{compactNumber(likesCount)}</Text>
          </View>
        </View>

        <View style={{flexDirection:'row',gap:10,marginBottom:16}}>
          <HapticButton onPress={toggleSave} style={{flex:1,backgroundColor:saved?'#14532d':COLORS.card,paddingVertical:14,borderRadius:RADIUS.lg,alignItems:'center'}}>
            <Text style={{color:saved?'#CFF8D6':COLORS.text,fontWeight:'800'}}>{saved?'Saved ✓':'Save'}</Text>
          </HapticButton>

          {!isOwner && (
            <HapticButton onPress={toggleLike} style={{flex:1,backgroundColor:liked?'#1f2937':COLORS.card,paddingVertical:14,borderRadius:RADIUS.lg,alignItems:'center'}}>
              <Text style={{color:liked?'#FFD1DC':COLORS.text,fontWeight:'800'}}>{liked?'♥ Liked':'♡ Like'}</Text>
            </HapticButton>
          )}

          <HapticButton onPress={shareIt} style={{width:80,backgroundColor:COLORS.accent,paddingVertical:14,borderRadius:RADIUS.lg,alignItems:'center'}}>
            <Text style={{color:'#001018',fontWeight:'900'}}>Share</Text>
          </HapticButton>
        </View>
      </View>

      <View style={{paddingHorizontal:SPACING.lg,marginTop:6}}>
        <Text style={{color:COLORS.text,fontSize:18,fontWeight:'900',marginBottom:8}}>Ingredients</Text>
        {ings.map((t,i)=><Text key={i} style={{color:COLORS.subtext,marginBottom:6}}>• {t}</Text>)}
      </View>

      <View style={{paddingHorizontal:SPACING.lg,marginTop:16}}>
        <Text style={{color:COLORS.text,fontSize:18,fontWeight:'900',marginBottom:8}}>Steps</Text>
        {stepList.map((s,i)=>(
          <View key={i} style={{flexDirection:'row',marginBottom:10}}>
            <Text style={{color:COLORS.accent,fontWeight:'900',width:24}}>{i+1}.</Text>
            <Text style={{color:COLORS.subtext,flex:1}}>
              {s.text}{' '}
              {typeof s.seconds==='number'&&s.seconds>0&&(
                <Text style={{color:COLORS.accent}}>
                  ({String(Math.floor(s.seconds/60)).padStart(2,'0')}:{String(s.seconds%60).padStart(2,'0')})
                </Text>
              )}
            </Text>
          </View>
        ))}
      </View>

      <View style={{paddingHorizontal:SPACING.lg,marginTop:8}}>
        {isOwner ? (
          <>
            <View style={{
              alignSelf:'flex-start',
              backgroundColor:'#0f172a',
              borderColor:'#334155',
              borderWidth:1,
              borderRadius:RADIUS.lg,
              paddingVertical:8,
              paddingHorizontal:12,
              marginBottom:12
            }}>
              <Text style={{ color: COLORS.subtext, fontWeight:'800', fontSize:12 }}>Your recipe</Text>
            </View>
            <HapticButton onPress={startCookMode} style={{backgroundColor:COLORS.accent,paddingVertical:16,borderRadius:RADIUS.xl,alignItems:'center'}}>
              <Text style={{color:'#001018',fontWeight:'900',fontSize:16}}>Start Cook Mode</Text>
            </HapticButton>
          </>
        ) : (
          <>
            <HapticButton onPress={markCooked} style={{backgroundColor:COLORS.card,paddingVertical:16,borderRadius:RADIUS.xl,alignItems:'center',marginBottom:8}}>
              <Text style={{color:COLORS.text,fontWeight:'900',fontSize:16}}>I cooked this!</Text>
            </HapticButton>
            <HapticButton onPress={startCookMode} style={{backgroundColor:COLORS.accent,paddingVertical:16,borderRadius:RADIUS.xl,alignItems:'center'}}>
              <Text style={{color:'#001018',fontWeight:'900',fontSize:16}}>Start Cook Mode</Text>
            </HapticButton>
          </>
        )}
      </View>

      <View style={{height:32}} />
    </ScrollView>
  );
}
