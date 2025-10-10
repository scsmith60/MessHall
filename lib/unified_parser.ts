// lib/unified_parser.ts
//
// 🧒 like I'm 5:
// We read a big recipe caption.
// We find Ingredients and Steps.
// We clean up messy stuff (emojis, bullets, numbers, hashtags).
// We fix lines that break like "8x" on one line and "inch" on the next.
// We break giant step paragraphs into many tiny steps.
// We split run-on ingredient lines (like "... toffee bits Sea salt flakes ...").
// We use a STRICT step detector so ingredients don’t “disappear”.

export type ParseResult = {
  ingredients: string[];
  steps: string[];
  confidence: "low" | "medium" | "high";
  debug?: string;
};

// ---------------------------------------
// little cleaners (take out gunk)
// ---------------------------------------
const NBSP_RE = /\u00A0/g;      // non-breaking space
const MULT_SIGN_RE = /\u00D7/g; // “×” -> "x"
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

const LEAD_BULLET_RE = /^\s*(?:[•\-*]\s+)+/; // bullets at start: • - *
const LEAD_NUM_RE = /^\s*\d{1,2}[.)]\s+/;    // "1. " or "2) "
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

// chop off tail noise like hashtag blobs or "... less" folds
function stripTailNoise(s: string): string {
  const m = s.match(/(\n\s*#|\n\s*less\b)/i);
  return m ? s.slice(0, m.index) : s;
}
function uniqueNonEmpty(arr: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of arr) { const t = x.trim(); if (t && !seen.has(t)) { seen.add(t); out.push(t); } }
  return out;
}

// ---------------------------------------
// fix split pan sizes: "8x\ninch" -> "8x inch"
// ---------------------------------------
function fixWrappedPanSizes(text: string): string {
  const lines = text.split("\n");
  const fixed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i] ?? "";
    const next = lines[i + 1] ?? "";

    // does current end with "... 8x" (allow spaces)
    const endsWithLooseX = /\b\d+\s*x\s*$/i.test(cur);
    // does next start like "inch"/"in." or "9x13"
    const nextLooksLikeDimension =
      /^(?:[-–—]?\s*)?(?:inch|in\.)\b/i.test(next) || /^\s*\d+\s*x\s*\d+/i.test(next);

    if (endsWithLooseX && nextLooksLikeDimension) {
      fixed.push(cur.replace(/\s*$/, "") + " " + next.replace(/^\s*/, ""));
      i += 1; // skip the next line (we glued it)
      continue;
    }
    fixed.push(cur);
  }
  return fixed.join("\n");
}

// ---------------------------------------
// section headers
// ---------------------------------------
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

// ---------------------------------------
// normalize step area (turn inline "1. 2." and bullets into new lines)
// ---------------------------------------
const INLINE_NUM = /(\s)(\d{1,2}[.)]\s+)/g;
const INLINE_BULLET = /(\s)([-*•]\s+)/g;
function normalizeStepArea(s: string): string {
  if (!s) return "";
  s = s.replace(INLINE_NUM, "\n$2");
  s = s.replace(INLINE_BULLET, "\n$2");
  s = s.replace(/\n{2,}/g, "\n");
  return s.trim();
}

// ---------------------------------------
// looks-like rules for ingredients vs steps
// ---------------------------------------
const UNIT_WORD = /(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|ml|l|g|gram|kg|lb|pound|stick|clove|cloves|pinch|dash)\b/i;
const FRACTIONS = /[¼½¾⅓⅔⅛⅜⅝⅞]/;

// quantity pattern that does NOT match step numbers like "1." or "2)"
//  - start number
//  - NOT followed by "." or ")"
//  - optional range like " - 2"
const QTY_START = /\d+(?![.)])(?:\s*[-–]\s*\d+)?/;

// helper used by the step detector to avoid stealing ingredients
function looksLikeIngredientShape(t: string): boolean {
  return (
    new RegExp(`^(${QTY_START.source}|\\d+\\s*\\/\\s*\\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\\b`).test(t) ||
    UNIT_WORD.test(t) ||
    FRACTIONS.test(t)
  );
}

function looksLikeIngredient(line: string): boolean {
  const t = line.trim(); if (!t) return false;

  // if it starts like a numbered step, it's not an ingredient
  if (LEAD_NUM_RE.test(t)) return false;

  // quantities: "1", "1/2", "½", "2-3", "1–2"
  const qty =
    new RegExp(`^(${QTY_START.source}|\\d+\\s*\\/\\s*\\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\\b`).test(t);

  return qty || UNIT_WORD.test(t) || FRACTIONS.test(t);
}

// STRICT step detector (won't steal ingredients)
function looksLikeStep(line: string): boolean {
  const t = line.trim();
  if (!t) return false;

  // numbered/bulleted lines are steps
  if (/^\d{1,2}[.)]\s+/.test(t)) return true;
  if (/^\s*[-*•]\s+/.test(t)) return true;

  // if it smells like an ingredient (qty/unit/fraction), do NOT call it a step
  if (looksLikeIngredientShape(t)) return false;

  // cue verbs at the start
  if (/^(preheat|heat|melt|whisk|stir|mix|combine|bring|simmer|boil|reduce|add|fold|pour|spread|sprinkle|season|coat|cook|bake|fry|air\s*fry|remove|transfer|let\s+sit|rest|chill|refrigerate|cool|cut|slice|serve|garnish|line)\b/i.test(t))
    return true;

  // sentence ends with period and contains a cooking verb → step
  if (/\.\s*$/.test(t) && /\b(preheat|heat|melt|whisk|stir|mix|combine|bring|pour|spread|sprinkle|season|bake|cook|chill|cut|slice|serve|garnish)\b/i.test(t))
    return true;

  // default: not a step
  return false;
}

// ---------------------------------------
// cleaning for final UI
// ---------------------------------------
function cleanIngredientLine(line: string): string {
  return tidySpaces(stripLeadBullets(stripEmojis(line)));
}
function cleanStepLine(line: string): string {
  const stripped = stripTrailHashtags(stripLeadBullets(stripLeadNumbers(stripEmojis(line))));
  return tidySpaces(stripped);
}

// ---------------------------------------
// merge orphan "8x" + "inch ..." after splitting
// ---------------------------------------
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

// ---------------------------------------
// explode long paragraphs into mini steps
// ---------------------------------------
const COOKING_CUES = [
  "Preheat","Heat","Melt","Whisk","Stir","Mix","Combine","Bring","Simmer","Boil","Reduce",
  "Add","Fold","Pour","Spread","Sprinkle","Season","Coat","Cook","Bake","Fry","Air fry",
  "Remove","Transfer","Let sit","Rest","Chill","Refrigerate","Cool","Cut","Slice","Serve","Garnish","Line"
];

const cueRegex = new RegExp(
  // split if we see a period and then a cue word, or a cue word starting a new clause
  String.raw`(?<=\.)\s+(?=(?:${COOKING_CUES.join("|")})\b)|\s+(?=(?:${COOKING_CUES.join("|")})\b)`,
  "g"
);

function explodeCompoundSteps(steps: string[]): string[] {
  const out: string[] = [];
  for (const s of steps) {
    const base = s.trim();
    if (!base) continue;

    // 1) split on ". " + Capital
    let parts = base.split(/(?<=\.)\s+(?=[A-Z])/g);

    // 2) then split inside on cooking cues
    const finer: string[] = [];
    for (const p of parts) {
      const trimmed = p.trim();
      if (!trimmed) continue;

      if (trimmed.length > 140 || COOKING_CUES.some(c => new RegExp(`\\b${c}\\b`, "i").test(trimmed))) {
        const sub = trimmed.split(cueRegex).map(x => x.trim()).filter(Boolean);
        finer.push(...sub);
      } else {
        finer.push(trimmed);
      }
    }

    for (const f of finer) {
      const cleaned = f.replace(/^\d+[.)]\s*/, "").trim();
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

// ---------------------------------------
// split run-on ingredient lines (Sea salt, Black pepper, oils, and/&)
// ---------------------------------------
const RUNON_SPLITERS: RegExp[] = [
  /\s+(?=(?:Sea|Kosher|Table)\s+salt\b)/i,
  /\s+(?=Black\s+pepper\b)/i,
  /\s+(?=White\s+pepper\b)/i,
  /\s+(?=Red\s+pepper\s+flakes\b)/i,
  /\s+(?=Olive\s+oil\b)/i,
  /\s+(?=Vegetable\s+oil\b)/i,
  /\s+(?=Cooking\s+spray\b)/i,
  // generic conjunctions: break "and"/"&" when they join two items
  /\s+(?=(?:and|&)\s+)/i
];

function splitRunOnIngredients(line: string): string[] {
  let parts: string[] = [line];
  for (const re of RUNON_SPLITERS) {
    const next: string[] = [];
    for (const p of parts) {
      const chunks = p.split(re).map(x => x.trim()).filter(Boolean);
      if (chunks.length > 1) next.push(...chunks);
      else next.push(p);
    }
    parts = next;
  }
  // also split on commas/semicolons when a Capital follows (", Sea salt")
  parts = parts.flatMap(p => p.split(/\s*[,;]\s+(?=[A-Z])/)).map(s => s.trim()).filter(Boolean);
  return parts;
}

// ---------------------------------------
// MAIN FUNCTION
// ---------------------------------------
export function parseRecipeText(input: string): ParseResult {
  if (!input) return { ingredients: [], steps: [], confidence: "low", debug: "empty" };

  // clean + trim noisy tail
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

  // split into raw lines
  const ingLinesRaw = ingBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const stepLinesRaw = stepBlob.split(/\n+/).map(s => s.trim()).filter(Boolean);

  // ---------- Ingredients: classify, clean, and split run-ons ----------
  const ingredientCandidates = ingLinesRaw
    .filter(looksLikeIngredient); // ← NO anti-step filter here (strict step detector handles it)

  let ingredients: string[] = [];
  for (const cand of ingredientCandidates) {
    const cleaned = cleanIngredientLine(cand);
    const split = splitRunOnIngredients(cleaned); // Sea salt, Black pepper, and/& …
    ingredients.push(...split);
  }
  ingredients = uniqueNonEmpty(ingredients).slice(0, 60);

  // ---------- Steps ----------
  let steps = uniqueNonEmpty(
    stepLinesRaw.filter(looksLikeStep).map(cleanStepLine)
  );

  // merge 8x + inch orphans
  if (steps.length >= 2) steps = mergeOrphanPanSizeSteps(steps);

  // break big paragraphs into mini steps
  if (steps.length) steps = explodeCompoundSteps(steps);

  // fallback if nothing yet: try latter portion of the text
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
