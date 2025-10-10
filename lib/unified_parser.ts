// lib/unified_parser.ts
//
// 🧒 like I'm 5:
// - We find Ingredients and Steps.
// - We clean silly stuff (emojis, bullets, numbers, hashtags).
// - We fix a wrap bug: "8x" on one line + "inch ..." on next line -> glued together.
// - NEW: If one step is a big long paragraph, we split it into little steps
//        at sentence breaks and cooking words (Melt, Bring, Pour, Sprinkle, etc).

export type ParseResult = {
  ingredients: string[];
  steps: string[];
  confidence: "low" | "medium" | "high";
  debug?: string;
};

// ---------- tiny helpers (just cleaning gunk) ----------
const NBSP_RE = /\u00A0/g;     // non-breaking space
const MULT_SIGN_RE = /\u00D7/g; // “×” -> "x"
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

const LEAD_BULLET_RE = /^\s*(?:[•\-*]\s+)+/;     // • - *
const LEAD_NUM_RE = /^\s*\d{1,2}[.)]\s+/;        // "1. " or "2) "
const TRAIL_HASHTAGS_RE = /\s*(?:#[\p{L}\p{N}_-]+(?:\s+#[\p{L}\p{N}_-]+)*)\s*$/u;

function softClean(s: string): string {
  return (s || "")
    .replace(NBSP_RE, " ")
    .replace(MULT_SIGN_RE, "x") // 9×13 -> 9x13
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

// ---------- fix split pan sizes like "8x\ninch" (glue lines) ----------
function fixWrappedPanSizes(text: string): string {
  const lines = text.split("\n");
  const fixed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i] ?? "";
    const next = lines[i + 1] ?? "";

    const endsWithLooseX = /\b\d+\s*x\s*$/i.test(cur);
    const nextLooksLikeDimension =
      /^(?:[-–—]?\s*)?(?:inch|in\.)\b/i.test(next) || /^\s*\d+\s*x\s*\d+/i.test(next);

    if (endsWithLooseX && nextLooksLikeDimension) {
      fixed.push(cur.replace(/\s*$/, "") + " " + next.replace(/^\s*/, ""));
      i += 1;
      continue;
    }
    fixed.push(cur);
  }
  return fixed.join("\n");
}

// ---------- find sections (Ingredients / Steps headers) ----------
const ING_RE = /\b(ingredients?|what you need|you(?:'|’)ll need)\b[:\-–—]?\s*/i;
const STEP_HDR_RE = /\b(instructions?|directions?|steps?|method)\b[:\-–—]?\s*/i;

function splitSections(raw: string) {
  const lower = raw.toLowerCase();
  const iIng = lower.search(ING_RE);
  const iStep = lower.search(STEP_HDR_RE);

  let before = raw, ingPart = "", stepPart = "";
  if (iIng >= 0) ingPart = raw.slice(iIng);
  if (iStep >= 0) stepPart = raw.slice(iStep);

  const firstHdr = Math.min(...[iIng, iStep].filter(n => n >= 0));
  if (isFinite(firstHdr)) before = raw.slice(0, firstHdr);

  return { before, ingPart, stepPart, iIng, iStep };
}

// ---------- normalize step area (turn inline "1. 2.)" into new lines) ----------
const INLINE_NUM = /(\s)(\d{1,2}[.)]\s+)/g;
const INLINE_BULLET = /(\s)([-*•]\s+)/g;
function normalizeStepArea(s: string): string {
  if (!s) return "";
  s = s.replace(INLINE_NUM, "\n$2");
  s = s.replace(INLINE_BULLET, "\n$2");
  s = s.replace(/\n{2,}/g, "\n");
  return s.trim();
}

// ---------- line looks-like rules ----------
const UNIT_WORD = /(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|ml|l|g|gram|kg|lb|pound|stick|clove|cloves|pinch|dash)\b/i;
const FRACTIONS = /[¼½¾⅓⅔⅛⅜⅝⅞]/;

function looksLikeIngredient(line: string): boolean {
  const t = line.trim(); if (!t) return false;
  const qty = /^(\d+(\s*[-–]\s*\d+)?|\d+\s*\/\s*\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\b/.test(t);
  return qty || UNIT_WORD.test(t) || FRACTIONS.test(t);
}
function looksLikeStep(line: string): boolean {
  const t = line.trim(); if (!t) return false;
  if (/^\d{1,2}[.)]\s+/.test(t)) return true;
  if (/^\s*[-*•]\s+/.test(t)) return true;
  if (/\.\s*$/.test(t)) return true;
  if (/^(cut|slice|dice|mix|stir|whisk|combine|add|bake|fry|air\s*fry|preheat|heat|cook|season|coat|marinate|pour|fold|serve|flip|shake|toss|garnish|line|melt|bring|remove|sprinkle|spread|chill|cut)\b/i.test(t)) return true;
  return true; // be generous: anything in steps area can be a step seed
}

// ---------- clean lines for UI ----------
function cleanIngredientLine(line: string): string {
  return tidySpaces(stripLeadBullets(stripEmojis(line)));
}
function cleanStepLine(line: string): string {
  const stripped = stripTrailHashtags(stripLeadBullets(stripLeadNumbers(stripEmojis(line))));
  return tidySpaces(stripped);
}

// ---------- merge orphan "8x" + "inch ..." after splitting ----------
function mergeOrphanPanSizeSteps(steps: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < steps.length) {
    const cur = steps[i];
    const next = steps[i + 1] ?? "";

    const endsWithLooseX = /\b\d+\s*x$/i.test(cur);
    const nextStartsWithInchOrDim = /^(?:inch|in\.)\b/i.test(next) || /^\d+\s*x\s*\d+/i.test(next);

    if (endsWithLooseX && nextStartsWithInchOrDim) {
      out.push((cur + " " + next).trim());
      i += 2;
    } else {
      out.push(cur);
      i += 1;
    }
  }
  return out;
}

// ---------- NEW: explode long paragraphs into mini steps ----------
/**
 * 👶 what this does:
 * If a step is a big wall of text, we slice it into smaller steps using:
 *  - sentence ends: a period followed by a capital letter
 *  - cooking cue words: Melt, Bring, Remove, Pour, Sprinkle, Spread, Let sit, Chill, Cut, etc.
 */
const COOKING_CUES = [
  "Preheat","Heat","Melt","Whisk","Stir","Mix","Combine","Bring","Simmer","Boil","Reduce",
  "Add","Fold","Pour","Spread","Sprinkle","Season","Coat","Cook","Bake","Fry","Air fry",
  "Remove","Transfer","Let sit","Rest","Chill","Refrigerate","Cool","Cut","Slice","Serve","Garnish","Line"
];

const cueRegex = new RegExp(
  // split if we see a period and then a cue word, or a start-of-line cue (capital/lower)
  String.raw`(?<=\.)\s+(?=(?:${COOKING_CUES.join("|")})\b)|\s+(?=(?:${COOKING_CUES.join("|")})\b)`,
  "g"
);

function explodeCompoundSteps(steps: string[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    // skip tiny lines
    const base = s.trim();
    if (!base) continue;

    // First split on clear sentence ends (". " + Capital)
    let parts = base.split(/(?<=\.)\s+(?=[A-Z])/g);

    // For each sentence, also split on cooking cues inside
    const finer: string[] = [];
    for (const p of parts) {
      const trimmed = p.trim();
      if (!trimmed) continue;

      // if still long and has multiple cues, break it more
      if (trimmed.length > 140 || COOKING_CUES.some(c => new RegExp(`\\b${c}\\b`, "i").test(trimmed))) {
        const sub = trimmed.split(cueRegex).map(x => x.trim()).filter(Boolean);
        finer.push(...sub);
      } else {
        finer.push(trimmed);
      }
    }

    // push cleaned chunks
    for (const f of finer) {
      // don’t leave trailing periods-only chunks
      const cleaned = f.replace(/^\d+[.)]\s*/, "").trim();
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

// ---------- main function ----------
export function parseRecipeText(input: string): ParseResult {
  if (!input) return { ingredients: [], steps: [], confidence: "low", debug: "empty" };

  // clean + early noise trim
  let raw = softClean(input);
  raw = stripTailNoise(raw);

  // glue "8x" + "inch" wraps
  raw = fixWrappedPanSizes(raw);

  // split by sections
  const { ingPart, stepPart, iIng, iStep } = splitSections(raw);

  // ingredients blob (fallback to whole text if no header)
  let ingBlob = iIng >= 0 ? stripTailNoise(ingPart.replace(ING_RE, "")) : raw;

  // steps blob
  let stepBlob = iStep >= 0 ? stripTailNoise(stepPart.replace(STEP_HDR_RE, "")) : "";

  // normalize only the steps area
  stepBlob = normalizeStepArea(stepBlob);

  // lines
  const ingLinesRaw = ingBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const stepLinesRaw = stepBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);

  // classify + clean
  const ingredients = uniqueNonEmpty(
    ingLinesRaw.filter(looksLikeIngredient).map(cleanIngredientLine)
  ).slice(0, 60);

  let steps = uniqueNonEmpty(
    stepLinesRaw.filter(looksLikeStep).map(cleanStepLine)
  );

  // merge 8x + inch orphans
  if (steps.length >= 2) steps = mergeOrphanPanSizeSteps(steps);

  // 🌟 NEW: break big paragraphs into mini steps
  if (steps.length) steps = explodeCompoundSteps(steps);

  // fallback if we somehow got nothing
  if (!steps.length) {
    const tail = normalizeStepArea(raw.slice(Math.floor(raw.length * 0.4)));
    const tailLines = tail.split(/\n+/).map(s => s.trim()).filter(Boolean);
    steps = uniqueNonEmpty(tailLines.filter(looksLikeStep).map(cleanStepLine));
    if (steps.length >= 2) {
      steps = mergeOrphanPanSizeSteps(steps);
      steps = explodeCompoundSteps(steps);
    }
  }

  // confidence feel
  let confidence: "low" | "medium" | "high" = "low";
  if (ingredients.length >= 5 && steps.length >= 3) confidence = "high";
  else if (ingredients.length >= 3 || steps.length >= 2) confidence = "medium";

  const dbg = `len:${raw.length} iHdr:${iIng} sHdr:${iStep} ing:${ingredients.length} steps:${steps.length}`;

  return { ingredients, steps, confidence, debug: dbg };
}
