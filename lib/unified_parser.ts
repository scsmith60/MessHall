// lib/unified_parser.ts
//
// 🧒 super simple:
// - Find Ingredients and Instructions.
// - Clean messy bits.
// - Fix "8x" + "inch" line wrap.
// - Keep mixed numbers together (1 1/2, 1 ½), even if split across lines.
// - If a line is ONLY a number (like "1"), glue it to the next line (early AND at the very end).
// - Split run-on ingredient lines; attach “and deveined” to previous.
// - Split long instruction paragraphs into short steps.

export type ParseResult = {
  ingredients: string[];
  steps: string[];
  confidence: "low" | "medium" | "high";
  debug?: string;
};

// ---------- tiny cleaners ----------
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

function stripTailNoise(s: string): string {
  const m = s.match(/(\n\s*#|\n\s*less\b)/i);
  return m ? s.slice(0, m.index) : s;
}
function uniqueNonEmpty(arr: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of arr) { const t = x.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return out;
}

// ---------- fix "8x" + "inch" wraps ----------
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

// ---------- section slicer ----------
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

// ---------- step normalization ----------
const INLINE_NUM = /(\s)(\d{1,2}[.)]\s+)/g;
const INLINE_BULLET = /(\s)([-*•]\s+)/g;
function normalizeStepArea(s: string): string {
  if (!s) return "";
  return s.replace(INLINE_NUM, "\n$2").replace(INLINE_BULLET, "\n$2").replace(/\n{2,}/g, "\n").trim();
}

// ---------- glue mixed numbers split across lines ----------
function glueSplitMixedNumbersAcrossNewlines(text: string): string {
  if (!text) return text;
  // "1" newline "1/2"
  text = text.replace(/(\b\d+)\s*[\r\n]+\s*(?:[-*•]\s*)?(\d+\s*\/\s*\d+)/gm, (_m, w, f) => `${w} ${f}`);
  // "1" newline "½"
  text = text.replace(/(\b\d+)\s*[\r\n]+\s*(?:[-*•]\s*)?([¼½¾⅓⅔⅛⅜⅝⅞])/gm, (_m, w, f) => `${w} ${f}`);
  return text;
}

// ---------- detectors ----------
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
  if (/^(preheat|heat|melt|whisk|stir|mix|combine|bring|simmer|boil|reduce|add|fold|pour|spread|sprinkle|season|coat|cook|bake|fry|air\s*fry|remove|transfer|let\s+sit|rest|chill|refrigerate|cool|cut|slice|serve|garnish|line|mince|dice|chop|peel|seed|core|marinate|prepare|mix the)\b/i.test(t)) return true;
  if (/\.\s*$/.test(t) && /\b(preheat|heat|melt|whisk|stir|mix|combine|bring|pour|spread|sprinkle|season|bake|cook|chill|cut|slice|serve|garnish|marinate|prepare)\b/i.test(t)) return true;
  return false;
}

// ---------- UI cleaners ----------
function cleanIngredientLine(line: string): string {
  return tidySpaces(stripLeadBullets(stripEmojis(line)));
}
function cleanStepLine(line: string): string {
  return tidySpaces(stripTrailHashtags(stripLeadBullets(stripLeadNumbers(stripEmojis(line)))));
}

// ---------- merge orphan "8x" + "inch" in steps ----------
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

// ---------- step exploding ----------
const COOKING_CUES = [
  "Preheat","Heat","Melt","Whisk","Stir","Mix","Combine","Bring","Simmer","Boil","Reduce",
  "Add","Fold","Pour","Spread","Sprinkle","Season","Coat","Cook","Bake","Fry","Air fry",
  "Remove","Transfer","Let sit","Rest","Chill","Refrigerate","Cool","Cut","Slice","Serve",
  "Garnish","Line","Mince","Dice","Chop","Peel","Seed","Core","Marinate","Prepare","Mix the"
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

// ---------- early glue of bare numbers with next line ----------
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

// ---------- FINAL safety glue on the finished ingredient list ----------
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

// ---------- MAIN ----------
export function parseRecipeText(input: string): ParseResult {
  if (!input) return { ingredients: [], steps: [], confidence: "low", debug: "empty" };

  let raw = softClean(input);
  raw = stripTailNoise(raw);
  raw = fixWrappedPanSizes(raw);

  let { ingBlob, stepBlob, iIng, iStep } = sliceSectionsSmart(raw);

  // glue "1" + newline + "½/1/2"
  ingBlob = glueSplitMixedNumbersAcrossNewlines(ingBlob);

  stepBlob = normalizeStepArea(stepBlob);

  // ingredients lines (handle single-paragraph alt)
  let ingLinesRaw: string[];
  if (/\bingredients?\b/i.test(raw) && !/\n/.test(ingBlob) && /,/.test(ingBlob)) {
    ingLinesRaw = ingBlob.split(ALT_ING_SPLIT).map(s => s.trim()).filter(Boolean);
  } else {
    ingLinesRaw = ingBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }

  // early glue
  ingLinesRaw = mergeOrphanQuantityLines(ingLinesRaw);

  // steps raw lines
  let stepLinesRaw = stepBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);

  // build ingredients
  const ingredientCandidates = ingLinesRaw.filter(looksLikeIngredient);
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
  // UNIQUE, then FINAL safety glue (this is the new belt-and-suspenders fix)
  let ingredients = finalFixOrphanNumberIngredients(uniqueNonEmpty(ingredientsBuilt)).slice(0, 60);

  // build steps
  let steps = uniqueNonEmpty(stepLinesRaw.filter(looksLikeStep).map(cleanStepLine));
  if (steps.length >= 2) steps = mergeOrphanPanSizeSteps(steps);
  if (!steps.length && stepBlob) steps = explodeCompoundSteps([stepBlob]);
  if (!steps.length) {
    const tail = normalizeStepArea(raw.slice(Math.floor(raw.length * 0.4)));
    const tailLines = tail.split(/\n+/).map(s => s.trim()).filter(Boolean);
    steps = uniqueNonEmpty(tailLines.filter(looksLikeStep).map(cleanStepLine));
    if (!steps.length && tail) steps = explodeCompoundSteps([tail]);
  }

  let confidence: "low" | "medium" | "high" = "low";
  if (ingredients.length >= 5 && steps.length >= 3) confidence = "high";
  else if (ingredients.length >= 3 || steps.length >= 2) confidence = "medium";

  const dbg = `len:${raw.length} iIng:${iIng} iStep:${iStep} ing:${ingredients.length} steps:${steps.length}`;
  return { ingredients, steps, confidence, debug: dbg };
}
