import { ParsedRecipe } from "./types";
import { parseRecipeText } from "../unified_parser";

const SERVING_PATTERN = /(serves?|servings?|serving size|makes|feeds|enough\s+for|yield|yields|portion|portions?)/i;
const PROMO_PATTERN = /(^|\s)([#@][\w._-]+)\b|follow\s+|recipes?\b.*(bio|below)|tag\s+us|link\s+in\s+bio|more\s+recipes|messhall\s+app/i;
const ING_HEADING_PATTERN = /^(ingredients?|ingredient list|what you need|things you need|for the (?:dough|sauce|crust|filling))/i;
const STEP_HEADING_PATTERN = /^(steps?|directions?|instructions?|method)\b/i;
const DISH_DISQUALIFIERS = /(add|mix|combine|stir|whisk|fold|pour|drizzle|cook|bake|heat|preheat|enjoy|subscribe|watch|prep|cook time|minutes|seconds|until|today|order)/i;
const UNIT_TOKEN = /(cups?|cup|tsp|teaspoon|teaspoons|tbsp|tablespoon|tablespoons|oz|ounce|ounces|lb|pound|pounds|g|gram|grams|kg|milliliter|milliliters|ml|liter|litre)/i;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const BULLET_RE = /^[\u2022*\-\s]+/;

function normalizeLine(line: string): string {
  return (line || "")
    .replace(EMOJI_RE, "")
    // remove zero-width / invisible control characters that can survive scraping
    .replace(/[\u200B-\u200F\uFEFF\u2060-\u2064\uE000-\uF8FF]/g, "")
    .replace(BULLET_RE, "")
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .trim();
}

function isServingLine(line: string): boolean {
  return SERVING_PATTERN.test(line);
}

function isDishLine(line: string): boolean {
  if (!line) return false;
  const s = line.trim();
  if (!s) return false;
  if (s.length < 3 || s.length > 80) return false;
  if (/https?:\/\//i.test(s)) return false;
  if (/#|@/i.test(s)) return false;
  if (/[0-9]/.test(s)) return false;
  if (UNIT_TOKEN.test(s)) return false;
  if (/(?:salt|pepper)/i.test(s) && /(?:and|&)/i.test(s)) return false;
  if (/\bto taste\b/i.test(s)) return false;
  if (/\b(community|video|followers?|likes?|comments?|global|watch|subscribe|follow|see more)\b/i.test(s)) return false;
  if (DISH_DISQUALIFIERS.test(s)) return false;
  return true;
}

function tidyTitle(candidate?: string | null, ...fallbacks: Array<string | null | undefined>): string | null {
  const normalize = (value?: string | null) =>
    (value || "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/['"\u00B0]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const candidates = [candidate, ...fallbacks];
  const normalized = candidates.map((value) => normalize(value));

  for (const line of normalized) {
    if (line && isDishLine(line)) {
      // If the candidate contains an obvious sentence boundary or common sentence-starter
      // tokens (e.g. "for", "to", "ingredients", "youll"), cut at that boundary so
      // we return just the dish title and not the following explanatory sentence.
      const lower = line.toLowerCase();
      const cutTokens = [' for ', ' to ', ' ingredients', " you'll", " youll", ' ingredients:', ' serves', ' servings', ' recipe', ' prep ', ' cook ', ' directions', ' instructions'];
      let cutIndex = -1;
      for (const tok of cutTokens) {
        const idx = lower.indexOf(tok);
        if (idx > 6) { // ignore tokens that appear too early (likely part of the title)
          if (cutIndex === -1 || idx < cutIndex) cutIndex = idx;
        }
      }
      // Also detect sentence-starters that may be attached without space (e.g. "sauceFor")
      const attachedMatch = line.match(/(For|To|Ingredients|You'll|Youll|Serves|Makes|Recipe)/);
      if (attachedMatch && attachedMatch.index && attachedMatch.index > 6) {
        const idx = attachedMatch.index;
        if (cutIndex === -1 || idx < cutIndex) cutIndex = idx;
      }
      let trimmed = line
        .replace(/\b\d[\d,.\s]*\s+likes?.*$/i, "")
        .replace(/\b\d[\d,.\s]*\s+comments?.*$/i, "")
        .trim();
      const colonSplit = trimmed.match(/^[^:]+:\s*(.+)$/);
      if (colonSplit && colonSplit[1]) trimmed = colonSplit[1].trim();
      if (cutIndex !== -1) {
        trimmed = trimmed.slice(0, cutIndex).trim();
      }
      // also split on punctuation (take first sentence)
      const m = trimmed.match(/^(.*?[.!?])\s+/);
      if (m && m[1]) trimmed = m[1].replace(/[.!?]$/g, "").trim();
      trimmed = trimmed.replace(/\s*(?:for|to|ingredients?|directions?|instructions?|method)\b.*$/i, "").trim();
      if (!trimmed || !isDishLine(trimmed)) continue;
      return trimmed;
    }
  }

  for (const line of normalized) {
    const fallback = (line || "").trim();
    if (fallback && isDishLine(fallback)) return fallback;
  }

  return null;
}

function cleanServings(line: string | null | undefined): string | null {
  if (!line) return null;
  return line
    .replace(/^[^:]*:\s*/, "")
    .replace(/\s+:+/g, ": ")
    .replace(/[.,!?;:]+$/g, "")
    .trim();
}

export type InstagramParseOptions = {
  fallbackTitle?: string | null;
  heroImage?: string | null;
};

function cleanPromo(line: string): string {
  let cleaned = line.replace(PROMO_PATTERN, "").trim();
  cleaned = cleaned
    .replace(/^\s*\d[\d,.\s]*\s+likes?,?\s*\d[\d,.\s]*\s+comments?\s*[-\u2013\u2014:]?\s*/i, "")
    .replace(/^\s*\d[\d,.\s]*\s+likes?.*$/gim, "")
    .replace(/^\s*\d[\d,.\s]*\s+comments?.*$/gim, "");
  if (/^[^:]+:\s*["'\u201c\u201d]/.test(cleaned)) {
    cleaned = cleaned.replace(/^[^:]+:\s*(?=["'\u201c\u201d])/, "");
  }
  return cleaned.trim();
}

export function parseSocialCaption(caption: string, options: InstagramParseOptions = {}): ParsedRecipe {
  const lines = caption
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => cleanPromo(normalizeLine(line)))
    .filter(Boolean);

  let titleCandidate: string | null = null;
  let fallbackCandidate: string | null = null;
  let servingsCandidate: string | null = null;

  let beforeIngredients = true;
  const preIngredientLines: string[] = [];

  for (const line of lines) {
    if (ING_HEADING_PATTERN.test(line)) {
      beforeIngredients = false;
    }

    if (beforeIngredients) {
      preIngredientLines.push(line);
    }

    if (!titleCandidate && beforeIngredients && isDishLine(line)) {
      titleCandidate = line;
    }

    if (!fallbackCandidate && beforeIngredients && !STEP_HEADING_PATTERN.test(line)) {
      fallbackCandidate = line;
    }

    if (!servingsCandidate && isServingLine(line)) {
      servingsCandidate = line;
    }
  }

  if (!titleCandidate) {
    const alt = preIngredientLines.find((line) => isDishLine(line));
    if (alt) titleCandidate = alt;
  }

  const title = tidyTitle(titleCandidate, fallbackCandidate, options.fallbackTitle);
  const servings = cleanServings(servingsCandidate);

  // For Instagram, prioritize explicit section extraction over unified parser
  // Instagram captions have clear "Ingredients:" and "Method:" sections
  let ingredients: string[] = [];
  let steps: string[] = [];
  
  // Find Ingredients section - look for "Ingredients:" header followed by content until "Method:" or "Directions:"
  // Use a more robust pattern that handles various formatting
  const ingPattern = /(?:^|\n)\s*ingredients?\s*:?\s*\n?\s*([\s\S]*?)(?:\n\s*\n\s*(?:directions?|steps?|method|instructions?)\s*:|\n\s*(?:directions?|steps?|method|instructions?)\s*:|$)/i;
  const ingMatch = caption.match(ingPattern);
  if (ingMatch && ingMatch[1]) {
    const ingBlock = ingMatch[1].trim();
    // Split by newlines and filter for ingredient-like lines
    const ingLines = ingBlock.split(/\n+/)
      .map(line => line.trim())
      .filter(line => {
        if (line.length < 3) return false;
        // Skip section headers, tips, and non-ingredient content
        if (/^(tips?|note|notes?|serves?|yield|#|method|directions?|instructions?|steps?|chill|for extra|to keep)/i.test(line)) return false;
        // Must have quantity indicator or be ingredient-like
        return /\d/.test(line) || 
               /\b(cup|cups|tsp|tbsp|teaspoon|teaspoons|tablespoon|tablespoons|oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|l|liter|litre|clove|cloves|head|heads|bunch|bunches|piece|pieces|can|cans|package|packages|bottle|bottles|jar|jars|box|boxes|bag|bags|container|containers|stick|sticks|slice|slices|fillet|fillets|strip|strips|stalk|stalks)\b/i.test(line) ||
               /\b(eggs?|avocado|mayonnaise|lemon|lime|garlic|onion|butter|salt|pepper|bell pepper|cheese|mustard|chives|parsley|cilantro|basil|tomato|cream|sugar|oil|vinegar|soy sauce|olive oil|parmesan|mozzarella)\b/i.test(line);
      });
    
    if (ingLines.length >= 2) {
      ingredients = ingLines;
    }
  }
  
  // Find Method/Directions section - look for "Method:" or "Directions:" header
  const stepPattern = /(?:^|\n)\s*(?:method|directions?|instructions?|steps?)\s*:?\s*\n?\s*([\s\S]*?)(?:\n\s*\n\s*(?:tips?|note|notes?|serves?|yield)\s*:|\n\s*(?:tips?|note|notes?|serves?|yield)\s*:|#|$)/i;
  const stepMatch = caption.match(stepPattern);
  if (stepMatch && stepMatch[1]) {
    const stepBlock = stepMatch[1].trim();
    // Split by numbered steps, new paragraphs, or sentence boundaries
    const stepLines = stepBlock
      .split(/(?:\n\s*\n|\d+[.)]\s+|(?<=[.!?])\s+(?=[A-Z])|(?<=\.)\s+(?=[A-Z]))/)
      .map(line => line.trim())
      .filter(line => {
        if (line.length < 10) return false;
        // Skip tips and notes
        if (/^(tips?|note|notes?|#|chill for|for extra|to keep)/i.test(line)) return false;
        // Must contain cooking verbs or instructions
        return /\b(place|add|mix|combine|stir|whisk|fold|pour|drizzle|layer|spread|cook|bake|heat|preheat|melt|fry|saute|sear|brown|season|toss|press|arrange|roll|wrap|serve|garnish|top|spoon|transfer|beat|blend|chop|mince|dice|slice|toast|grill|broil|roast|simmer|boil|knead|marinate|let|allow|rest|cover|refrigerate|chill|transfer|remove|bring|turn|increase|decrease|drain|rinse|trim|halve|cut|slice)\b/i.test(line);
      });
    
    if (stepLines.length >= 1) {
      steps = stepLines;
    }
  }
  
  // Fallback to unified parser only if explicit extraction found nothing
  if (ingredients.length < 2 || steps.length < 1) {
    const parsed = parseRecipeText(caption);
    if (ingredients.length < 2 && parsed.ingredients && parsed.ingredients.length >= 2) {
      ingredients = parsed.ingredients;
    }
    if (steps.length < 1 && parsed.steps && parsed.steps.length >= 1) {
      steps = parsed.steps;
    }
  }
  
  return {
    title,
    ingredients,
    steps,
    servings,
    heroImage: options.heroImage ?? null,
    source: "instagram",
  };
}

export const parseInstagramCaption = parseSocialCaption;

