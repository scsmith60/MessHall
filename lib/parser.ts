// PURPOSE: when user pastes a YouTube/TikTok/blog link, we try to guess fields.
// NOTE: offline stub today; later we'll fetch real metadata server-side.
export type Parsed = {
  title?: string;
  minutes?: number;
  image?: string;
};

const RE_TIME = /\b(\d+)\s*(min|mins|minutes|hr|hour|hours)\b/i;

export async function parseRecipeUrl(url: string): Promise<Parsed> {
  // super simple guessing so we can demo the flow.
  const out: Parsed = {};
  if (/youtube\.com|youtu\.be/i.test(url)) {
    out.title = 'Recipe from YouTube';
    out.image = 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'; // placeholder 😉
    out.minutes = 15;
  } else if (/tiktok\.com/i.test(url)) {
    out.title = 'Quick TikTok Recipe';
    out.minutes = 10;
    out.image = 'https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=1600&auto=format&fit=crop';
  } else {
    // try to guess minutes from text
    const m = url.match(RE_TIME);
    if (m) out.minutes = parseInt(m[1], 10);
    out.title = 'Imported Recipe';
    out.image = 'https://images.unsplash.com/photo-1550507992-eb63ffee0847?q=80&w=1600&auto=format&fit=crop';
  }
  await new Promise(r => setTimeout(r, 350)); // pretend network
  return out;
}
