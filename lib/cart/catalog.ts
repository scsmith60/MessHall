// lib/cart/catalog.ts
// LIKE I'M 5:
// - This file *guesses* the shopping aisle (category) when your DB item has no category.
// - It also converts kitchen amounts into store sizes (like "1/3 cup flour" → "5 lb bag").
// - And it holds a tiny sample catalog for quick suggestions.

export type SimpleCatalogEntry = {
  title: string;         // "Shredded Monterey Jack Cheese"
  variant?: string;      // "8 oz"
  walmartId?: string;
  amazonAsin?: string;
  krogerUpc?: string;
  hebSku?: string;
  albertsonsSku?: string;
};

// 🔤 tiny helper: does the string include ANY of these words/phrases?
function hasAny(s: string, words: string[]) {
  const n = s.toLowerCase();
  return words.some((w) => n.includes(w));
}

/* ===========================================================
   🧭 CATEGORY GUESSER
   - We only changed TWO little things (safe + minimal):
     1) Put vanilla extract under Baking
     2) Put oats/oatmeal/granola/cereal under Breakfast & Cereal
   - Everything else stays the same.
   =========================================================== */
export function categorizeIngredient(name: string): string {
  const n = (name || "").toLowerCase();

  // ✅ NEW: Breakfast aisle for oat-based breakfast things
  if (hasAny(n, ["oats", "oatmeal", "rolled oats", "old-fashioned oats", "quick oats", "granola", "cereal"])) {
    return "Breakfast & Cereal";
  }

  // ✅ NEW: Baking bucket for vanilla extract and common baking bits
  if (
    hasAny(n, [
      "vanilla extract",
      "vanilla paste",
      "vanilla bean",
      "baking soda",
      "baking powder",
      "cocoa",
      "cacao",
    ])
  ) {
    return "Baking";
  }

  // 🥩 meats
  if (hasAny(n, ["chicken", "beef", "pork", "turkey", "sausage", "bacon", "ham", "ground"])) return "Meat/Protein";

  // 🐟 seafood
  if (hasAny(n, ["salmon", "tuna", "shrimp", "cod", "tilapia", "fish"])) return "Seafood";

  // 🥛 dairy/eggs
  if (hasAny(n, ["milk", "cheese", "butter", "yogurt", "cream", "mozzarella", "cheddar", "monterey", "parmesan", "egg"]))
    return "Dairy/Eggs";

  // 🥬 produce
  if (
    hasAny(n, [
      "tomato",
      "onion",
      "garlic",
      "pepper",
      "poblano",
      "lettuce",
      "spinach",
      "carrot",
      "celery",
      "potato",
      "avocado",
      "cilantro",
      "lime",
      "lemon",
    ])
  )
    return "Produce";

  // 🧁 pantry (kept as-is; flour/sugar/cornstarch/yeast stay here unless caught earlier)
  if (hasAny(n, ["flour", "sugar", "rice", "pasta", "beans", "lentil", "salt", "baking", "yeast", "cornstarch", "oil", "vinegar"]))
    return "Pantry";

  // 🌶️ spices
  if (hasAny(n, ["cumin", "paprika", "oregano", "basil", "chili", "peppercorn", "cinnamon", "spice", "seasoning", "extract", "vanilla extract"]))
    return "Spices";

  // 🧂 condiments
  if (hasAny(n, ["ketchup", "mustard", "mayo", "sriracha", "soy sauce", "bbq", "salsa", "hot sauce"])) return "Condiments";

  // 🍞 bakery
  if (hasAny(n, ["bread", "bun", "tortilla", "pita", "bagel"])) return "Bakery";

  // 🧊 frozen
  if (hasAny(n, ["frozen"])) return "Frozen";

  // 🥤 beverages
  if (hasAny(n, ["water", "soda", "juice", "coffee", "tea"])) return "Beverages";

  // 🤷 default
  return "Other";
}

/* ===========================================================
   🧮 Quantity helper — reads simple numbers/fractions.
   =========================================================== */
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
  // 1-1/2 → ~1.5
  const mix = tok.match(/^([0-9]+)-([0-9]+)\/([0-9]+)$/);
  if (mix) {
    const a = parseInt(mix[1], 10);
    const b = parseInt(mix[2], 10);
    const c = parseInt(mix[3], 10);
    if (c !== 0) return a + b / c;
  }
  return null;
}

/* ===========================================================
   🛒 Convert kitchen amounts to store-friendly sizes.
   =========================================================== */
export function toStoreQuantity(rawQty: string | undefined, name: string): string | undefined {
  const n = (name || "").toLowerCase();
  const q = (rawQty || "").toLowerCase().trim();

  // countable items just keep a number
  const countables = ["egg", "pepper", "poblano", "tomato", "onion", "lime", "lemon", "jalapeno"];
  if (countables.some((w) => n.includes(w))) {
    const firstTok = q.split(/\s+/)[0];
    const maybe = parseFractionToken(firstTok ?? "");
    return maybe ? String(Math.max(1, Math.round(maybe))) : q || "1";
  }

  // Pantry staples → a bag/box
  if (/(flour|sugar|rice|pasta)/.test(n)) {
    return "5 lb bag";
  }

  // Spices → a jar
  if (/(cumin|paprika|oregano|basil|chili|pepper|cinnamon|spice|seasoning)/.test(n)) {
    return "1 small jar";
  }

  // Cheese (shredded) → 8 oz or 16 oz
  if (/cheese/.test(n) && /shredd/.test(n)) {
    const tok = q.split(/\s+/)[0];
    const maybe = parseFractionToken(tok ?? "");
    if ((maybe ?? 0) >= 2) return "16 oz";
    return "8 oz";
  }

  // Milk default
  if (/milk/.test(n)) return q || "1 gallon";

  return rawQty;
}

/* ===========================================================
   🧾 Tiny sample catalog for suggestions (unchanged)
   =========================================================== */
export const MINI_CATALOG: Record<string, SimpleCatalogEntry[]> = {
  eggs: [
    { title: "Large Eggs", variant: "12 count", walmartId: "w-eggs-12", amazonAsin: "A-EGGS-12", krogerUpc: "K-EGGS-12", hebSku: "H-EGGS-12", albertsonsSku: "AB-EGGS-12" },
    { title: "Cage-Free Large Eggs", variant: "12 count", walmartId: "w-eggs-cf-12", amazonAsin: "A-EGGS-CF-12", krogerUpc: "K-EGGS-CF-12", hebSku: "H-EGGS-CF-12", albertsonsSku: "AB-EGGS-CF-12" },
  ],
  "monterey jack cheese": [
    { title: "Shredded Monterey Jack Cheese", variant: "8 oz",  walmartId: "w-mj-8",   amazonAsin: "A-MJ-8",  krogerUpc: "K-MJ-8",  hebSku: "H-MJ-8",  albertsonsSku: "AB-MJ-8" },
    { title: "Shredded Monterey Jack Cheese", variant: "16 oz", walmartId: "w-mj-16",  amazonAsin: "A-MJ-16", krogerUpc: "K-MJ-16", hebSku: "H-MJ-16", albertsonsSku: "AB-MJ-16" },
  ],
  flour: [
    { title: "All-Purpose Flour", variant: "5 lb bag",  walmartId: "w-flour-5",  amazonAsin: "A-FLOUR-5",  krogerUpc: "K-FLOUR-5",  hebSku: "H-FLOUR-5",  albertsonsSku: "AB-FLOUR-5" },
    { title: "All-Purpose Flour", variant: "10 lb bag", walmartId: "w-flour-10", amazonAsin: "A-FLOUR-10", krogerUpc: "K-FLOUR-10", hebSku: "H-FLOUR-10", albertsonsSku: "AB-FLOUR-10" },
  ],
  milk: [
    { title: "Whole Milk", variant: "1 gallon",   walmartId: "w-milk-1g",  amazonAsin: "A-MILK-1G",  krogerUpc: "K-MILK-1G",  hebSku: "H-MILK-1G",  albertsonsSku: "AB-MILK-1G" },
    { title: "Whole Milk", variant: "0.5 gallon", walmartId: "w-milk-05g", amazonAsin: "A-MILK-05G", krogerUpc: "K-MILK-05G", hebSku: "H-MILK-05G", albertsonsSku: "AB-MILK-05G" },
  ],
  poblano: [
    { title: "Poblano Peppers", variant: "by weight", walmartId: "w-poblano-lb", amazonAsin: "A-POBLANO", krogerUpc: "K-POBLANO", hebSku: "H-POBLANO", albertsonsSku: "AB-POBLANO" },
  ],
};
