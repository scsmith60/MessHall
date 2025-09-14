// scrapeFoodNetwork.ts
// ------------------------------------------------------------
// Like I'm 5: We open the web page, peek inside the recipe box,
// and pull out the real recipe picture. If the recipe box isn't
// there, we try the "og:image" tag. We skip ad/tracker images.
// ------------------------------------------------------------

export type ImportedRecipe = {
  title?: string;
  imageUrl?: string | null;
  source?: string;
};

// (A) Safe JSON.parse so we don't crash on weird script blobs
function safeParseJSON<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// (B) Try the JSON-LD recipe block(s)
function extractFromJSONLD(
  html: string
): { title?: string; imageUrl?: string | null } | null {
  // find every <script type="application/ld+json">...</script>
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];

  for (const m of scripts) {
    const raw = m[1]?.trim();
    if (!raw) continue;

    const json = safeParseJSON<any>(raw);
    if (!json) continue;

    // Sometimes it's an array, sometimes a single object
    const nodes = Array.isArray(json) ? json : [json];

    for (const node of nodes) {
      // Some sites put everything under @graph
      const graph = node?.['@graph'];
      const candidates = Array.isArray(graph) ? graph : [node];

      for (const item of candidates) {
        const type = item?.['@type'];
        const isRecipe =
          type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
        if (!isRecipe) continue;

        // Image can be: string | string[] | { url: string } | { "@id": string }
        let imageUrl: string | null = null;
        const image = item?.image;

        if (typeof image === 'string') {
          imageUrl = image;
        } else if (Array.isArray(image) && image.length) {
          // pick the first non-ad looking image
          const good = image.find(
            (x) => typeof x === 'string' && isLikelyRecipeImage(x)
          );
          imageUrl =
            (good as string) || (typeof image[0] === 'string' ? image[0] : null);
        } else if (image && typeof image === 'object') {
          imageUrl = image.url || image['@id'] || null;
        }

        const title = item?.name || item?.headline;

        // toss out obvious ad/tracker images
        if (imageUrl && !isLikelyRecipeImage(imageUrl)) imageUrl = null;

        if (title || imageUrl) return { title, imageUrl };
      }
    }
  }
  return null;
}

// (C) Backup: look for <meta property="og:image" content="...">
function extractFromOGImage(html: string): string | null {
  const m = html.match(
    /<meta\s+(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );
  if (m && isLikelyRecipeImage(m[1])) return m[1];
  return m ? m[1] : null;
}

// (D) Very simple "is this probably an ad?" filter
function isLikelyRecipeImage(url: string): boolean {
  const lowered = url.toLowerCase();
  const badBits = [
    'adserver',
    '/ads/',
    'doubleclick',
    'pixel',
    'beacon',
    'track',
    'analytics',
    'grill-ad',
  ];
  return !badBits.some((b) => lowered.includes(b));
}

// (E) Main function you call
export async function importRecipeFromUrl(
  url: string
): Promise<ImportedRecipe> {
  const res = await fetch(url);
  const html = await res.text();
  const source = new URL(url).hostname;

  // Try JSON-LD (best)
  const ld = extractFromJSONLD(html);
  if (ld?.imageUrl || ld?.title) {
    return {
      title: ld?.title,
      imageUrl: ld?.imageUrl || extractFromOGImage(html),
      source,
    };
  }

  // Fallback to og:image
  const og = extractFromOGImage(html);
  return { title: undefined, imageUrl: og, source };
}
