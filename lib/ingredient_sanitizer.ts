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

// These words mean "this is a section title" like "For the Ganache:"
const SECTION_HINTS = [
  "for the", "ganache", "filling", "topping", "frosting",
  "assembly", "optional toppings", "to serve"
];

// 👀 Does this look like a section header?
function looksLikeSectionHeader(s: string): boolean {
  const plain = s.toLowerCase();
  if (plain.endsWith(":")) return true;
  return SECTION_HINTS.some(w => plain.includes(w) && /:|\bfor the\b/i.test(plain));
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
  const out: SanitizedPiece[] = [];

  for (const raw of lines) {
    if (!raw || !raw.trim()) continue;

    // 1) light scrub
    let s = basicClean(raw);

    // 2) header check (we tag & skip later)
    const header = looksLikeSectionHeader(s);
    if (header) {
      out.push({ text: s.replace(TRAIL_DECOR, ""), maybeHeader: true });
      continue;
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

  // 6) de-dupe but keep order
  const seen = new Set<string>();
  return out.filter(p => {
    const key = p.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
