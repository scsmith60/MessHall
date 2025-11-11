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

    // Try to detect recipe data in HTML (try all extraction methods)
    const hasJsonLd = extractRecipeFromJsonLd(html);
    const hasMicrodata = extractRecipeFromMicrodata(html);
    const hasHtml = extractRecipeFromHtml(html);

    if (!hasJsonLd && !hasMicrodata && !hasHtml) {
      return; // No recipe data found, don't discover
    }

    // Determine detection method (prefer structured data, but also accept HTML)
    const detectionMethod = hasJsonLd ? "jsonld" : hasMicrodata ? "microdata" : "html";

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
    // First, try standard script tags with type="application/ld+json"
    const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    
    // Also try script tags without explicit type (some sites embed JSON-LD this way)
    const scriptsNoType = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    
    // Try to find JSON-LD objects anywhere in the HTML (fallback for non-standard embedding)
    const allJsonLdMatches = [
      ...scripts.map(m => ({ content: m[1], source: 'script-tag' })),
      ...scriptsNoType.map(m => ({ content: m[1], source: 'script-no-type' })),
    ];
    
    // Also search for Recipe schemas embedded in JavaScript or inline JSON
    // Look for "@type": "Recipe" pattern and extract surrounding JSON
    const recipeTypeMatches = [...html.matchAll(/"@type"\s*:\s*["']Recipe["']/gi)];
    for (const match of recipeTypeMatches) {
      const startIdx = match.index || 0;
      // Go backwards to find the opening brace
      let braceCount = 0;
      let startPos = startIdx;
      for (let i = startIdx; i >= 0 && i >= startIdx - 50000; i--) {
        if (html[i] === '}') braceCount++;
        else if (html[i] === '{') {
          braceCount--;
          if (braceCount === 0) {
            startPos = i;
            break;
          }
        }
      }
      // Go forwards to find the closing brace
      let endPos = startIdx;
      braceCount = 0;
      for (let i = startIdx; i < html.length && i < startIdx + 50000; i++) {
        if (html[i] === '{') braceCount++;
        else if (html[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            endPos = i + 1;
            break;
          }
        }
      }
      if (startPos < startIdx && endPos > startIdx) {
        const jsonStr = html.slice(startPos, endPos);
        // Clean up: remove potential JavaScript assignments or function calls
        const cleaned = jsonStr
          .replace(/^[^\{]*\{/, '{')  // Remove anything before first {
          .replace(/\}[^}]*$/, '}');   // Remove anything after last }
        if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
          allJsonLdMatches.push({ content: cleaned, source: 'inline-recipe-schema' });
        }
      }
    }
    
    // Deduplicate by content (same JSON might be found multiple ways)
    const seen = new Set<string>();
    const uniqueMatches = allJsonLdMatches.filter(({ content }) => {
      const key = content.slice(0, 100); // Use first 100 chars as key
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    // Debug: log what we found
    if (uniqueMatches.length > 0) {
      console.log('[recipeSiteHelpers] Found', uniqueMatches.length, 'potential JSON-LD sources:', 
        uniqueMatches.map(m => ({ source: m.source, length: m.content.length, preview: m.content.slice(0, 100) })));
    }
    
    for (const { content, source } of uniqueMatches) {
      try {
        // Skip if it's clearly not JSON (contains HTML tags, etc.)
        if (/<[a-z][\s\S]*>/i.test(content) && !source.includes('inline')) continue;
        
        // Try to parse as JSON
        let json;
        try {
          json = JSON.parse(content);
        } catch (parseErr) {
          // If parsing fails, try cleaning up JavaScript assignments
          let cleaned = content
            .replace(/^[^=]*=\s*/, '')  // Remove variable assignments
            .replace(/;\s*$/, '')        // Remove trailing semicolons
            .replace(/^[^{]*/, '')       // Remove anything before first {
            .replace(/[^}]*$/, '');      // Remove anything after last }
          
          // Also try to extract JSON from array assignments like: var x = [{...}];
          if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
            const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
              cleaned = arrayMatch[0];
            }
          }
          
          try {
            json = JSON.parse(cleaned);
          } catch (err2) {
            // Last attempt: try to find the first valid JSON object/array in the content
            const jsonMatch = content.match(/(\[?\{[\s\S]*\}\]?)/);
            if (jsonMatch) {
              try {
                json = JSON.parse(jsonMatch[1]);
              } catch (err3) {
                // Debug: log parsing failures for troubleshooting
                if (source === 'script-tag' || source === 'inline-recipe-schema') {
                  console.log('[recipeSiteHelpers] JSON-LD parse failed for', source, 'preview:', content.slice(0, 200));
                }
                continue; // Skip if still can't parse
              }
            } else {
              if (source === 'script-tag' || source === 'inline-recipe-schema') {
                console.log('[recipeSiteHelpers] No JSON match found for', source, 'preview:', content.slice(0, 200));
              }
              continue; // Skip if still can't parse
            }
          }
        }
        
        // Handle array format: [{...}] or @graph array
        let items: any[] = [];
        if (Array.isArray(json)) {
          items = json;
        } else if (json["@graph"] && Array.isArray(json["@graph"])) {
          items = json["@graph"];
        } else if (json && typeof json === "object") {
          items = [json];
        }
        
        console.log('[recipeSiteHelpers] Processing', items.length, 'items from JSON-LD');
        
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          
          const type = item["@type"];
          const isRecipe = typeof type === "string" 
            ? /Recipe/i.test(type)
            : Array.isArray(type) && type.some((t: any) => /Recipe/i.test(String(t)));
          
          if (!isRecipe) continue;
          
          console.log('[recipeSiteHelpers] Found Recipe schema! Source:', source);
          
          // Debug: log the structure we found (will be logged via caller's dbg)
          // Store this info in result for debugging
          const debugInfo = {
            hasRecipeIngredient: !!item.recipeIngredient,
            recipeIngredientType: typeof item.recipeIngredient,
            recipeIngredientIsArray: Array.isArray(item.recipeIngredient),
            recipeIngredientLength: Array.isArray(item.recipeIngredient) ? item.recipeIngredient.length : 'N/A',
            hasRecipeInstructions: !!item.recipeInstructions,
            recipeInstructionsType: typeof item.recipeInstructions,
            recipeInstructionsIsArray: Array.isArray(item.recipeInstructions),
            recipeInstructionsStructure: item.recipeInstructions?.[0] ? Object.keys(item.recipeInstructions[0]) : 'N/A',
          };
          
          // Extract recipe data
          const result: any = {};
          
          if (item.name) result.title = String(item.name).trim();
          
          // Ingredients
          if (item.recipeIngredient && Array.isArray(item.recipeIngredient)) {
            result.ingredients = item.recipeIngredient.map((i: any) => String(i).trim());
          } else if (item.recipeIngredient && typeof item.recipeIngredient === "string") {
            // Handle single string ingredient
            result.ingredients = [String(item.recipeIngredient).trim()];
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
                } else if (step?.text) {
                  steps.push(String(step.text));
                } else if (step?.itemListElement) {
                  // Handle HowToStep or HowToSection with itemListElement (contains array of actual steps)
                  const elements = Array.isArray(step.itemListElement) 
                    ? step.itemListElement 
                    : [step.itemListElement];
                  for (const elem of elements) {
                    if (typeof elem === "string") {
                      steps.push(elem);
                    } else if (elem?.text) {
                      steps.push(String(elem.text));
                    } else if (elem?.name) {
                      steps.push(String(elem.name));
                    } else if (elem?.itemListElement) {
                      // Nested itemListElement (uncommon but possible)
                      const nested = Array.isArray(elem.itemListElement) 
                        ? elem.itemListElement 
                        : [elem.itemListElement];
                      for (const nestedElem of nested) {
                        if (typeof nestedElem === "string") {
                          steps.push(nestedElem);
                        } else if (nestedElem?.text) {
                          steps.push(String(nestedElem.text));
                        } else if (nestedElem?.name) {
                          steps.push(String(nestedElem.name));
                        }
                      }
                    }
                  }
                } else if (step?.["@type"] === "HowToStep" && step?.name) {
                  // Some sites use name instead of text
                  steps.push(String(step.name));
                }
              }
            } else if (instructions?.["@type"] === "HowToSection" && instructions?.itemListElement) {
              // Handle HowToSection with itemListElement
              const elements = Array.isArray(instructions.itemListElement) 
                ? instructions.itemListElement 
                : [instructions.itemListElement];
              for (const elem of elements) {
                if (elem?.text) steps.push(String(elem.text));
                else if (elem?.name) steps.push(String(elem.name));
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
            // Attach debug info for logging
            (result as any).__debugInfo = debugInfo;
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

// Fallback HTML parser for sites that don't have proper JSON-LD or microdata
// Extracts ingredients and steps from common HTML patterns
export function extractRecipeFromHtml(html: string): {
  title?: string;
  ingredients?: string[];
  steps?: string[];
  ingredientSections?: Array<{ name: string | null; ingredients: string[] }>;
} | null {
  try {
    const result: any = {};
    let wprmResult: any = null; // Store wprm extraction separately
    
    // FIRST: Try to extract from WordPress Recipe Maker (wprm_recipes) if available
    // This is more reliable than HTML parsing
    // Find the start of window.wprm_recipes = { and then count braces to find the end
    const wprmStartPattern = /window\.wprm_recipes\s*=\s*\{/;
    const startMatch = html.match(wprmStartPattern);
    
    if (startMatch && startMatch.index !== undefined) {
      try {
        const startPos = startMatch.index + startMatch[0].length - 1; // Position of the opening {
        
        // Now count braces to find the matching closing brace
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;
        let endPos = -1;
        
        for (let i = startPos; i < html.length && i < startPos + 500000; i++) { // Limit search to 500KB
          const char = html[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if ((char === '"' || char === "'") && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                endPos = i + 1;
                break;
              }
            }
          }
        }
        
        if (endPos > startPos) {
          const jsonStr = html.substring(startPos, endPos).trim();
          const wprmData = JSON.parse(jsonStr);
          
          // wprm_recipes is an object with recipe IDs as keys
          const recipeIds = Object.keys(wprmData);
          if (recipeIds.length > 0) {
            const recipe = wprmData[recipeIds[0]]; // Get first recipe
            
            // Log all recipe keys to find instructions
            console.log('[HTML-EXTRACT] Recipe keys:', Object.keys(recipe));
            
            if (recipe.name) result.title = recipe.name;
            
            // Extract ingredients - wprm has ingredients in recipe.ingredients array
            if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
              const ingredients: string[] = [];
              const ingredientSections: Array<{ name: string | null; ingredients: string[] }> = [];
              let currentSection: { name: string | null; ingredients: string[] } | null = null;
              
              console.log('[HTML-EXTRACT] wprm ingredients array length:', recipe.ingredients.length);
              
              // Log first few ingredients to understand structure
              if (recipe.ingredients.length > 0) {
                console.log('[HTML-EXTRACT] First ingredient sample:', JSON.stringify(recipe.ingredients[0], null, 2));
                if (recipe.ingredients.length > 1) {
                  console.log('[HTML-EXTRACT] Second ingredient sample:', JSON.stringify(recipe.ingredients[1], null, 2));
                }
                // Log a few more to see if we can spot section headers
                for (let i = 0; i < Math.min(10, recipe.ingredients.length); i++) {
                  const ing = recipe.ingredients[i];
                  const hasAmount = !!(ing.amount || ing.unit);
                  const name = ing.name ? String(ing.name).trim() : '';
                  console.log(`[HTML-EXTRACT] Ingredient ${i}: type="${ing.type}", name="${name}", hasAmount=${hasAmount}`);
                }
              }
              
              for (const ing of recipe.ingredients) {
                // Check for section headers - wprm might use different field names
                // Headers can be: type 'header'/'group', OR names matching patterns (with or without colons)
                const nameTrimmed = ing.name ? String(ing.name).trim().replace(/[:：]$/, '') : '';
                
                // More flexible header pattern matching - check for common section header patterns
                const matchesHeaderPattern = nameTrimmed && (
                  /^(FOR\s+THE|FOR\s+|TO\s+SERVE|INGREDIENTS\s+FOR|COOK\s+THE|MAKE\s+)/i.test(nameTrimmed) ||
                  /^[A-Z\s]{5,30}$/.test(nameTrimmed) // All caps, 5-30 chars (likely a section header)
                );
                
                // Don't treat items with amounts/units as headers
                const hasAmountOrUnit = !!(ing.amount || ing.unit);
                
                // Don't treat ingredient-like names as headers (even if they match patterns)
                // If it has ingredient words but no amount/unit, it's probably still an ingredient
                const looksLikeIngredient = nameTrimmed && /\b(salt|pepper|butter|flour|sugar|garlic|onion|lemon|parsley|shrimp|chicken|beef|pork|wine|broth|sauce|seasoning|egg|eggs|oil|bread)\b/i.test(nameTrimmed);
                
                // Check if it's explicitly a header type OR matches header patterns
                const isHeader = (ing.type === 'header' || ing.type === 'group') ||
                                (matchesHeaderPattern && !hasAmountOrUnit && !looksLikeIngredient && nameTrimmed.length > 3);
                
                if (isHeader && ing.name) {
                  // Save previous section if it exists
                  if (currentSection && currentSection.ingredients.length > 0) {
                    ingredientSections.push(currentSection);
                  }
                  // Start new section - remove trailing colon if present
                  const sectionName = nameTrimmed;
                  console.log('[HTML-EXTRACT] Found section header:', sectionName, 'type:', ing.type, 'original:', ing.name);
                  currentSection = { name: sectionName, ingredients: [] };
                } else if (ing.name && (ing.amount || ing.unit || ing.type === 'ingredient')) {
                  // Build ingredient string with quantity
                  let ingText = '';
                  if (ing.amount) ingText += String(ing.amount).trim() + ' ';
                  if (ing.unit) ingText += String(ing.unit).trim() + ' ';
                  ingText += String(ing.name).trim();
                  if (ing.notes) ingText += ' ' + String(ing.notes).trim();
                  
                  const cleaned = ingText.trim();
                  if (cleaned) {
                    ingredients.push(cleaned);
                    if (currentSection) {
                      currentSection.ingredients.push(cleaned);
                    } else {
                      // If no section yet, create a default one
                      if (ingredientSections.length === 0) {
                        currentSection = { name: null, ingredients: [] };
                      }
                    }
                  }
                }
              }
              
              // Add last section
              if (currentSection && currentSection.ingredients.length > 0) {
                ingredientSections.push(currentSection);
              }
              
              console.log('[HTML-EXTRACT] Extracted ingredients:', ingredients.length, 'sections:', ingredientSections.length);
              if (ingredientSections.length > 0) {
                console.log('[HTML-EXTRACT] Section names:', ingredientSections.map(s => s.name));
              }
              
              if (ingredients.length >= 2) {
                result.ingredients = ingredients;
                if (ingredientSections.length > 0) {
                  result.ingredientSections = ingredientSections;
                }
              }
            }
            
            // Extract steps - wprm has instructions in recipe.instructions array
            // Also check recipe.instructions_flat or other possible field names
            const instructionsArray = recipe.instructions || 
                                     recipe.instructions_flat || 
                                     recipe.steps ||
                                     recipe.directions ||
                                     recipe.instructions_list;
            
            if (instructionsArray && Array.isArray(instructionsArray)) {
              console.log('[HTML-EXTRACT] wprm instructions array length:', instructionsArray.length);
              if (instructionsArray.length > 0) {
                console.log('[HTML-EXTRACT] First instruction sample:', JSON.stringify(instructionsArray[0], null, 2));
              }
              const steps: string[] = [];
              
              for (const inst of instructionsArray) {
                // Handle different instruction formats
                let stepText = '';
                
                if (typeof inst === 'string') {
                  stepText = inst;
                } else if (inst.text) {
                  stepText = inst.text;
                } else if (inst.name) {
                  stepText = inst.name;
                } else if (inst.instruction) {
                  stepText = inst.instruction;
                } else if (inst.content) {
                  stepText = inst.content;
                }
                
                if (stepText) {
                  // Clean HTML tags and normalize
                  stepText = stepText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                  // Decode HTML entities
                  stepText = stepText
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/&rsquo;/g, "'")
                    .replace(/&lsquo;/g, "'")
                    .replace(/&rdquo;/g, '"')
                    .replace(/&ldquo;/g, '"')
                    .replace(/&eacute;/g, 'é')
                    .replace(/&agrave;/g, 'à')
                    .replace(/&egrave;/g, 'è')
                    .replace(/&acirc;/g, 'â')
                    .replace(/&ocirc;/g, 'ô')
                    .replace(/&icirc;/g, 'î')
                    .replace(/&ucirc;/g, 'û')
                    .replace(/&ccedil;/g, 'ç')
                    .trim();
                  
                  if (stepText && stepText.length > 10) {
                    steps.push(stepText);
                  }
                }
              }
              
              console.log('[HTML-EXTRACT] Extracted steps:', steps.length);
              if (steps.length > 0) {
                result.steps = steps;
              }
            } else {
              // Log all keys to help debug
              const allKeys = Object.keys(recipe);
              console.log('[HTML-EXTRACT] No instructions array found. All recipe keys:', allKeys);
              console.log('[HTML-EXTRACT] Recipe object sample (first 2000 chars):', JSON.stringify(recipe).substring(0, 2000));
            }
            
            // Store wprm result for later merging
            if (result.ingredients?.length || result.steps?.length) {
              console.log('[HTML-EXTRACT] Extracted from wprm_recipes:', {
                ingredientsCount: result.ingredients?.length,
                stepsCount: result.steps?.length,
                sectionsCount: result.ingredientSections?.length,
              });
              wprmResult = { ...result };
              // If we have both ingredients and steps from wprm, we can return early
              // Otherwise, continue to HTML fallback to fill in missing pieces
              if (result.ingredients?.length && result.steps?.length) {
                return result;
              }
              // Clear result to allow HTML fallback to run, we'll merge later
              result.ingredients = undefined;
              result.ingredientSections = undefined;
              result.steps = undefined;
            }
          }
        }
      } catch (e) {
        console.warn('[HTML-EXTRACT] Failed to parse wprm_recipes:', e);
        // Fall through to HTML parsing
      }
    }
    
    // Fallback to HTML parsing if wprm_recipes not available or failed
    // First, remove all script and style tags to avoid extracting JavaScript/CSS
    let cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
    
    // Extract title from h1 or recipe title class (but don't use it - we'll use OG title)
    // We're just checking if there's a recipe structure, not extracting the title
    const titlePatterns = [
      /<h1[^>]*class[^>]*recipe[^>]*>([\s\S]*?)<\/h1>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<h2[^>]*class[^>]*recipe[^>]*title[^>]*>([\s\S]*?)<\/h2>/i,
    ];
    let hasTitle = false;
    for (const pattern of titlePatterns) {
      const match = cleanHtml.match(pattern);
      if (match) {
        const titleText = match[1].replace(/<[^>]*>/g, "").trim();
        if (titleText && titleText.length > 5 && titleText.length < 200) {
          hasTitle = true;
          break;
        }
      }
    }
    
    // Extract ingredients - try multiple patterns (using cleaned HTML)
    const ingredients: string[] = [];
    const ingredientSections: Array<{ name: string | null; ingredients: string[] }> = [];
    
    // Helper to decode HTML entities
    const decodeHtmlEntities = (text: string): string => {
      const entityMap: { [key: string]: string } = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&nbsp;': ' ',
        '&#9634;': '', // Remove square character
        '&#8203;': '', // Zero-width space
        '&#160;': ' ',
      };
      // Decode numeric entities like &#9634;
      let decoded = text.replace(/&#(\d+);/g, (match, num) => {
        const code = parseInt(num, 10);
        // Common ones we want to remove or replace
        if (code === 9634) return ''; // Square
        if (code === 8203) return ''; // Zero-width space
        if (code === 160) return ' '; // Non-breaking space
        // For other numeric entities, try to convert to character
        return String.fromCharCode(code);
      });
      // Decode named entities
      for (const [entity, replacement] of Object.entries(entityMap)) {
        decoded = decoded.replace(new RegExp(entity, 'g'), replacement);
      }
      return decoded;
    };
    
    // Helper to clean text and filter out JavaScript/noise
    // For ingredients, we want to preserve quantities (like "6 tbsp butter")
    const cleanText = (text: string): string | null => {
      if (!text) return null;
      // Decode HTML entities first
      let cleaned = decodeHtmlEntities(text);
      // Remove HTML tags but preserve spacing between quantity and ingredient
      cleaned = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      
      // Remove only decorative bullets/squares at the start, but preserve ALL quantities and numbers
      // Match patterns like "• ", "&#9634; ", "- ", "* " but NOT "6 tbsp" or "1/2 cup" or "1. 6 tbsp"
      // We're very conservative here - only remove obvious decorative characters
      cleaned = cleaned.replace(/^[\s\-•*&#9634;]+\s*/, "").trim();
      
      // For ingredients, we want to preserve quantities at all costs
      // Don't remove list numbers (1., 2., etc.) as they might be part of the structure
      // and removing them could accidentally remove quantities
      // The unified_parser will handle cleaning these up later if needed
      
      // Filter out JavaScript patterns
      if (/gtag|function|var\s+\w+\s*=|console\.|window\.|document\.|script|javascript:/i.test(cleaned)) {
        return null; // Skip JavaScript
      }
      // Filter out URLs
      if (/https?:\/\//i.test(cleaned)) {
        return null;
      }
      // Filter out code-like patterns (quotes, semicolons, etc. that suggest code)
      if (/['"]\s*[,;]\s*['"]|=>|\(\)\s*=>|function\s*\(/i.test(cleaned)) {
        return null;
      }
      return cleaned;
    };
    
    // Pattern 1: List items in ingredient sections (more flexible patterns)
    // First, try to find the main ingredients section
    const ingSectionPatterns = [
      /<h[1-6][^>]*>\s*ingredients?\s*<\/h[1-6]>([\s\S]{0,30000}?)(?=<h[1-6][^>]*>\s*(?:instructions?|directions?|steps?|method|preparation|cooking|how\s+to|procedure)|<\/section|<\/div|$)/i,
      /<div[^>]*class[^>]*ingredient[^>]*>([\s\S]{0,30000}?)(?=<\/div>)/i,
      /<ul[^>]*class[^>]*ingredient[^>]*>([\s\S]{0,30000}?)(?=<\/ul>)/i,
      // Also try finding ingredients list after "Ingredients" heading anywhere
      /(?:^|>)\s*ingredients?\s*[:\-–—]?\s*([\s\S]{0,30000}?)(?=\s*(?:instructions?|directions?|steps?|method|preparation|cooking|how\s+to|procedure)|<h[1-6]|$)/i,
      // Try uppercase INGREDIENTS
      /<h[1-6][^>]*>\s*INGREDIENTS\s*<\/h[1-6]>([\s\S]{0,30000}?)(?=<h[1-6][^>]*>\s*(?:instructions?|directions?|steps?|method|preparation|cooking|how\s+to|procedure)|<\/section|<\/div|$)/i,
    ];
    
    for (const pattern of ingSectionPatterns) {
      const sectionMatch = cleanHtml.match(pattern);
      if (sectionMatch) {
        console.log('[HTML-EXTRACT] Found ingredient section with pattern, length:', sectionMatch[1].length);
        const mainSection = sectionMatch[1];
        
        // Try to detect subsections (like "FOR THE SHRIMP", "FOR THE SAUCE", etc.)
        // Look for headings within the ingredients section - try multiple patterns
        const subsectionPatterns = [
          /<h[3-5][^>]*>([^<]+)<\/h[3-5]>([\s\S]*?)(?=<h[3-5][^>]*>|<\/ul>|<\/div>|$)/gi,
          /<strong[^>]*>([^<]*(?:FOR\s+THE|FOR\s+)[^<]+)<\/strong>([\s\S]*?)(?=<strong[^>]*>|<\/ul>|<\/div>|$)/gi,
          /<b[^>]*>([^<]*(?:FOR\s+THE|FOR\s+)[^<]+)<\/b>([\s\S]*?)(?=<b[^>]*>|<\/ul>|<\/div>|$)/gi,
        ];
        
        let subsectionMatches: RegExpMatchArray[] = [];
        for (const pattern of subsectionPatterns) {
          const matches = [...mainSection.matchAll(pattern)];
          if (matches.length > 0) {
            subsectionMatches = matches;
            break;
          }
        }
        
        if (subsectionMatches.length > 0) {
          // We have subsections - extract each one
          for (const subMatch of subsectionMatches) {
            const sectionName = decodeHtmlEntities(subMatch[1]).replace(/<[^>]+>/g, '').trim();
            const sectionContent = subMatch[2];
            const sectionIngredients: string[] = [];
            
            // Extract list items from this subsection
            const liMatches = [...sectionContent.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
            for (const liMatch of liMatches) {
              // Get the RAW HTML first to see what we're working with
              const rawHtml = liMatch[1];
              let liContent = extractFullTextFromLi(rawHtml);
              
              // Debug: log first few ingredients to see what we're extracting
              if (ingredients.length < 5) {
                console.log('[HTML-EXTRACT] Raw HTML (first 300 chars):', rawHtml.substring(0, 300));
                console.log('[HTML-EXTRACT] Extracted text:', liContent);
              }
              
              if (liContent && liContent.length > 3 && liContent.length < 300) {
                const hasQuantity = /(\d+\s+)?(\d+\/\d+|\d+)\s*(cup|cups|tsp|tbsp|oz|lb|g|kg|ml|l|tablespoon|teaspoon|pound|ounce|clove|cloves|sheet|sheets|large|small|medium|jumbo|head|heads|bunch|can|cans|package|packages)/i.test(liContent);
                const hasIngredientWord = /\b(salt|pepper|butter|flour|sugar|garlic|onion|lemon|parsley|shrimp|chicken|beef|pork|wine|broth|sauce|seasoning|hot\s+sauce|worcestershire|egg|eggs|oil|vegetable|canola|olive)\b/i.test(liContent);
                if (hasQuantity || hasIngredientWord) {
                  sectionIngredients.push(liContent);
                  ingredients.push(liContent);
                }
              }
            }
            
            if (sectionIngredients.length > 0) {
              ingredientSections.push({ name: sectionName, ingredients: sectionIngredients });
            }
          }
        }
        
        // If no subsections found, extract all ingredients from main section
        if (ingredientSections.length === 0) {
          const liMatches = [...mainSection.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
          console.log('[HTML-EXTRACT] Found', liMatches.length, 'list items in ingredient section');
          for (const liMatch of liMatches) {
            let liContent = extractFullTextFromLi(liMatch[1]);
            // Debug: show raw content for first few items
            if (ingredients.length < 2) {
              console.log('[HTML-EXTRACT] Raw li content:', liMatch[1].substring(0, 150));
              console.log('[HTML-EXTRACT] Extracted text:', liContent);
            }
            if (liContent && liContent.length > 3 && liContent.length < 300) {
              const hasQuantity = /(\d+\s+)?(\d+\/\d+|\d+)\s*(cup|cups|c\.|tsp|tbsp|oz|lb|g|kg|ml|l|tablespoon|teaspoon|pound|ounce|clove|cloves|sheet|sheets|large|small|medium|jumbo|head|heads|bunch|can|cans|package|packages)/i.test(liContent);
              const hasIngredientWord = /\b(salt|pepper|butter|flour|sugar|garlic|onion|lemon|parsley|shrimp|chicken|beef|pork|wine|broth|sauce|seasoning|hot\s+sauce|worcestershire|egg|eggs|oil|vegetable|canola|olive|potato|potatoes|cream\s+cheese|half\s+and\s+half|half-and-half)\b/i.test(liContent);
              if (hasQuantity || hasIngredientWord) {
                ingredients.push(liContent);
                if (ingredients.length <= 3) {
                  console.log('[HTML-EXTRACT] Added ingredient', ingredients.length, ':', liContent);
                }
              } else {
                if (liMatches.length <= 10) {
                  console.log('[HTML-EXTRACT] Rejected ingredient (no quantity/word):', liContent.substring(0, 60));
                  console.log('[HTML-EXTRACT] hasQuantity:', hasQuantity, 'hasIngredientWord:', hasIngredientWord);
                }
              }
            }
          }
        }
        
        if (ingredients.length >= 2) break; // Need at least 2 to be valid
      }
    }
    
    // Helper function to extract full text from list item, preserving quantities
    // This is critical - quantities might be in <strong>, <b>, <span> tags, so we need to preserve ALL text
    function extractFullTextFromLi(htmlContent: string): string {
      if (!htmlContent) return '';
      
      // Decode entities first - this handles &#9634; and other entities
      let text = decodeHtmlEntities(htmlContent);
      
      // Remove script/style tags but keep everything else
      text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
      text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
      
      // Remove form elements like checkboxes, inputs, labels (but preserve their text content if any)
      text = text.replace(/<input[^>]*>/gi, '');
      text = text.replace(/<label[^>]*>([\s\S]*?)<\/label>/gi, '$1');
      
      // IMPORTANT: Replace HTML tags with SINGLE spaces, not multiple
      // This preserves spacing between quantity and unit
      // Example: "<strong>6</strong> TBSP" becomes "6 TBSP" not "6TBSP"
      text = text.replace(/<[^>]+>/g, ' ');
      
      // Normalize multiple spaces to single space, but preserve the content
      text = text.replace(/\s+/g, ' ').trim();
      
      // Only remove decorative bullets/squares at the very start
      // DO NOT remove numbers - they might be quantities!
      // Match: •, -, *, &#9634;, but NOT digits
      text = text.replace(/^[\s\-•*&#9634;]+\s*/, "").trim();
      
      // CRITICAL: Do NOT remove list item numbers automatically
      // The HTML structure might have list numbers (1., 2., etc.) AND quantities (6 TBSP)
      // We want to preserve everything and let the unified_parser handle cleanup
      // Only remove list numbers if they're clearly NOT part of the ingredient
      // Pattern: "1. " at start followed by something that doesn't look like a quantity
      // But be VERY conservative - if in doubt, keep it
      
      // Check if it starts with a list number pattern (1-2 digits + . or ) + space)
      const listNumPattern = /^(\d{1,2})[.)]\s+(.+)$/;
      const match = text.match(listNumPattern);
      if (match) {
        const listNum = match[1];
        const rest = match[2];
        
        // Only remove the list number if:
        // 1. The rest does NOT start with a number (not a quantity)
        // 2. AND the rest does NOT start with a fraction (not a quantity like "1/2")
        // 3. AND the list number is small (1-9, not like "10" which could be "10 cups")
        const startsWithNumber = /^\d/.test(rest);
        const startsWithFraction = /^\d+\/\d+/.test(rest);
        const isSmallListNum = parseInt(listNum) <= 9;
        
        if (!startsWithNumber && !startsWithFraction && isSmallListNum) {
          // Probably a list marker, remove it
          text = rest;
        }
        // Otherwise, keep the whole thing - the list number might be part of the structure
      }
      
      return text;
    }
    
    // Pattern 2: Direct list items with ingredient-like content (more lenient)
    if (ingredients.length < 2) {
      const allLiMatches = [...cleanHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
      for (const liMatch of allLiMatches) {
        let liContent = extractFullTextFromLi(liMatch[1]);
        if (liContent && liContent.length > 5 && liContent.length < 300) {
          // Strong ingredient indicators - handle complex quantities
          const hasQuantity = /(\d+\s+)?(\d+\/\d+|\d+)\s*(cup|cups|tsp|tbsp|oz|lb|g|kg|ml|l|tablespoon|teaspoon|pound|ounce|sheet|sheets|large|small|medium|jumbo)/i.test(liContent);
          const hasIngredientWord = /\b(jumbo|gulf|shrimp|butter|hot\s+sauce|cajun|seasoning|white\s+wine|chicken\s+broth|garlic|onion|lemon|parsley|worcestershire)\b/i.test(liContent);
          if (hasQuantity || hasIngredientWord) {
            ingredients.push(liContent);
          }
        }
      }
    }
    
    if (ingredients.length >= 2) {
      result.ingredients = ingredients.slice(0, 30); // Limit to reasonable number
      // If we found sections, include them
      if (ingredientSections.length > 0) {
        result.ingredientSections = ingredientSections;
      }
    }
    
    // Extract steps/instructions - try multiple patterns (using cleaned HTML)
    const steps: string[] = [];
    
    // Helper to clean step text and filter out JavaScript/noise
    const cleanStepText = (text: string, originalMatch?: string): string | null => {
      if (!text) return null;
      // Decode HTML entities first
      let cleaned = decodeHtmlEntities(text);
      // Remove HTML tags
      cleaned = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      // Remove leading numbers/bullets but preserve content
      cleaned = cleaned.replace(/^[\d\s\-•*.)&#9634;]+\s*/, "").trim();
      // Filter out non-step content (headings, section titles, etc.)
      if (/^(what to serve|leftovers|reheating|notes|tips|faq|related|more like|nutrition|serving|calories|course|cuisine)/i.test(cleaned)) {
        return null; // Skip section headings that aren't steps
      }
      // Filter out JavaScript patterns
      if (/gtag|function|var\s+\w+\s*=|console\.|window\.|document\.|script|javascript:/i.test(cleaned)) {
        return null; // Skip JavaScript
      }
      // Filter out URLs
      if (/https?:\/\//i.test(cleaned)) {
        return null;
      }
      // Filter out code-like patterns
      if (/['"]\s*[,;]\s*['"]|=>|\(\)\s*=>|function\s*\(/i.test(cleaned)) {
        return null;
      }
      // Filter out very short or very generic text
      if (cleaned.length < 15) {
        return null;
      }
      return cleaned;
    };
    
    // Pattern 1: Instructions/Directions/Steps/Method section (comprehensive patterns)
    // Look for any heading that indicates instructions: directions, steps, method, preparation, cooking, how to, procedure
    // IMPORTANT: After the heading, skip wrapper divs and capture the actual content
    const stepSectionPatterns = [
      // Pattern 1: Heading followed by content (skip wrapper divs, capture until next major section)
      /<h[1-6][^>]*>\s*(?:instructions?|directions?|steps?|method|preparation|cooking\s+instructions?|how\s+to|procedure)\s*<\/h[1-6]>[\s\S]{0,500}?([\s\S]{0,50000}?)(?=<h[1-6][^>]*>\s*(?:what\s+to\s+serve|leftovers|notes|tips|faq|nutrition|related|more\s+like|serving|storage|variations|substitutions|ingredients?)|<\/section|<\/article|$)/i,
      // Pattern 2: Look for div/section with direction/instruction class
      /<div[^>]*class[^>]*(?:instruction|direction|step|method|preparation|procedure)[^>]*>([\s\S]{0,50000}?)(?=<\/div>)/i,
      /<ol[^>]*class[^>]*(?:instruction|direction|step|method)[^>]*>([\s\S]{0,50000}?)(?=<\/ol>)/i,
      /<section[^>]*class[^>]*(?:instruction|direction|step|method)[^>]*>([\s\S]{0,50000}?)(?=<\/section>)/i,
      // Pattern 3: Find "Directions" heading, then look for the next container with numbered content
      /<h[1-6][^>]*>\s*(?:instructions?|directions?|steps?|method)\s*<\/h[1-6]>[\s\S]*?(?:<div[^>]*>|<ol[^>]*>|<ul[^>]*>|<section[^>]*>)([\s\S]{0,50000}?)(?=<\/div>|<\/ol>|<\/ul>|<\/section>|<h[1-6]|$)/i,
      // Pattern 4: Also try finding instructions/directions/steps/method after heading anywhere
      /(?:^|>)\s*(?:instructions?|directions?|steps?|method|preparation|cooking\s+instructions?|how\s+to|procedure)\s*[:\-–—]?\s*([\s\S]{0,50000}?)(?=<h[1-6][^>]*>\s*(?:what\s+to\s+serve|leftovers|notes|tips|faq|nutrition|related|more\s+like|serving|storage|variations|substitutions|ingredients?)|<\/section|<\/div|<\/article|$)/i,
    ];
    
    for (const pattern of stepSectionPatterns) {
      const sectionMatch = cleanHtml.match(pattern);
      if (sectionMatch) {
        console.log('[HTML-EXTRACT] Found step section with pattern, length:', sectionMatch[1].length);
        const section = sectionMatch[1];
        // Debug: show first 500 chars of section to see structure
        console.log('[HTML-EXTRACT] Step section preview:', section.substring(0, 500));
        
        // First, try to find numbered steps (1., 2., etc.) in list items - these are most reliable
        // Extract full <li> content first, then look for numbered patterns
        const allLiMatches = [...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
        console.log('[HTML-EXTRACT] Found', allLiMatches.length, 'list items in step section');
        
        // If no <li> tags, try <p> tags with numbered content
        if (allLiMatches.length === 0) {
          console.log('[HTML-EXTRACT] No <li> tags found, trying <p> tags with numbered steps');
          const pMatches = [...section.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
          console.log('[HTML-EXTRACT] Found', pMatches.length, '<p> tags in step section');
          for (const pMatch of pMatches) {
            let stepContent = extractFullTextFromLi(pMatch[1]);
            // Check if it starts with a number (1., 2., etc.)
            const numberedMatch = stepContent.match(/^(\d+[.)]\s+)(.+)$/);
            if (numberedMatch) {
              stepContent = numberedMatch[2];
              const cleaned = cleanStepText(stepContent, pMatch[0]);
              if (cleaned && cleaned.length > 15 && cleaned.length < 600) {
                const hasCookingVerb = /\b(preheat|heat|melt|whisk|stir|mix|combine|add|pour|cook|bake|fry|simmer|boil|remove|transfer|serve|garnish|season|toss|flip|deglaze|bring|reduce|sauté|sautéed|start|working|wrap|set|allow|remove|garnish|using|caution|transfer|toss|coat|deglaze|scrape|whisk|peel|cut|drain|mash|place|turn|stir)\b/i.test(cleaned);
                if (hasCookingVerb || cleaned.length > 30) {
                  steps.push(cleaned);
                  if (steps.length <= 3) {
                    console.log('[HTML-EXTRACT] Added step from <p>', steps.length, ':', cleaned.substring(0, 100));
                  }
                }
              }
            }
          }
        }
        
        // If still no steps, try to find numbered patterns directly in the section text (any tag)
        if (steps.length === 0) {
          console.log('[HTML-EXTRACT] No steps from <li> or <p>, trying direct numbered pattern extraction');
          // First, try to extract all text from the section (removing HTML tags but preserving structure)
          const sectionText = section
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          console.log('[HTML-EXTRACT] Section text (first 1000 chars):', sectionText.substring(0, 1000));
          
          // Look for numbered patterns like "1. " or "1) " anywhere in the section text
          const numberedPattern = /(\d+[.)]\s+)(.{20,600}?)(?=\d+[.)]\s+|$)/gi;
          let match;
          while ((match = numberedPattern.exec(sectionText)) !== null && steps.length < 20) {
            let stepContent = match[2].trim();
            const cleaned = cleanStepText(stepContent, match[0]);
            if (cleaned && cleaned.length > 15 && cleaned.length < 600) {
              const hasCookingVerb = /\b(preheat|heat|melt|whisk|stir|mix|combine|add|pour|cook|bake|fry|simmer|boil|remove|transfer|serve|garnish|season|toss|flip|deglaze|bring|reduce|sauté|sautéed|start|working|wrap|set|allow|remove|garnish|using|caution|transfer|toss|coat|deglaze|scrape|whisk|peel|cut|drain|mash|place|turn|stir)\b/i.test(cleaned);
              if (hasCookingVerb || cleaned.length > 30) {
                steps.push(cleaned);
                if (steps.length <= 3) {
                  console.log('[HTML-EXTRACT] Added step from direct pattern', steps.length, ':', cleaned.substring(0, 100));
                }
              }
            }
          }
          console.log('[HTML-EXTRACT] Direct pattern extraction found', steps.length, 'steps');
        }
        
        for (const liMatch of allLiMatches) {
          let stepContent = extractFullTextFromLi(liMatch[1]);
          // Check if it starts with a number (1., 2., etc.) - if so, extract the content after the number
          const numberedMatch = stepContent.match(/^(\d+[.)]\s+)(.+)$/);
          if (numberedMatch) {
            stepContent = numberedMatch[2]; // Use content after the number
          }
          const cleaned = cleanStepText(stepContent, liMatch[0]);
          if (cleaned && cleaned.length > 15 && cleaned.length < 600) {
            const hasCookingVerb = /\b(preheat|heat|melt|whisk|stir|mix|combine|add|pour|cook|bake|fry|simmer|boil|remove|transfer|serve|garnish|season|toss|flip|deglaze|bring|reduce|sauté|sautéed|start|working|wrap|set|allow|remove|garnish|using|caution|transfer|toss|coat|deglaze|scrape|whisk|peel|cut|drain|mash|place|turn|stir)\b/i.test(cleaned);
            if (hasCookingVerb || cleaned.length > 30) {
              steps.push(cleaned);
              if (steps.length <= 3) {
                console.log('[HTML-EXTRACT] Added step', steps.length, ':', cleaned.substring(0, 100));
              }
            } else {
              if (allLiMatches.length <= 5) {
                console.log('[HTML-EXTRACT] Rejected step (no verb, length:', cleaned.length, '):', cleaned.substring(0, 80));
              }
            }
          }
        }
        
        // If we got numbered steps, use those. Otherwise try other patterns
        if (steps.length === 0) {
          const stepMatches = [
            ...section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi),
            ...section.matchAll(/<p[^>]*>\s*(\d+[.)]\s+[^<]{20,600})/gi),
            ...section.matchAll(/(?:^|\n)\s*(\d+[.)]\s+[^\n]{20,600})/gi),
          ];
          
          for (const stepMatch of stepMatches) {
            const cleaned = cleanStepText(stepMatch[1], stepMatch[0]);
            if (cleaned && cleaned.length > 15 && cleaned.length < 600) {
              const hasCookingVerb = /\b(preheat|heat|melt|whisk|stir|mix|combine|add|pour|cook|bake|fry|simmer|boil|remove|transfer|serve|garnish|season|toss|flip|deglaze|bring|reduce|sauté|sautéed|start|working|wrap|set|allow|remove|garnish|using|caution|transfer|toss|coat|deglaze|scrape|whisk)\b/i.test(cleaned);
              const isNumbered = stepMatch[0] ? /^\d+[.)]\s+/.test(stepMatch[0]) : false;
              if ((hasCookingVerb || isNumbered) && cleaned.length > 20) {
                steps.push(cleaned);
              }
            }
          }
        }
        
        if (steps.length >= 1) break; // Need at least 1 step
      }
    }
    
    // Pattern 2: Direct numbered steps in HTML (more flexible)
    if (steps.length < 1) {
      // Look for numbered steps anywhere in the HTML
      const numberedSteps = [
        ...cleanHtml.matchAll(/<li[^>]*>\s*(\d+[.)]\s+[^<]{15,600})/gi),
        ...cleanHtml.matchAll(/<p[^>]*>\s*(\d+[.)]\s+[^<]{15,600})/gi),
        ...cleanHtml.matchAll(/(?:^|>)\s*(\d+[.)]\s+[^\n<]{15,600})/gi),
      ];
      for (const stepMatch of numberedSteps) {
        const cleaned = cleanStepText(stepMatch[1], stepMatch[0]);
        if (cleaned && cleaned.length > 10 && cleaned.length < 600) {
          // More lenient - if it's numbered and has reasonable length, include it
          const hasCookingVerb = /\b(preheat|heat|melt|whisk|stir|mix|combine|add|pour|cook|bake|fry|simmer|boil|remove|transfer|serve|garnish|season|toss|flip|deglaze|bring|reduce|sauté|sautéed|start|working|wrap|set|allow|remove|garnish|using|caution|transfer)\b/i.test(cleaned);
          if (hasCookingVerb || cleaned.length > 30) { // Include if has verb OR is substantial
            steps.push(cleaned);
          }
        }
      }
    }
    
    if (steps.length >= 1) {
      result.steps = steps.slice(0, 30); // Limit to reasonable number
    }
    
    // Merge wprm result with HTML fallback result
    if (wprmResult) {
      // Prefer wprm ingredients (they're more reliable), but use HTML steps if wprm didn't have them
      if (wprmResult.ingredients?.length) {
        result.ingredients = wprmResult.ingredients;
        result.ingredientSections = wprmResult.ingredientSections;
      }
      // Use wprm steps if available, otherwise use HTML steps
      if (wprmResult.steps?.length) {
        result.steps = wprmResult.steps;
      }
      // Use wprm title if available
      if (wprmResult.title && !result.title) {
        result.title = wprmResult.title;
      }
      console.log('[HTML-EXTRACT] Merged wprm + HTML results:', {
        ingredientsCount: result.ingredients?.length,
        stepsCount: result.steps?.length,
        sectionsCount: result.ingredientSections?.length,
      });
    }
    
    // Don't return title from HTML - we'll use OG title instead
    // Only return if we have ingredients or steps
    return (result.ingredients?.length || result.steps?.length) ? result : null;
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
