// lib/feed.ts
// 🧸 LIKE I'M 5: This file builds your Home Feed list.
// What it does:
// 1) Figures out who "I" am (the logged-in user).
// 2) Finds all the people I follow.
// 3) Gets their newest recipes from the database (newest first).
// 4) If I follow nobody (or they have no recipes), it shows global/trending recipes.
// 5) It mixes in sponsored cards after every N recipes.
// 6) It returns items in the shape your Home screen expects.
//
// You do NOT need a separate "mocks" file. If you still want temporary fake
// recipes for testing, you can keep the tiny helper at the bottom and toggle it on/off.

import { supabase } from './supabase';
import { listFollowing } from './data'; // we use your existing helper to get who I follow

// ───────────────────────────────────────────────────────────────────────────────
// TYPES that match what app/(tabs)/index.tsx expects
// ───────────────────────────────────────────────────────────────────────────────

type RecipeFeedItemForHome = {
  type: 'recipe';
  id: string;
  title: string;
  image: string;
  creator: string;                 // callsign / username like "@chefjules"
  creatorAvatar?: string | null;   // face picture URL
  knives: number;
  cooks: number;
  likes: number;
  createdAt: string;               // ISO string (index.tsx turns it into a Date)
  ownerId: string;                 // who posted it
};

type SponsoredSlot = {
  id: string;
  brand?: string;
  title?: string;
  image?: string;
  cta?: string;
};

type SponsoredFeedItemForHome = {
  type: 'sponsored';
  id: string;          // we’ll use the creativeId here so impressions are unique
  brand: string;
  title: string;
  image: string;
  cta?: string;
  slot?: SponsoredSlot; // index.tsx can use this too
};

export type FeedItemForHome = RecipeFeedItemForHome | SponsoredFeedItemForHome;

// ───────────────────────────────────────────────────────────────────────────────
// CONFIG
// ───────────────────────────────────────────────────────────────────────────────

// After how many recipe cards should we show an ad card?
const AD_FREQUENCY = 5;

// Safety caps so we never fetch huge payloads by accident
const MAX_SLOTS = 100;
const MAX_CREATIVES = 1000;

// ───────────────────────────────────────────────────────────────────────────────
// TINY HELPERS (like little lego blocks)
// ───────────────────────────────────────────────────────────────────────────────

// pick one thing from an array (for weighted picks we have a real helper below)
function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// choose ONE by weight (bigger weight = more likely)
function weightedPick<T extends { weight: number }>(items: T[]): T | null {
  if (!items?.length) return null;
  const total = items.reduce((sum, it) => sum + Math.max(0, it.weight || 0), 0);
  if (total <= 0) return items[0];
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, it.weight || 0);
    if (r <= 0) return it;
  }
  return items[items.length - 1] ?? null;
}

// Just to be neat
function nowIso() {
  return new Date().toISOString();
}

// ───────────────────────────────────────────────────────────────────────────────
// ADS (REAL) — get active slots + their creatives, pick ONE creative per slot
// and format it for the Home screen.
// ───────────────────────────────────────────────────────────────────────────────

type RawSlot = {
  id: string;
  brand: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  weight?: number; // optional slot-level weight (unused in simple picking but kept for future)
};

type RawCreative = {
  id: string;
  slot_id: string;
  title: string;
  image_url: string;
  cta: string | null;
  cta_url: string | null;
  weight: number;
  is_active: boolean;
};

async function fetchSponsoredForHome(): Promise<SponsoredFeedItemForHome[]> {
  const now = nowIso();

  // 1) Active slots where start <= now <= end and is_active = true
  const { data: slots, error: slotErr } = await supabase
    .from('sponsored_slots')
    .select('id, brand, starts_at, ends_at, is_active, weight')
    .lte('starts_at', now)
    .gte('ends_at', now)
    .order('starts_at', { ascending: false })
    .limit(MAX_SLOTS);

  if (slotErr) {
    console.log('[feed] slots error:', slotErr.message);
    return [];
  }

  const activeSlots: RawSlot[] = (slots ?? []).filter((s) => s.is_active);
  if (!activeSlots.length) return [];

  // 2) All creatives for those slots
  const slotIds = activeSlots.map((s) => s.id);
  const { data: creatives, error: crErr } = await supabase
    .from('sponsored_creatives')
    .select('id, slot_id, title, image_url, cta, cta_url, weight, is_active')
    .in('slot_id', slotIds)
    .limit(MAX_CREATIVES);

  if (crErr) {
    console.log('[feed] creatives error:', crErr.message);
    return [];
  }

  // 3) Pick exactly ONE creative per slot (by creative weight) and map to Home shape
  const out: SponsoredFeedItemForHome[] = [];
  for (const slot of activeSlots) {
    const options = (creatives ?? []).filter((c) => c.slot_id === slot.id && c.is_active);
    if (!options.length) continue;
    const pick = weightedPick(options);
    if (!pick) continue;

    out.push({
      type: 'sponsored',
      id: pick.id, // use creative id so impressions/clicks de-dup nicely
      brand: slot.brand,
      title: pick.title,
      image: pick.image_url,
      cta: pick.cta ?? 'Learn more',
      // index.tsx can also read "slot" if it wants richer info
      slot: {
        id: slot.id,
        brand: slot.brand,
        title: pick.title,
        image: pick.image_url,
        cta: pick.cta ?? undefined,
      },
    });
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// RECIPES (REAL) — two paths:
//   A) Following feed: recipes where owner_id ∈ myFollowingIds
//   B) Global/trending: recipes for everybody (fallback)
// We also separately fetch profile data to attach username + avatar.
// ───────────────────────────────────────────────────────────────────────────────

type RawRecipe = {
  id: string;
  title: string;
  image_url: string | null;
  created_at: string;
  owner_id: string;
  cooks_count?: number | null;
  knives_count?: number | null;
  likes_count?: number | null;
};

type RawProfile = {
  id: string;
  username: string | null;
  avatar_url: string | null;
};

// Get the logged-in user's id (viewer)
async function getViewerId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.log('[feed] auth getUser error:', error.message);
    return null;
  }
  return data?.user?.id ?? null;
}

// Query N recipes by owners, with pagination
async function fetchRecipesByOwners(
  ownerIds: string[],
  page: number,
  size: number
): Promise<RawRecipe[]> {
  if (!ownerIds.length) return [];
  const from = page * size;
  const to = from + size - 1;

  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, image_url, created_at, owner_id, cooks_count, knives_count, likes_count')
    .in('owner_id', ownerIds)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.log('[feed] recipes (following) error:', error.message);
    return [];
  }
  return (data ?? []) as RawRecipe[];
}

// Query N global recipes (fallback)
async function fetchGlobalRecipes(page: number, size: number): Promise<RawRecipe[]> {
  const from = page * size;
  const to = from + size - 1;

  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, image_url, created_at, owner_id, cooks_count, knives_count, likes_count')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    console.log('[feed] recipes (global) error:', error.message);
    return [];
  }
  return (data ?? []) as RawRecipe[];
}

// Get profiles for many owners in one go
async function fetchProfilesForOwners(ownerIds: string[]): Promise<Map<string, RawProfile>> {
  if (!ownerIds.length) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', ownerIds);

  if (error) {
    console.log('[feed] profiles error:', error.message);
    return new Map();
  }

  const map = new Map<string, RawProfile>();
  for (const p of data as RawProfile[]) map.set(p.id, p);
  return map;
}

// Map raw DB recipe rows + profiles into Home Feed recipe items
function mapRecipesToHome(
  rows: RawRecipe[],
  profileMap: Map<string, RawProfile>
): RecipeFeedItemForHome[] {
  return rows.map((r) => {
    const prof = profileMap.get(r.owner_id);
    const username = prof?.username || 'anonymous';
    // Ensure it starts with @ if your app style prefers that:
    const creatorHandle = username.startsWith('@') ? username : `@${username}`;

    return {
      type: 'recipe',
      id: r.id,
      title: r.title,
      image: r.image_url || '', // fallback to empty if missing
      creator: creatorHandle,
      creatorAvatar: prof?.avatar_url ?? null,
      knives: (r.knives_count ?? 0) | 0,
      cooks: (r.cooks_count ?? 0) | 0,
      likes: (r.likes_count ?? 0) | 0,
      createdAt: r.created_at,   // keep as ISO string for index.tsx
      ownerId: r.owner_id,
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// PUBLIC: fetchFeedPage(page, size)
// This is what your Home screen calls (via dataAPI.getFeedPage).
// It returns a list of mixed items: recipe cards + sponsored cards sprinkled in.
// ───────────────────────────────────────────────────────────────────────────────

export async function fetchFeedPage(page: number, size = 12): Promise<FeedItemForHome[]> {
  // 0) figure out who I am
  const me = await getViewerId();

  // 1) find who I follow (use your existing helper)
  let followingIds: string[] = [];
  if (me) {
    try {
      // listFollowing returns [{ id, username, avatar_url, ... }] for people I follow
      const people = await listFollowing(me);
      followingIds = (people as any[]).map((p) => p.id).filter(Boolean);
    } catch (e: any) {
      console.log('[feed] listFollowing error:', e?.message);
    }
  }

  // 2) fetch recipes for following; if empty, fallback to global
  let rawRecipes: RawRecipe[] = [];
  if (followingIds.length > 0) {
    rawRecipes = await fetchRecipesByOwners(followingIds, page, size);
  }
  if (rawRecipes.length === 0) {
    rawRecipes = await fetchGlobalRecipes(page, size);
  }

  // 3) attach profile info (username + avatar)
  const ownerIds = Array.from(new Set(rawRecipes.map((r) => r.owner_id)));
  const profileMap = await fetchProfilesForOwners(ownerIds);
  const recipes: RecipeFeedItemForHome[] = mapRecipesToHome(rawRecipes, profileMap);

  // 4) get sponsored items (one creative per active slot)
  const ads: SponsoredFeedItemForHome[] = await fetchSponsoredForHome();

  // 5) sprinkle in ads after every N recipes
  const mixed: FeedItemForHome[] = [];
  let adIndex = 0;
  for (let i = 0; i < recipes.length; i++) {
    mixed.push(recipes[i]);

    const hitBoundary = (i + 1) % AD_FREQUENCY === 0;
    const haveAd = adIndex < ads.length;
    if (hitBoundary && haveAd) {
      mixed.push(ads[adIndex]);
      adIndex++;
    }
  }

  // If there were fewer recipes than a full page AND we still have ads left,
  // you can optionally drop one more ad at the end (totally optional).
  // if (recipes.length < size && adIndex < ads.length) {
  //   mixed.push(ads[adIndex]);
  // }

  return mixed;
}

// ───────────────────────────────────────────────────────────────────────────────
// OPTIONAL: tiny mock helper if you ever want to test w/o DB.
// To use: swap calls in fetchFeedPage to `fetchRecipeMocks(size)`.
// Keep this here during development; remove later if you want.
// ───────────────────────────────────────────────────────────────────────────────

const sampleImages = [
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=1200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1495195134817-aeb325a55b65?q=80&w=1200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1551183053-bf91a1d81141?q=80&w=1200&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1200&auto=format&fit=crop',
];
const sampleTitles = [
  'Grilled Chicken Tacos',
  '5-Minute Avocado Toast',
  'One-Pot Creamy Pasta',
  'Smoky Sheet-Pan Salmon',
  'Weeknight Stir-Fry',
  'Crispy Garlic Potatoes',
];
const sampleCreators = ['@chefjules', '@spicepilot', '@noodle_mom', '@grilldad'];

// ⚠️ DEV-ONLY: fake recipes
async function fetchRecipeMocks(count: number): Promise<RecipeFeedItemForHome[]> {
  const items: RecipeFeedItemForHome[] = [];
  for (let i = 0; i < count; i++) {
    const created = new Date(Date.now() - Math.floor(Math.random() * 86_400_000 * 7)).toISOString();
    items.push({
      type: 'recipe',
      id: Math.random().toString(36).slice(2),
      title: pickOne(sampleTitles),
      image: pickOne(sampleImages),
      creator: pickOne(sampleCreators),
      creatorAvatar: null,
      knives: Math.floor(Math.random() * 25),
      cooks: Math.floor(Math.random() * 20_000) + 20,
      likes: Math.floor(Math.random() * 500),
      createdAt: created,
      ownerId: 'dev_owner',
    });
  }
  return items;
}
