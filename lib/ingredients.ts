// lib/ingredients.ts
// like i'm 5: we take messy ingredient lines and turn them into tidy parts.
// we ALWAYS return objects with a .canonical string because the UI needs it.
//
// example inputs -> canonical outputs:
//  "4 boneless skinless chicken breasts" -> "4 boneless skinless chicken breasts"
//  "2 tsps oregano or Italian seasoning" -> "2 teaspoons oregano or Italian seasoning"
//  "2 jalapenos, diced"                  -> "2 jalapenos, diced"   (no more "2, diced")
//  "1 cup shredded cheese (optional)"    -> "1 cup shredded cheese (optional)"
//  "Salt" + "Pepper to taste"            -> "Salt and pepper to taste" (cute merge)

export type ParsedIngredient = {
  original: string;       // the text we got
  qty: number | null;     // 1.5, 0.25, etc (we don’t need this for UI, but nice to keep)
  unit: string | null;    // canonical singular unit ("teaspoon", "cup", "gram", ...)
  item: string;           // the food (what to buy)
  note: string | null;    // "diced", "room temp", "(optional)", etc.
  canonical: string;      // pretty rebuilt line the UI shows
};

/* -------------------------- units + fractions tables -------------------------- */

// 1) unit words in all the ways people type them -> one clean word
const UNIT_ALIASES: Record<string, string> = {
  // teaspoons
  't': 'teaspoon', 'tsp': 'teaspoon', 'tsps': 'teaspoon', 'tsp.': 'teaspoon',
  'teaspoon': 'teaspoon', 'teaspoons': 'teaspoon',

  // tablespoons
  'tbsp': 'tablespoon', 'tbsp.': 'tablespoon', 'tbs': 'tablespoon', 'tbl': 'tablespoon',
  'tablespoon': 'tablespoon', 'tablespoons': 'tablespoon',

  // cups
  'c': 'cup', 'c.': 'cup', 'cup': 'cup', 'cups': 'cup',

  // ounces (by weight)
  'oz': 'ounce', 'ounce': 'ounce', 'ounces': 'ounce',

  // pounds
  'lb': 'pound', 'lbs': 'pound', 'pound': 'pound', 'pounds': 'pound',

  // grams/kilos
  'g': 'gram', 'gram': 'gram', 'grams': 'gram',
  'kg': 'kilogram', 'kilogram': 'kilogram', 'kilograms': 'kilogram',

  // milliliters/liters
  'ml': 'milliliter', 'milliliter': 'milliliter', 'milliliters': 'milliliter',
  'l': 'liter', 'liter': 'liter', 'liters': 'liter',

  // fluid ounces (as a volume)
  'fl oz': 'fluid_ounce', 'floz': 'fluid_ounce', 'fluid ounce': 'fluid_ounce', 'fluid ounces': 'fluid_ounce',

  // “loose” units that are still helpful
  'pinch': 'pinch', 'pinches': 'pinch',
  'dash': 'dash', 'dashes': 'dash',
  'clove': 'clove', 'cloves': 'clove',
  'slice': 'slice', 'slices': 'slice',
  'stick': 'stick', 'sticks': 'stick',
  'can': 'can', 'cans': 'can',
};

// 2) unicode fractions so “½” becomes 0.5, etc.
const UNICODE_FRAC: Record<string, number> = {
  '¼': 1/4, '½': 1/2, '¾': 3/4,
  '⅐': 1/7, '⅑': 1/9, '⅒': 1/10,
  '⅓': 1/3, '⅔': 2/3,
  '⅕': 1/5, '⅖': 2/5, '⅗': 3/5, '⅘': 4/5,
  '⅙': 1/6, '⅚': 5/6,
  '⅛': 1/8, '⅜': 3/8, '⅝': 5/8, '⅞': 7/8,
};

/* ------------------------------- tiny helpers ------------------------------- */

// turn a quantity string into a number (when possible)
function toNumber(q: string | null | undefined): number | null {
  if (!q) return null;
  const s = q.trim();

  // unicode-only, like "½"
  if (s.length === 1 && UNICODE_FRAC[s] != null) return UNICODE_FRAC[s];

  // mixed number "1 1/2"
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const a = parseInt(mixed[1], 10);
    const b = parseInt(mixed[2], 10);
    const c = parseInt(mixed[3], 10);
    return c ? a + b / c : a;
  }

  // simple fraction "3/4"
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const b = parseInt(frac[1], 10);
    const c = parseInt(frac[2], 10);
    return c ? b / c : null;
  }

  // range like "2-3" → we’ll keep qty as first number
  const range = s.match(/^(\d+(?:\.\d+)?)\s*-\s*\d+(?:\.\d+)?$/);
  if (range) return parseFloat(range[1]);

  // plain number
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// make the unit key nice so we can look it up
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

// do we need plural: “1 cup” vs “2 cups”
function shouldPluralize(qtyText: string) {
  if (!qtyText) return false;
  if (/^1$/.test(qtyText)) return false;                   // 1
  if (/^\d+\/\d+$/.test(qtyText)) return false;             // 1/2
  if (/^\d+\s+\d+\/\d+$/.test(qtyText)) return true;        // 1 1/2
  if (/^\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?$/.test(qtyText)) return true; // 2-3
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
    fluid_ounce:'fl oz', // keep short; already “plural”
  };
  return map[unit] || unit;
}

// pull notes like "(optional)" or ", diced" into a note, but keep the food words
function splitNotesKeepFood(s: string): { core: string; note: string | null } {
  const notes: string[] = [];
  let core = s;

  // parentheses → notes
  core = core.replace(/\(([^)]+)\)/g, (_, p1) => {
    const txt = String(p1).trim();
    if (txt) notes.push(txt);
    return ' ';
  });

  // trailing ", diced/chopped/..." → notes
  core = core.replace(
    /,\s*(diced|chopped|minced|shredded|grated|softened|melted|room\s*temperature|to\s*taste)\b/gi,
    (_m, w) => { notes.push(String(w).toLowerCase()); return ''; }
  );

  core = core.replace(/\s{2,}/g, ' ').trim();
  return { core, note: notes.length ? Array.from(new Set(notes)).join(', ') : null };
}

/* ------------------------------ main parsers ------------------------------ */

// parse ONE text line → a ParsedIngredient we can show
export function parseIngredientLine(line: string): ParsedIngredient {
  const original = String(line || '').trim();
  if (!original) return { original, qty: null, unit: null, item: '', note: null, canonical: '' };

  // find: [QTY] [maybe-UNIT] [REST]
  // NOTE: if the second token is NOT a real unit (e.g. "jalapenos"), we glue it back to REST.
  const m = original.match(
    /^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|[¼-¾⅐-⅞]|(?:\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?))\s*([A-Za-zÀ-ÿ.]+)?\s*(.*)$/
  );

  let qtyText = '';
  let qty: number | null = null;
  let unitCanon: string | null = null;
  let rest = original;

  if (m) {
    qtyText = m[1] || '';
    qty = toNumber(qtyText);

    const unitRaw = (m[2] || '').trim();
    const after   = (m[3] || '').trim();

    const normalized = normalizeUnitRaw(unitRaw);
    if (unitRaw && !normalized) {
      // NOT a real unit → it's actually part of the food (e.g., "jalapenos")
      unitCanon = null;
      rest = `${unitRaw} ${after}`.trim();
    } else {
      unitCanon = normalized;
      rest = after;
    }
  } else {
    // also support “pinch of salt” / “dash of sugar”
    const uLead = original.match(/^([A-Za-z. ]+)\s+of\s+(.*)$/i);
    if (uLead) {
      const maybeUnit = normalizeUnitRaw(uLead[1]);
      if (maybeUnit) {
        unitCanon = maybeUnit;
        rest = (uLead[2] || '').trim();
      }
    }
  }

  // drop leading "of" (ex: "1 cup of sugar" → "sugar")
  rest = rest.replace(/^\bof\b\s+/i, '').trim();

  // keep adjectives like “boneless skinless”, pull only clean notes
  const { core, note } = splitNotesKeepFood(rest);
  const item = core;

  // build a nice canonical string
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

// parse MANY lines → list of ParsedIngredient (with tiny dedupe + salt/pepper merge)
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

  // cute merge: "Salt" + "Pepper" → "Salt and pepper to taste"
  const iSalt = out.findIndex(x => /^salt$/i.test(x.canonical));
  const iPep  = out.findIndex(x => /^pepper(\s+to\s+taste)?$/i.test(x.canonical));
  if (iSalt !== -1 && iPep !== -1) {
    const first = Math.min(iSalt, iPep);
    const merged: ParsedIngredient = {
      original: 'Salt and pepper to taste',
      qty: null, unit: null, item: 'salt and pepper', note: 'to taste',
      canonical: 'Salt and pepper to taste',
    };
    const keep: ParsedIngredient[] = [];
    out.forEach((p, idx) => { if (idx !== iSalt && idx !== iPep) keep.push(p); });
    keep.splice(first, 0, merged);
    return keep;
  }

  return out;
}
