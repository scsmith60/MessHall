// lib/unified_parser.ts
//
// 🧒 what this file does (like I'm 5)
// 1) We split the big caption into Ingredients and Instructions.
// 2) We make tiny cleanups so things look nice:
//    - Ingredients: remove emojis (🍗🧂), bullets (• - *), tidy spaces.
//    - Steps: remove leading numbers (1. 2) 3.), bullets, and chop off hashtag tails.
//    - We also break inline "1. 2) 3." into new lines (steps) so each becomes one row.
// 3) We return { ingredients[], steps[], confidence, debug }.
//
// NOTE: This keeps your working logic. We only added gentle cleanup helpers.

export type ParseResult = {
  ingredients: string[];
  steps: string[];
  confidence: "low" | "medium" | "high";
  debug?: string;
};

// ---------- helpers ----------

// non-breaking spaces that sneak in
const NBSP_RE = /\u00A0/g;

// "emoji" range (kept friendly: remove food/face/etc. from output lines)
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

// bullets we want to trim from the start of a line
const LEAD_BULLET_RE = /^\s*(?:[•\-*]\s+)+/;

// step numbers like "1.", "2)", "10." at the beginning of a line
const LEAD_NUM_RE = /^\s*\d{1,2}[.)]\s+/;

// simple hashtag tail at end of a line: " ... #tag #tag2"
const TRAIL_HASHTAGS_RE = /\s*(?:#[\p{L}\p{N}_-]+(?:\s+#[\p{L}\p{N}_-]+)*)\s*$/u;

function softClean(s: string): string {
  return (s || "")
    .replace(NBSP_RE, " ")
    .replace(/\r/g, "\n")
    .trim();
}

// removes emoji anywhere in a line (ingredients look cleaner)
function stripEmojis(s: string): string {
  return s.replace(EMOJI_RE, "");
}

// removes bullets at the start: "• ½ cup..."  -> "½ cup..."
function stripLeadBullets(s: string): string {
  return s.replace(LEAD_BULLET_RE, "");
}

// removes leading numbers: "1. Mix …" or "2) Stir …" -> "Mix …"
function stripLeadNumbers(s: string): string {
  return s.replace(LEAD_NUM_RE, "");
}

// removes trailing hashtags: "Serve hot! #yum #dinner" -> "Serve hot!"
function stripTrailHashtags(s: string): string {
  return s.replace(TRAIL_HASHTAGS_RE, "");
}

// final tidy: collapse spaces
function tidySpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// chop off when hashtags or "less" sections begin (caption tail)
function stripTailNoise(s: string): string {
  const m = s.match(/(\n\s*#|\n\s*less\b)/i);
  return m ? s.slice(0, m.index) : s;
}

function uniqueNonEmpty(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const t = x.trim();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

// ---------- section detection ----------
const ING_RE = /\b(ingredients?|what you need|you(?:'|’)ll need)\b[:\-–—]?\s*/i;
const STEP_HDR_RE = /\b(instructions?|directions?|steps?|method)\b[:\-–—]?\s*/i;

function splitSections(raw: string) {
  const lower = raw.toLowerCase();
  const iIng = lower.search(ING_RE);
  const iStep = lower.search(STEP_HDR_RE);

  let before = raw;
  let ingPart = "";
  let stepPart = "";

  if (iIng >= 0) ingPart = raw.slice(iIng);
  if (iStep >= 0) stepPart = raw.slice(iStep);

  const firstHdr = Math.min(...[iIng, iStep].filter(n => n >= 0));
  if (isFinite(firstHdr)) before = raw.slice(0, firstHdr);

  return { before, ingPart, stepPart, iIng, iStep };
}

// ---------- inline numbered steps → new lines (only in step part) ----------
const INLINE_NUM = /(\s)(\d{1,2}[.)]\s+)/g;
const INLINE_BULLET = /(\s)([-*•]\s+)/g;

function normalizeStepArea(s: string): string {
  if (!s) return "";
  // add a newline before each inline number/bullet
  s = s.replace(INLINE_NUM, "\n$2");
  s = s.replace(INLINE_BULLET, "\n$2");
  // collapse extra newlines
  s = s.replace(/\n{2,}/g, "\n");
  return s.trim();
}

// ---------- line classifiers (unchanged, but friendly) ----------
const UNIT_WORD = /(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|ml|l|g|gram|kg|lb|pound|stick|clove|cloves|pinch|dash)\b/i;
const FRACTIONS = /[¼½¾⅓⅔⅛⅜⅝⅞]/;

function looksLikeIngredient(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // quantities: "1", "1/2", "½", "2-3", "1–2"
  const qty = /^(\d+(\s*[-–]\s*\d+)?|\d+\s*\/\s*\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\b/.test(t);
  return qty || UNIT_WORD.test(t) || FRACTIONS.test(t);
}

function looksLikeStep(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^\d{1,2}[.)]\s+/.test(t)) return true;
  if (/^\s*[-*•]\s+/.test(t)) return true;
  if (/\.\s*$/.test(t)) return true;
  // common cooking verbs
  if (/^(cut|slice|dice|mix|stir|whisk|combine|add|bake|fry|air\s*fry|preheat|heat|cook|season|coat|marinate|pour|fold|serve|flip|shake|toss|garnish)\b/i.test(t)) return true;
  return false;
}

// ---------- per-line cleanup for UI ----------

// Ingredients: remove emojis + bullets; tidy spaces.
function cleanIngredientLine(line: string): string {
  return tidySpaces(stripLeadBullets(stripEmojis(line)));
}

// Steps: remove numeric index + bullets + trailing hashtags + emojis; tidy spaces.
function cleanStepLine(line: string): string {
  const stripped = stripTrailHashtags(
    stripLeadBullets(
      stripLeadNumbers(
        stripEmojis(line)
      )
    )
  );
  return tidySpaces(stripped);
}

// ---------- main parse ----------
export function parseRecipeText(input: string): ParseResult {
  if (!input) return { ingredients: [], steps: [], confidence: "low", debug: "empty" };

  // light clean
  let raw = softClean(input);

  // stop early noise (#hashtags tail)
  raw = stripTailNoise(raw);

  // split into sections by headers
  const { ingPart, stepPart, iIng, iStep } = splitSections(raw);

  // INGRIDIENTS
  let ingBlob = "";
  if (iIng >= 0) ingBlob = stripTailNoise(ingPart.replace(ING_RE, ""));
  else ingBlob = raw; // heuristic fallback

  // STEPS
  let stepBlob = "";
  if (iStep >= 0) stepBlob = stripTailNoise(stepPart.replace(STEP_HDR_RE, ""));

  // IMPORTANT: normalize ONLY the step area
  stepBlob = normalizeStepArea(stepBlob);

  // break into lines
  const ingLinesRaw = ingBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const stepLinesRaw = stepBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);

  // classify
  const ingredients = uniqueNonEmpty(
    ingLinesRaw.filter(looksLikeIngredient).map(cleanIngredientLine)
  ).slice(0, 60);

  let steps = uniqueNonEmpty(
    stepLinesRaw.filter(looksLikeStep).map(cleanStepLine)
  );

  // fallback: try latter half if we somehow missed step header
  if (!steps.length) {
    const tail = normalizeStepArea(raw.slice(Math.floor(raw.length * 0.4)));
    const tailLines = tail.split(/\n+/).map(s => s.trim()).filter(Boolean);
    steps = uniqueNonEmpty(tailLines.filter(looksLikeStep).map(cleanStepLine));
  }

  // confidence heuristic
  let confidence: "low" | "medium" | "high" = "low";
  if (ingredients.length >= 5 && steps.length >= 3) confidence = "high";
  else if (ingredients.length >= 3 || steps.length >= 2) confidence = "medium";

  const dbg = `len:${raw.length} iHdr:${iIng} sHdr:${iStep} ing:${ingredients.length} steps:${steps.length}`;

  return { ingredients, steps, confidence, debug: dbg };
}
