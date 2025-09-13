// lib/caption_to_ingredients.ts
// LIKE I'M 5: We take the caption text, find ingredient lines,
// and every time we see a new NUMBER or FRACTION, we start a NEW ingredient.

// 1) We use the normalizer from ingredients.ts to tidy each line.
import { normalizeIngredientLines } from './ingredients';

// 2) Words we use to guess that a line smells like an ingredient.
const UNIT_WORDS = /(?:tsp|teaspoon|tbsp|tablespoon|cup|cups|oz|ounce|ounces|lb|pound|g|gram|grams|kg|ml|l|liter|litre|pinch|dash|clove|cloves|slice|slices|can|cans|packet|packets|stick|sticks)\b/i;
const COMMON_FOODS = /\b(salt|pepper|oil|butter|flour|sugar|garlic|onion|egg|eggs|milk|cream|cheese|tomato|soy|vinegar|chicken|beef|pork|shrimp|rice|pasta|bread|yeast|baking|vanilla|cocoa|chili|cilantro|parsley|basil|lemon|lime)\b/i;

// 3) This pattern means “an amount” (number, 1/2, 1 1/2, unicode ½, or a range like 2–3)
//    We use this to split one long line into multiple ingredients.
const AMOUNT_CORE =
  '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[¼-¾⅐-⅞]|(?:\\d+(?:\\.\\d+)?\\s*[–—-]\\s*\\d+(?:\\.\\d+)?))';
const AMOUNT_ANY = new RegExp(`(?:^|[\\s,;()])${AMOUNT_CORE}\\b`, 'g');

// 4) Helper: “Does this look like an ingredient line?”
function looksIngredienty(line: string): boolean {
  const s = line.trim();
  if (!s) return false;

  // If it sounds like instructions, we skip it.
  if (/\b(mix|stir|bake|cook|air[- ]?fry|preheat|add|whisk|saute|sauté|boil|simmer|serve|top|drain)\b/i.test(s)) {
    return false;
  }
  // If it has an amount, or unit, or common food word → probably an ingredient.
  return AMOUNT_ANY.test(s) || UNIT_WORDS.test(s) || COMMON_FOODS.test(s);
}

// 5) First split the caption into chunks by newline/bullets/long comma lists.
function splitCaption(raw: string): string[] {
  let s = String(raw || '').replace(/\r/g, '').replace(/\u00A0/g, ' ');
  s = s.replace(/ingredients?:/ig, '\nIngredients:\n').replace(/instructions?:|steps?:/ig, '\nSteps:\n');

  const primary = s
    .split(/\n|[\u2022•·▪▫►▶]/g)  // new lines and bullet characters
    .map(v => v.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const p of primary) {
    // If a chunk is very long and has commas, split those too.
    if (/,/.test(p) && p.length > 40) out.push(...p.split(/\s*,\s*/g));
    else out.push(p);
  }
  return out.map(v => v.replace(/^\-+\s*/, '').trim()).filter(Boolean);
}

// 6) NEW: Split one chunk into many pieces whenever we see a NEW “amount”.
function explodeOnNewAmount(chunk: string): string[] {
  const text = chunk.replace(/\u00A0/g, ' ').trim();
  if (!text) return [];

  // Find the start of EVERY amount token.
  const re = new RegExp(`(^|[\\s,;()])(${AMOUNT_CORE})\\b`, 'g');
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const tokenStart = m.index + (m[1] ? m[1].length : 0); // skip the boundary character
    starts.push(tokenStart);
  }
  if (!starts.length) return [];

  // (a) If there is junk BEFORE the first amount (like "… flour 3 cups milk"),
  //     try to SAVE the last meaningful word (ex: "flour") and glue it to the first piece.
  const prefix = text.slice(0, starts[0]).trim();
  let salvage = '';
  if (prefix) {
    const words = prefix.split(/\s+/).filter(w => /^[A-Za-z][A-Za-z-]*$/.test(w));
    // take the last 1 word that looks like food-y, ignore tiny words like "a", "of", "the"
    const stop = /^(a|an|the|of|and|or)$/i;
    for (let i = words.length - 1; i >= 0; i--) {
      if (!stop.test(words[i]) && words[i].length > 2) { salvage = words[i]; break; }
    }
  }

  // (b) Build pieces that each START at an amount.
  const rawPieces: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i];
    const b = i + 1 < starts.length ? starts[i + 1] : text.length;
    rawPieces.push(text.slice(a, b).trim());
  }

  // (c) If we salvaged a word like "flour", glue it AFTER the qty/unit in the FIRST piece.
  //     This turns "… flour 3 cups milk" into "3 cups flour milk" (we’ll clean this later).
  if (salvage && rawPieces.length) {
    rawPieces[0] = rawPieces[0].replace(/^(\S+(?:\s+\S+)?)(.*)$/s, (_m, head: string, tail: string) => {
      // head ~ "3 cups"   tail ~ " milk …"
      return `${head} ${salvage}${tail}`.replace(/\s{2,}/g, ' ').trim();
    });
  }

  // (d) Split off a trailing “salt and pepper to taste” (or “salt to taste” / “pepper to taste”)
  //     so it becomes its own ingredient line.
  const pieces: string[] = [];
  for (const p of rawPieces) {
    let line = p;

    const both = /(,?\s*and\s*)?salt\s+and\s+pepper\s+to\s+taste\.?$/i;
    const justSalt = /salt\s+to\s+taste\.?$/i;
    const justPep = /pepper\s+to\s+taste\.?$/i;

    if (both.test(line)) {
      line = line.replace(both, '').trim();
      if (line) pieces.push(line);
      pieces.push('Salt and pepper to taste');
    } else if (justSalt.test(line)) {
      line = line.replace(justSalt, '').trim();
      if (line) pieces.push(line);
      pieces.push('Salt to taste');
    } else if (justPep.test(line)) {
      line = line.replace(justPep, '').trim();
      if (line) pieces.push(line);
      pieces.push('Pepper to taste');
    } else {
      pieces.push(line);
    }
  }

  return pieces.filter(Boolean);
}

// 7) MAIN: take caption → array of clean ingredient strings.
export function captionToIngredientLines(caption: string): string[] {
  const chunks = splitCaption(caption);

  // If the caption has an “Ingredients:” block, only read that area.
  const lower = chunks.map(l => l.toLowerCase());
  const start = lower.findIndex(l => l.startsWith('ingredients'));
  if (start !== -1) {
    const acc: string[] = [];
    for (let i = start + 1; i < chunks.length; i++) {
      const L = lower[i];
      if (L.startsWith('steps') || L.startsWith('instructions') || L.startsWith('method')) break;
      if (!looksIngredienty(chunks[i])) continue;
      acc.push(...explodeOnNewAmount(chunks[i]));
    }
    return normalizeIngredientLines(acc).map(p => p.canonical);
  }

  // No section header → keep all ingredienty lines, then hard-split inside them.
  const picks = chunks.filter(looksIngredienty);
  const cleaned = picks.filter(l => !/\b(follow|subscribe|music|soundtrack|credits|link in bio|shop|use code)\b/i.test(l));

  const exploded: string[] = [];
  for (const line of cleaned) exploded.push(...explodeOnNewAmount(line));

  return normalizeIngredientLines(exploded).map(p => p.canonical);
}
