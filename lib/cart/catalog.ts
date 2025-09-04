// lib/cart/catalog.ts
// LIKE I'M 5:
// - We guess the shopping aisle (category).
// - We turn weird kitchen amounts into store-friendly sizes.
// - We hold a tiny brand catalog so we can suggest choices.

export type SimpleCatalogEntry = {
  title: string;         // "Shredded Monterey Jack Cheese"
  variant?: string;      // "8 oz"
  walmartId?: string;
  amazonAsin?: string;
  krogerUpc?: string;
  hebSku?: string;
};

function hasAny(s: string, words: string[]) {
  const n = s.toLowerCase();
  return words.some(w => n.includes(w));
}

export function categorizeIngredient(name: string): string {
  const n = (name || "").toLowerCase();
  if (hasAny(n, ["chicken","beef","pork","turkey","sausage","bacon","ham","ground"])) return "Meat/Protein";
  if (hasAny(n, ["salmon","tuna","shrimp","cod","tilapia","fish"])) return "Seafood";
  if (hasAny(n, ["milk","cheese","butter","yogurt","cream","mozzarella","cheddar","monterey","parmesan","egg"])) return "Dairy/Eggs";
  if (hasAny(n, ["tomato","onion","garlic","pepper","poblano","lettuce","spinach","carrot","celery","potato","avocado","cilantro","lime","lemon"])) return "Produce";
  if (hasAny(n, ["flour","sugar","rice","pasta","beans","lentil","salt","baking","yeast","cornstarch","oil","vinegar"])) return "Pantry";
  if (hasAny(n, ["cumin","paprika","oregano","basil","chili","peppercorn","cinnamon","spice","seasoning"])) return "Spices";
  if (hasAny(n, ["ketchup","mustard","mayo","sriracha","soy sauce","bbq","salsa","hot sauce"])) return "Condiments";
  if (hasAny(n, ["bread","bun","tortilla","pita","bagel"])) return "Bakery";
  if (hasAny(n, ["frozen"])) return "Frozen";
  if (hasAny(n, ["water","soda","juice","coffee","tea"])) return "Beverages";
  return "Other";
}

// 🧠 tiny helper: read fractions like "1/3", "1/2" → 0.33, 0.5
function parseFractionToken(tok: string): number | null {
  // 1, 2, 3
  if (/^[0-9]+$/.test(tok)) return parseInt(tok, 10);
  // 1/3, 3/4, 1/8
  const frac = tok.match(/^([0-9]+)\/([0-9]+)$/);
  if (frac) {
    const a = parseInt(frac[1], 10);
    const b = parseInt(frac[2], 10);
    if (b !== 0) return a / b;
  }
  // 1-1/2 or 1½ etc → just treat as ~1.5
  const mix = tok.match(/^([0-9]+)-([0-9]+)\/([0-9]+)$/);
  if (mix) {
    const a = parseInt(mix[1], 10);
    const b = parseInt(mix[2], 10);
    const c = parseInt(mix[3], 10);
    if (c !== 0) return a + b / c;
  }
  return null;
}

// LIKE I'M 5: if the recipe says "1/3 cup flour", the store sells bags.
// This function turns kitchen units into store sizes.
export function toStoreQuantity(rawQty: string | undefined, name: string): string | undefined {
  const n = (name || "").toLowerCase();
  const q = (rawQty || "").toLowerCase().trim();

  // Countables just keep a number: eggs/peppers/limes/etc.
  const countables = ["egg","pepper","poblano","tomato","onion","lime","lemon","jalapeno"];
  if (countables.some(w => n.includes(w))) {
    // try to read a "4" from "4 large", "4"
    const firstTok = q.split(/\s+/)[0];
    const maybe = parseFractionToken(firstTok ?? "");
    return maybe ? String(Math.max(1, Math.round(maybe))) : q || "1";
  }

  // Pantry staples → a bag/box, no matter the recipe fraction.
  if (/(flour|sugar|rice|pasta)/.test(n)) {
    // if the recipe mentions a tiny amount, still suggest a common bag.
    // 5 lb bag is the safe default most stores carry.
    return "5 lb bag";
  }

  // Spices → a jar
  if (/(cumin|paprika|oregano|basil|chili|pepper|cinnamon|spice|seasoning)/.test(n)) {
    return "1 small jar";
  }

  // Cheese (shredded) → 8 oz or 16 oz bag
  if (/cheese/.test(n) && /shredd/.test(n)) {
    // bigger if recipe says 2+ cups
    const tok = q.split(/\s+/)[0];
    const maybe = parseFractionToken(tok ?? "");
    if ((maybe ?? 0) >= 2) return "16 oz";
    return "8 oz";
  }

  // Milk → 1 gallon default if unknown
  if (/milk/.test(n)) return q || "1 gallon";

  // fallback: keep what we got
  return rawQty;
}

// Tiny quick-pick product catalog so we can show choices.
// (IDs are placeholders; swap with real SKUs/ASINs later.)
export const MINI_CATALOG: Record<string, SimpleCatalogEntry[]> = {
  eggs: [
    { title: "Large Eggs", variant: "12 count", walmartId: "w-eggs-12", amazonAsin: "A-EGGS-12", krogerUpc: "K-EGGS-12", hebSku: "H-EGGS-12" },
    { title: "Cage-Free Large Eggs", variant: "12 count", walmartId: "w-eggs-cf-12", amazonAsin: "A-EGGS-CF-12", krogerUpc: "K-EGGS-CF-12", hebSku: "H-EGGS-CF-12" },
  ],
  "monterey jack cheese": [
    { title: "Shredded Monterey Jack Cheese", variant: "8 oz", walmartId: "w-mj-8", amazonAsin: "A-MJ-8", krogerUpc: "K-MJ-8", hebSku: "H-MJ-8" },
    { title: "Shredded Monterey Jack Cheese", variant: "16 oz", walmartId: "w-mj-16", amazonAsin: "A-MJ-16", krogerUpc: "K-MJ-16", hebSku: "H-MJ-16" },
  ],
  flour: [
    { title: "All-Purpose Flour", variant: "5 lb bag", walmartId: "w-flour-5", amazonAsin: "A-FLOUR-5", krogerUpc: "K-FLOUR-5", hebSku: "H-FLOUR-5" },
    { title: "All-Purpose Flour", variant: "10 lb bag", walmartId: "w-flour-10", amazonAsin: "A-FLOUR-10", krogerUpc: "K-FLOUR-10", hebSku: "H-FLOUR-10" },
  ],
  milk: [
    { title: "Whole Milk", variant: "1 gallon", walmartId: "w-milk-1g", amazonAsin: "A-MILK-1G", krogerUpc: "K-MILK-1G", hebSku: "H-MILK-1G" },
    { title: "Whole Milk", variant: "0.5 gallon", walmartId: "w-milk-05g", amazonAsin: "A-MILK-05G", krogerUpc: "K-MILK-05G", hebSku: "H-MILK-05G" },
  ],
  poblano: [
    { title: "Poblano Peppers", variant: "by weight", walmartId: "w-poblano-lb", amazonAsin: "A-POBLANO", krogerUpc: "K-POBLANO", hebSku: "H-POBLANO" },
  ],
};
