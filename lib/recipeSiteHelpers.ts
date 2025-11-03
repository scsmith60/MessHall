// lib/recipeSiteHelpers.ts
// 🧑 ELI5: Detects which site we're on and knows how to read recipes from each one

import { supabase } from "./supabase";

// Cache for discovered recipe sites (to avoid hitting DB on every call)
let discoveredSitesCache: Set<string> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Shared list of known recipe sites (used by both detectSiteType and discoverRecipeSiteIfNeeded)
const KNOWN_RECIPE_SITES = [
  // Large recipe platforms
  "allrecipes.com",
  "food.com",
  "foodnetwork.com",
  "epicurious.com",
  "bonappetit.com",
  "seriouseats.com",
  "simplyrecipes.com",
  "delish.com",
  "tasty.co",
  "tasteofhome.com",
  "myrecipes.com",
  "cookinglight.com",
  "eatingwell.com",
  "meatydelights.net",
  "realsimple.com",
  "southernliving.com",
  "recipesize.com",
  "bhg.com",
  "marthastewart.com",
  "jamieoliver.com",
  "gordonramsay.com",
  "bbcgoodfood.com",
  "bettycrocker.com",
  "pillsbury.com",
  "kingarthurbaking.com",
  "kosher.com",
  "justapinch.com",
  "meishichina.com",
  "howtocookthat.com",
  // Popular food blogs
  "cookieandkate.com",
  "budgetbytes.com",
  "skinnytaste.com",
  "thekitchn.com",
  "minimalistbaker.com",
  "minikitchenmagic.com",
  "pinchofyum.com",
  "recipetineats.com",
  "sallysbakingaddiction.com",
  "smittenkitchen.com",
  "halfbakedharvest.com",
  "gimmesomeoven.com",
  "damndelicious.net",
  "damndelicious.com",
  "twopeasandtheirpod.com",
  "lilluna.com",
  "365daysofbakingandmore.com",
  "spoonfulofflavor.com",
  "loveandlemons.com",
  "thepioneerwoman.com",
  "tastesbetterfromscratch.com",
  "onceuponachef.com",
  "iwashyoudry.com",
  "spendwithpennies.com",
  "chef-in-training.com",
  "the-girl-who-ate-everything.com",
  "theslowroasteditalian.com",
  "dinneratthezoo.com",
  "dinnerthendessert.com",
  "wellplated.com",
  "ambitiouskitchen.com",
  "averiecooks.com",
  "cafe-delites.com",
  "carrots-n-cake.com",
  "chelseasmessyapron.com",
  "cookingclassy.com",
  "cravingsomecrunch.com",
  "dairyfreeforbaby.com",
  "eatingonadime.com",
  "easychickenrecipes.com",
  "foodiecrush.com",
  "gonna-want-seconds.com",
  "grandbaby-cakes.com",
  "handletheheat.com",
  "iambaker.net",
  "iheartnaptime.net",
  "lecremedelacrumb.com",
  "lifeloveandsugar.com",
  "lifemadesimplebakes.com",
  "lifemadesweeter.com",
  "littlebitsof.com",
  "motherthyme.com",
  "natashaskitchen.com",
  "norecipes.com",
  "number-2-pencil.com",
  "ohsweetbasil.com",
  "pickleeats.com",
  "prettysimplesweet.com",
  "shugarysweets.com",
  "sweetpeaskitchen.com",
  "thebestblogrecipes.com",
  "thechunkychef.com",
  "thediaryofarealhousewife.com",
  "theredheadbaker.com",
  "therecipecritic.com",
  "thestayathomechef.com",
  "today.com",
  "vallahome.com",
  "wineandglue.com",
  "yellowblissroad.com",
  "yummly.com",
  "allthecooks.com",
  "bigoven.com",
  "chowhound.com",
  "eatwell101.com",
  "food52.com",
  "greatbritishchefs.com",
  "kitchme.com",
  "mrfood.com",
  "sugarspunrun.com",
  "aroundmyfamilytable.com",
  "copykat.com",
  // International and specialty sites
  "justonecookbook.com",
  "rasamalaysia.com",
  "maangchi.com",
  "buzzfeed.com",
  // Magazine sites
  "people.com",
  "goodhousekeeping.com",
  "womansday.com",
  "countryliving.com",
  "redbookmag.com",
];

// Fetch discovered recipe sites from database
async function getDiscoveredRecipeSites(): Promise<Set<string>> {
  const now = Date.now();
  
  // Return cached result if still valid
  if (discoveredSitesCache && (now - cacheTimestamp) < CACHE_TTL) {
    return discoveredSitesCache;
  }

  try {
    const { data, error } = await supabase
      .from("discovered_recipe_sites")
      .select("hostname");

    if (error) {
      console.warn("[recipeSiteHelpers] Failed to fetch discovered sites:", error);
      return new Set();
    }

    const hostnames = (data || []).map(row => row.hostname);
    discoveredSitesCache = new Set(hostnames);
    cacheTimestamp = now;
    
    return discoveredSitesCache;
  } catch (err) {
    console.warn("[recipeSiteHelpers] Error fetching discovered sites:", err);
    return new Set();
  }
}

// Invalidate the cache (call this after discovering a new site)
export function invalidateDiscoveredSitesCache() {
  discoveredSitesCache = null;
  cacheTimestamp = 0;
}

// Normalize hostname for storage
function normalizeHostname(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    // Don't discover social media sites or known platforms
    if (hostname.includes("tiktok.com") || 
        hostname.includes("instagram.com") || 
        hostname.includes("facebook.com") || 
        hostname.includes("fb.com") ||
        hostname.includes("pinterest.com") ||
        hostname.includes("youtube.com")) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

/**
 * Auto-discover and save a recipe site if it contains recipe data but isn't in our list.
 * Call this when you successfully extract recipe data from a "generic" site.
 */
export async function discoverRecipeSiteIfNeeded(
  url: string,
  html: string
): Promise<void> {
  try {
    // Only discover if user is authenticated (silently skip if not)
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      return; // Not authenticated, skip discovery
    }

    const hostname = normalizeHostname(url);
    if (!hostname) return; // Skip social media and invalid URLs

    // Check if it's already in our hardcoded list
    if (KNOWN_RECIPE_SITES.some(site => hostname.includes(site))) {
      return; // Already known
    }

    // Check if already discovered in DB
    const discoveredSites = await getDiscoveredRecipeSites();
    if (discoveredSites.has(hostname)) {
      return; // Already discovered
    }

    // Try to detect recipe data in HTML
    const hasJsonLd = extractRecipeFromJsonLd(html);
    const hasMicrodata = extractRecipeFromMicrodata(html);

    if (!hasJsonLd && !hasMicrodata) {
      return; // No recipe data found, don't discover
    }

    // Determine detection method
    const detectionMethod = hasJsonLd ? "jsonld" : "microdata";

    // Save to database using the upsert function
    const { error } = await supabase.rpc("upsert_discovered_recipe_site", {
      p_hostname: hostname,
      p_detection_method: detectionMethod,
    });

    if (error) {
      console.warn("[recipeSiteHelpers] Failed to discover recipe site:", error);
      return;
    }

    // Immediately update the cache so the current user's flow works right away
    if (!discoveredSitesCache) {
      discoveredSitesCache = new Set();
    }
    discoveredSitesCache.add(hostname);
    cacheTimestamp = Date.now(); // Reset TTL since we just updated
    
    console.log(`[recipeSiteHelpers] ✅ Auto-discovered recipe site: ${hostname} (${detectionMethod})`);
  } catch (err) {
    console.warn("[recipeSiteHelpers] Error in discoverRecipeSiteIfNeeded:", err);
  }
}

export async function detectSiteType(url: string): Promise<"tiktok" | "instagram" | "facebook" | "recipe-site" | "generic"> {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    
    if (h.includes("tiktok.com") || h === "vm.tiktok.com") return "tiktok";
    if (h.includes("instagram.com")) return "instagram";
    if (h.includes("facebook.com") || h.includes("fb.com")) return "facebook";
    
    // Check known recipe sites
    if (KNOWN_RECIPE_SITES.some(site => h.includes(site))) return "recipe-site";
    
    // Check discovered sites from database
    const discoveredSites = await getDiscoveredRecipeSites();
    if (discoveredSites.has(h) || Array.from(discoveredSites).some(site => h.includes(site))) {
      return "recipe-site";
    }
    
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
              const total = (parseInt(cook || "0") || 0) + (parseInt(prep || "0") || 0);
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
