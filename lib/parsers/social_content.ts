// lib/parsers/social_content.ts
//
// ≡ƒö£ Helper functions for processing TikTok/Instagram content with better accuracy

import { extractRecipeTitle } from './title_extractor';

/** Clean up text content by removing common social media cruft */
function cleanSocialText(text: string): string {
  return (text || '')
    // Remove URLs
    .replace(/https?:\/\/[^\s<>]+/g, '')
    // Remove handles/hashtags
    .replace(/[@#][\w._-]+/g, '')
    // Normalize bullets and dashes
    .replace(/[\u2022\u2023\u25E6\u2043\u2012\u2013\u2014\u2015]/g, '-')
    // Remove excessive whitespace
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Score how recipe-like a block of text is */
export function scoreRecipeContent(text: string): number {
  if (!text) return 0;
  const s = text.toLowerCase();
  
  let score = 0;
  
  // Recipe structure indicators
  if (/\bingredients?\b/.test(s)) score += 500;
  if (/\b(steps?|directions?|method|instructions?)\b/.test(s)) score += 360;
  if (/\b(recipe|homemade)\b/.test(s)) score += 400;
  
  // Measurements and quantities
  const unitHits = (s.match(/\b(cups?|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|lb|pound|g|gram|kg|ml|l|lit(?:er|re)|clove|cloves|egg|eggs|stick|sticks)\b/g) || []).length;
  score += unitHits * 70;
  
  // Numbers and fractions
  if (/[0-9¼½¾⅓⅔⅛⅜⅝⅞]/.test(s)) score += 80;
  
  // List markers
  if (/^[\s]*[-*•]/m.test(s)) score += 80;
  if (/^[\s]*\d+[.)]/m.test(s)) score += 90;
  
  // Recipe-related emojis
  if (/[🍕🍔🍞🥖🥨🥯🥪🥙🌮🌯🥗🥘🍝🥫🍜🍲🍛🍣🍱🥟🍤🍗🍖🧀🥚🥓🥩🥐🧂🥄🍽️⏲️]/.test(text)) score += 60;
  if (/🛒|📝|🍽️|⏰|➡️/.test(text)) score += 40;
  
  // Penalties
  const hashDensity = (text.match(/#/g) || []).length / Math.max(1, text.length);
  if (hashDensity > 0.02) score -= 60;
  
  // Common promotional phrases
  if (/tour|tickets|anniversary|merch|follow|subscribe|link in bio|watch this|check out|new post/i.test(s)) score -= 120;
  
  // Instruction verbs at start (not recipe title)
  if (/^(step|preheat|mix|combine|add|stir|whisk|bake|boil|simmer|cook|fry|sauté|grill|roast)\b/i.test(s)) score -= 100;
  
  // Length bonus (but not too much)
  score += Math.min(text.length, 1000) / 10;
  
  return score;
}

/** Process social media text to extract recipe content */
export function processSocialContent(input: {
  caption?: string | null;
  text?: string | null;
  pageTitle?: string | null;
  comments?: string[] | null;
}): {
  title: string | null;
  mainText: string;
  comments: string[];
  score: number;
} {
  // Clean caption/text
  const caption = cleanSocialText(input.caption || '');
  const text = cleanSocialText(input.text || '');
  const pageTitle = cleanSocialText(input.pageTitle || '');
  const comments = (input.comments || []).map(cleanSocialText).filter(Boolean);
  
  // Extract title
  const title = extractRecipeTitle({
    caption,
    text,
    pageTitle,
    description: null
  });
  
  // Score main content
  const mainText = caption || text;
  const score = scoreRecipeContent(mainText);
  
  return {
    title,
    mainText,
    comments,
    score
  };
}

/** Extract recipe-like comment blocks */
export function extractRecipeComments(comments: string[]): string[] {
  return comments
    .filter(c => c && c.length >= 20)  // Minimum meaningful length
    .map(c => ({ text: c, score: scoreRecipeContent(c) }))
    .filter(c => c.score >= 300)  // Must have strong recipe indicators
    .sort((a, b) => b.score - a.score)
    .map(c => c.text)
    .slice(0, 5);  // Keep top 5 recipe-like comments
}