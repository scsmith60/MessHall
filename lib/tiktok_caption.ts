// lib/tiktok_caption.ts
//
// 🧒 what this file does (like I'm 5):
// - we clean the big caption text a little.
// - we DO NOT change how we pull ingredients (we use your current parser).
// - we add a small "find steps" helper that only looks after
//   the "Instructions / Directions / Steps / Method" header,
//   and splits 1. / 2) / 3. correctly.
// - if we can't find steps, we fall back to the old parser.
//
// exports:
//   - captionToIngredientLinesSafe()
//   - captionToStepsSafe()
//   - bestEffortTikTokText()

import { parseRecipeText } from "./unified_parser";

// ---------- tiny cleaners ----------
const EMOJI_RE  = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const HASH_RE   = /#\w+/g;
const AT_RE     = /@\w+/g;

function cleanBlob(s?: string | null): string {
  if (!s) return "";
  return s
    .replace(/\u00A0/g, " ") // nbsp → space
    .replace(/\r/g, "\n")
    .trim();
}

function softStripForPreview(s: string): string {
  // only for debug previews; don't mutate actual parsing text
  return s
    .replace(EMOJI_RE, "")
    .replace(AT_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------- step extractor (safe & scoped to steps header) ----------
const STEP_HEADER_RE =
  /(?:^|[\s\n\r])(🔥?\s*)?(instructions?|directions?|steps?|method)\s*[:\-–—]?\s*/i;

const STOP_LINE_RE = /^\s*(less|see more|music\b|credits?\b)/i;

const INLINE_NUM_TOKEN = /(\s)(\d{1,2}[.)]\s+)/g;

function extractStepsAfterHeader(raw: string, debug?: (m: string)=>void): string[] {
  if (!raw) return [];

  // find the steps header position
  const lower = raw.toLowerCase();
  const idx = lower.search(STEP_HEADER_RE);
  debug?.(`[TT-CAP] stepHeaderIdx=${idx}`);
  if (idx < 0) return [];

  // keep only the tail starting at the header
  let tail = raw.slice(idx);

  // cut off trailing hashtags / "less" section quickly
  const hashIdx = tail.search(/\n\s*#/);
  const lessIdx = tail.search(/\n\s*less\b/i);
  const cutAt = [hashIdx, lessIdx].filter(n => n >= 0).sort((a,b)=>a-b)[0];
  if (cutAt !== undefined) tail = tail.slice(0, cutAt);

  // turn inline " 1.  2)  3." into new lines, but ONLY in this tail
  tail = tail.replace(INLINE_NUM_TOKEN, "\n$2");

  // also add newlines before bullets
  tail = tail.replace(/(\s)([-*•])\s+/g, "\n$2 ");

  // split into lines and clean
  const lines = tail
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean);

  // strip leading numbering / bullets
  const stripped = lines.map(l =>
    l
      .replace(/^\s*(\d{1,2}[.)])\s+/, "") // "1. " / "2) "
      .replace(/^\s*[-*•]\s+/, "")        // bullets
      .replace(/^\s*[:\-–—]\s*/, "")      // dangling colons/dashes
      .trim()
  );

  // keep only real step-looking lines until we hit a stop word
  const steps: string[] = [];
  for (const l of stripped) {
    if (STOP_LINE_RE.test(l)) break;
    if (!l) continue;

    // Heuristic: keep if it ends with a period OR begins with a cooking verb
    const looksLikeVerb =
      /^(cut|slice|dice|mix|stir|whisk|combine|add|bake|fry|air\s*fry|preheat|heat|cook|season|coat|marinate|pour|fold|serve|flip|shake|toss)\b/i.test(
        l
      );

    const looksLikeStep = looksLikeVerb || /\.\s*$/.test(l) || /^\d{1,2}[°º]/.test(l);
    if (looksLikeStep) steps.push(l);
  }

  // squash duplicates, trim, and cap
  const unique = Array.from(new Set(steps.map(s => s.trim()))).filter(Boolean).slice(0, 40);

  debug?.(
    `[TT-CAP] stepsExtracted=${unique.length} sample=${JSON.stringify(unique.slice(0,3))}`
  );

  return unique;
}

// ---------- public helpers (ingredients untouched) ----------

export function captionToIngredientLinesSafe(
  blob?: string | null,
  dbg?: (m: string)=>void
): string[] {
  const raw = cleanBlob(blob);
  if (!raw) return [];
  // 🚫 Do not change how ingredients are made — use existing parser on the raw text
  const parsed = parseRecipeText(raw);
  dbg?.(
    `[TT-CAP] ING ONLY rawLen=${raw.length} ing=${parsed.ingredients.length} steps=${parsed.steps.length} preview="${softStripForPreview(
      raw
    ).slice(0, 160)}"`
  );
  return parsed.ingredients;
}

export function captionToStepsSafe(
  blob?: string | null,
  dbg?: (m: string)=>void
): string[] {
  const raw = cleanBlob(blob);
  if (!raw) return [];

  // 1) try our header-scoped extractor (safe for ingredients)
  const direct = extractStepsAfterHeader(raw, dbg);
  if (direct.length >= 2) return direct;

  // 2) fallback to existing parser (in case creator used unusual formatting)
  const parsed = parseRecipeText(raw);
  const result = parsed.steps.length ? parsed.steps : direct; // prefer parser if it found some
  dbg?.(
    `[TT-CAP] STEPS ONLY rawLen=${raw.length} direct=${direct.length} parser=${parsed.steps.length} result=${result.length}`
  );
  return result;
}

// ---------- best-effort entry used by your STEP 2 pipeline ----------

export type BestEffortInput = {
  url: string;
  ogDescription?: string | null;   // caption (+ maybe comments concatenated upstream)
  screenshotUris?: string[];       // kept for signature compatibility
  debug?: (m: string) => void;
};

export type BestEffortResult = {
  raw: string;
  used: string[];
  text?: string;
  ingredients: string[];
  steps: string[];
};

export async function bestEffortTikTokText(input: BestEffortInput): Promise<BestEffortResult> {
  const raw = cleanBlob(input.ogDescription);
  const used: string[] = [];
  if (raw) used.push("caption+comments");

  // Ingredients: keep using your existing parser on the raw text
  const parsedForIng = raw ? parseRecipeText(raw) : { ingredients: [], steps: [], confidence: "low" as const, debug: "empty" };

  // Steps: try the header-scoped extractor first, fallback to parser
  const directSteps = extractStepsAfterHeader(raw, input.debug);
  const finalSteps = directSteps.length >= 2 ? directSteps : (raw ? parseRecipeText(raw).steps : []);

  input.debug?.(
    `[bestEffortTikTokText] len=${raw.length} ing=${parsedForIng.ingredients.length} steps=${finalSteps.length}`
  );

  return {
    raw,
    used,
    text: raw,
    ingredients: parsedForIng.ingredients,
    steps: finalSteps,
  };
}
