// titleExtractor.ts - Shared utilities for extracting clean titles from social media posts

// Common regex patterns
const RECIPE_WORDS = /\b(?:recipe|pasta|bread|sauce|chicken|beef|pork|fish|soup|salad|sandwich|cake|cookies)\b/i;
const INTRO_VERBS = /^(?:made|making|try|trying|cook|cooking|baking|how\s+to\s+make)\s+/i;
const HANDLES_TAGS = /^(?:[#@][\w._-]+\b[\s,:-]*){1,4}/;
const WEAK_TITLES = /^(?:recipe|food|yummy|delicious|tasty|homemade|amazing|good|tiktok|instagram|youtube|facebook|pinterest|food\s*network|allrecipes)$/i;

/**
 * Cleans boilerplate text from social media posts
 */
export function cleanSocialBoilerplate(text: string): string {
  if (!text) return "";
  return text
    .replace(/^\s*\d[\d,.\s]*\s+likes?,?\s*\d[\d,.\s]*\s+comments?\s*-\s*[^:]+:\s*/i, "")
    .replace(/^\s*\d[\d,.\s]*\s+likes?\s*$/gim, "")
    .replace(/^\s*\d[\d,.\s]*\s+comments?\s*$/gim, "")
    .replace(/^\s*(?:tiktok\s*[-|]\s*)?make\s+your\s+day\s*$/gim, "")
    .trim();
}

/**
 * Attempts to extract a recipe title from text using multiple strategies
 */
export function extractRecipeTitle(text: string): string {
  const cleanText = cleanSocialBoilerplate(text);
  
  // Strategy 1: Look for recipe title in ingredients list
  const ingredientsMatch = cleanText.match(/^\s*ingredients\s*(?:[:-]\s*)?([^.,!?\n]{5,60})/im);
  if (ingredientsMatch && ingredientsMatch[1]) {
    const candidate = cleanTitle(ingredientsMatch[1]);
    if (isValidTitle(candidate)) return candidate;
  }

  // Strategy 2: Recipe-specific patterns
  const recipeMatches = [
    // Title words before recipe ingredients
    cleanText.match(/([^.,!?\n@#]{5,60}?)\s*(?:ingredients|what\s+you\s+need)\b/i),
    // "Recipe for [dish]" or "[dish] recipe"
    cleanText.match(/(?:recipe(?:\s+for)?[\s:-]+)?([^.,!?\n@#]{5,60})(?:\s+recipe\b)/i),
    // Recipe name in first part before ingredients
    cleanText.match(/^([^.,!?\n@#]{5,60}?)(?=\s*\n.*?\b(?:ingredients|what\s+you\s+need)\b)/is),
    // "How to make [dish]"
    cleanText.match(/how\s+to\s+make\s+([^.,!?\n@#]{5,60})/i),
    // Recipe-like phrases after common intros
    cleanText.match(/\b(?:this|delicious|homemade|easy)\s+([^.,!?\n@#]{5,50})(?:\s+recipe\b|\s+bread\b|\s+cake\b|\s+sauce\b)/i)
  ];
  
  for (const match of recipeMatches) {
    if (match && match[1]) {
      const candidate = cleanTitle(match[1]);
      if (isValidTitle(candidate)) return candidate;
    }
  }

  // Strategy 2: Quoted text
  const quotedMatch = cleanText.match(/[""']([^""']{3,80})[""']/);
  if (quotedMatch && quotedMatch[1]) {
    const candidate = cleanTitle(quotedMatch[1]);
    if (isValidTitle(candidate)) return candidate;
  }

  // Strategy 3: First line or sentence that looks recipe-like
  const lines = cleanText.split(/\s*[~|\n\u2022]\s*/);
  for (const line of lines) {
    const candidate = cleanTitle(line);
    if (isValidTitle(candidate) && RECIPE_WORDS.test(candidate)) {
      return candidate;
    }
  }

  // Strategy 4: Capitalized phrases
  const capitalMatch = cleanText.match(/\b([A-Z][a-z]+(?:\s+[A-Za-z][a-z]+){1,4})\b(?=\s|$)/);
  if (capitalMatch && capitalMatch[1]) {
    const candidate = cleanTitle(capitalMatch[1]);
    if (isValidTitle(candidate)) return candidate;
  }

  // Strategy 5: First non-weak line as fallback
  for (const line of lines) {
    const candidate = cleanTitle(line);
    if (isValidTitle(candidate)) return candidate;
  }

  return "Recipe";
}

/**
 * Clean up and normalize a title candidate
 */
function cleanTitle(text: string): string {
  return text
    .replace(HANDLES_TAGS, "") // Remove leading hashtags/handles
    .replace(INTRO_VERBS, "") // Remove intro verbs
    .replace(/\s*[.,!?]\s*$/, "") // Remove trailing punctuation
    .replace(/[""''"<>]/g, "") // Remove quotes and brackets
    .trim();
}

/**
 * Check if a title candidate is valid
 */
function isValidTitle(text: string): boolean {
  const clean = text.trim();
  if (!clean || clean.length < 3 || clean.length > 72) return false;
  if (WEAK_TITLES.test(clean)) return false;
  if (/^[@#][\w._-]+$/.test(clean)) return false; // Just a handle
  if (/^\d{6,}$/.test(clean)) return false; // Just numbers
  if (/^(?:prepare|mix|add|combine|ingredients?)(?:\s+\w+)?$/i.test(clean)) return false; // Just an instruction
  if (/^\s*(?:ingredients?|steps?|directions?|method):/i.test(clean)) return false; // Section headers
  if (/^[\d.,]+\s*(?:cup|tsp|tbsp|oz|g|ml|kg)s?\b/i.test(clean)) return false; // Just measurements
  return true;
}