// lib/recipeSiteHelpers.ts
// 🧑 ELI5: Detects which site we're on and knows how to read recipes from each one

export function detectSiteType(url: string): "tiktok" | "instagram" | "facebook" | "recipe-site" | "generic" {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    
    if (h.includes("tiktok.com") || h === "vm.tiktok.com") return "tiktok";
    if (h.includes("instagram.com")) return "instagram";
    if (h.includes("facebook.com") || h.includes("fb.com")) return "facebook";
    
    // Major recipe sites
    const recipeSites = [
      "allrecipes.com",
      "food.com",
      "foodnetwork.com",
      "epicurious.com",
      "bonappetit.com",
      "seriouseats.com",
      "simplyrecipes.com",
      "delish.com",
      "tasty.co",
      "cookieandkate.com",
      "budgetbytes.com",
      "skinnytaste.com",
      "thekitchn.com",
      "minimalistbaker.com",
      "pinchofyum.com",
      "recipetineats.com",
      "sallysbakingaddiction.com",
      "smittenkitchen.com",
      "kingarthurbaking.com",
      "bettycrocker.com",
      "pillsbury.com",
      "tasteofhome.com",
      "myrecipes.com",
      "cookinglight.com",
      "eatingwell.com",
      "realsimple.com",
      "southernliving.com",
      "bhg.com",
      "marthastewart.com",
      "jamieoliver.com",
      "gordonramsay.com",
      "bbcgoodfood.com",
    ];
    
    if (recipeSites.some(site => h.includes(site))) return "recipe-site";
    
    return "generic";
  } catch {
    return "generic";
  }
}

// Enhanced JSON-LD reader for recipe sites
export function extractRecipeFromJsonLd(html: string): {
  title?: string;
  ingredients?: string[];
  steps?: string[];
  image?: string;
  time?: string;
  servings?: string;
} | null {
  try {
    const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    
    for (const match of scripts) {
      try {
        const json = JSON.parse(match[1]);
        const items = Array.isArray(json) ? json : json["@graph"] ? json["@graph"] : [json];
        
        for (const item of items) {
          const type = item["@type"];
          const isRecipe = typeof type === "string" 
            ? /Recipe/i.test(type)
            : Array.isArray(type) && type.some((t: any) => /Recipe/i.test(String(t)));
          
          if (!isRecipe) continue;
          
          // Extract recipe data
          const result: any = {};
          
          if (item.name) result.title = String(item.name).trim();
          
          // Ingredients
          if (item.recipeIngredient && Array.isArray(item.recipeIngredient)) {
            result.ingredients = item.recipeIngredient.map((i: any) => String(i).trim());
          }
          
          // Steps
          if (item.recipeInstructions) {
            const instructions = item.recipeInstructions;
            const steps: string[] = [];
            
            if (typeof instructions === "string") {
              steps.push(instructions);
            } else if (Array.isArray(instructions)) {
              for (const step of instructions) {
                if (typeof step === "string") {
                  steps.push(step);
                } else if (step.text) {
                  steps.push(String(step.text));
                } else if (step["@type"] === "HowToStep" && step.itemListElement) {
                  steps.push(String(step.itemListElement));
                }
              }
            }
            
            if (steps.length) result.steps = steps.map(s => s.trim());
          }
          
          // Image
          if (item.image) {
            if (typeof item.image === "string") {
              result.image = item.image;
            } else if (Array.isArray(item.image) && item.image[0]) {
              result.image = typeof item.image[0] === "string" ? item.image[0] : item.image[0].url;
            } else if (item.image.url) {
              result.image = item.image.url;
            }
          }
          
          // Time
          if (item.totalTime) {
            result.time = parseDuration(item.totalTime);
          } else if (item.cookTime || item.prepTime) {
            const cook = parseDuration(item.cookTime || "");
            const prep = parseDuration(item.prepTime || "");
            if (cook || prep) {
              const total = (parseInt(cook) || 0) + (parseInt(prep) || 0);
              result.time = total ? String(total) : undefined;
            }
          }
          
          // Servings
          if (item.recipeYield) {
            const y = Array.isArray(item.recipeYield) ? item.recipeYield[0] : item.recipeYield;
            result.servings = String(y).replace(/[^\d]/g, "") || undefined;
          }
          
          if (result.title || result.ingredients?.length || result.steps?.length) {
            return result;
          }
        }
      } catch {}
    }
    
    return null;
  } catch {
    return null;
  }
}

// Parse ISO 8601 duration to minutes
function parseDuration(duration: string): string | undefined {
  if (!duration) return undefined;
  try {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (match) {
      const hours = parseInt(match[1] || "0");
      const mins = parseInt(match[2] || "0");
      const total = hours * 60 + mins;
      return total ? String(total) : undefined;
    }
  } catch {}
  return undefined;
}

// Extract from microdata (some sites use this instead of JSON-LD)
export function extractRecipeFromMicrodata(html: string): {
  title?: string;
  ingredients?: string[];
  steps?: string[];
} | null {
  try {
    const result: any = {};
    
    // Title from h1[itemprop="name"]
    const titleMatch = html.match(/<h1[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h1>/i);
    if (titleMatch) {
      result.title = titleMatch[1].replace(/<[^>]*>/g, "").trim();
    }
    
    // Ingredients from [itemprop="recipeIngredient"]
    const ingMatches = [...html.matchAll(/itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)<\//gi)];
    if (ingMatches.length) {
      result.ingredients = ingMatches
        .map(m => m[1].replace(/<[^>]*>/g, "").trim())
        .filter(Boolean);
    }
    
    // Steps from [itemprop="recipeInstructions"]
    const stepMatches = [...html.matchAll(/itemprop=["']recipeInstructions["'][^>]*>([\s\S]*?)<\//gi)];
    if (stepMatches.length) {
      result.steps = stepMatches
        .map(m => m[1].replace(/<[^>]*>/g, "").trim())
        .filter(Boolean);
    }
    
    return Object.keys(result).length ? result : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Instagram Title Helpers (make short & clean from long captions)
// ─────────────────────────────────────────────────────────────
export function stripInstagramBoilerplate(s: string): string {
  if (!s) return s;
  // Drop prefixes like: "5 likes, 0 comments - user on <date>:"
  s = s.replace(/^\s*\d[\d,.\s]*\s+likes?,?\s*\d[\d,.\s]*\s+comments?\s*-\s*[^:]+:\s*/i, "");
  // If it still starts "username: ..." drop until first colon
  s = s.replace(/^[^:]{2,40}:\s+/, "");
  return s.trim();
}

export function extractRecipeTitleFromInstagram(caption: string): string {
  if (!caption) return "";
  let c = stripInstagramBoilerplate(caption);

  // Prefer first quoted phrase
  const q = c.match(/[“"']([^“"']{3,80})[”"']/);
  if (q && q[1]) c = q[1];

  // Split at tilde or newline
  c = c.split(/\s*~\s*|\r?\n/)[0].trim();

  // Strip leading hashtags/mentions
  c = c.replace(/^([#@]\S+\s+){1,4}/, "").trim();

  // Remove emojis/symbols but keep common fractions
  c = c.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").replace(/[“”‘’"<>]/g, "").trim();

  if (c.length > 72) c = c.slice(0, 72).trim();
  if (!c) c = "Recipe";
  return c;
}
