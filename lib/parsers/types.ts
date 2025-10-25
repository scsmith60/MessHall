export type ParsedRecipe = {
  title?: string | null;
  ingredients: string[];
  steps: string[];
  servings?: string | null;
  heroImage?: string | null;
  source?: string | null;
};

export function dedupeNormalized(list: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list) {
    const value = (raw || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
