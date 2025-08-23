// lib/fetch_meta.ts
// Fetches recipe metadata from a URL (title, image, ingredients, steps…)
// Now delegates ingredient cleanup to lib/ingredientExtract to keep this file slim.

import { normalizeIngredientLines, normalizeIngredientBlock } from './ingredientExtract';

type RecipeMeta = {
  title?: string;
  image?: string;
  ingredients?: string[];
  steps?: string[];
  url: string;
  // …anything else you already return
};

export async function fetchMeta(url: string): Promise<RecipeMeta> {
  // 1) Fetch HTML / JSON-LD / OG tags (your existing logic)
  const html = await fetchAsText(url); // <- keep your current network/util fn
  // const doc = parseHTML(html);       // <- your DOM parser (cheerio, etc.)

  // 2) Extract candidate fields using your existing strategies:
  //    - JSON-LD: recipeIngredient / recipeInstructions
  //    - Microdata
  //    - Open Graph fallbacks
  //    - TikTok / YouTube descriptions
  // (Below is just schematic — wire into what you have.)
  const candidates = extractFromAllSources(html);

  // 3) Normalize ingredients
  // If you already produce an array of lines:
  let normalizedIngredients: string[] = [];
  if (Array.isArray(candidates.ingredientLines) && candidates.ingredientLines.length) {
    normalizedIngredients = normalizeIngredientLines(candidates.ingredientLines);
  } else if (typeof candidates.ingredientBlock === 'string') {
    // Some sources give one big blob
    normalizedIngredients = normalizeIngredientBlock(candidates.ingredientBlock);
  } else {
    normalizedIngredients = [];
  }

  // 4) Normalize steps (you can keep your existing step normalizer; shown briefly here)
  const steps = normalizeSteps(candidates.stepLines || candidates.stepBlock);

  // 5) Compose result
  return {
    url,
    title: candidates.title || guessTitle(html),
    image: candidates.image || undefined,
    ingredients: normalizedIngredients,
    steps,
  };
}

/* -------------------- helpers (keep your versions if you already have them) -------------------- */

async function fetchAsText(url: string): Promise<string> {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return await res.text();
}

function extractFromAllSources(html: string): {
  title?: string;
  image?: string;
  ingredientLines?: string[];
  ingredientBlock?: string;
  stepLines?: string[];
  stepBlock?: string;
} {
  // This is where your existing JSON-LD / schema / OG / TikTok parsing lives.
  // Return a shape with either ingredientLines[] or ingredientBlock (string).
  // Do the same for steps: stepLines[] or stepBlock.
  // Keep the rest of your implementation; this is just the interface boundary.
  return {
    // title, image, ingredientLines or ingredientBlock, stepLines or stepBlock
  };
}

function normalizeSteps(input?: string[] | string): string[] {
  if (!input) return [];
  const lines = Array.isArray(input) ? input : String(input).split(/\n|\r|·|•|\u2022/g);
  const cleaned = lines
    .map((s) => s.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  // Optional: dedupe steps if needed
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of cleaned) {
    const k = s.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

function guessTitle(html: string): string | undefined {
  const m = html.match(/<title>(.*?)<\/title>/i);
  return m?.[1]?.replace(/\s+/g, ' ').trim();
}
