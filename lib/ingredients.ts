// lib/ingredients.ts
// LIKE I'M 5: This file takes ONE ingredient line and makes it neat.
// New trick: if the line has random junk BEFORE the first number (“e flour 3 cups milk”),
// we try to keep the last useful word (“flour”) and put it back where it belongs.

export type ParsedIngredient = {
  original: string;
  qty: number | null;
  unit: string | null;
  item: string;
  note: string | null;
  canonical: string;
};

// ---------------- units + fractions helpers ----------------
const UNIT_ALIASES: Record<string, string> = {
  // teaspoons
  't': 'teaspoon', 'tsp': 'teaspoon', 'tsps': 'teaspoon', 'tsp.': 'teaspoon',
  'teaspoon': 'teaspoon', 'teaspoons': 'teaspoon',
  // tablespoons
  'tbsp': 'tablespoon', 'tbsp.': 'tablespoon', 'tbs': 'tablespoon', 'tbl': 'tablespoon',
  'tablespoon': 'tablespoon', 'tablespoons': 'tablespoon',
  // cups
  'c': 'cup', 'c.': 'cup', 'cup': 'cup', 'cups': 'cup',
  // ounces (weight)
  'oz': 'ounce', 'ounce': 'ounce', 'ounces': 'ounce',
  // pounds
  'lb': 'pound', 'lbs': 'pound', 'pound': 'pound', 'pounds': 'pound',
  // grams/kilos
  'g': 'gram', 'gram': 'gram', 'grams': 'gram',
  'kg': 'kilogram', 'kilogram': 'kilogram', 'kilograms': 'kilogram',
  // milliliters/liters
  'ml': 'milliliter', 'milliliter': 'milliliter', 'milliliters': 'milliliter',
  'l': 'liter', 'liter': 'liter', 'liters': 'liter',
  // fluid ounces (volume)
  'fl oz': 'fluid_ounce', 'floz': 'fluid_ounce', 'fluid ounce': 'fluid_ounce', 'fluid ounces': 'fluid_ounce',
  // looser units
  'pinch': 'pinch', 'pinches': 'pinch',
  'dash': 'dash', 'dashes': 'dash',
  'clove': 'clove', 'cloves': 'clove',
  'slice': 'slice', 'slices': 'slice',
  'stick': 'stick', 'sticks': 'stick',
  'can': 'can', 'cans': 'can',
};

const UNICODE_FRAC: Record<string, number> = {
  '¼': 1/4, '½': 1/2, '¾': 3/4,
  '⅐': 1/7, '⅑': 1/9, '⅒': 1/10,
  '⅓': 1/3, '⅔': 2/3,
  '⅕': 1/5, '⅖': 2/5, '⅗': 3/5, '⅘': 4/5,
  '⅙': 1/6, '⅚': 5/6,
  '⅛': 1/8, '⅜': 3/8, '⅝': 5/8, '⅞': 7/8,
};

// share the same “amount” brain as caption splitter
const AMOUNT_CORE =
  '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[¼-¾⅐-⅞]|(?:\\d+(?:\\.\\d+)?\\s*[–—-]\\s*\\d+(?:\\.\\d+)?))';
const FIRST_AMOUNT = new RegExp(`(^|[\\s,;()])(${AMOUNT_CORE})\\b`);

// --------------- helpers to clean numbers/units ---------------
function toNumber(q: string | null | undefined): number | null {
  if (!q) return null;

  // unicode-only, like "½"
  if (q.length === 1 && UNICODE_FRAC[q] != null) return UNICODE_FRAC[q];

  // mixed number "1 1/2"
  const mixed = q.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const a = parseInt(mixed[1], 10);
    const b = parseInt(mixed[2], 10);
    const c = parseInt(mixed[3], 10);
    return c ? a + b / c : a;
  }

  // simple fraction "3/4"
  const frac = q.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const b = parseInt(frac[1], 10);
    const c = parseInt(frac[2], 10);
    return c ? b / c : null;
  }

  // range "2-3" or "2–3" → keep first number (safe default)
  const range = q.match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*\d+(?:\.\d+)?$/);
  if (range) return parseFloat(range[1]);

  const n = Number(q.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeUnitRaw(u?: string | null): string | null {
  if (!u) return null;
  const clean = u.toLowerCase().replace(/\./g, '').trim();
  if (!clean) return null;

  const joined = clean.replace(/\s+/g, ' ');
  if (UNIT_ALIASES[joined]) return UNIT_ALIASES[joined];

  const squish = clean.replace(/\s+/g, '');
  if (UNIT_ALIASES[squish]) return UNIT_ALIASES[squish];

  if (joined.endsWith('s') && UNIT_ALIASES[joined.slice(0, -1)]) {
    return UNIT_ALIASES[joined.slice(0, -1)];
  }
  return null;
}

function shouldPluralize(qtyText: string) {
  if (!qtyText) return false;
  if (/^1$/.test(qtyText)) return false;                   // exactly 1
  if (/^\d+\/\d+$/.test(qtyText)) return false;             // 1/2, 3/4 …
  if (/^\d+\s+\d+\/\d+$/.test(qtyText)) return true;        // 1 1/2
  if (/^\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?$/.test(qtyText)) return true; // 2–3
  if (/^\d*\.\d+$/.test(qtyText)) return parseFloat(qtyText) > 1;
  return Number(qtyText) > 1;
}

function pluralizeUnit(unit: string, qtyText: string): string {
  if (!unit) return '';
  if (!shouldPluralize(qtyText)) return unit;
  const map: Record<string,string> = {
    milliliter:'milliliters', liter:'liters',
    teaspoon:'teaspoons', tablespoon:'tablespoons', cup:'cups',
    ounce:'ounces', pound:'pounds',
    gram:'grams', kilogram:'kilograms',
    pinch:'pinches', dash:'dashes',
    clove:'cloves', slice:'slices', stick:'sticks', can:'cans',
    fluid_ounce:'fl oz',
  };
  return map[unit] || unit;
}

function splitNotesKeepFood(s: string): { core: string; note: string | null } {
  const notes: string[] = [];
  let core = s;

  // items in (parentheses) become notes
  core = core.replace(/\(([^)]+)\)/g, (_, p1) => {
    const txt = String(p1).trim();
    if (txt) notes.push(txt);
    return ' ';
  });

  // trailing ", diced/chopped/..." become notes
  core = core.replace(
    /,\s*(diced|chopped|minced|shredded|grated|softened|melted|room\s*temperature|to\s*taste)\b/gi,
    (_m, w) => { notes.push(String(w).toLowerCase()); return ''; }
  );

  core = core.replace(/\s{2,}/g, ' ').trim();
  return { core, note: notes.length ? Array.from(new Set(notes)).join(', ') : null };
}

// ------------------------------ MAIN ------------------------------
export function parseIngredientLine(line: string): ParsedIngredient {
  const original = String(line || '').trim();
  if (!original) return { original, qty: null, unit: null, item: '', note: null, canonical: '' };

  // A) If there are words BEFORE the first amount, try to save the last useful one.
  let work = original;
  const first = work.match(FIRST_AMOUNT);
  let salvage = ''; // e.g., "flour" from "… flour 3 cups milk"
  if (first && first.index != null && first.index > 0) {
    const prefix = work.slice(0, first.index + (first[1] ? first[1].length : 0)).trim();
    const words = prefix.split(/\s+/).filter(w => /^[A-Za-z][A-Za-z-]*$/.test(w));
    const stop = /^(a|an|the|of|and|or)$/i;
    for (let i = words.length - 1; i >= 0; i--) {
      if (!stop.test(words[i]) && words[i].length > 2) { salvage = words[i]; break; }
    }
    work = work.slice(first.index + (first[1] ? first[1].length : 0)).trim();
  }

  // B) Find [QTY] [maybe-UNIT] [REST]
  const m = work.match(
    /^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|[¼-¾⅐-⅞]|(?:\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?))\s*([A-Za-zÀ-ÿ.]+)?\s*(.*)$/
  );

  let qtyText = '';
  let qty: number | null = null;
  let unitCanon: string | null = null;
  let rest = work;

  if (m) {
    qtyText = m[1] || '';
    qty = toNumber(qtyText);

    const unitRaw = (m[2] || '').trim();
    const after   = (m[3] || '').trim();

    const normalized = normalizeUnitRaw(unitRaw);
    if (unitRaw && !normalized) {
      // second token looked like a word, not a unit → it's part of the food
      unitCanon = null;
      rest = `${unitRaw} ${after}`.trim();
    } else {
      unitCanon = normalized;
      rest = after;
    }
  } else {
    // Support “pinch of salt”
    const uLead = work.match(/^([A-Za-z. ]+)\s+of\s+(.*)$/i);
    if (uLead) {
      const maybeUnit = normalizeUnitRaw(uLead[1]);
      if (maybeUnit) {
        unitCanon = maybeUnit;
        rest = (uLead[2] || '').trim();
      }
    }
  }

  // If we salvaged a word like "flour", and it's not already in rest, add it at the front.
  if (salvage && !new RegExp(`\\b${salvage}\\b`, 'i').test(rest)) {
    rest = `${salvage} ${rest}`.replace(/\s{2,}/g, ' ').trim();
  }

  // drop leading "of"
  rest = rest.replace(/^\bof\b\s+/i, '').trim();

  const { core, note } = splitNotesKeepFood(rest);
  const item = core;

  // Build a friendly, tidy line.
  let canon = '';
  if (qtyText) canon += qtyText + ' ';
  if (unitCanon) canon += pluralizeUnit(unitCanon, qtyText) + ' ';
  canon += item;
  if (note) {
    if (/^optional$/i.test(note)) canon += ' (optional)';
    else canon += `, ${note}`;
  }

  canon = canon.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();

  return { original, qty, unit: unitCanon, item, note, canonical: canon };
}

export function normalizeIngredientLines(lines: string[]): ParsedIngredient[] {
  const seen = new Set<string>();
  const out: ParsedIngredient[] = [];

  for (const raw of (lines || [])) {
    const p = parseIngredientLine(String(raw));
    const key = p.canonical.toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }

  // Cute merge: "Salt" + "Pepper" → "Salt and pepper to taste"
  const iSalt = out.findIndex(x => /^salt$/i.test(x.canonical));
  const iPep  = out.findIndex(x => /^pepper(\s+to\s+taste)?$/i.test(x.canonical));
  if (iSalt !== -1 && iPep !== -1) {
    const first = Math.min(iSalt, iPep);
    const keep: ParsedIngredient[] = [];
    out.forEach((p, idx) => { if (idx !== iSalt && idx !== iPep) keep.push(p); });
    keep.splice(first, 0, {
      original: 'Salt and pepper to taste',
      qty: null, unit: null, item: 'salt and pepper', note: 'to taste',
      canonical: 'Salt and pepper to taste',
    });
    return keep;
  }

  return out;
}
