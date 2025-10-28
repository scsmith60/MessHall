// lib/parsers/title_extractor.ts
//
// ≡ƒô┐ ELI5: Given Instagram/TikTok text (caption, meta, etc), extract a good recipe title.
// - Try to find actual recipe names like "Shrimp Scampi" or "Cheesy Garlic Bread"
// - Avoid junk like "Follow me for more recipes" or "Watch this TikTok video"
// - Return the best title we can find, or null if we can't find a good one

/** Symbols we recognize as recipe indicators */
const RECIPE_EMOJIS = /[🍕🍔🍞🥖🥨🥯🥪🥙🌮🌯🥗🥘🍝🥫🍜🍲🍛🍣🍱🥟🍤🍗🍖🧀🥚🥓🥩🥐🧂🥄🍽️⏲️]/;

/** Words that indicate we're talking about a recipe */
const RECIPE_WORDS = /\b(recipe|homemade|bake|baked|cook|cooked|dish|meal|dinner|lunch|breakfast|brunch|snack|dessert|treat|appetizer)\b/i;

/** Common measurement words that suggest this is an ingredient list */
const MEASUREMENT_WORDS = /\b(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|liter|litre|clove|cloves|egg|eggs|stick|sticks)\b/i;

/** Words that suggest this is promotional text, not a title */
const PROMO_WORDS = /\b(follow|subscribe|like|share|check out|new post|link in bio)\b/i;

/** Common social media platform names */
const PLATFORM_NAMES = /\b(tiktok|instagram|youtube|pinterest|facebook)\b/i;

/** Words that start recipe instructions */
const INSTRUCTION_WORDS = /^(step|preheat|mix|combine|add|stir|whisk|bake|boil|simmer|cook|fry|sauté|grill|roast)\b/i;

/** Score how recipe-like a piece of text is */
function scoreRecipeTitle(text: string): number {
  if (!text) return -100;
  const s = text.trim();
  
  // Quick rejections
  if (s.length < 3 || s.length > 100) return -100;
  if (INSTRUCTION_WORDS.test(s)) return -50;
  if (s.includes('http')) return -100;
  if (/@\w+/.test(s)) return -50;
  if (/#\w+/.test(s)) return -50;
  
  let score = 0;
  
  // Recipe indicators boost score
  if (RECIPE_EMOJIS.test(s)) score += 20;
  if (RECIPE_WORDS.test(s)) score += 30;
  
  // Proper formatting boosts score
  if (/^[A-Z]/.test(s)) score += 10;
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,3}$/.test(s)) score += 50; // "Shrimp Scampi"
  
  // Length sweet spot (2-6 words is ideal)
  const words = s.split(/\s+/).length;
  if (words >= 2 && words <= 6) score += 20;
  if (words === 1) score -= 20;
  if (words > 8) score -= 20;
  
  // Promotional content reduces score
  if (PROMO_WORDS.test(s)) score -= 40;
  if (PLATFORM_NAMES.test(s)) score -= 30;
  
  // Ingredients/measurements in title reduce score
  if (MEASUREMENT_WORDS.test(s)) score -= 20;
  
  return score;
}

/** Extract a quoted phrase that might be a recipe title */
function extractQuotedTitle(text: string): string | null {
  const quotes = text.match(/["'""'']([\s\S]{3,100})["'""'']/);
  if (quotes && quotes[1]) {
    const candidate = quotes[1].trim();
    // Don't accept quoted text that looks like instructions
    if (!INSTRUCTION_WORDS.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Try to extract a recipe title from a longer text */
function findTitleInText(text: string): string | null {
  if (!text) return null;
  
  // First try quoted phrases
  const quoted = extractQuotedTitle(text);
  if (quoted && scoreRecipeTitle(quoted) > 0) {
    return quoted;
  }
  
  // Split into lines and score each one
  const lines = text
    .split(/[\n\r\u2028\u2029]/)
    .map(line => line.trim())
    .filter(line => line.length >= 3 && line.length <= 100);
    
  // Score each line
  const candidates = lines
    .map(line => ({
      text: line,
      score: scoreRecipeTitle(line)
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);
  
  // Return best candidate if it's good enough
  if (candidates.length && candidates[0].score >= 20) {
    return candidates[0].text;
  }
  
  return null;
}

/** Try to find a good recipe title from a social media post */
export function extractRecipeTitle(input: { 
  caption?: string | null;
  description?: string | null;
  pageTitle?: string | null;
  text?: string | null;
}): string | null {
  const candidates: Array<{text: string; score: number; source: string}> = [];
  
  // Try caption first (most reliable)
  if (input.caption) {
    const fromCaption = findTitleInText(input.caption);
    if (fromCaption) {
      candidates.push({
        text: fromCaption,
        score: scoreRecipeTitle(fromCaption) + 20, // Bonus for caption
        source: 'caption'
      });
    }
  }
  
  // Try page title
  if (input.pageTitle) {
    // Clean up page title
    const cleaned = input.pageTitle
      .replace(/\s*[|:]\s*(TikTok|Instagram).*$/, '')
      .replace(/^.*:\s*/, '')
      .trim();
      
    if (cleaned) {
      candidates.push({
        text: cleaned,
        score: scoreRecipeTitle(cleaned),
        source: 'page-title'
      });
    }
  }
  
  // Try description and other text
  for (const field of ['description', 'text']) {
    const value = input[field as keyof typeof input];
    if (value) {
      const found = findTitleInText(value);
      if (found) {
        candidates.push({
          text: found,
          score: scoreRecipeTitle(found),
          source: field
        });
      }
    }
  }
  
  // Sort by score and return best if it's good enough
  candidates.sort((a, b) => b.score - a.score);
  
  if (candidates.length && candidates[0].score >= 20) {
    // Log for debugging
    console.log('[TITLE] Candidates:', candidates.map(c => `${c.text} (${c.score} from ${c.source})`));
    return candidates[0].text;
  }
  
  return null;
}