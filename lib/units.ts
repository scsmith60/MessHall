// super-simple kitchen unit converter for display only.
// it converts between common US <-> METRIC units.
// if we don't recognize the unit, we return the original.

export type UnitsPref = "us" | "metric";

type Qty = number | string | null | undefined;

const toNum = (x: Qty) => (typeof x === "number" ? x : parseFloat(String(x ?? "")));

const round = (n: number, dp = 2) => {
  const p = Math.pow(10, dp);
  return Math.round(n * p) / p;
};

// factors based on standard kitchen measures
const G_PER_OZ = 28.3495;
const ML_PER_TSP = 4.92892;
const TSP_PER_TBSP = 3;
const TBSP_PER_CUP = 16;
const ML_PER_CUP = ML_PER_TSP * TSP_PER_TBSP * TBSP_PER_CUP; // ~236.588
const G_PER_LB = 453.592;
const C_PER_F = (f: number) => (f - 32) * (5 / 9);
const F_PER_C = (c: number) => c * (9 / 5) + 32;

type Unit =
  | "tsp" | "tbsp" | "cup"
  | "oz" | "lb" | "g" | "kg"
  | "ml" | "l"
  | "°f" | "°c";

const normalizeUnit = (u: string): Unit | null => {
  const s = u.trim().toLowerCase();
  if (["teaspoon","teaspoons","tsp"].includes(s)) return "tsp";
  if (["tablespoon","tablespoons","tbsp"].includes(s)) return "tbsp";
  if (["cup","cups"].includes(s)) return "cup";
  if (["ounce","ounces","oz"].includes(s)) return "oz";
  if (["pound","pounds","lb","lbs"].includes(s)) return "lb";
  if (["gram","grams","g"].includes(s)) return "g";
  if (["kilogram","kilograms","kg"].includes(s)) return "kg";
  if (["milliliter","millilitre","milliliters","millilitres","ml"].includes(s)) return "ml";
  if (["liter","litre","liters","litres","l"].includes(s)) return "l";
  if (["f","°f","fahrenheit"].includes(s)) return "°f";
  if (["c","°c","celsius","centigrade"].includes(s)) return "°c";
  return null;
};

export function convertForDisplay(
  quantity: Qty,
  unit: string | null | undefined,
  pref: UnitsPref
): { qty: number | string, unit: string } {
  if (!unit) return { qty: quantity ?? "", unit: "" };

  const n = toNum(quantity);
  const u = normalizeUnit(unit);
  if (!u || Number.isNaN(n)) return { qty: quantity ?? "", unit: unit };

  // already preferred
  if (pref === "us") {
    switch (u) {
      case "g":   return { qty: round(n / G_PER_OZ, 2), unit: "oz" };
      case "kg":  return { qty: round((n * 1000) / G_PER_OZ / 16, 2), unit: "lb" };
      case "ml":  {
        // convert to tsp/tbsp/cup with friendly thresholds
        if (n < 15) return { qty: round(n / ML_PER_TSP, 2), unit: "tsp" };
        if (n < 90) return { qty: round(n / (ML_PER_TSP * TSP_PER_TBSP), 2), unit: "tbsp" };
        return { qty: round(n / ML_PER_CUP, 2), unit: "cup" };
      }
      case "l":   return { qty: round((n * 1000) / ML_PER_CUP, 2), unit: "cup" };
      case "°c":  return { qty: Math.round(F_PER_C(n)), unit: "°F" };
      default:    return { qty: n, unit: pretty(u) };
    }
  } else {
    // metric preferred
    switch (u) {
      case "oz":  return { qty: round(n * G_PER_OZ, 0), unit: "g" };
      case "lb":  return { qty: round(n * G_PER_LB / 1000, 2), unit: "kg" };
      case "tsp": return { qty: round(n * ML_PER_TSP, 0), unit: "ml" };
      case "tbsp":return { qty: round(n * ML_PER_TSP * TSP_PER_TBSP, 0), unit: "ml" };
      case "cup": return { qty: round(n * ML_PER_CUP, 0), unit: "ml" };
      case "°f":  return { qty: Math.round(C_PER_F(n)), unit: "°C" };
      default:    return { qty: n, unit: pretty(u) };
    }
  }
}

const pretty = (u: Unit) => {
  switch (u) {
    case "tsp": return "tsp";
    case "tbsp": return "tbsp";
    case "cup": return "cup";
    case "oz": return "oz";
    case "lb": return "lb";
    case "g": return "g";
    case "kg": return "kg";
    case "ml": return "ml";
    case "l": return "L";
    case "°f": return "°F";
    case "°c": return "°C";
  }
};
