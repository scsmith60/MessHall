// lib/unified_parser.ts
//
// 🧒 what this file does (like I'm 5):
// - We find Ingredients and Steps in a messy recipe.
// - We wash lines so they are clean and tidy.
// - We glue broken numbers together (like 1 + 1/2).
// - We split loooong step paragraphs into small steps.
// - We fix weird editor junk (like &#8203;).
// - We use a special "ingredient bath" helper (sanitizer) to clean ingredient lines.
// - We split steps on semicolons/pipes and inline numbers (like "2." "3)") so big blobs
//   become many tiny steps that your UI can list one-by-one.

import { sanitizeAndSplitIngredientCandidates } from "./ingredient_sanitizer"; // ✅ ingredient bath

export type ParseResult = {
  ingredients: string[];
  steps: string[];
  confidence: "low" | "medium" | "high";
  debug?: string;
};

// ---------- tiny cleaners (soap + towel) ----------
const NBSP_RE = /\u00A0/g;
const MULT_SIGN_RE = /\u00D7/g;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

const LEAD_BULLET_RE = /^\s*(?:[•\-*]\s+)+/;
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

// 🧹 cut off tail noise like “#hashtag” blobs a site may add at the end
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
      /^(?:[-–—]?\s*)?(?:inch|in\.)\b/i.test(next) || /^\s*\d+\s*x\s*\d+/i.test(next);
    if (endsWithLooseX && nextLooksLikeDimension) { fixed.push(cur.trimEnd() + " " + next.trimStart()); i++; continue; }
    fixed.push(cur);
  }
  return fixed.join("\n");
}

// ---------- section slicer (find "Ingredients" and "Steps" areas) ----------
const ING_RE = /\b(ingredients?|what you need|you(?:'|’)ll need)\b[:\-–—]?\s*/i;
const STEP_HDR_RE = /\b(instructions?|directions?|steps?|method)\b[:\-–—]?\s*/i;

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
const INLINE_BULLET = /(\s)([-*•]\s+)/g;

/**
 * 🧱 forceInlineStepBreaks:
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
    // be gentler about breaking on periods — only break when the next word is an explicit new step cue
    .replace(/(?<=\.)\s+(?=(?:Step|STEP)\b)/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** old name kept for compatibility (calls the stronger splitter) */
function normalizeStepArea(s: string): string {
  return forceInlineStepBreaks(s);
}

/**
 * 🪚 splitMixedStepLine:
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
  text = text.replace(/(\b\d+)\s*[\r\n]+\s*(?:[-*•]\s*)?(\d+\s*\/\s*\d+)/gm, (_m, w, f) => `${w} ${f}`);
  // "1" newline "½"
  text = text.replace(/(\b\d+)\s*[\r\n]+\s*(?:[-*•]\s*)?([¼½¾⅓⅔⅛⅜⅝⅞])/gm, (_m, w, f) => `${w} ${f}`);
  return text;
}

// ---------- detectors for ingredients/steps ----------
const UNIT_WORD = /(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|ml|l|g|gram|kg|lb|lbs|pound|pounds|stick|clove|cloves|pinch|dash|bunch|can|cans|package|packages|head|heads)\b/i;
const FRACTIONS = /[¼½¾⅓⅔⅛⅜⅝⅞]/;
const QTY_START = /\d+(?![.)])(?:\s*[-–]\s*\d+)?/;

function looksLikeIngredientShape(t: string): boolean {
  return (
    new RegExp(`^(${QTY_START.source}|\\d+\\s*\\/\\s*\\d+|[¼½¾⅓⅔⅛⅜⅝⅞])`).test(t) ||
    UNIT_WORD.test(t) || FRACTIONS.test(t)
  );
}
function looksLikeIngredient(line: string): boolean {
  const t = line.trim(); if (!t) return false;
  if (LEAD_NUM_RE.test(t)) return false;
  const qty = new RegExp(`^(${QTY_START.source}|\\d+\\s*\\/\\s*\\d+|[¼½¾⅓⅔⅛⅜⅝⅞])`).test(t);
  return qty || UNIT_WORD.test(t) || FRACTIONS.test(t);
}
function looksLikeStep(line: string): boolean {
  const t = line.trim(); if (!t) return false;
  if (/^\d{1,2}[.)]\s+/.test(t)) return true;
  if (/^\s*[-*•]\s+/.test(t)) return true;
  if (looksLikeIngredientShape(t)) return false;
  if (/^(preheat|heat|melt|whisk|stir|mix|combine|bring|simmer|boil|reduce|add|fold|pour|spread|sprinkle|season|coat|cook|bake|fry|air\s*fry|remove|transfer|let\s+sit|rest|chill|refrigerate|cool|cut|slice|serve|garnish|line|mince|dice|chop|peel|seed|core|marinate|prepare|mix the|make|fill|assemble)\b/i.test(t)) return true;
  if (/\.\s*$/.test(t) && /\b(preheat|heat|melt|whisk|stir|mix|combine|bring|pour|spread|sprinkle|season|bake|cook|chill|cut|slice|serve|garnish|marinate|prepare|make|fill|assemble)\b/i.test(t)) return true;
  return false;
}

// ---------- UI line cleaners ----------
function cleanIngredientLine(line: string): string {
  const stripped = tidySpaces(stripLeadBullets(stripEmojis(line)));
  // trim punctuation that often trails after copying from captions ("Add salt.")
  const withoutTrail = stripped.replace(/[.,!?;:]+$/g, "").trim();
  return withoutTrail;
}
function cleanStepLine(line: string): string {
  return tidySpaces(stripTrailHashtags(stripLeadBullets(stripLeadNumbers(stripEmojis(line)))));
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
  "Make","Fill","Assemble" // ✅ add here too for splitting help
];
const cueRegex = new RegExp(
  String.raw`(?<=\.)\s+(?=(?:${COOKING_CUES.join("|")})\b)|\s+(?=(?:${COOKING_CUES.join("|")})\b)`,
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
  s = s.replace(/(\b\d+)\s+([¼½¾⅓⅔⅛⅜⅝⅞]\b)/g, `$1${MIXED_NUMBER_MARK}$2`);
  return s;
}
function restoreMixedNumbers(s: string): string {
  return s.replace(new RegExp(MIXED_NUMBER_MARK, "g"), " ");
}
const INTERNAL_QTY_SPLIT = new RegExp(String.raw`\s+(?=(?:\d+\s*(?:\/\s*\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(?:[a-zA-Z(]|$))`, "g");
const AND_QTY_SPLIT = /\s+(?=(?:and|&)\s+\d)/i;
const PUNCT_THEN_CAP_SPLIT = /\s*[,;]\s+(?=[A-Z])/;
const CONTINUATION_PREP = /^(?:and\s+)?(?:peeled|deveined|seeded|pitted|minced|chopped|diced|sliced|shredded|rinsed|drained|cored|crushed)\b/i;
const ALT_ING_SPLIT = new RegExp(
  String.raw`[,;]\s+(?=(?:` +
  `${QTY_START.source}|\\d+\\s*\\/\\s*\\d+|[¼½¾⅓⅔⅛⅜⅝⅞]|` +
  `(?:Sea|Kosher|Table)\\s+salt|Black\\s+pepper|White\\s+pepper|Red\\s+pepper\\s+flakes|Olive\\s+oil|Vegetable\\s+oil|Cooking\\s+spray|` +
  `(?:and|&)\\s+\\d` + `))`, "i"
);

function extractContinuationPrefix(line: string): { prefix: string; rest: string } {
  const m = line.match(CONTINUATION_PREP);
  if (!m) return { prefix: "", rest: line };
  return { prefix: m[0].replace(/^(?:and|&)\s+/i, "").trim(), rest: line.slice(m[0].length).trim() };
}

function splitRunOnIngredients(line: string): string[] {
  const protectedLine = protectMixedNumbers(line);
  let parts: string[] = [protectedLine];
  parts = parts.flatMap(p => p.split(ALT_ING_SPLIT)).map(s => s.trim()).filter(Boolean);
  parts = parts.flatMap(p => p.split(AND_QTY_SPLIT)).map(s => s.trim()).filter(Boolean);
  parts = parts.flatMap(p => p.split(INTERNAL_QTY_SPLIT)).map(s => s.trim()).filter(Boolean);
  parts = parts.flatMap(p => p.split(PUNCT_THEN_CAP_SPLIT)).map(s => s.trim()).filter(Boolean);
  return parts.map(restoreMixedNumbers);
}

// ---------- early glue of bare numbers with next line (ingredients area) ----------
const BARE_WHOLE = /^\s*\d+\s*$/;
const BARE_QTY = new RegExp(`^\\s*(?:${QTY_START.source})\\s*$`);
function mergeOrphanQuantityLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = (lines[i] ?? "").trim();
    const next = (lines[i + 1] ?? "").trim();
    if (cur && (BARE_WHOLE.test(cur) || BARE_QTY.test(cur)) && next) {
      out.push(tidySpaces(`${cur} ${next}`)); i++; continue;
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
    if (cur && /^\d+$/.test(cur) && next) {
      out.push(tidySpaces(`${cur} ${next}`));
      i++; // skip the next one because we merged it
    } else {
      out.push(items[i]);
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
    //    & # 8203 ;  or &#8203;  → remove
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
// 🏷️ meta lines: "Servings: 4", "Prep Time: 10 minutes", "4 croissants" (no period)
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

// ✅ verb-anywhere detector so we keep instruction lines even if they don't start with a number/bullet
const COOKING_VERBS = [
  "preheat","heat","melt","whisk","stir","mix","combine","bring","simmer","boil","reduce",
  "add","fold","pour","spread","sprinkle","season","coat","cook","bake","fry","air\\s*fry",
  "remove","transfer","let\\s+sit","rest","chill","refrigerate","cool","cut","slice","serve",
  "garnish","line","mince","dice","chop","peel","seed","core","marinate","prepare","beat",
  "blend","pulse","knead","roll","press","grease","butter","measure","rinse","drain","pat\\s+dry",
  "toast","grate","zest","steam","microwave","warm",
  // ✅ NEW verbs so we keep these lines as steps:
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

  // glue "1" + newline + "½/1/2"
  ingBlob = glueSplitMixedNumbersAcrossNewlines(ingBlob);

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

  // ✅ sanitizer bath (fixes headers, /2 → 1/2, bullets/dashes, etc.)
  const sanitizedPieces = sanitizeAndSplitIngredientCandidates(ingLinesRaw);
  const hadGuesses = sanitizedPieces.some(p => p.lowConfidence);
  const ingLinesPrepped = sanitizedPieces
    .filter(p => !p.maybeHeader) // drop "For the Ganache:"-style headers
    .map(p => p.text);

  // build ingredients from cleaned lines
  const ingredientCandidates = ingLinesPrepped.filter(looksLikeIngredient);
  const ingredientsBuilt: string[] = [];
  for (let cand of ingredientCandidates) {
    cand = cleanIngredientLine(cand);
    const { prefix, rest } = extractContinuationPrefix(cand);
    if (prefix && ingredientsBuilt.length) {
      ingredientsBuilt[ingredientsBuilt.length - 1] =
        ingredientsBuilt[ingredientsBuilt.length - 1].replace(/\s*,?\s*$/, "") + ", " + prefix;
      if (!rest) continue;
      cand = rest;
    }
    for (const p of splitRunOnIngredients(cand)) {
      const t = tidySpaces(p); if (t) ingredientsBuilt.push(t);
    }
  }
  // unique + final orphan-number glue
  let ingredients = finalFixOrphanNumberIngredients(uniqueNonEmpty(ingredientsBuilt)).slice(0, 60);

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

  // Final tidy for steps
  if (steps.length >= 2) steps = mergeOrphanPanSizeSteps(steps);
  steps = uniqueNonEmpty(steps).slice(0, 60);

  // ---------- confidence dial (simple rules + nudge if we guessed) ----------
  let confidence: "low" | "medium" | "high" = "low";
  if (ingredients.length >= 5 && steps.length >= 3) confidence = "high";
  else if (ingredients.length >= 3 || steps.length >= 2) confidence = "medium";
  if (hadGuesses && confidence === "high") confidence = "medium"; // nudge down if sanitizer had to guess

  const dbg = `len:${raw.length} iIng:${iIng} iStep:${iStep} ing:${ingredients.length} steps:${steps.length} guessed:${hadGuesses}`;
  return { ingredients, steps, confidence, debug: dbg };
}


// ─────────────────────────────────────────────────────────────
// Quantity normalizers (handle 1½, 1 1/2lb → 1 1/2 lb, etc.)
// ─────────────────────────────────────────────────────────────
function normalizeUnicodeFractions(s: string): string {
  // Map common unicode fractions to ascii
  return s.replace(/¼/g, " 1/4")
          .replace(/½/g, " 1/2")
          .replace(/¾/g, " 3/4");
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
function dropJunkIngredientLines(lines: string[]): string[] {
  return (lines || []).filter((l) => !/^\s*\d[\d,.\s]*\s+(likes?|comments?)\b/i.test(l || ""));
}
