// lib/ingredientExtract.ts
// LIKE I'M 5: We turn messy text into neat ingredient lines.
// New superpower: if a line has more than one NUMBER/FRACTION in it,
// we split it into multiple ingredients. We also rescue the last food
// word that comes before the first number (ex: "... flour 3 cups milk").

// ------------------------------------------------------------------
// PUBLIC: you call these two
// ------------------------------------------------------------------

export function normalizeIngredientLines(lines: string[]): string[] {
  // 1) Break any long line into pieces each time we see a new amount.
  const expanded: string[] = [];
  for (const raw of (lines || [])) {
    const pieces = explodeOnNewAmount(String(raw));
    if (pieces.length) expanded.push(...pieces);
    else expanded.push(String(raw)); // keep original if we found no amounts
  }

  // 2) Parse every piece into a tidy one-liner. Remove duplicates.
  const out: string[] = [];
  const seen = new Set<string>();

  for (const piece of expanded) {
    const parsed = parseIngredientLine(piece);
    const canon = parsed.canonical.trim();
    if (!canon) continue;
    const key = canon.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canon);
  }

  // 3) Cute merge: if list has BOTH salt and pepper, replace them with one line.
  const iSalt = out.findIndex(x => /^salt(\s+to\s+taste)?$/i.test(x));
  const iPep  = out.findIndex(x => /^pepper(\s+to\s+taste)?$/i.test(x));
  if (iSalt !== -1 && iPep !== -1) {
    const first = Math.min(iSalt, iPep);
    const last  = Math.max(iSalt, iPep);
    out.splice(last, 1);
    out.splice(first, 1, 'Salt and pepper to taste');
  }

  return out;
}

// If you pass one big paragraph instead of lines:
export function normalizeIngredientBlock(block: string): string[] {
  const chunks = String(block)
    .replace(/\r/g, '')
    .split(/\n|;|[|]|[\u2022•·▪▫►▶]/g) // newlines + bullet-like chars
    .map(s => s.replace(/^[\s\-–—•*·\u2022]+/, '').trim())
    .filter(Boolean);

  // Let the main function do the heavy lifting (including hard splits).
  return normalizeIngredientLines(chunks);
}

/* ==================================================================
   Below is the brainy part. You shouldn't need to touch it. 🙂
   ================================================================== */

// ---------------- amount patterns we all agree on ------------------
// Numbers: 2, 2.5, 2-3, 2–3, Fractions: 1/2, 1 1/2, Unicode: ½ ¼ ¾ …
const AMOUNT_CORE =
  '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[¼-¾⅐-⅞]|(?:\\d+(?:\\.\\d+)?\\s*[–—-]\\s*\\d+(?:\\.\\d+)?))';
const FIRST_AMOUNT = new RegExp(`(^|[\\s,;()])(${AMOUNT_CORE})\\b`);
const ANY_AMOUNT_GLOBAL = new RegExp(`(^|[\\s,;()])(${AMOUNT_CORE})\\b`, 'g');

// ------------------- split line into many pieces -------------------
// LIKE I'M 5: Every time we see a NEW number/fraction, we start a NEW ingredient.
// We also try to save the last food word BEFORE the first number (like “flour”).
function explodeOnNewAmount(chunk: string): string[] {
  const text = String(chunk || '').replace(/\u00A0/g, ' ').trim();
  if (!text) return [];

  // Find every amount's start index
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = ANY_AMOUNT_GLOBAL.exec(text))) {
    const tokenStart = m.index + (m[1] ? m[1].length : 0);
    starts.push(tokenStart);
  }
  if (!starts.length) {
    // Also peel off a trailing "salt and pepper to taste" so it can be
    // its own entry even when there are no amounts.
    const pulled = peelSaltPepperTail(text);
    return pulled;
  }

  // Try to salvage the last useful word before the first amount, e.g. "flour"
  const prefix = text.slice(0, starts[0]).trim();
  let salvage = '';
  if (prefix) {
    const words = prefix.split(/\s+/).filter(w => /^[A-Za-z][A-Za-z-]*$/.test(w));
    const stop = /^(a|an|the|of|and|or)$/i;
    for (let i = words.length - 1; i >= 0; i--) {
      if (!stop.test(words[i]) && words[i].length > 2) { salvage = words[i]; break; }
    }
  }

  // Cut the text into slices that each START at an amount
  const rawPieces: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i];
    const b = i + 1 < starts.length ? starts[i + 1] : text.length;
    rawPieces.push(text.slice(a, b).trim());
  }

  // If we found a salvage word ("flour"), glue it right after the qty/unit in the first slice.
  if (salvage && rawPieces.length) {
    rawPieces[0] = rawPieces[0].replace(/^(\S+(?:\s+\S+)?)(.*)$/s, (_m, head: string, tail: string) => {
      return `${head} ${salvage}${tail}`.replace(/\s{2,}/g, ' ').trim();
    });
  }

  // For each slice, peel off a trailing “salt and pepper to taste” (or salt/pepper to taste)
  // so it becomes its own clean line.
  const finalPieces: string[] = [];
  for (const p of rawPieces) {
    finalPieces.push(...peelSaltPepperTail(p));
  }

  return finalPieces.filter(Boolean);
}

// Helper: split off “… salt and pepper to taste” to be its own line.
function peelSaltPepperTail(line: string): string[] {
  let s = String(line || '').trim();
  if (!s) return [];

  const both = /(,?\s*and\s*)?salt\s+and\s+pepper\s+to\s+taste\.?$/i;
  const justSalt = /salt\s+to\s+taste\.?$/i;
  const justPep = /pepper\s+to\s+taste\.?$/i;

  if (both.test(s)) {
    s = s.replace(both, '').trim();
    return s ? [s, 'Salt and pepper to taste'] : ['Salt and pepper to taste'];
  }
  if (justSalt.test(s)) {
    s = s.replace(justSalt, '').trim();
    return s ? [s, 'Salt to taste'] : ['Salt to taste'];
  }
  if (justPep.test(s)) {
    s = s.replace(justPep, '').trim();
    return s ? [s, 'Pepper to taste'] : ['Pepper to taste'];
  }
  return [s];
}

/* -------------------------- parser guts below -------------------------- */

type Parsed = {
  original: string;
  qtyText: string;           // "1 1/2", "2", "½", "2-3"
  unitCanon: string | null;  // teaspoon, cup, ounce… (singular), or null
  item: string;              // the food words we keep ("boneless chicken")
  note: string | null;       // "diced", "optional", "to taste", etc.
  canonical: string;         // pretty one-line we show in UI
};

// map unicode fractions → numeric
const UNICODE_FRAC: Record<string, number> = {
  '¼': 1/4, '½': 1/2, '¾': 3/4,
  '⅐': 1/7, '⅑': 1/9, '⅒': 1/10,
  '⅓': 1/3, '⅔': 2/3,
  '⅕': 1/5, '⅖': 2/5, '⅗': 3/5, '⅘': 4/5,
  '⅙': 1/6, '⅚': 5/6,
  '⅛': 1/8, '⅜': 3/8, '⅝': 5/8, '⅞': 7/8,
};

function toNumber(q: string | null | undefined): number | null {
  if (!q) return null;
  q = q.trim();
  if (q.length === 1 && UNICODE_FRAC[q] != null) return UNICODE_FRAC[q];

  const range = q.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/);
  if (range) return parseFloat(range[1]);

  const mixed = q.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1], 10) + (parseInt(mixed[2], 10) / parseInt(mixed[3], 10));

  const frac = q.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);

  const n = Number(q.replace(',', '.'));
  return isFinite(n) ? n : null;
}

// unit dictionary (canonical singular)
const UNIT_ALIASES: Record<string, string> = {
  // teaspoons
  't': 'teaspoon', 'tsp': 'teaspoon', 'tsps': 'teaspoon', 'tsp.': 'teaspoon',
  'teaspoon': 'teaspoon', 'teaspoons': 'teaspoon',
  // tablespoons
  'tbsp': 'tablespoon', 'tbsps': 'tablespoon', 'tbsp.': 'tablespoon',
  'tablespoon': 'tablespoon', 'tablespoons': 'tablespoon',
  // cups
  'c': 'cup', 'c.': 'cup', 'cup': 'cup', 'cups': 'cup',
  // weight
  'oz': 'ounce', 'ounce': 'ounce', 'ounces': 'ounce',
  'lb': 'pound', 'lbs': 'pound', 'pound': 'pound', 'pounds': 'pound',
  'g': 'gram', 'gram': 'gram', 'grams': 'gram',
  'kg': 'kilogram', 'kilogram': 'kilogram', 'kilograms': 'kilogram',
  // volume
  'ml': 'milliliter', 'milliliter': 'milliliter', 'milliliters': 'milliliter',
  'l': 'liter', 'liter': 'liter', 'liters': 'liter',
  // loose-but-useful
  'pinch': 'pinch', 'pinches': 'pinch', 'dash': 'dash', 'dashes': 'dash',
  'clove': 'clove', 'cloves': 'clove',
  'can': 'can', 'cans': 'can',
  'stick': 'stick', 'sticks': 'stick',
  'slice': 'slice', 'slices': 'slice',
  // fluid ounces (volume)
  'fl oz': 'fluid_ounce', 'floz': 'fluid_ounce', 'fluid ounce': 'fluid_ounce', 'fluid ounces': 'fluid_ounce',
};

function normalizeUnitRaw(s: string | null | undefined): string | null {
  if (!s) return null;
  const clean = s.toLowerCase().replace(/\./g, '').trim();
  if (!clean) return null;

  if (UNIT_ALIASES[clean]) return UNIT_ALIASES[clean];

  const squished = clean.replace(/\s+/g, '');
  if (UNIT_ALIASES[squished]) return UNIT_ALIASES[squished];

  if (clean.endsWith('s') && UNIT_ALIASES[clean.slice(0, -1)]) {
    return UNIT_ALIASES[clean.slice(0, -1)];
  }
  return null;
}

function shouldPluralize(qtyText: string): boolean {
  if (!qtyText) return false;
  if (/^1$/.test(qtyText)) return false;                         // "1"
  if (/^\d+\/\d+$/.test(qtyText)) return false;                  // "1/2"
  if (/^\d+\s+\d+\/\d+$/.test(qtyText)) return true;             // "1 1/2"
  if (/^\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?$/.test(qtyText)) return true; // "2–3"
  if (/^\d*\.\d+$/.test(qtyText)) return parseFloat(qtyText) > 1;
  return Number(qtyText) > 1;
}

function pluralizeUnit(unit: string, qtyText: string): string {
  if (!unit) return '';
  if (!shouldPluralize(qtyText)) return unit;
  const map: Record<string, string> = {
    milliliter: 'milliliters', liter: 'liters',
    ounce: 'ounces', gram: 'grams', kilogram: 'kilograms',
    pound: 'pounds', teaspoon: 'teaspoons', tablespoon: 'tablespoons',
    cup: 'cups', pinch: 'pinches', dash: 'dashes',
    clove: 'cloves', can: 'cans', stick: 'sticks', slice: 'slices',
    fluid_ounce: 'fl oz',
  };
  return map[unit] || unit;
}

// Pull notes but keep food words in the item.
function splitNotesKeepFood(core: string): { core: string; note: string | null } {
  const notes: string[] = [];
  let s = core;

  // (1) parentheses become notes
  s = s.replace(/\(([^)]+)\)/g, (_, p1) => {
    const txt = String(p1).trim();
    if (txt) notes.push(txt);
    return ' ';
  });

  // (2) common trailing notes (we include "to taste")
  s = s.replace(
    /,\s*(diced|chopped|minced|shredded|grated|softened|melted|room\s*temperature|to\s*taste)\b/gi,
    (_m, w) => { notes.push(String(w).toLowerCase()); return ''; }
  );

  s = s.replace(/\s{2,}/g, ' ').trim();
  return { core: s, note: notes.length ? Array.from(new Set(notes)).join(', ') : null };
}

// IMPORTANT FIX: if the word after the number is NOT a real unit (like "jalapeños"),
// we keep it as part of the food instead of treating it as a unit.
function parseIngredientLine(line: string): Parsed {
  const original = String(line).trim();

  // A) If there are words BEFORE the first amount, try to save the last useful one (salvage).
  let work = original;
  let salvage = '';
  const first = work.match(FIRST_AMOUNT);
  if (first && first.index != null && first.index > 0) {
    const prefix = work.slice(0, first.index + (first[1] ? first[1].length : 0)).trim();
    const words = prefix.split(/\s+/).filter(w => /^[A-Za-z][A-Za-z-]*$/.test(w));
    const stop = /^(a|an|the|of|and|or)$/i;
    for (let i = words.length - 1; i >= 0; i--) {
      if (!stop.test(words[i]) && words[i].length > 2) { salvage = words[i]; break; }
    }
    work = work.slice(first.index + (first[1] ? first[1].length : 0)).trim();
  }

  // B) Find: [QTY] [maybe-UNIT] [REST]
  const m = work.match(
    /^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|[¼-¾⅐-⅞]|(?:\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?))\s*([A-Za-zÀ-ÿ.]+)?\s*(.*)$/
  );

  let qtyText = '';
  let unitCanon: string | null = null;
  let rest = work;

  if (m) {
    qtyText = m[1] || '';

    const unitRaw = (m[2] || '').trim();
    const after   = (m[3] || '').trim();

    const normalized = normalizeUnitRaw(unitRaw);
    if (unitRaw && !normalized) {
      // not a real unit → part of the food
      unitCanon = null;
      rest = `${unitRaw} ${after}`.trim();
    } else {
      unitCanon = normalized;
      rest = after;
    }
  } else {
    // also support "pinch of salt" style
    const uLead = work.match(/^([A-Za-z. ]+)\s+of\s+(.*)$/i);
    if (uLead) {
      const unitMaybe = normalizeUnitRaw(uLead[1]);
      if (unitMaybe) {
        unitCanon = unitMaybe;
        rest = uLead[2].trim();
      }
    }
  }

  // If we salvaged a word like "flour" and it's not already in rest, add it up front.
  if (salvage && !new RegExp(`\\b${salvage}\\b`, 'i').test(rest)) {
    rest = `${salvage} ${rest}`.replace(/\s{2,}/g, ' ').trim();
  }

  rest = rest.replace(/^\bof\b\s+/i, '').trim();

  const { core, note } = splitNotesKeepFood(rest);
  const item = core;

  // Build pretty string
  let canonical = '';
  if (qtyText) canonical += qtyText + ' ';
  if (unitCanon) canonical += pluralizeUnit(unitCanon, qtyText) + ' ';
  canonical += item;
  if (note) {
    if (/^optional$/i.test(note)) canonical += ' (optional)';
    else canonical += `, ${note}`;
  }

  canonical = canonical.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();

  return { original, qtyText, unitCanon, item, note, canonical };
}
