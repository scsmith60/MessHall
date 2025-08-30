// lib/feed.ts
// 🧸 ELI5: This makes the Home feed list.
// - It builds a mix of recipe cards + sponsored cards.
// - Recipes are MOCKED for now (so you can see it working).
// - Sponsored cards are REAL from Supabase, with A/B/C creatives picked by WEIGHT.
// - Each sponsored item carries slotId + creativeId so tracking works.
//
// What you get:
//   fetchFeedPage(page, size) → FeedItem[]
//     - returns ~`size` recipes, with an ad after every N recipes
//     - ads come from active slots, each slot picks ONE creative by weight

import { supabase } from './supabase';     // your already-configured Supabase client
// (Optional) you can import logAdEvent here if you want to test-log impressions on fetch.
// import { logAdEvent } from './ads';

// ───────────────────────────────────────────────────────────────────────────────
// TYPES
// ───────────────────────────────────────────────────────────────────────────────

export type RecipeFeedItem = {
  type: 'recipe';
  id: string;
  title: string;
  image: string;
  creator: string;
  creatorAvatar?: string;
  knives: number;
  cooks: number;
  createdAt: number;
};

export type SponsoredFeedItem = {
  type: 'sponsored';
  // 👇 important for tracking A/B: we include BOTH slot + creative ids
  slotId: string;
  creativeId: string;
  brand: string;
  title: string;
  image: string;     // image_url
  cta: string;       // CTA text (e.g., "Learn more")
  ctaUrl: string;    // CTA link
  // (optional) you can keep debug fields here if you want:
  _slotWeight?: number;
  _creativeWeight?: number;
};

export type FeedItem = RecipeFeedItem | SponsoredFeedItem;

// ───────────────────────────────────────────────────────────────────────────────
// CONFIG (tweak as you like)
// ───────────────────────────────────────────────────────────────────────────────

// Show 1 sponsored card after this many recipe cards:
const AD_FREQUENCY = 5;

// Max slots & creatives per page fetch (avoid giant payloads)
const MAX_SLOTS = 100;
const MAX_CREATIVES = 1000;

// ───────────────────────────────────────────────────────────────────────────────
// SMALL HELPERS (kid simple)
// ───────────────────────────────────────────────────────────────────────────────

// 👶 make a tiny random id (no external libs)
function id(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// 👉 pick one thing from an array
function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 👉 choose by weight (bigger weight = more likely); returns one item
function weightedPick<T extends { weight: number }>(items: T[]): T | null {
  if (!items?.length) return null;
  const total = items.reduce((sum, it) => sum + Math.max(0, it.weight || 0), 0);
  if (total <= 0) return items[0];
  let r = Math.random() * total;
  for (const it of items) {
    r -= Math.max(0, it.weight || 0);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// just for the mock recipes:
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

// ───────────────────────────────────────────────────────────────────────────────
// ADS (REAL) — fetch active slots + creatives, pick one creative per slot by weight
// ───────────────────────────────────────────────────────────────────────────────

type RawSlot = {
  id: string;
  brand: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  weight?: number; // optional; used if you later want to weight BETWEEN slots too
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

// get ISO now
function nowIso() {
  return new Date().toISOString();
}

/**
 * fetchSponsorItems
 * 🧸 ELI5: get ads from DB and pick ONE creative for each active slot (by creative weight)
 * Returns: an array of SponsoredFeedItem (ready to render)
 */
async function fetchSponsorItems(): Promise<SponsoredFeedItem[]> {
  const now = nowIso();

  // 1) get slots that are active *right now* (start <= now <= end)
  // Some clients don’t allow combining filters in one call; we do two filters:
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

  const activeSlots: RawSlot[] = (slots ?? []).filter(s => s.is_active);
  if (!activeSlots.length) return [];

  // 2) get creatives for those slots
  const slotIds = activeSlots.map(s => s.id);
  const { data: creatives, error: crErr } = await supabase
    .from('sponsored_creatives')
    .select('id, slot_id, title, image_url, cta, cta_url, weight, is_active')
    .in('slot_id', slotIds)
    .limit(MAX_CREATIVES);

  if (crErr) {
    console.log('[feed] creatives error:', crErr.message);
    return [];
  }

  // 3) pick exactly ONE creative per slot (by creative weight)
  const out: SponsoredFeedItem[] = [];
  for (const slot of activeSlots) {
    const options = (creatives ?? []).filter(c => c.slot_id === slot.id && c.is_active);
    if (!options.length) continue;
    const pick = weightedPick(options);
    if (!pick) continue;

    out.push({
      type: 'sponsored',
      slotId: slot.id,
      creativeId: pick.id,
      brand: slot.brand,
      title: pick.title,
      image: pick.image_url,
      cta: pick.cta ?? 'Learn more',
      ctaUrl: pick.cta_url ?? '',
      _slotWeight: slot.weight ?? 1,
      _creativeWeight: pick.weight ?? 1,
    });
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// RECIPES (MOCK) — keep your app moving while we finish the DB wiring
// ───────────────────────────────────────────────────────────────────────────────

async function fetchRecipeMocks(count: number): Promise<RecipeFeedItem[]> {
  // 🎭 this is just pretend data so screens render; swap with real DB when ready
  const items: RecipeFeedItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      type: 'recipe',
      id: id('r'),
      title: rand(sampleTitles),
      image: rand(sampleImages),
      creator: rand(sampleCreators),
      knives: Math.floor(Math.random() * 25),
      cooks: Math.floor(Math.random() * 20_000) + 20,
      createdAt: Date.now() - Math.floor(Math.random() * 86_400_000 * 7), // up to a week ago
    });
  }
  return items;
}

// ───────────────────────────────────────────────────────────────────────────────
/**
 * fetchFeedPage(page, size)
 * 🧸 ELI5: build one page of the feed:
 *   1) get `size` recipes (mocked here)
 *   2) get sponsored items (real, one creative per active slot)
 *   3) after every AD_FREQUENCY recipes, insert one sponsored card
 */
export async function fetchFeedPage(page: number, size = 10): Promise<FeedItem[]> {
  // 1) recipes (mock)
  const recipes = await fetchRecipeMocks(size);

  // 2) sponsored (real)
  const ads = await fetchSponsorItems();

  // 3) interleave: after every N recipes, sprinkle in one ad
  const out: FeedItem[] = [];
  let adIndex = 0;

  for (let i = 0; i < recipes.length; i++) {
    out.push(recipes[i]);

    const isBoundary = (i + 1) % AD_FREQUENCY === 0;
    const haveAd = adIndex < ads.length;
    if (isBoundary && haveAd) {
      out.push(ads[adIndex]);
      adIndex++;
    }
  }

  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// OPTIONAL: if you want to fetch multiple pages and keep sprinkling ads,
// call fetchFeedPage(page) per page and concatenate.
//
// IMPORTANT: Impressions/clicks are logged in the UI layer:
// - Your FlatList onViewableItemsChanged → logAdEvent(slotId, 'impression', ..., creativeId)
// - Your SponsoredCard onPress → logAdEvent(slotId, 'click', ..., creativeId) then open URL
// ───────────────────────────────────────────────────────────────────────────────
