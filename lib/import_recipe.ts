// lib/import_recipe.ts
// ELI5: given a web page URL, we try really hard to pull out a recipe.
// Order:
// 1) JSON-LD (schema.org Recipe)
// 2) Microdata fallbacks
// 3) Visible description textContent fallbacks (e.g., DivDescriptionContainer, data-e2e*="desc")
// 4) OG/Twitter description as last resort
//
// We return { title?, ingredients?, steps? }.
// Screens then normalize + display.

import { normalizeIngredientLines } from './ingredients';

// ---------- tiny utils ----------
type ImportedRecipe = {
  title?: string;
  ingredients?: string[];
  steps?: string[];
};

function safeJSON<T=any>(s?: string) { try { return s ? JSON.parse(s) as T : undefined; } catch { return; } }
function stripTags(s: string) { return s.replace(/<[^>]*>/g, ''); }
function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
function textify(htmlChunk: string) {
  return decodeEntities(stripTags(htmlChunk)).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}
function pickMeta(html: string, name: string) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
  const m = html.match(re); if (!m) return "";
  const cm = m[0].match(/content=["']([^"']+)["']/i);
  return cm?.[1]?.trim() || "";
}
function toLines(val: any): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  // split on newlines & common bullet separators
  return String(val)
    .replace(/\r/g,'')
    .split(/\n|[\u2022•·▪▫►▶]/g)
    .map(v => v.trim())
    .filter(Boolean);
}
function asArray<T=any>(x: any): T[] { return Array.isArray(x) ? x : [x]; }

// ---------- JSON-LD ----------
function parseJsonLd(html: string): ImportedRecipe | null {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    const json = safeJSON<any>(s[1]); if (!json) continue;
    const nodes: any[] = [];
    if (Array.isArray(json)) nodes.push(...json);
    else if (json['@graph']) nodes.push(...json['@graph']);
    else nodes.push(json);

    for (const node of nodes) {
      const type = node?.['@type'];
      const isRecipe = typeof type === 'string' ? /Recipe/i.test(type) : Array.isArray(type) && type.some((t:any)=>/Recipe/i.test(String(t)));
      if (!isRecipe) continue;

      const name = (node?.name || node?.headline || '').toString().trim();
      const ings = toLines(node?.recipeIngredient || node?.ingredients);
      let steps: string[] = [];
      const inst = node?.recipeInstructions;
      if (Array.isArray(inst)) {
        for (const it of inst) {
          if (typeof it === 'string') steps.push(it);
          else if (it?.text) steps.push(String(it.text));
          else if (it?.itemListElement) {
            for (const step of asArray(it.itemListElement)) {
              if (typeof step === 'string') steps.push(step);
              else if (step?.text) steps.push(String(step.text));
            }
          }
        }
      } else if (typeof inst === 'string') {
        steps = toLines(inst);
      }

      return {
        title: name || undefined,
        ingredients: ings,
        steps: steps.map(textify).filter(Boolean),
      };
    }
  }
  return null;
}

// ---------- Microdata (light) ----------
function parseMicrodata(html: string): ImportedRecipe | null {
  const ingMatches = [...html.matchAll(/itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const stepMatches = [...html.matchAll(/itemprop=["']recipeInstructions["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)];
  const nameMatch = html.match(/itemprop=["']name["'][^>]*>([\s\S]*?)<\/[^>]+>/i);

  const ingredients = ingMatches.map(m => textify(m[1])).filter(Boolean);
  const steps = stepMatches.map(m => textify(m[1])).filter(Boolean);
  const title = nameMatch ? textify(nameMatch[1]) : '';

  if (ingredients.length || steps.length) {
    return { title: title || undefined, ingredients, steps };
  }
  return null;
}

// ---------- Visible description/caption FALLBACK ----------
// We scan for elements whose class/id/data-e2e mention "desc", "description", "caption",
// or the exact "DivDescriptionContainer" you found. We then take their textContent,
// split to lines, and run our normalizer so units are canonical.
function parseVisibleDescription(html: string): ImportedRecipe | null {
  const CANDIDATE_BLOCK = new RegExp(
    // capture whole opening+content+closing of likely description blocks
    `<([a-z0-9]+)([^>]*?(?:class|id|data-e2e)=["'][^"']*(?:DivDescriptionContainer|description|desc|caption)[^"']*["'][^>]*)>([\\s\\S]*?)<\\/\\1>`,
    'ig'
  );

  const chunks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = CANDIDATE_BLOCK.exec(html))) {
    const inner = textify(m[3]);
    if (inner && inner.length > 8) chunks.push(inner);
  }
  if (!chunks.length) return null;

  // Pick the longest chunk (usually the full description)
  const best = chunks.sort((a,b)=>b.length-a.length)[0];

  // Heuristic: extract lines that look like ingredients
  // (We let normalizeIngredientLines do heavy lifting/aliases.)
  const roughLines = toLines(best);
  const normalized = normalizeIngredientLines(roughLines);
  const ingredients = normalized.map(p => p.canonical).filter(Boolean);

  // Optional: guess steps if we see a 'Steps:' section
  const lower = best.toLowerCase();
  let steps: string[] = [];
  const stepsIdx = lower.indexOf('steps:');
  if (stepsIdx >= 0) {
    steps = toLines(best.slice(stepsIdx + 6));
  }

  if (ingredients.length || steps.length) {
    return { ingredients, steps };
  }
  return null;
}

// ---------- OG/Twitter description fallback ----------
function parseMetaDescriptionFallback(html: string): ImportedRecipe | null {
  const desc = pickMeta(html, 'og:description') || pickMeta(html, 'twitter:description');
  if (!desc) return null;
  const rough = toLines(desc);
  if (!rough.length) return null;
  const normalized = normalizeIngredientLines(rough);
  const ingredients = normalized.map(p => p.canonical).filter(Boolean);
  return { ingredients };
}

// ---------- main ----------
export async function importRecipeFromUrl(url: string): Promise<ImportedRecipe | null> {
  const res = await fetch(url, { redirect: 'follow' });
  const html = await res.text();

  // 1) JSON-LD
  const fromLd = parseJsonLd(html);
  if (fromLd) return fromLd;

  // 2) Microdata
  const fromMicro = parseMicrodata(html);
  if (fromMicro) return fromMicro;

  // 3) Visible description/caption (your DivDescriptionContainer case)
  const fromVisible = parseVisibleDescription(html);
  if (fromVisible) return fromVisible;

  // 4) OG/Twitter description
  const fromMeta = parseMetaDescriptionFallback(html);
  if (fromMeta) return fromMeta;

  return null;
}
