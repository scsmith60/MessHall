// PURPOSE: pretend server. later we point this to Supabase.
// NOTE: images are stock placeholders; you can replace with real URLs anytime.

export type FeedItem =
  | { type: 'recipe'; id: string; title: string; image: string; creator: string; creatorAvatar?: string; knives: number; cooks: number; createdAt: number }
  | { type: 'sponsored'; id: string; brand: string; title: string; image: string; cta: string };

const sampleImages = [
  'https://images.unsplash.com/photo-1550507992-eb63ffee0847?q=80&w=1600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=1600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1543352634-8730eafecb75?q=80&w=1600&auto=format&fit=crop'
];

function rand<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)]; }
function id() { return Math.random().toString(36).slice(2); }

export async function fetchFeedPage(page: number, size = 10): Promise<FeedItem[]> {
  // pretend latency (feels real)
  await new Promise(r => setTimeout(r, 300));
  const items: FeedItem[] = [];
  for (let i = 0; i < size; i++) {
    // insert a sponsored card every 6 items
    const insertAd = (i + page * size) % 6 === 4;
    if (insertAd) {
      items.push({
        type: 'sponsored',
        id: 'ad_' + id(),
        brand: 'ProWare',
        title: 'Non-stick Pan that Never Quits',
        image: rand(sampleImages),
        cta: 'Shop Deal'
      });
    }
    items.push({
      type: 'recipe',
      id: 'r_' + id(),
      title: rand([
        'Grilled Chicken Tacos',
        '5-Minute Avocado Toast',
        'One-Pot Creamy Pasta',
        'Smoky Sheet-Pan Salmon'
      ]),
      image: rand(sampleImages),
      creator: rand(['@chefjules', '@spicepilot', '@noodle_mom', '@grilldad']),
      knives: Math.floor(Math.random() * 25),        // badge level
      cooks: Math.floor(Math.random() * 20000) + 20, // cook count
      createdAt: Date.now() - Math.floor(Math.random() * 86_400_000 * 7) // last 7 days
    });
  }
  return items;
}
