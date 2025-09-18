// /lib/shared/units.ts
export type UnitsPref = 'us' | 'metric';

type NormUnit =
  | 'tsp' | 'tbsp' | 'cup' | 'floz' | 'ml' | 'l'
  | 'g' | 'kg' | 'oz' | 'lb'
  | 'c' | 't' | 'T'; // tolerated aliases, normalized below

// --- constants ---
const ML_PER_TSP = 5;
const ML_PER_TBSP = 15;
const ML_PER_FLOZ = 29.5735;
const ML_PER_CUP = 240;                // cooking-friendly
const G_PER_OZ = 28.3495;
const G_PER_LB = 453.592;

// --- aliases ---
const UNIT_ALIASES: Record<string, NormUnit> = Object.fromEntries([
  // teaspoons
  ['tsp','tsp'], ['teaspoon','tsp'], ['tea spoon','tsp'], ['t','tsp'],
  // tablespoons
  ['tbsp','tbsp'], ['tablespoon','tbsp'], ['tbl','tbsp'], ['T','tbsp'],
  // cups
  ['cup','cup'], ['c','cup'],
  // fluid ounces
  ['fl oz','floz'], ['floz','floz'], ['fluid ounce','floz'], ['fluid ounces','floz'],
  // metric volumes
  ['ml','ml'], ['milliliter','ml'], ['millilitre','ml'],
  ['l','l'], ['liter','l'], ['litre','l'],
  // mass
  ['g','g'], ['gram','g'], ['grams','g'],
  ['kg','kg'], ['kilogram','kg'],
  ['oz','oz'], ['ounce','oz'], ['ounces','oz'],
  ['lb','lb'], ['lbs','lb'], ['pound','lb'], ['pounds','lb'],
].map(([k,v]) => [k, v as NormUnit]));

export function normalizeUnit(unit: string | null | undefined): NormUnit | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase();
  return UNIT_ALIASES[u] ?? (UNIT_ALIASES[u.replace(/\./g,'')] ?? null);
}

export function detectSystemFromUnit(unit: string): UnitsPref | null {
  const u = normalizeUnit(unit);
  if (!u) return null;
  if (u === 'ml' || u === 'l' || u === 'g' || u === 'kg') return 'metric';
  if (u === 'tsp' || u === 'tbsp' || u === 'cup' || u === 'floz' || u === 'oz' || u === 'lb') return 'us';
  return null;
}

// rounding helpers
function roundTo(n: number, step: number) { return Math.round(n / step) * step; }
function toNiceUSVolume(ml: number): { qty: number; unit: 'tsp'|'tbsp'|'cup'|'floz' } {
  // choose best US unit by thresholds
  if (ml < 15)       return { qty: roundTo(ml / ML_PER_TSP, 0.25), unit: 'tsp' };
  if (ml < 90)       return { qty: roundTo(ml / ML_PER_TBSP, 0.25), unit: 'tbsp' };
  if (ml < 360)      return { qty: roundTo(ml / ML_PER_FLOZ, 0.25), unit: 'floz' };
  return                 { qty: roundTo(ml / ML_PER_CUP, 0.25), unit: 'cup' };
}
function toNiceMetricVolume(ml: number): { qty: number; unit: 'ml'|'l' } {
  if (ml >= 1000) return { qty: roundTo(ml / 1000, 0.05), unit: 'l' };
  return { qty: Math.round(ml), unit: 'ml' };
}
function toNiceUSMass(g: number): { qty: number; unit: 'oz'|'lb' } {
  if (g >= G_PER_LB) return { qty: roundTo(g / G_PER_LB, 0.05), unit: 'lb' };
  return { qty: roundTo(g / G_PER_OZ, 0.05), unit: 'oz' };
}
function toNiceMetricMass(g: number): { qty: number; unit: 'g'|'kg' } {
  if (g >= 1000) return { qty: roundTo(g / 1000, 0.01), unit: 'kg' };
  return { qty: Math.round(g), unit: 'g' };
}

export function convertForDisplay(
  qty: number,
  unit: string,
  pref: UnitsPref
): { qty: number; unit: string } {
  const u = normalizeUnit(unit);
  if (!u || Number.isNaN(qty)) return { qty, unit };

  // Volume path (ml as hub)
  if (u === 'ml' || u === 'l' || u === 'tsp' || u === 'tbsp' || u === 'cup' || u === 'floz') {
    const ml =
      u === 'ml' ? qty :
      u === 'l' ? qty * 1000 :
      u === 'tsp' ? qty * ML_PER_TSP :
      u === 'tbsp' ? qty * ML_PER_TBSP :
      u === 'floz' ? qty * ML_PER_FLOZ :
      /* cup */     qty * ML_PER_CUP;

    if (pref === 'metric') {
      const m = toNiceMetricVolume(ml);
      return { qty: m.qty, unit: m.unit };
    } else {
      const v = toNiceUSVolume(ml);
      return { qty: v.qty, unit: v.unit };
    }
  }

  // Mass path (g as hub)
  if (u === 'g' || u === 'kg' || u === 'oz' || u === 'lb') {
    const g =
      u === 'g' ? qty :
      u === 'kg' ? qty * 1000 :
      u === 'oz' ? qty * G_PER_OZ :
      /* lb */     qty * G_PER_LB;

    if (pref === 'metric') {
      const m = toNiceMetricMass(g);
      return { qty: m.qty, unit: m.unit };
    } else {
      const w = toNiceUSMass(g);
      return { qty: w.qty, unit: w.unit };
    }
  }

  // Unknown/unsupported → no-op
  return { qty, unit };
}
