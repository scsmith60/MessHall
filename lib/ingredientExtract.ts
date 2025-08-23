// lib/ingredientExtract.ts
// Standalone normalizer to keep Add/fetch_meta slim.

const VULGAR_MAP: Record<string, string> = {
  '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3',
  '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
};

export function normalizeFractions(s = ''): string {
  return String(s).replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, (m) => VULGAR_MAP[m] || m);
}

export function normalizeIngredientLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let raw of lines) {
    let s = normalizeFractions(raw || '')
      .replace(/\r/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/^[\-\u2022\.\*]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    s = s
      .replace(/\b(for|to)\s+serve\b.*$/i, '')
      .replace(/\bfor\s+garnish\b.*$/i, '')
      .replace(/\bgrease[sd]?\s+pan.*$/i, '');

    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
