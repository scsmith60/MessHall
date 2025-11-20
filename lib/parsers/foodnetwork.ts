// lib/parsers/foodnetwork.ts
// Food Network-specific parser with smart fetch and AMP fallback

/* ---------------------------- ⭐ FOOD NETWORK SMART FETCH (AMP + optional proxy) ---------------------------- */
const FOODNETWORK_PROXY_URL = ""; // e.g., "https://YOUR_PROJECT_REF.functions.supabase.co/fn_foodnetwork_fetch"

export function isFoodNetworkUrl(u: string): boolean {
  try { return new URL(u).hostname.replace(/^www\./, "").endsWith("foodnetwork.com"); }
  catch { return /foodnetwork\.com/i.test(u); }
}

function ensureHttps(input: string): string {
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  return `https://${input}`;
}

function buildFNAmpCandidates(input: string): string[] {
  const out: string[] = [];
  try {
    const u = new URL(ensureHttps(input));
    const ampRef = new URL(u); ampRef.searchParams.set("ref", "amp"); out.push(ampRef.toString());
    const ampDot = new URL(u);
    if (ampDot.pathname.endsWith(".html")) ampDot.pathname = ampDot.pathname.replace(/\.html$/, ".amp");
    else if (!ampDot.pathname.endsWith(".amp") && !/\.[a-z]{2,5}$/i.test(ampDot.pathname)) ampDot.pathname += ".amp";
    out.push(ampDot.toString());
  } catch {}
  return out;
}

async function fetchFoodNetworkHtmlSmart(
  pageUrl: string,
  fetchWithUA: (url: string, ms: number, as: "json" | "text") => Promise<any>
): Promise<{ html: string; from: string } | null> {
  const tries = [pageUrl, ...buildFNAmpCandidates(pageUrl)];
  for (const href of tries) {
    try {
      const html = await fetchWithUA(href, 12000, "text");
      if (html && !/Access Denied/i.test(html)) return { html, from: href };
    } catch {}
  }
  if (FOODNETWORK_PROXY_URL) {
    for (const href of tries) {
      try {
        const prox = `${FOODNETWORK_PROXY_URL}?url=${encodeURIComponent(href)}`;
        const res = (await withTimeout(fetch(prox), 12000)) as Response;
        if (res.ok) {
          const html = await res.text();
          if (html && !/Access Denied/i.test(html)) return { html, from: href };
        }
      } catch {}
    }
  }
  try {
    const mirror = `https://r.jina.ai/http://www.foodnetwork.com${new URL(pageUrl).pathname}`;
    const res = (await withTimeout(fetch(mirror), 12000)) as Response;
    if (res.ok) {
      const html = await res.text();
      if (html) return { html, from: "mirror" };
    }
  } catch {}
  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

function parseRecipeLdFromHtml(html: string) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const objs: any[] = [];
  for (const m of blocks) {
    try {
      const json = JSON.parse(m[1]);
      const list = Array.isArray(json) ? json : [json];
      for (const node of list) {
        const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node];
        for (const item of graph) objs.push(item);
      }
    } catch {}
  }
  const recipe = objs.find((n) => {
    const t = n?.['@type'];
    return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
  });
  if (!recipe) return null;

  const rawInstr = recipe.recipeInstructions ?? [];
  const steps: string[] = Array.isArray(rawInstr)
    ? rawInstr.map((s: any) =>
        typeof s === "string" ? s :
        typeof s?.text === "string" ? s.text :
        typeof s?.name === "string" ? s.name : ""
      ).filter(Boolean)
    : [];

  const imgVal = recipe.image;
  let image: string | null = null;
  if (typeof imgVal === "string") image = imgVal;
  else if (Array.isArray(imgVal)) image = imgVal.find((v: any) => typeof v === "string") || null;
  else if (imgVal && typeof imgVal === "object") image = imgVal.url || imgVal['@id'] || null;

  return {
    title: (recipe.name ?? "").toString(),
    image,
    ingredients: Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient.filter(Boolean) : [],
    steps
  };
}

function extractMetaContent(html: string, nameOrProp: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
  const m = html.match(re);
  return m?.[1]?.trim() || null;
}

function absolutizeImageUrl(candidate: string, base: string): string | null {
  if (!candidate) return null;
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function cleanTitle(raw: string, url: string): string {
  let s = raw.trim();
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return "";
    }
  })();
  
  // Remove site name suffixes
  const splitters = [" | ", " - ", " • ", " - "];
  for (const splitter of splitters) {
    if (s.includes(splitter)) {
      const parts = s.split(splitter);
      if (parts.length > 1) {
        const last = parts[parts.length - 1].toLowerCase();
        if (last.includes("food network") || last.includes("allrecipes") || last.includes("youtube")) {
          s = parts.slice(0, -1).join(splitter).trim();
        }
      }
    }
  }
  
  return s;
}

function maybeUpgradeSndimg(url: string): string {
  // Simple stub - just return the URL as-is
  // If you have image upgrade logic, add it here
  return url;
}

function extractAllImageCandidatesFromHtml(html: string, baseUrl: string): string[] {
  const candidates: string[] = [];
  try {
    // Try to find images in JSON-LD
    const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of blocks) {
      try {
        const json = JSON.parse(m[1]);
        const list = Array.isArray(json) ? json : [json];
        for (const node of list) {
          const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node];
          for (const item of graph) {
            if (item?.['@type'] === 'Recipe' || (Array.isArray(item?.['@type']) && item['@type'].includes('Recipe'))) {
              const img = item.image;
              if (typeof img === "string") candidates.push(img);
              else if (Array.isArray(img)) {
                for (const v of img) {
                  if (typeof v === "string") candidates.push(v);
                  else if (v?.url) candidates.push(v.url);
                }
              } else if (img?.url) candidates.push(img.url);
            }
          }
        }
      } catch {}
    }
    
    // Try OG image
    const og = extractMetaContent(html, "og:image");
    if (og) candidates.push(og);
    
    // Try Twitter image
    const tw = extractMetaContent(html, "twitter:image");
    if (tw) candidates.push(tw);
  } catch {}
  return candidates.map(c => absolutizeImageUrl(c, baseUrl)).filter((c): c is string => c !== null);
}

export async function getFoodNetworkBits(
  pageUrl: string,
  fetchWithUA: (url: string, ms: number, as: "json" | "text") => Promise<any>
) {
  const fetched = await fetchFoodNetworkHtmlSmart(pageUrl, fetchWithUA);
  if (!fetched) return null;

  const parsed = parseRecipeLdFromHtml(fetched.html);
  if (!parsed) {
    const title = cleanTitle(
      extractMetaContent(fetched.html, "og:title") || extractMetaContent(fetched.html, "twitter:title") || "",
      pageUrl
    );
    const image = absolutizeImageUrl(
      extractMetaContent(fetched.html, "og:image") || extractMetaContent(fetched.html, "twitter:image") || "",
      pageUrl
    );
    return { title, image, ingredients: [], steps: [] };
  }
  return {
    title: parsed.title ? cleanTitle(parsed.title, pageUrl) : "",
    image: parsed.image ? absolutizeImageUrl(parsed.image, pageUrl) : null,
    ingredients: parsed.ingredients || [],
    steps: parsed.steps || [],
  };
}

export async function getFoodNetworkBestImage(
  pageUrl: string,
  fetchWithUA: (url: string, ms: number, as: "json" | "text") => Promise<any>
): Promise<string | null> {
  const fetched = await fetchFoodNetworkHtmlSmart(pageUrl, fetchWithUA);
  if (!fetched) return null;

  const node = parseRecipeLdFromHtml(fetched.html);
  if (node?.image) {
    const u = absolutizeImageUrl(node.image, pageUrl);
    if (u) return maybeUpgradeSndimg(u);
  }
  const og = extractMetaContent(fetched.html, "og:image") || extractMetaContent(fetched.html, "twitter:image");
  if (og) {
    const u = absolutizeImageUrl(og, pageUrl);
    if (u) return maybeUpgradeSndimg(u);
  }
  const all = extractAllImageCandidatesFromHtml(fetched.html, pageUrl);
  if (all.length) return all[0];
  return null;
}
