// lib/ingredient_sanitizer.ts
// 🧼 Hi! This file is a tiny "ingredient bath".
// We take messy lines (like sticky toys), wash them, and hand back clean ones.

export type SanitizedPiece = {
  text: string;            // ✅ clean ingredient line
  maybeHeader?: boolean;   // 🔖 looks like a section header? (skip these)
  lowConfidence?: boolean; // 🤏 we guessed something (like "spoon" -> "1 tablespoon")
};

// ---------- little helper soaps & towels ----------
const DASHES = /[–—−]/g;                 // turn fancy dashes into a normal "-"
const MULTI_SPACE = /\s{2,}/g;           // squeeze extra spaces
const BOLD_MD = /\*{1,3}([^*]+)\*{1,3}/g;// remove **bold** marks
const TRAIL_DECOR = /[-–—•\s]+$/;         // trim trailing " - " or dots/spaces
const LEAD_BULLET = /^\s*[-–—•]+\s*/;     // trim leading "- " bullets
const MARKUP = /[_`~]/g;                  // drop stray markdown marks
const TEMP_ING = /\b(?:warmed|warm|heated|heat|cooled|cool)\s+to\s+[-~]?\s*\d+\s*(?:°\s*)?(?:f|c)\b/i;

// These words mean "this is a section title" like "For the Ganache:"
const SECTION_HINTS = [
  "for the", "ganache", "filling", "topping", "frosting",
  "assembly", "optional toppings", "to serve", "batter", "glaze",
  "streusel", "crust", "dough", "sauce", "dressing", "marinade",
  "ingredients"
];

const UNIT_OR_MEASURE_HINT = /\b(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|ml|l|g|gram|grams|kg|stick|sticks)\b/i;
const INLINE_INGREDIENT_HINT = /\b(cup|cups|tsp|tbsp|teaspoon|tablespoon|oz|ounce|ounces|ml|l|g|gram|grams|kg|stick|sticks|egg|eggs|butter|milk|sugar|cream|yeast|flour|salt|pepper)\b/i;
const NUMBER_WORD = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

function headerHasHint(header: string): boolean {
  const lower = header.toLowerCase();
  return SECTION_HINTS.some(hint => lower.includes(hint));
}

const GENERIC_HEADER_SKIP = /title\/captions/i;
const TITLE_CASE_HEADER = /^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,5}$/;

function looksLikeSectionHeader(s: string): boolean {
  const trimmed = (s || "").trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (GENERIC_HEADER_SKIP.test(lower)) return false;

  if (!trimmed.endsWith(":")) {
    return /^for\s+(?:the\s+)?[^:]+:\s*$/i.test(lower);
  }

  const base = trimmed.slice(0, -1).trim();
  if (!base || /\d/.test(base)) return false;
  if (UNIT_OR_MEASURE_HINT.test(base)) return false;

  return headerHasHint(base) || TITLE_CASE_HEADER.test(base) || /^for\s+(?:the\s+)?/i.test(base);
}

function normalizeHeaderCandidate(raw: string): string {
  const stripped = (raw || "").replace(TRAIL_DECOR, "").trim();
  if (!stripped) return "";
  const firstUpperIdx = stripped.search(/[A-Z]/);
  if (firstUpperIdx > 0) {
    const prefix = stripped.slice(0, firstUpperIdx).trim();
    if (prefix && /^[a-z\s]+$/.test(prefix)) {
      return stripped.slice(firstUpperIdx).trim();
    }
  }
  return stripped;
}

function tailLooksLikeIngredient(tail: string): boolean {
  if (!tail) return false;
  const core = tail.replace(/^[-•*]+\s*/, "").trim();
  if (!core) return false;
  if (/^(\d+\/\d+|\d+(?:\s+\d+\/\d+)?)/.test(core)) return true;
  if (NUMBER_WORD.test(core)) return true;
  if (INLINE_INGREDIENT_HINT.test(core)) return true;
  return false;
}

function shouldSplitInlineHeader(headerRaw: string, tail: string): boolean {
  const header = normalizeHeaderCandidate(headerRaw);
  if (!header || GENERIC_HEADER_SKIP.test(header)) return false;
  const looksSectiony =
    headerHasHint(header) ||
    /^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}$/.test(header);
  if (!looksSectiony) return false;
  return tailLooksLikeIngredient(tail);
}

function splitInlineHeaderSegments(raw: string): string[] {
  const text = raw ?? "";
  if (!text.trim()) return [];
  const nakedMatch = text.match(/^\s*(ingredients?|ingredient\s+list)\b/i);
  if (nakedMatch) {
    const after = text.slice(nakedMatch[0].length).trim();
    if (tailLooksLikeIngredient(after)) {
      const normalizedHeader = normalizeHeaderCandidate(nakedMatch[0]);
      const parts: string[] = [];
      if (normalizedHeader) parts.push(`${normalizedHeader}:`);
      if (after) parts.push(after);
      if (parts.length) return parts;
    }
  }
  const parts: string[] = [];
  let cursor = 0;
  const matcher = /([A-Z][A-Za-z\s]{0,80}):/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const headerRaw = match[1];
    const tail = text.slice(match.index + match[0].length);
    if (!shouldSplitInlineHeader(headerRaw, tail)) continue;
    const before = text.slice(cursor, match.index).trim();
    if (before) parts.push(before);
    const normalizedHeader = normalizeHeaderCandidate(headerRaw);
    if (normalizedHeader) {
      parts.push(`${normalizedHeader}:`);
    }
    cursor = match.index + match[0].length;
  }
  const tail = text.slice(cursor).trim();
  if (tail) parts.push(tail);
  return parts.length ? parts : [raw];
}

// ✂️ Split glued-together items: "A - B -" -> ["A", "B"]
function splitRunOnByDash(s: string): string[] {
  const parts = s.split(/\s[-–—]\s/).map(x => x.trim()).filter(Boolean);
  return parts.length <= 1 ? [s.trim()] : parts;
}

// 🧹 Gentle word cleanups
function gentleWordFixes(s: string): string {
  // "half & half" → "half-and-half" (more searchable)
  s = s.replace(/\bhalf\s*&\s*half\b/gi, "half-and-half");
  return s;
}

// 🩹 OCR boo-boo: starts with "/2 " → "1/2 "
function fixLeadingSlashFractions(s: string): string {
  return s.replace(/^\/(\d)\b/, (_m, d) => `1/${d}`);
}

// 🥄 OCR boo-boo: starts with "spoon " → assume "1 tablespoon " (mark as guessed)
function fixLeadingSpoonGuess(s: string): { text: string; lowConfidence: boolean } {
  if (/^\s*spoon\b/i.test(s)) {
    return { text: s.replace(/^\s*spoon\b/i, "1 tablespoon"), lowConfidence: true };
  }
  return { text: s, lowConfidence: false };
}

// ) → trims one extra dangling ")"
function trimDanglingParens(s: string): string {
  const opens = (s.match(/\(/g) || []).length;
  const closes = (s.match(/\)/g) || []).length;
  if (closes > opens && s.endsWith(")")) return s.slice(0, -1).trim();
  return s;
}

// 🧽 Big clean: unify dashes, remove bullets, trim extras
function basicClean(s: string): string {
  return s
    .replace(DASHES, "-")
    .replace(BOLD_MD, "$1")
    .replace(MARKUP, "")
    .replace(LEAD_BULLET, "")
    .replace(TRAIL_DECOR, "")
    .replace(MULTI_SPACE, " ")
    .trim();
}

// 🚿 Main bath time!
export function sanitizeAndSplitIngredientCandidates(lines: string[]): SanitizedPiece[] {
  const headerTail = /([A-Za-z][A-Za-z\s]{1,60}):\s*$/;
  const expanded: string[] = [];
  for (const raw of lines) {
    if (!raw) continue;
    const segments = splitInlineHeaderSegments(raw);
    for (const segment of segments) {
      if (!segment) continue;
      const trimmed = segment.trimEnd();
      if (!trimmed) continue;
      const tailMatch = headerTail.exec(trimmed);
      if (tailMatch && !/\d/.test(tailMatch[1])) {
        const before = trimmed.slice(0, tailMatch.index).trim();
        if (before) expanded.push(before);
        const normalizedHeader = normalizeHeaderCandidate(tailMatch[1]);
        if (normalizedHeader) {
          expanded.push(normalizedHeader + ":");
        }
      } else {
        expanded.push(segment);
      }
    }
  }

  const out: SanitizedPiece[] = [];

  for (const raw of expanded) {
    if (!raw || !raw.trim()) continue;

    // 1) light scrub
    let s = basicClean(raw);
    if (!s) continue;
    const hasIngredientHints = /[-•\d]/.test(s);
    const hasSectionHint = /(?:recipe|details|makes|serves|yield)\b/i.test(s);
    if (!hasIngredientHints && !hasSectionHint && s.length > 160) continue;

    // 2) header check (we tag & skip later) but allow inline ingredients after colon
    let header = looksLikeSectionHeader(s);
    if (header && s.endsWith(":")) {
      const colonIdx = s.indexOf(":");
      const afterColon = colonIdx >= 0 ? s.slice(colonIdx + 1).trim() : "";
      let headerText = s.slice(0, colonIdx + 1).replace(TRAIL_DECOR, "").trim();
      headerText = normalizeHeaderCandidate(headerText);
      if (headerText && headerText.length <= 80) {
        out.push({ text: headerText, maybeHeader: true });
      }
      if (afterColon) {
        s = afterColon;
        header = false;
      } else {
        continue;
      }
    }

    // 3) tiny OCR fixes
    s = fixLeadingSlashFractions(s);
    const spoon = fixLeadingSpoonGuess(s);
    s = spoon.text;
    let lowConfidence = spoon.lowConfidence;

    // 4) fix one extra ")"
    s = trimDanglingParens(s);

    // 5) split glued items
    const parts = splitRunOnByDash(s);

    for (let part of parts) {
      part = basicClean(part);
      if (!part) continue;

      part = gentleWordFixes(part);

      out.push({ text: part, lowConfidence });
      // only the first piece keeps the guess flag
      lowConfidence = false;
    }
  }

  const merged: SanitizedPiece[] = [];
  for (const piece of out) {
    if (TEMP_ING.test(piece.text) && merged.length && !merged[merged.length - 1].maybeHeader) {
      const prev = merged[merged.length - 1];
      merged[merged.length - 1] = { ...prev, text: `${prev.text} ${piece.text}`.trim() };
    } else {
      merged.push(piece);
    }
  }

  // 6) de-dupe inside each section but keep duplicates across sections
  const seenBySection = new Map<number, Set<string>>();
  let sectionEpoch = 0;
  return merged.filter(p => {
    if (p.maybeHeader) {
      sectionEpoch += 1;
      return true;
    }
    if (!seenBySection.has(sectionEpoch)) {
      seenBySection.set(sectionEpoch, new Set());
    }
    const bucket = seenBySection.get(sectionEpoch)!;
    const key = p.text.toLowerCase();
    if (bucket.has(key)) return false;
    bucket.add(key);
    return true;
  });
}
