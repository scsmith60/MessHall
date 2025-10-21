// lib/parser.ts
// Minimal URL parser shim used by ImportBar.
// Tries OG scrape for title and image; leaves minutes undefined.

import { fetchOgForUrl } from '@/lib/og';

export async function parseRecipeUrl(url: string): Promise<{ title?: string; minutes?: number; image?: string }>
{
  try {
    const og = await fetchOgForUrl(url);
    const title = (og?.title || undefined) as string | undefined;
    const image = (og?.image || undefined) as string | undefined;
    return { title, image };
  } catch {
    return {};
  }
}

