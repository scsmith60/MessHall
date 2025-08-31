// lib/ingredientExtract.ts
// Like I'm 5: this file turns messy ingredient text into neat one-line strings.
// We KEEP important words ("boneless skinless chicken"), fix units ("tsps" → "teaspoons"),
// and make smart notes ("(optional)", "diced"). It returns string[] so the UI stays happy.
//
// This is the ONLY place fetch_meta calls to clean ingredients.

export function normalizeIngredientLines(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (let raw of (lines || [])) {
    const parsed = parseIngredientLine(String(raw));
    const canon = parsed.canonical.trim();
    if (!canon) continue;
    const key = canon.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canon);
  }

  // Nice touch: if list has both "Salt" and "Pepper", merge → "Salt and pepper to taste"
  const iSalt = out.findIndex(x => /^salt$/i.test(x));
  const iPep  = out.findIndex(x => /^pepper\b/i.test(x));
  if (iSalt !== -1 && iPep !== -1) {
    const first = Math.min(iSalt, iPep);
    const last  = Math.max(iSalt, iPep);
    out.splice(first, 1);
    out.splice(last - 1, 1);
    out.splice(first, 0, 'Salt and pepper to taste');
  }

  return out;
}

// Optional helper if you pass one big paragraph instead of lines.
export function normalizeIngredientBlock(block: string): string[] {
  return normalizeIngredientLines(
    String(block)
      .replace(/\r/g, '')
      .split(/\n|;|[|]|[\u2022•·▪▫►▶]/g)
      .map(s => s.replace(/^[\s\-–—•*·\u2022]+/, '').trim())
      .filter(Boolean)
  );
}

/* -------------------------- parser guts below -------------------------- */

type Parsed = {
  original: string;
  qtyText: string;      // "1 1/2", "2", "½", "2-3"
  unitCanon: string | null; // teaspoon, cup, ounce… (singular), or null
  item: string;         // KEEP adjectives here
  note: string | null;  // "diced", "optional", etc.
  canonical: string;    // pretty one-line we show in UI
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

  const range = q.match(/^(\d+(?:\.\d+)?)[\s-]+(\d+(?:\.\d+)?)$/);
  if (range) return parseFloat(range[1]);

  const mixed = q.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1], 10) + (parseInt(mixed[2], 10) / parseInt(mixed[3], 10));

  const frac = q.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);

  const n = Number(q);
  return isFinite(n) ? n : null;
}

// unit dictionary (we store canonical singular)
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
  if (/^1$/.test(qtyText)) return false;            // "1"
  if (/^\d+\/\d+$/.test(qtyText)) return false;      // "1/2"
  if (/^\d+\s+\d+\/\d+$/.test(qtyText)) return true; // "1 1/2"
  if (/^\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?$/.test(qtyText)) return true; // "2-3"
  if (/^\d*\.\d+$/.test(qtyText)) return parseFloat(qtyText) > 1;
  return Number(qtyText) > 1;
}

function pluralizeUnit(unit: string, qtyText: string): string {
  if (!unit) return '';
  const p = shouldPluralize(qtyText);
  if (!p) return unit;
  const map: Record<string, string> = {
    milliliter: 'milliliters', liter: 'liters',
    ounce: 'ounces', gram: 'grams', kilogram: 'kilograms',
    pound: 'pounds', teaspoon: 'teaspoons', tablespoon: 'tablespoons',
    cup: 'cups', pinch: 'pinches', dash: 'dashes',
    clove: 'cloves', can: 'cans', stick: 'sticks', slice: 'slices',
  };
  return map[unit] || unit;
}

// Pull notes but keep food words in the item.
function splitNotesKeepFood(core: string): { core: string; note: string | null } {
  const notes: string[] = [];
  let s = core;

  // parentheses become notes
  s = s.replace(/\(([^)]+)\)/g, (_, p1) => {
    const txt = String(p1).trim();
    if (txt) notes.push(txt);
    return ' ';
  });

  // common trailing notes
  s = s.replace(/,\s*(diced|chopped|minced|shredded|grated|softened|melted|room\s*temperature)\b/gi,
    (_m, w) => { notes.push(String(w).toLowerCase()); return ''; });

  s = s.replace(/\s{2,}/g, ' ').trim();
  return { core: s, note: notes.length ? Array.from(new Set(notes)).join(', ') : null };
}

// IMPORTANT FIX: if the word after the number is NOT a real unit (like "jalapenos"),
// we glue it back into the item so "2 jalapenos, diced" doesn’t become "2, diced".
function parseIngredientLine(line: string): Parsed {
  const original = String(line).trim();
  let qtyText = '';
  let unitCanon: string | null = null;
  let rest = original;

  // QTY [maybe-UNIT] REST  (allow accents so "jalapeño" is fine)
  const m = original.match(
    /^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|[¼-¾⅐-⅞]|(?:\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?))\s*([A-Za-zÀ-ÿ.]+)?\s*(.*)$/
  );
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
    const uLead = original.match(/^([A-Za-z. ]+)\s+of\s+(.*)$/i);
    if (uLead) {
      const unitMaybe = normalizeUnitRaw(uLead[1]);
      if (unitMaybe) {
        unitCanon = unitMaybe;
        rest = uLead[2].trim();
      }
    }
  }

  rest = rest.replace(/^\bof\b\s+/i, '').trim();

  const { core, note } = splitNotesKeepFood(rest);
  const item = core;

  // build pretty string
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
