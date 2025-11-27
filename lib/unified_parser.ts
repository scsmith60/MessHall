// lib/unified_parser.ts
//
// ðŸ§’ what this file does (like I'm 5):
// - We find Ingredients and Steps in a messy recipe.
// - We wash lines so they are clean and tidy.
// - We glue broken numbers together (like 1 + 1/2).
// - We split loooong step paragraphs into small steps.
// - We fix weird editor junk (like &#8203;).
// - We use a special "ingredient bath" helper (sanitizer) to clean ingredient lines.
// - We split steps on semicolons/pipes and inline numbers (like "2." "3)") so big blobs
//   become many tiny steps that your UI can list one-by-one.

import { sanitizeAndSplitIngredientCandidates } from "./ingredient_sanitizer"; // âœ… ingredient bath

export type IngredientSection = {
  name: string | null; // null means "ungrouped" or "main ingredients"
  ingredients: string[];
};

export type ParseResult = {
  ingredients: string[];
  ingredientSections?: IngredientSection[]; // Grouped by section if sections detected
  steps: string[];
  confidence: "low" | "medium" | "high";
  debug?: string;
};

// ---------- tiny cleaners (soap + towel) ----------
const NBSP_RE = /\u00A0/g;
const MULT_SIGN_RE = /\u00D7/g;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

const LEAD_BULLET_RE = /^\s*(?:[â€¢\-*]\s+)+/;
const LEAD_NUM_RE = /^\s*\d{1,2}[.)]\s+/;
const TRAIL_HASHTAGS_RE = /\s*(?:#[\p{L}\p{N}_-]+(?:\s+#[\p{L}\p{N}_-]+)*)\s*$/u;

function softClean(s: string): string {
  return (s || "")
    .replace(NBSP_RE, " ")
    .replace(MULT_SIGN_RE, "x")
    .replace(/\r/g, "\n")
    .trim();
}
function stripEmojis(s: string) { return s.replace(EMOJI_RE, ""); }
function stripLeadBullets(s: string) { return s.replace(LEAD_BULLET_RE, ""); }
function stripLeadNumbers(s: string) { return s.replace(LEAD_NUM_RE, ""); }
function stripTrailHashtags(s: string) { return s.replace(TRAIL_HASHTAGS_RE, ""); }
function tidySpaces(s: string) { return s.replace(/\s+/g, " ").trim(); }

// ðŸ§¹ cut off tail noise like â€œ#hashtagâ€ blobs a site may add at the end
function stripTailNoise(s: string): string {
  const m = s.match(/(\n\s*#|\n\s*less\b)/i);
  return m ? s.slice(0, m.index) : s;
}
function uniqueNonEmpty(arr: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of arr) { const t = x.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return out;
}

// ---------- fix "8x" + "inch" wraps (glue broken lines) ----------
function fixWrappedPanSizes(text: string): string {
  const lines = text.split("\n");
  const fixed: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    const endsWithLooseX = /\b\d+\s*x\s*$/i.test(cur);
    const nextLooksLikeDimension =
      /^(?:[-â€“â€”]?\s*)?(?:inch|in\.)\b/i.test(next) || /^\s*\d+\s*x\s*\d+/i.test(next);
    if (endsWithLooseX && nextLooksLikeDimension) { fixed.push(cur.trimEnd() + " " + next.trimStart()); i++; continue; }
    fixed.push(cur);
  }
  return fixed.join("\n");
}

// ---------- section slicer (find "Ingredients" and "Steps" areas) ----------
const ING_RE = /\b(ingredients?|what you need|you(?:'|')ll need)\b[:\-â€“â€”]?\s*/i;
const STEP_HDR_RE = /\b(instructions?|directions?|steps?|method|how\s+to\s+make\s+it)\b[:\-â€“â€”]?\s*/i;

function sliceSectionsSmart(raw: string) {
  const lower = raw.toLowerCase();
  const iIng = lower.search(ING_RE);
  const iStep = lower.search(STEP_HDR_RE);

  let ingBlob = "", stepBlob = "";
  if (iIng >= 0 && iStep >= 0) {
    const ingEnd = iStep > iIng ? iStep : raw.length;
    ingBlob = raw.slice(iIng, ingEnd).replace(ING_RE, "");
    stepBlob = raw.slice(iStep).replace(STEP_HDR_RE, "");
  } else if (iIng >= 0) {
    ingBlob = raw.slice(iIng).replace(ING_RE, "");
  } else if (iStep >= 0) {
    ingBlob = raw.slice(0, iStep);
    stepBlob = raw.slice(iStep).replace(STEP_HDR_RE, "");
  } else {
    ingBlob = raw;
  }
  return { ingBlob: stripTailNoise(ingBlob), stepBlob: stripTailNoise(stepBlob), iIng, iStep };
}

// ---------- step normalization (make splitting easier) ----------
const INLINE_NUM = /(\s)(\d{1,2}[.)]\s+)/g;
const INLINE_BULLET = /(\s)([-*â€¢]\s+)/g;

/**
 * ðŸ§± forceInlineStepBreaks:
 * - puts a NEW LINE before any " 2. " or " 2) " that appears mid-sentence
 * - turns semicolons `;` and pipes `|` into step separators (new lines)
 * - collapses extra blank lines
 */
function forceInlineStepBreaks(s: string): string {
  if (!s) return "";
  return s
    // put inline numbers/bullets on their own line
    .replace(INLINE_NUM, "\n$2")
    .replace(INLINE_BULLET, "\n$2")
    // split on semicolons and pipes (common makeshift separators)
    .replace(/[;|]+\s*/g, "\n")
    // be gentler about breaking on periods â€” only break when the next word looks like a new step cue
    .replace(/(?<=\.)\s+(?=(?:Step\b|STEP\b|Add\b|Then\b|Next\b|Now\b|Once\b|After\b|Meanwhile\b|When\b|If\b|Bake\b|Cook\b|Serve\b|Let\b))/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** old name kept for compatibility (calls the stronger splitter) */
function normalizeStepArea(s: string): string {
  return forceInlineStepBreaks(s);
}

/**
 * ðŸªš splitMixedStepLine:
 * final safeguard to break a single line into multiple steps.
 * We split on:
 *  - semicolons/pipes
 *  - inline numbering tokens like "2. " or "3) " that appear anywhere
 */
function splitMixedStepLine(line: string): string[] {
  if (!line) return [];
  // first split on obvious separators ; and |
  const first = line.split(/[;|]+/g).map(x => x.trim()).filter(Boolean);
  // then split any piece further at inline numbering
  const pieces: string[] = [];
  for (const part of first) {
    // split where a number-dot/paren *begins* (keep the token with the new piece)
    const sub = part.split(/(?=\b\d{1,2}[.)]\s+)/g).map(x => x.trim()).filter(Boolean);
    pieces.push(...sub);
  }
  return pieces;
}

// ---------- glue mixed numbers split across lines in ingredients ----------
function glueSplitMixedNumbersAcrossNewlines(text: string): string {
  if (!text) return text;
  // "1" newline "1/2"
  text = text.replace(/(\b\d+)\s*[\r\n]+\s*(?:[-*â€¢]\s*)?(\d+\s*\/\s*\d+)/gm, (_m, w, f) => `${w} ${f}`);
  // "1" newline "Â½"
  text = text.replace(/(\b\d+)\s*[\r\n]+\s*(?:[-*â€¢]\s*)?([Â¼Â½Â¾â…“â…”â…›â…œâ…â…ž])/gm, (_m, w, f) => `${w} ${f}`);
  return text;
}

// ---------- detectors for ingredients/steps ----------
const UNIT_WORD = /(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|ml|l|g|gram|kg|lb|lbs|pound|pounds|stick|clove|cloves|pinch|pinches|dash|dashes|bunch|can|cans|package|packages|head|heads)\b/i;
const LOOSE_INGREDIENT_HINT = /\b(chuck|roast|short\s*ribs?|ribs?|tortilla|tortillas|cilantro|oregano|cinnamon|salt|peppers?|sugar|flour|butter|oil|olive|vegetable|garlic|onion|bay\s+leaves?|parsley|basil|thyme|rosemary|sage|tomato|paste|yogurt|sour\s+cream|cheese|mozzarella|oaxaca|taco|lettuce|ginger|sesame|soy\s+sauce|coconut\s+aminos|lime|lemon|avocado|ground\s+chicken|chicken|beef|pork|shrimp|salmon|fish|egg|eggs|chile|chiles|chili|chilies|guajillo|pasilla)\b/i;
const STEP_CLUE_RE = /\bstep\s*\d+/i;
const FRACTIONS = /[Â¼Â½Â¾â…“â…”â…›â…œâ…â…ž]/;
const QTY_START = /\d+(?![.)])(?:\s*[-â€“â€”]\s*\d+)?/;

function looksLikeIngredientShape(t: string): boolean {
  return (
    new RegExp(`^(${QTY_START.source}|\\d+\\s*\\/\\s*\\d+|[Â¼Â½Â¾â…“â…”â…›â…œâ…â…ž])`).test(t) ||
    UNIT_WORD.test(t) || FRACTIONS.test(t)
  );
}
function looksLikeIngredient(line: string): boolean {
  const t = line.trim(); if (!t) return false;
  if (STEP_CLUE_RE.test(t)) return false;
  if (LEAD_NUM_RE.test(t)) return false;
  const qtyTarget = t.replace(/^\((\d+)\)/, '$1');
  const qty = new RegExp(`^(${QTY_START.source}|\\d+\\s*\\/\\s*\\d+|[¼½¾⅓⅔⅛⅜⅝⅞])`).test(qtyTarget);
  // Special case: "to taste" ingredients (e.g., "Salt and pepper to taste", "Salt to taste")
  if (/\bto taste\b/i.test(t) || /\b(salt|pepper)\s+(and|&)\s+(pepper|salt)\b/i.test(t)) {
    return true;
  }
  // Special case: "pinch" or "dash" ingredients (with or without "of")
  // Matches: "pinch of salt", "dash of cayenne", "pinch salt", "dash pepper", "A pinch of salt"
  if (/\b(pinch|pinches|dash|dashes)(\s+of)?\s+[a-z]/i.test(t)) {
    return true;
  }
  if (qty || UNIT_WORD.test(t) || FRACTIONS.test(t)) {
    return true;
  }
  if (LOOSE_INGREDIENT_HINT.test(t) && !/[.!?]$/.test(t) && t.length <= 80) {
    return true;
  }
  return false;
}
function looksLikeStep(line: string): boolean {
  const t = line.trim(); if (!t) return false;
  if (/^\d{1,2}[.)]\s+/.test(t)) return true;
  if (/^\s*[-*â€¢]\s+/.test(t)) return true;
  if (looksLikeIngredientShape(t)) return false;
  if (/^(preheat|heat|melt|whisk|stir|mix|combine|bring|simmer|boil|reduce|add|fold|pour|spread|sprinkle|season|coat|cook|bake|fry|air\s*fry|remove|transfer|let\s+sit|rest|chill|refrigerate|cool|cut|slice|serve|garnish|line|mince|dice|chop|peel|seed|core|marinate|prepare|mix the|make|fill|assemble)\b/i.test(t)) return true;
  if (/\.\s*$/.test(t) && /\b(preheat|heat|melt|whisk|stir|mix|combine|bring|pour|spread|sprinkle|season|bake|cook|chill|cut|slice|serve|garnish|marinate|prepare|make|fill|assemble)\b/i.test(t)) return true;
  return false;
}

// ---------- UI line cleaners ----------
function cleanIngredientLine(line: string): string {
  let stripped = tidySpaces(stripLeadBullets(stripEmojis(line)));
  // Remove leading "Ingredients:" labels that often remain from captions
  stripped = stripped.replace(/^(?:ingredients?|ingredient\s+list)\s*[:\-]?\s*/i, "");
  // trim punctuation that often trails after copying from captions ("Add salt.")
  const withoutTrail = stripped.replace(/[.,!?;:]+$/g, "").trim();
  return withoutTrail;
}
function cleanStepLine(line: string): string {
  let cleaned = tidySpaces(stripTrailHashtags(stripLeadBullets(stripLeadNumbers(stripEmojis(line)))));
  cleaned = cleaned.replace(/^step\s*\d*[:.)-]?\s*/i, "");
  return cleaned;
}

// ---------- merge orphan "8x" + "inch" lines in steps ----------
function mergeOrphanPanSizeSteps(steps: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const cur = steps[i]; const next = steps[i + 1] ?? "";
    const endsWithLooseX = /\b\d+\s*x$/i.test(cur);
    const nextStartsWithDim = /^(?:inch|in\.)/i.test(next) || /^\d+\s*x\s*\d+/i.test(next);
    if (endsWithLooseX && nextStartsWithDim) { out.push((cur + " " + next).trim()); i++; }
    else out.push(cur);
  }
  return out;
}

// ---------- step exploding (split big paragraphs on cue words) ----------
const COOKING_CUES = [
  "Preheat","Heat","Melt","Whisk","Stir","Mix","Combine","Bring","Simmer","Boil","Reduce",
  "Add","Fold","Pour","Spread","Sprinkle","Season","Coat","Cook","Bake","Fry","Air fry",
  "Remove","Transfer","Let sit","Rest","Chill","Refrigerate","Cool","Cut","Slice","Serve",
  "Garnish","Line","Mince","Dice","Chop","Peel","Seed","Core","Marinate","Prepare","Mix the",
  "Make","Fill","Assemble" // âœ… add here too for splitting help
];
const cueRegex = new RegExp(
  String.raw`(?<=\.)\s+(?=(?:${COOKING_CUES.join("|")})\b)`,
  "g"
);
function explodeCompoundSteps(steps: string[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    const base = s.trim(); if (!base) continue;
    let parts = base.replace(/\s*:\s+/g, ". ").split(/(?<=\.)\s+(?=[A-Z])/g);
    const finer: string[] = [];
    for (const p of parts) {
      const t = p.trim(); if (!t) continue;
      if (t.length > 140 || COOKING_CUES.some(c => new RegExp(`\\b${c}\\b`, "i").test(t))) {
        finer.push(...t.split(cueRegex).map(x => x.trim()).filter(Boolean));
      } else finer.push(t);
    }
    for (const f of finer) {
      const cleaned = f.replace(/^\d+[.)]\s*/, "").trim();
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

// ---------- ingredient run-on splitting & tails ----------
const MIXED_NUMBER_MARK = "@@MN@@";
function protectMixedNumbers(s: string): string {
  s = s.replace(/(\b\d+)\s+(\d+\s*\/\s*\d+\b)/g, `$1${MIXED_NUMBER_MARK}$2`);
  s = s.replace(/(\b\d+)\s+([Â¼Â½Â¾â…“â…”â…›â…œâ…â…ž]\b)/g, `$1${MIXED_NUMBER_MARK}$2`);
  return s;
}
function restoreMixedNumbers(s: string): string {
  return s.replace(new RegExp(MIXED_NUMBER_MARK, "g"), " ");
}
const INTERNAL_QTY_SPLIT = new RegExp(String.raw`\s+(?=(?:\d+\s*(?:\/\s*\d+)?|[Â¼Â½Â¾â…“â…”â…›â…œâ…â…ž])\s*(?:[a-zA-Z(Â°]|$))`, "g");
const AND_QTY_SPLIT = /\s+(?=(?:and|&)\s+\d)/i;
const PUNCT_THEN_CAP_SPLIT = /\s*[,;]\s+(?=[A-Z])/;
const CONTINUATION_PREP = /^(?:and\s+)?(?:peeled|deveined|seeded|pitted|minced|chopped|diced|sliced|shredded|rinsed|drained|cored|crushed|warmed|heated|cooled)\b/i;
const ALT_ING_SPLIT = new RegExp(
  String.raw`[,;]\s+(?=(?:` +
  `${QTY_START.source}|\\d+\\s*\\/\\s*\\d+|[Â¼Â½Â¾â…“â…”â…›â…œâ…â…ž]|` +
  `(?:Sea|Kosher|Table)\\s+salt|Black\\s+pepper|White\\s+pepper|Red\\s+pepper\\s+flakes|Olive\\s+oil|Vegetable\\s+oil|Cooking\\s+spray|` +
  `(?:and|&)\\s+\\d` + `))`, "i"
);

function extractContinuationPrefix(line: string): { prefix: string; rest: string } {
  const m = line.match(CONTINUATION_PREP);
  if (!m) return { prefix: "", rest: line };
  return { prefix: m[0].replace(/^(?:and|&)\s+/i, "").trim(), rest: line.slice(m[0].length).trim() };
}

function splitRunOnIngredients(line: string): string[] {
  // First, split on bullet points if there are multiple ingredients on one line
  // e.g., "tarch â€¢ 1 egg yolk â€¢ 1 tsp vanilla bean paste" should split into 3 ingredients
  // But only if there are multiple quantities (numbers) - don't split if it's just one ingredient with notes
  const bulletParts = line.split(/\s*[â€¢]\s+/).map(s => s.trim()).filter(Boolean);
  
  // If we have multiple parts separated by bullets AND they each look like separate ingredients (have quantities),
  // split them. Otherwise, treat as one ingredient with bullet-separated notes.
  const hasMultipleQuantities = bulletParts.filter(p => {
    const qtyMatch = p.match(/^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|[Â¼Â½Â¾â…“â…”â…›â…œâ…â…ž]|\d+(?:\.\d+)?\s*[-â€“â€”]\s*\d+(?:\.\d+)?)/);
    return qtyMatch !== null;
  }).length;
  
  // If we have 2+ parts with quantities, split them
  if (bulletParts.length > 1 && hasMultipleQuantities >= 2) {
    const allParts: string[] = [];
    for (const part of bulletParts) {
      // Recursively split each part (in case it has other separators)
      allParts.push(...splitRunOnIngredients(part));
    }
    return allParts;
  }
  
  // Protect "OR" statements - don't split on them
  // Replace " OR " with a placeholder, split, then restore
  const OR_PLACEHOLDER = "@@OR@@";
  const hasOr = /\b(or|OR)\b/i.test(line);
  let protectedLine = protectMixedNumbers(line);
  
  if (hasOr) {
    // Protect OR statements by replacing them with a placeholder
    // Match patterns like "X OR Y" or "X, OR Y" or "X; OR Y" or "X (or Y)"
    protectedLine = protectedLine.replace(/\s+(or|OR)\s+/gi, ` ${OR_PLACEHOLDER} `);
    // Also handle parenthetical OR: "(or" -> "(OR_PLACEHOLDER"
    protectedLine = protectedLine.replace(/\(\s*(or|OR)\s+/gi, `(${OR_PLACEHOLDER} `);
  }
  
  let parts: string[] = [protectedLine];
  
  // Split on patterns, but be careful not to split OR statements
  parts = parts.flatMap(p => p.split(ALT_ING_SPLIT)).map(s => s.trim()).filter(Boolean);
  parts = parts.flatMap(p => p.split(AND_QTY_SPLIT)).map(s => s.trim()).filter(Boolean);
  parts = parts.flatMap(p => p.split(INTERNAL_QTY_SPLIT)).map(s => s.trim()).filter(Boolean);
  parts = parts.flatMap(p => p.split(PUNCT_THEN_CAP_SPLIT)).map(s => s.trim()).filter(Boolean);
  
  let finalParts = parts
    .map(p => restoreMixedNumbers(p.replace(new RegExp(OR_PLACEHOLDER, "g"), " or ")))
    .map(s => tidySpaces(s))
    .filter(Boolean);

  if (finalParts.length <= 1) {
    const restored = restoreMixedNumbers(protectedLine).replace(new RegExp(OR_PLACEHOLDER, "g"), " or ");
    const qtyToken = new RegExp(`(\\d+\\s*\\/\\s*\\d+|${QTY_START.source}|${FRACTIONS.source})`, "gi");
    const boundaries: number[] = [0];
    let depth = 0;
    let scanPos = 0;
    qtyToken.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = qtyToken.exec(restored)) !== null) {
      const idx = match.index ?? 0;
      for (let c = scanPos; c < idx; c++) {
        const ch = restored[c];
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
      }
      scanPos = idx;
      if (depth > 0) continue;
      if (idx === 0) continue;
      const prevChar = restored[idx - 1] || "";
      if (idx > 0 && /[\(\-â€“â€”]/.test(prevChar)) continue;
      const lastBoundary = boundaries[boundaries.length - 1] ?? 0;
      const span = restored.slice(lastBoundary, idx);
      if (!/[-â€¢\n\r]/.test(span)) continue;
      boundaries.push(idx);
    }
    if (boundaries.length >= 2) {
      const fallback: string[] = [];
      for (let i = 0; i < boundaries.length; i++) {
        const startIdx = boundaries[i];
        const endIdx = boundaries[i + 1] ?? restored.length;
        const chunk = restored.slice(startIdx, endIdx).trim();
        if (chunk) fallback.push(chunk);
      }
      if (fallback.length > 1) finalParts = fallback;
    }
  }
  
  return finalParts;
}

// ---------- merge parenthetical statements split across lines ----------
function mergeParentheticalOrLines(lines: string[]): string[] {
  // Run multiple passes until no more changes (handles nested or complex cases)
  let result = [...lines];
  let changed = true;
  let maxPasses = 10; // Safety limit
  
  while (changed && maxPasses > 0) {
    changed = false;
    const out: string[] = [];
    
    for (let i = 0; i < result.length; i++) {
      const cur = (result[i] ?? "").trim();
      
      if (!cur) {
        out.push(result[i]);
        continue;
      }
      
      // Count opening and closing parentheses in current line
      const openParens = (cur.match(/\(/g) || []).length;
      const closeParens = (cur.match(/\)/g) || []).length;
      const hasUnclosedParen = openParens > closeParens;
      
      // Simple rule: if line has unclosed parentheses, merge with next lines until balanced
      if (hasUnclosedParen && i + 1 < result.length) {
        // Preserve line number from current line if present (e.g., "6. " or "6.")
        const curNumberMatch = cur.match(/^(\d+\.?\s*)/);
        const curNumber = curNumberMatch ? curNumberMatch[1] : "";
        
        // Remove ONLY the number prefix and trailing bullets/whitespace from current line
        // Keep all the actual content (like "1 tbsp vanilla bean paste ( or")
        const curWithoutNumber = cur.replace(/^\d+\.?\s*/, "").replace(/[â€¢•\s]*$/, "").trim();
        let accumulated = curWithoutNumber;
        let skipCount = 0;
        
        // Keep merging with next lines until parentheses are balanced
        for (let j = i + 1; j < result.length; j++) {
          const nextLineRaw = (result[j] ?? "").trim();
          if (!nextLineRaw) {
            skipCount++;
            continue;
          }
          
          // Remove ONLY the leading line number prefix (e.g., "7. " or "7.") and bullets from next line
          // Preserve all the actual content (like "2 tsp vanilla extract)")
          // Match pattern: number + period + optional space at the very start
          // This ensures we only remove "7. " or "7." not "2" from "2 tsp"
          let nextLine = nextLineRaw;
          // Remove line number pattern: "7. " or "7." at start
          if (/^\d+\./.test(nextLine)) {
            nextLine = nextLine.replace(/^\d+\.\s*/, "");
          }
          // Remove leading bullets
          nextLine = nextLine.replace(/^[â€¢•\s]+/, "").trim();
          if (!nextLine) {
            skipCount++;
            continue;
          }
          
          // Merge: just add a space and the next line content
          accumulated = tidySpaces(`${accumulated} ${nextLine}`);
          skipCount++;
          
          // Check if parentheses are now balanced
          const accOpen = (accumulated.match(/\(/g) || []).length;
          const accClose = (accumulated.match(/\)/g) || []).length;
          if (accOpen <= accClose) {
            break; // Balanced now, stop merging
          }
        }
        
        // Build final merged line with preserved line number
        const merged = curNumber ? `${curNumber}${accumulated}` : accumulated;
        out.push(merged);
        i += skipCount; // skip all merged lines
        changed = true; // Mark that we made a change
        continue;
      }
      
      out.push(result[i]);
    }
    
    result = out;
    maxPasses--;
  }
  
  return result;
}

// ---------- early glue of bare numbers with next line (ingredients area) ----------
const BARE_WHOLE = /^\s*\d+\s*$/;
const BARE_QTY = new RegExp(`^\\s*(?:${QTY_START.source})\\s*$`);
const TEMP_LINE = /^\s*[-~]?\s*\d+\s*(?:°|º|Â°|\bdeg\b|\bdeg\.)?\s*(?:f|c)\b/i;
function mergeOrphanQuantityLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = (lines[i] ?? "").trim();
    const next = (lines[i + 1] ?? "").trim();
    // Don't merge if current line ends with "OR" or next line starts with "OR"
    // This prevents merging "vanilla extract) â€¢ 2" with the next line when it should stay with "vanilla bean paste OR"
    const curEndsWithOr = /\b(or|OR)\s*[â€¢)\]]?\s*$/i.test(cur);
    const nextStartsWithOr = /^\s*[â€¢(\[]?\s*(or|OR)\b/i.test(next);
    const nextIsTemp = TEMP_LINE.test(next);
    if (cur && next && !curEndsWithOr && !nextStartsWithOr) {
      const shouldGlue = (BARE_WHOLE.test(cur) || BARE_QTY.test(cur)) ||
        nextIsTemp ||
        /\b(?:warm|warmed|heat|heated|cool|cooled)\s+to\s*$/i.test(cur);
      if (shouldGlue) {
        out.push(tidySpaces(`${cur} ${next}`));
        i++;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out;
}

// ---------- FINAL safety glue for finished ingredient list ----------
function finalFixOrphanNumberIngredients(items: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const cur = (items[i] ?? "").trim();
    const next = (items[i + 1] ?? "").trim();
    // Don't merge if current line ends with "OR" or next line starts with "OR"
    // This prevents merging orphan numbers with OR statements
    const curEndsWithOr = /\b(or|OR)\s*[â€¢)\]]?\s*$/i.test(cur);
    const nextStartsWithOr = /^\s*[â€¢(\[]?\s*(or|OR)\b/i.test(next);
    if (cur && /^\d+$/.test(cur) && next && !curEndsWithOr && !nextStartsWithOr) {
      out.push(tidySpaces(`${cur} ${next}`));
      i++; // skip the next one because we merged it
    } else {
      if (cur && TEMP_LINE.test(cur) && out.length) {
        out[out.length - 1] = tidySpaces(`${out[out.length - 1]} ${cur}`);
        continue;
      } else {
        out.push(items[i]);
      }
    }
  }
  return out;
}

function mergeTempLines(items: string[]): string[] {
  const out: string[] = [];
  for (const line of items) {
    if (TEMP_LINE.test(line) && out.length) {
      out[out.length - 1] = tidySpaces(`${out[out.length - 1]} ${line}`);
    } else {
      out.push(line);
    }
  }
  return out;
}

// ---------- step artifact scrubber (kills &#8203;, oaicite refs, etc.) ----------
function stripEditorArtifacts(s: string): string {
  return s
    // 1) decode a few safe entities
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // 2) kill numeric zero-width/bidi entities even if spaced weird:
    //    & # 8203 ;  or &#8203;  â†’ remove
    .replace(/&\s*#\s*(?:8203|8204|8205|8232|8233|8234|8235|8236|8237|8238|65279)\s*;?/gi, "")
    // 3) also remove the actual unicode chars if already decoded
    .replace(/[\u200B\u200C\u200D\u2028\u2029\u202A-\u202E\uFEFF]/g, "")
    // 4) remove editor placeholders
    .replace(/:contentReference\[.*?\]/g, "")
    .replace(/\{index=.*?\}/g, "")
    // 5) clean leftover **bold**
    .replace(/\*{2,}/g, "")
    // 6) trim stray semicolons and extra spaces
    .replace(/\s*;\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    // 7) kill a lonely trailing ampersand (we keep real "salt & pepper")
    .replace(/\s*&\s*$/g, "")
    // 8) and if the whole line is just "&", drop it
    .replace(/^\s*&\s*$/g, "")
    .trim();
}

// ---------- meta detector for steps (gentle filtering) ----------
// ðŸ·ï¸ meta lines: "Servings: 4", "Prep Time: 10 minutes", "4 croissants" (no period)
function isMetaLine(s: string): boolean {
  const t = (s || "").trim();
  if (!t) return true;

  // classic labels at start
  if (/^(servings?|yield|yields|makes|prep time|cook time|total time|time|kcal|calories)\b/i.test(t)) return true;

  // piped meta anywhere
  if (/(^|\s)(prep time:|cook time:|total time:|kcal\b|calories\b)/i.test(t)) return true;

  // bare qty + product (no sentence end)
  if (/^\d+\s+(?:servings?|croissants?|cookies?|muffins?|bars?|slices?|pieces?|cups?)\b/i.test(t) && !/[.!?]$/.test(t)) {
    return true;
  }
  return false;
}

// âœ… verb-anywhere detector so we keep instruction lines even if they don't start with a number/bullet
const COOKING_VERBS = [
  "preheat","heat","melt","whisk","stir","mix","combine","bring","simmer","boil","reduce",
  "add","fold","pour","spread","sprinkle","season","coat","cook","bake","fry","air\\s*fry",
  "remove","transfer","let\\s+sit","rest","chill","refrigerate","cool","cut","slice","serve",
  "garnish","line","mince","dice","chop","peel","seed","core","marinate","prepare","beat",
  "blend","pulse","knead","roll","press","grease","butter","measure","rinse","drain","pat\\s+dry",
  "toast","grate","zest","steam","microwave","warm",
  // âœ… NEW verbs so we keep these lines as steps:
  "make","fill","assemble"
];
const VERB_ANYWHERE_RE = new RegExp(`\\b(?:${COOKING_VERBS.join("|")})\\b`, "i");

// ---------- MAIN ----------
export function parseRecipeText(input: string): ParseResult {
  if (!input) return { ingredients: [], steps: [], confidence: "low", debug: "empty" };

  let raw = softClean(input);
  raw = stripTailNoise(raw);
  raw = fixWrappedPanSizes(raw);

  let { ingBlob, stepBlob, iIng, iStep } = sliceSectionsSmart(raw);

  // glue "1" + newline + "Â½/1/2"
  ingBlob = glueSplitMixedNumbersAcrossNewlines(ingBlob);
  ingBlob = ingBlob.replace(/\s+-\s+(?=\d)/g, "\n- ");

  // make step area friendlier (now also splits on ; and |)
  stepBlob = normalizeStepArea(stepBlob);

  // ---------- INGREDIENTS ----------
  // turn ingredient blob into raw lines (handle single-paragraph alternative)
  let ingLinesRaw: string[];
  if (/\bingredients?\b/i.test(raw) && !/\n/.test(ingBlob) && /,/.test(ingBlob)) {
    ingLinesRaw = ingBlob.split(ALT_ING_SPLIT).map(s => s.trim()).filter(Boolean);
  } else {
    ingLinesRaw = ingBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }

  // early glue like "1" newline "cup sugar"
  ingLinesRaw = mergeOrphanQuantityLines(ingLinesRaw);
  
  // Merge lines where parenthetical OR statements are split across lines
  // e.g., "vanilla bean paste (or" on one line and "2 tsp vanilla extract)" on next
  ingLinesRaw = mergeParentheticalOrLines(ingLinesRaw);

  // âœ… sanitizer bath (fixes headers, /2 â†' 1/2, bullets/dashes, etc.)
  const sanitizedPieces = sanitizeAndSplitIngredientCandidates(ingLinesRaw);
  const hadGuesses = sanitizedPieces.some(p => p.lowConfidence);
  let ingLinesPrepped = sanitizedPieces
    .filter(p => !p.maybeHeader) // drop "For the Ganache:"-style headers
    .map(p => p.text);
  
  // Merge parenthetical statements again after sanitization (in case sanitizer split them)
  ingLinesPrepped = mergeParentheticalOrLines(ingLinesPrepped);
  const strayStepSeedsRaw = ingLinesPrepped.filter(line => !looksLikeIngredient(line) && !isLikelyPromoLine(line));
  
  // Group ingredients by sections if headers are detected
  const ingredientSections: IngredientSection[] = [];
  let currentSection: IngredientSection | null = null;
  const allIngredientsBuilt: string[] = [];
  
  for (const piece of sanitizedPieces) {
    if (piece.maybeHeader) {
      // This is a section header - start a new section
      const sectionName = piece.text.replace(/[:â€¢\s]+$/, "").trim();
      if (currentSection && currentSection.ingredients.length > 0) {
        ingredientSections.push(currentSection);
      }
      currentSection = { name: sectionName, ingredients: [] };
    } else {
      // This is an ingredient line
      const line = piece.text;
      // Safety check: filter out headers that weren't caught by the sanitizer
      // Headers ending with ":" that have no numbers/units should not be ingredients
      if (line.trim().endsWith(':')) {
        const base = line.trim().slice(0, -1).trim();
        if (!/\d/.test(base) && !/(cup|cups|tsp|tbsp|oz|lb|g|gram|kg|ml|l)/i.test(base)) {
          // This looks like a header, skip it
          continue;
        }
      }
      if (!looksLikeIngredient(line) && !isLikelyPromoLine(line)) continue;
      
      let cand = cleanIngredientLine(line);
      const { prefix, rest } = extractContinuationPrefix(cand);
      const sectionIngredients: string[] = [];
      
      if (prefix && (currentSection?.ingredients.length || allIngredientsBuilt.length)) {
        const target = currentSection?.ingredients || allIngredientsBuilt;
        if (target.length > 0) {
          target[target.length - 1] =
            target[target.length - 1].replace(/\s*,?\s*$/, "") + ", " + prefix;
        }
        if (!rest) continue;
        cand = rest;
      }
      
      for (const p of splitRunOnIngredients(cand)) {
        const t = tidySpaces(p);
        if (t) {
          sectionIngredients.push(t);
          allIngredientsBuilt.push(t);
        }
      }
      
      if (currentSection) {
        currentSection.ingredients.push(...sectionIngredients);
      } else {
        // No section header yet - add to ungrouped
        allIngredientsBuilt.push(...sectionIngredients);
      }
    }
  }
  
  // Add the last section if it exists
  if (currentSection && currentSection.ingredients.length > 0) {
    ingredientSections.push(currentSection);
  }
  
  // Build flat list for backward compatibility
  const ingredientsBuilt = allIngredientsBuilt;
  
  // unique + final orphan-number glue
  const ingredientsPrepped = finalFixOrphanNumberIngredients(uniqueNonEmpty(ingredientsBuilt));
  let ingredients = mergeTempLines(dropJunkIngredientLines(ingredientsPrepped));
  
  // Final pass: merge any parenthetical statements that might have been split
  ingredients = mergeParentheticalOrLines(ingredients).slice(0, 60);
  
  // Also apply final fixes to section ingredients
  if (ingredientSections.length > 0) {
    for (const section of ingredientSections) {
      const sectionPrepped = finalFixOrphanNumberIngredients(uniqueNonEmpty(section.ingredients));
      let sectionIngs = mergeTempLines(dropJunkIngredientLines(sectionPrepped));
      // Final pass: merge any parenthetical statements
      section.ingredients = mergeParentheticalOrLines(sectionIngs).slice(0, 60);
    }
  }
  
  // Ensure "Salt and pepper to taste" is included if it appeared in the original text
  // Check if we have salt/pepper separately but missing the combined version
  const hasSalt = ingredients.some(ing => /^salt(\s+to\s+taste)?$/i.test(ing.trim()));
  const hasPepper = ingredients.some(ing => /^pepper(\s+to\s+taste)?$/i.test(ing.trim()));
  const hasSaltAndPepper = ingredients.some(ing => /salt\s+(and|&)\s+pepper/i.test(ing));
  // If original text had "Salt and pepper to taste" but we don't have it, add it
  const originalHasSaltAndPepper = /\bsalt\s+(and|&)\s+pepper\s+to\s+taste\b/i.test(input);
  if (originalHasSaltAndPepper && !hasSaltAndPepper && (hasSalt || hasPepper)) {
    // Remove individual salt/pepper entries and add combined
    ingredients = ingredients.filter(ing => !/^(salt|pepper)(\s+to\s+taste)?$/i.test(ing.trim()));
    ingredients.push("Salt and pepper to taste");
  }

  // ---------- STEPS ----------
  // get raw step lines (after strong inline splitting)
  let stepLinesRaw = stepBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);

  // build steps gently:
  // 1) clean (stripEditorArtifacts kills &#8203; and lonely "&")
  // 2) split any remaining "mushy" lines into mini steps (splitMixedStepLine)
  // 3) drop meta (Servings/Times)
  // 4) keep lines that either look like steps OR contain a cooking verb anywhere (now includes make/fill/assemble)
  let steps = stepLinesRaw
    .map(cleanStepLine)
    .map(stripEditorArtifacts)
    .flatMap(splitMixedStepLine)
    .map(s => s.replace(/\s+:\s*$/, ":")) // normalize spaces before a trailing colon
    .filter(s => s.length > 1)
    .filter(s => !isMetaLine(s))
    .filter(s => looksLikeStep(s) || VERB_ANYWHERE_RE.test(s));

  // If we barely got anything, fall back to exploding the paragraph
  if (steps.length < 2 && stepBlob) {
    const exploded = explodeCompoundSteps([stepBlob])
      .map(stripEditorArtifacts)
      .flatMap(splitMixedStepLine)
      .map(cleanStepLine)
      .filter(s => s.length > 1)
      .filter(s => !isMetaLine(s))
      .filter(s => looksLikeStep(s) || VERB_ANYWHERE_RE.test(s));
    if (exploded.length > steps.length) steps = exploded;
  }

  const stepSeedsFromIngredients = strayStepSeedsRaw
    .map(cleanStepLine)
    .map(stripEditorArtifacts)
    .flatMap(splitMixedStepLine)
    .map(s => s.replace(/\s+:\s*$/, ":").trim())
    .filter(s => s.length > 1)
    .filter(s => !isMetaLine(s))
    .filter(s => !isLikelyPromoLine(s))
    .filter(s => looksLikeStep(s) || VERB_ANYWHERE_RE.test(s));
  if (stepSeedsFromIngredients.length) {
    steps = steps.concat(stepSeedsFromIngredients);
  }

  // Final tidy for steps
  if (steps.length >= 2) steps = mergeOrphanPanSizeSteps(steps);
  steps = uniqueNonEmpty(steps).slice(0, 60);

  // ---------- confidence dial (simple rules + nudge if we guessed) ----------
  let confidence: "low" | "medium" | "high" = "low";
  if (ingredients.length >= 5 && steps.length >= 3) confidence = "high";
  else if (ingredients.length >= 3 || steps.length >= 2) confidence = "medium";
  if (hadGuesses && confidence === "high") confidence = "medium"; // nudge down if sanitizer had to guess

  const dbg = `len:${raw.length} iIng:${iIng} iStep:${iStep} ing:${ingredients.length} steps:${steps.length} guessed:${hadGuesses}`;
  
  // Return with sections if we detected any, otherwise return flat list
  const result: ParseResult = { ingredients, steps, confidence, debug: dbg };
  if (ingredientSections.length > 0) {
    result.ingredientSections = ingredientSections;
  }
  return result;
}


// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Quantity normalizers (handle 1Â½, 1 1/2lb â†’ 1 1/2 lb, etc.)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function normalizeUnicodeFractions(s: string): string {
  // Map common unicode fractions to ascii
  return s.replace(/Â¼/g, " 1/4")
          .replace(/Â½/g, " 1/2")
          .replace(/Â¾/g, " 3/4");
}
function fixStuckQtyUnitsAll(s: string): string {
  // Add a space between quantity (with optional mixed fraction) and unit
  // Examples: "1lb" -> "1 lb", "1 1/2lb" -> "1 1/2 lb", "12oz" -> "12 oz"
  return s.replace(/\b(\d+(?:\s+\d+\/\d+)?)(?=(lb|lbs|pound|pounds|oz|g|kg|ml|l)\b)/gi, "$1 ");
}
function normalizeQuantitiesForIG(s: string): string {
  let out = normalizeUnicodeFractions(s);
  out = fixStuckQtyUnitsAll(out);
  return out;
}
// Drop obvious junk lines that sometimes sneak in as ingredients
const INLINE_HASHTAG_RE = /#[\p{L}][\p{L}\p{N}_-]*/iu;
const INLINE_HANDLE_RE = /@[a-z0-9_.-]+/i;
const PROMO_CLUE_RE = /\b(follow|subscribe|newsletter|link\s+(?:in|on)\s+bio|visit\s+our|check\s+(?:out|our)|use\s+code|discount|shop\s+(?:our|the)|our\s+shop|storefront|featured|feature|chance\s+to\s+be\s+featured|tag\s+us|contest|giveaway|delicious\s+food|our\s+(?:site|website|blog)|download\s+our\s+app|app\s+store)\b/i;

function isLikelyPromoLine(line: string): boolean {
  const t = (line || "").trim();
  if (looksLikeIngredient(t)) return false;
  if (!t) return true;
  if (/https?:\/\//i.test(t)) return true;
  if (INLINE_HASHTAG_RE.test(t)) return true;
  if (INLINE_HANDLE_RE.test(t)) return true;
  if (/\b\d+\s*\+\s*(?:more\s+)?recipes\b/i.test(t)) return true;
  if (/\bmore\b.*\brecipes\b/i.test(t)) return true;
  if (PROMO_CLUE_RE.test(t)) return true;
  return false;
}

function dropJunkIngredientLines(lines: string[]): string[] {
  return (lines || [])
    .map((l) => l || "")
    .filter((l) => !/^\s*\d[\d,.\s]*\s+(likes?|comments?)\b/i.test(l))
    .filter((l) => !isLikelyPromoLine(l));
}


