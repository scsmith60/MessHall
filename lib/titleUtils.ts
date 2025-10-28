// titleUtils.ts - Enhanced title extraction logic for Instagram and TikTok imports
/**
 * Advanced recipe title extraction with multi-strategy approach.
 * Handles Instagram and TikTok style content with various patterns.
 */

const INTRO_VERBS = /^(?:made|making|try|trying|cook|cooking|baking|how\s+to\s+make)\s+/i;
const HANDLES_HASHTAGS = /^(?:[#@][\w._-]+\b[\s,:-]*){1,4}/;
const RECIPE_WORDS = /\b(?:recipe|pasta|bread|sauce|chicken|beef|pork|fish|soup|salad|sandwich|cake|cookies)\b/i;
const WEAK_TITLES = /^(?:recipe|food|yummy|delicious|tasty|homemade|amazing|good|tiktok|instagram|youtube|facebook|pinterest|food\s*network|allrecipes)$/i;

interface TitleMatch {
  title: string;
  confidence: number;
}

/** Clean up common social media boilerplate from text */
function stripBoilerplate(text: string): string {
  if (!text) return "";
  let s = text
    // TikTok patterns
    .replace(/\s*\|\s*TikTok\s*$/i, "")
    .replace(/\s*\|\s*Create(?:\s+Upload)?\s*(?:your own videos )?with our free\s+creator tools\s*$/i, "")
    .replace(/\s*\|\s*Watch more videos\s*$/i, "")
    .replace(/\s*\|\s*Discover\s*$/i, "")
    // Instagram patterns
    .replace(/^\s*\d[\d,.\s]*\s+likes?,?\s*\d[\d,.\s]*\s+comments?\s*-\s*[^:]+:\s*/i, "")
    .replace(/^\s*\d[\d,.\s]*\s+likes?\s*$/gim, "")
    .replace(/^\s*\d[\d,.\s]*\s+comments?\s*$/gim, "")
    // General patterns
    .replace(/^\s*@[\w._-]+\s*[|:.-]\s*/i, "")  // Remove leading handles
    .replace(/\s*#(?:[\w-]+)\s*$/i, "");  // Remove trailing hashtags
    
  return s.trim();
}

/** Clean up a potential title candidate */
function cleanTitle(text: string): string {
  return text
    .replace(HANDLES_HASHTAGS, "")  // Remove leading hashtags/handles
    .replace(INTRO_VERBS, "")  // Remove intro verbs
    .replace(/\s*[.,!?]\s*$/, "")  // Remove trailing punctuation
    .replace(/[""''"<>]/g, "")  // Remove quotes and brackets
    .trim();
}

/** Check if a title meets our quality criteria */
function isValidTitle(text: string): boolean {
  const clean = text.trim();
  if (!clean || clean.length < 3 || clean.length > 72) return false;
  if (WEAK_TITLES.test(clean)) return false;
  if (/^[@#][\w._-]+$/.test(clean)) return false;  // Just a handle
  if (/^\d{6,}$/.test(clean)) return false;  // Just numbers
  if (/^\s*ingredients?:/i.test(clean)) return false;  // Ingredients list
  return true;
}

/** Extract title matches with confidence scores */
function findTitleMatches(text: string): TitleMatch[] {
  const matches: TitleMatch[] = [];
  const cleanText = stripBoilerplate(text);

  // Strategy 1: Recipe-specific patterns
  const recipePatterns = [
    // "Recipe for [dish]" or "[dish] recipe"
    /(?:recipe(?:\s+for)?[\s:-]+)?([^.,!?\n@#]{5,60}?)(?:\s+recipe\b)/i,
    // Dish name followed by recipe keyword
    /([^.,!?\n@#]{5,60})\s+(?:recipe|pasta|bread|sauce)\b/i,
    // "How to make [dish]"
    /how\s+to\s+make\s+([^.,!?\n@#]{5,60})/i,
    // Title near ingredients list
    /^([^.,!?\n@#]{5,60}?)(?=\s*\n.*?\bingredients\b)/is,
    // Title before steps
    /^([^.,!?\n@#]{5,60}?)(?=\s*\n.*?\b(?:steps?|directions?|method|instructions?)\b)/is,
    // Recipe-like phrases with food words
    /\b(?:this|delicious|homemade|easy)\s+([^.,!?\n@#]{5,50}(?:\b(?:recipe|pasta|bread|sauce|chicken|beef|pork|fish|soup|salad|sandwich|cake|cookies)\b))/i
  ];

  for (const pattern of recipePatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      const title = cleanTitle(match[1]);
      if (isValidTitle(title)) {
        matches.push({ 
          title, 
          confidence: 0.8 + (RECIPE_WORDS.test(title) ? 0.1 : 0)
        });
      }
    }
  }

  // Strategy 2: Quoted text
  const quotedMatch = cleanText.match(/[""']([^""']{3,80})[""']/);
  if (quotedMatch && quotedMatch[1]) {
    const title = cleanTitle(quotedMatch[1]);
    if (isValidTitle(title)) {
      matches.push({ 
        title, 
        confidence: 0.7 + (RECIPE_WORDS.test(title) ? 0.1 : 0)
      });
    }
  }

  // Strategy 3: Lines that look recipe-like
  const lines = cleanText.split(/\s*[~|\n\u2022]\s*/);
  for (const line of lines) {
    const title = cleanTitle(line);
    if (isValidTitle(title) && RECIPE_WORDS.test(title)) {
      matches.push({ title, confidence: 0.6 });
    }
  }

  // Strategy 4: Capitalized sequences
  const capitalMatch = cleanText.match(/\b([A-Z][a-z]+(?:\s+[A-Za-z][a-z]+){1,4})\b(?=\s|$)/);
  if (capitalMatch && capitalMatch[1]) {
    const title = cleanTitle(capitalMatch[1]);
    if (isValidTitle(title)) {
      matches.push({ 
        title,
        confidence: 0.5 + (RECIPE_WORDS.test(title) ? 0.1 : 0)
      });
    }
  }

  // Strategy 5: First decent line as fallback
  if (matches.length === 0) {
    for (const line of lines) {
      const title = cleanTitle(line);
      if (isValidTitle(title)) {
        matches.push({ title, confidence: 0.3 });
        break;
      }
    }
  }

  return matches;
}

/**
 * Extract the best recipe title from text content.
 * Uses multiple strategies and returns the highest confidence match.
 */
export function extractRecipeTitle(text: string): string {
  if (!text) return "Recipe";
  
  const matches = findTitleMatches(text);
  if (matches.length === 0) return "Recipe";
  
  // Sort by confidence and prefer longer titles when confidence is close
  matches.sort((a, b) => {
    const confDiff = b.confidence - a.confidence;
    return Math.abs(confDiff) > 0.1 ? confDiff : b.title.length - a.title.length;
  });

  return matches[0].title;
}

/**
 * Check if text content contains recipe-related content.
 * Used for filtering comments and rating potential recipe text.
 */
export function scoreRecipeContent(text: string): number {
  if (!text) return 0;
  const low = text.toLowerCase();
  let score = 0;

  // Core recipe indicators
  if (/\bingredients?\b/.test(low)) score += 500;
  if (/\b(?:steps?|directions?|method|instructions?)\b/.test(low)) score += 360;
  
  // Measurement units
  const unitHits = (low.match(/\b(?:cups?|cup|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|lit(?:er|re)|clove|cloves|egg|eggs|stick|sticks)\b/g) || []).length;
  score += unitHits * 70;
  
  // Other recipe indicators
  if (/[0-9¼½¾⅓⅔⅛⅜⅝⅞]/.test(text)) score += 80;
  if (/^[\s]*[-*•]/m.test(text)) score += 80;
  if (/^[\s]*\d+[.)]/m.test(text)) score += 90;
  
  // Recipe emojis/formatting
  if (/🛒|📝|🍽️|⏰|➡️|—|–|⸻/.test(text)) score += 40;
  
  // Negatives
  const hashDensity = (text.match(/#/g) || []).length / Math.max(1, text.length);
  if (hashDensity > 0.02) score -= 60;
  if (/tour|tickets|anniversary|merch|follow|subscribe|link in bio/i.test(text)) score -= 120;
  
  // Length bonus (capped)
  score += Math.min(text.length, 1600) / 8;
  
  return score;
}