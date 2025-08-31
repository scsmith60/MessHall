// lib/caption_to_ingredients.ts
// LIKE I'M 5: we take a long caption and pull out the “Ingredients:” part,
// or any bullet/emoji list that smells like ingredients. Then we clean each line.

import { normalizeIngredientLines } from './ingredients'; // your canonical normalizer (units, fractions, dedupe)

/** quick checks for unit/amount words to guess “ingredienty” lines */
const UNIT_WORDS = /(?:tsp|teaspoon|tbsp|tablespoon|cup|cups|oz|ounce|ounces|lb|pound|g|gram|grams|kg|ml|l|lit(er|re)s?|pinch|clove|cloves|slice|slices|can|cans|packet|packets|stick|sticks)\b/i;
const AMOUNT = /(^|\s)(\d+([\/.\u00BC-\u00BE\u2150-\u215E])?|\d+\s+\d+\/\d+)\b/; // 1, 1/2, 1 1/2, unicode ½ etc
const COMMON_FOODS = /\b(salt|pepper|oil|butter|flour|sugar|garlic|onion|egg|milk|cream|cheese|tomato|soy|vinegar|chicken|beef|pork|shrimp|rice|pasta|bread|yeast|baking|vanilla|cocoa|chili|cilantro|parsley|basil|lemon|lime)\b/i;

function looksIngredienty(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  // obvious step keywords → not ingredient
  if (/\b(mix|stir|bake|cook|air[- ]?fry|preheat|add|whisk|saute|sauté|boil|simmer|serve|top|drain)\b/i.test(s)) return false;
  // any of these makes it ingredient-like
  return AMOUNT.test(s) || UNIT_WORDS.test(s) || COMMON_FOODS.test(s);
}

/** split by lines/bullets/emojis/commas (but keep reasonable chunks) */
function splitCaption(raw: string): string[] {
  // normalize separators
  let s = raw.replace(/\r/g,'').replace(/\u00A0/g,' ');
  // enforce line breaks around obvious headings
  s = s.replace(/ingredients?:/ig, '\nIngredients:\n').replace(/instructions?:|steps?:/ig, '\nSteps:\n');

  // split hard on newlines and bullets
  const primary = s.split(/\n|[\u2022•·▪▫►▶]/g).map(v => v.trim()).filter(Boolean);

  // further split any comma lists that look like “x, y, z”
  const out: string[] = [];
  for (const p of primary) {
    if (/,/.test(p) && p.length > 40) {
      out.push(...p.split(/\s*,\s*/g));
    } else {
      out.push(p);
    }
  }
  return out.map(v => v.replace(/^\-+\s*/,'').trim()).filter(Boolean);
}

/**
 * Extract probable ingredient lines from a social caption/description.
 * If there is a clear “Ingredients:” block, we take lines after it until “Steps:”.
 * Otherwise, we score each split line with looksIngredienty().
 */
export function captionToIngredientLines(caption: string): string[] {
  const lines = splitCaption(caption);

  // 1) look for an explicit Ingredients: block
  const lower = lines.map(l => l.toLowerCase());
  const start = lower.findIndex(l => l.startsWith('ingredients'));
  if (start !== -1) {
    const acc: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      const L = lower[i];
      if (L.startsWith('steps') || L.startsWith('instructions') || L.startsWith('method')) break;
      if (looksIngredienty(lines[i])) acc.push(lines[i]);
    }
    return normalizeIngredientLines(acc).map(p => p.canonical);
  }

  // 2) otherwise, pick all lines that look “ingredienty”
  const picks = lines.filter(looksIngredienty);

  // clear obvious junk (social CTAs, music, etc.)
  const cleaned = picks.filter(l => !/\b(follow|subscribe|music|soundtrack|credits|link in bio|shop|use code)\b/i.test(l));

  return normalizeIngredientLines(cleaned).map(p => p.canonical);
}
