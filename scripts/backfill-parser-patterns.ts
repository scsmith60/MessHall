// scripts/backfill-parser-patterns.ts
// Pre-populate the parser pattern database from existing successful recipe imports
// This "teaches" the system ahead of time with known-good patterns

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { 
  extractHtmlPattern, 
  type SiteType,
  type StrategyName,
  type ParserVersion 
} from '../lib/parsers/versioning';
import { fetchHtmlDesktop } from '../lib/fetch_meta';
import { fetchMeta } from '../lib/fetch_meta';

// Node.js-compatible site type detection (avoids React Native supabase import)
function detectSiteType(url: string): SiteType {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    
    if (h.includes("tiktok.com") || h === "vm.tiktok.com") return "tiktok";
    if (h.includes("instagram.com")) return "instagram";
    if (h.includes("facebook.com") || h.includes("fb.com")) return "facebook";
    
    // Check known recipe sites (subset of the full list)
    const KNOWN_RECIPE_SITES = [
      "allrecipes.com", "food.com", "foodnetwork.com", "epicurious.com",
      "bonappetit.com", "seriouseats.com", "simplyrecipes.com", "delish.com",
      "tasty.co", "tasteofhome.com", "myrecipes.com", "cookinglight.com",
      "eatingwell.com", "realsimple.com", "southernliving.com", "bhg.com",
      "marthastewart.com", "jamieoliver.com", "gordonramsay.com", "bbcgoodfood.com",
      "bettycrocker.com", "pillsbury.com", "kingarthurbaking.com",
    ];
    
    if (KNOWN_RECIPE_SITES.some(site => h.includes(site))) return "recipe-site";
    
    return "generic";
  } catch {
    return "generic";
  }
}

// Node.js-compatible JSON-LD extraction (avoids React Native supabase import)
function extractRecipeFromJsonLdNode(html: string): {
  title?: string;
  ingredients?: string[];
  steps?: string[];
  image?: string;
} | null {
  try {
    const scriptTags = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (!scriptTags || scriptTags.length === 0) return null;

    for (const tag of scriptTags) {
      const contentMatch = tag.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
      if (!contentMatch) continue;

      let content = contentMatch[1].trim();
      if (!content) continue;

      // Try to parse JSON
      let json: any;
      try {
        json = JSON.parse(content);
      } catch {
        continue;
      }

      // Handle array format
      const items = Array.isArray(json) ? json : json["@graph"] ? json["@graph"] : [json];

      for (const item of items) {
        if (item["@type"] === "Recipe" || item["@type"]?.includes("Recipe")) {
          const recipe: any = {
            title: item.name || item.headline,
            image: item.image?.url || (typeof item.image === "string" ? item.image : item.image?.[0]?.url),
          };

          // Extract ingredients
          if (item.recipeIngredient) {
            recipe.ingredients = Array.isArray(item.recipeIngredient)
              ? item.recipeIngredient.map((ing: any) => typeof ing === "string" ? ing : ing.text || ing.name)
              : [];
          }

          // Extract steps
          if (item.recipeInstructions) {
            const instructions = Array.isArray(item.recipeInstructions)
              ? item.recipeInstructions
              : [item.recipeInstructions];
            
            recipe.steps = instructions.map((step: any) => {
              if (typeof step === "string") return step;
              if (step.text) return step.text;
              if (step["@type"] === "HowToStep" && step.name) return step.name;
              return String(step);
            }).filter(Boolean);
          }

          if (recipe.ingredients?.length > 0 || recipe.steps?.length > 0) {
            return recipe;
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
// Service role key is required (not anon key) - it has full database access
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  console.error('❌ Missing SUPABASE_URL');
  console.error('   Please set EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL in your .env file');
  process.exit(1);
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  console.error('   This is different from EXPO_PUBLIC_SUPABASE_ANON_KEY');
  console.error('   Find it in: Supabase Dashboard → Settings → API → Service Role Key (secret!)');
  console.error('   Add to .env: SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here');
  process.exit(1);
}

// Create Supabase client for Node.js (not React Native)
// Use a memory-based storage adapter to avoid AsyncStorage issues
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false, // Don't persist sessions in Node.js
    autoRefreshToken: false, // Don't auto-refresh in Node.js
    detectSessionInUrl: false, // Not needed in Node.js
    storage: {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    },
  },
});

interface RecipeWithSource {
  id: string;
  source_url: string;
  title: string;
  ingredients_count: number;
  steps_count: number;
}

/**
 * Get all recipes with source URLs that have ingredients/steps
 */
async function getRecipesToBackfill(limit: number = 1000): Promise<RecipeWithSource[]> {
  console.log(`\n📊 Fetching recipes with source URLs (limit: ${limit})...`);
  
  const { data, error } = await supabase
    .from('recipes')
    .select(`
      id,
      source_url,
      title,
      recipe_ingredients!inner(count),
      recipe_steps!inner(count)
    `)
    .not('source_url', 'is', null)
    .limit(limit);
  
  if (error) {
    console.error('Error fetching recipes:', error);
    throw error;
  }
  
  // Transform to include counts
  const recipes: RecipeWithSource[] = (data || []).map((r: any) => ({
    id: r.id,
    source_url: r.source_url,
    title: r.title || 'Untitled',
    ingredients_count: Array.isArray(r.recipe_ingredients) ? r.recipe_ingredients.length : 0,
    steps_count: Array.isArray(r.recipe_steps) ? r.recipe_steps.length : 0,
  })).filter((r: RecipeWithSource) => 
    r.ingredients_count > 0 || r.steps_count > 0
  );
  
  console.log(`✅ Found ${recipes.length} recipes with source URLs and ingredients/steps`);
  return recipes;
}

/**
 * Try to extract recipe from URL using different strategies
 */
async function tryExtractionStrategies(
  url: string,
  siteType: SiteType,
  html: string
): Promise<{ strategy: StrategyName; success: boolean; ingredients?: string[]; steps?: string[] } | null> {
  const strategies: StrategyName[] = [
    'server-html-sigi',
    'server-html-meta',
    'server-html-jsonld',
    'oembed-api',
  ];
  
  for (const strategy of strategies) {
    try {
      let result: { success: boolean; ingredients?: string[]; steps?: string[] } | null = null;
      
      switch (strategy) {
        case 'server-html-sigi':
        case 'server-html-meta':
          // Try fetchMeta which handles both
          const meta = await fetchMeta(url);
          if (meta && (meta.ingredients?.length || 0) > 0) {
            result = {
              success: true,
              ingredients: meta.ingredients,
              steps: meta.steps,
            };
          }
          break;
        
        case 'server-html-jsonld':
          const jsonLd = extractRecipeFromJsonLdNode(html);
          if (jsonLd && (jsonLd.ingredients?.length || 0) > 0) {
            result = {
              success: true,
              ingredients: jsonLd.ingredients,
              steps: jsonLd.steps,
            };
          }
          break;
        
        case 'oembed-api':
          // oEmbed doesn't provide recipe data, skip
          continue;
      }
      
      if (result?.success) {
        return { ...result, strategy };
      }
    } catch (error) {
      // Continue to next strategy
      continue;
    }
  }
  
  return null;
}

/**
 * Backfill a single recipe
 */
async function backfillRecipe(
  recipe: RecipeWithSource,
  parserVersion: ParserVersion = 'v1'
): Promise<{ success: boolean; pattern?: string; strategy?: StrategyName }> {
  try {
    const url = recipe.source_url;
    
    // Detect site type (Node.js version, no async needed)
    const siteType = detectSiteType(url);
    
    // Fetch HTML
    let html: string;
    try {
      html = await fetchHtmlDesktop(url);
    } catch (error) {
      console.warn(`  ⚠️  Could not fetch HTML for ${url}:`, (error as Error).message);
      return { success: false };
    }
    
    // Extract pattern
    const pattern = extractHtmlPattern(html, siteType);
    
    // Try extraction strategies
    const extraction = await tryExtractionStrategies(url, siteType, html);
    
    if (!extraction || !extraction.success) {
      // Log failure (using Node.js supabase client directly)
      try {
        await supabase.rpc('log_recipe_import_attempt', {
          p_url: url,
          p_site_type: siteType,
          p_parser_version: parserVersion,
          p_strategy_used: 'server-html-meta',
          p_success: false,
          p_confidence_score: null,
          p_ingredients_count: null,
          p_steps_count: null,
          p_raw_html_sample: html.substring(0, 5000),
          p_error_message: 'No successful extraction strategy found',
        });
      } catch (err) {
        // Silently fail logging
      }
      
      return { success: false, pattern };
    }
  
    // Log success (using Node.js supabase client directly)
    try {
      await supabase.rpc('log_recipe_import_attempt', {
        p_url: url,
        p_site_type: siteType,
        p_parser_version: parserVersion,
        p_strategy_used: extraction.strategy,
        p_success: true,
        p_confidence_score: (extraction.ingredients?.length || 0) >= 3 ? 'high' : 'medium',
        p_ingredients_count: extraction.ingredients?.length || null,
        p_steps_count: extraction.steps?.length || null,
        p_raw_html_sample: html.substring(0, 5000),
        p_error_message: null,
      });
    } catch (err) {
      console.warn('  ⚠️  Failed to log attempt:', err);
    }
    
    // Update pattern success rate (using Node.js supabase client directly)
    try {
      await supabase.rpc('update_extraction_pattern', {
        p_site_type: siteType,
        p_html_pattern: pattern,
        p_extraction_method: extraction.strategy,
        p_parser_version: parserVersion,
        p_success: true,
      });
    } catch (err) {
      console.warn('  ⚠️  Failed to update pattern:', err);
    }
    
    return { 
      success: true, 
      pattern, 
      strategy: extraction.strategy 
    };
  } catch (error: any) {
    console.error(`  ❌ Error backfilling recipe ${recipe.id}:`, error.message);
    return { success: false };
  }
}

/**
 * Main backfill function
 */
async function backfillParserPatterns(options: {
  limit?: number;
  batchSize?: number;
  delayMs?: number;
  parserVersion?: ParserVersion;
}) {
  const {
    limit = 1000,
    batchSize = 10,
    delayMs = 1000, // 1 second between batches
    parserVersion = 'v1',
  } = options;
  
  console.log('\n🚀 Starting parser pattern backfill...');
  console.log(`   Limit: ${limit} recipes`);
  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Delay: ${delayMs}ms between batches`);
  console.log(`   Parser version: ${parserVersion}\n`);
  
  // Get recipes to backfill
  const recipes = await getRecipesToBackfill(limit);
  
  if (recipes.length === 0) {
    console.log('✅ No recipes to backfill');
    return;
  }
  
  // Process in batches
  let successCount = 0;
  let failureCount = 0;
  const patternStats = new Map<string, { count: number; strategies: Set<string> }>();
  
  for (let i = 0; i < recipes.length; i += batchSize) {
    const batch = recipes.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(recipes.length / batchSize);
    
    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} recipes)...`);
    
    const batchPromises = batch.map(async (recipe) => {
      console.log(`  🔄 ${recipe.title.substring(0, 50)}...`);
      const result = await backfillRecipe(recipe, parserVersion);
      
      if (result.success) {
        successCount++;
        if (result.pattern) {
          const stats = patternStats.get(result.pattern) || { count: 0, strategies: new Set() };
          stats.count++;
          if (result.strategy) stats.strategies.add(result.strategy);
          patternStats.set(result.pattern, stats);
        }
        console.log(`    ✅ Success (pattern: ${result.pattern}, strategy: ${result.strategy})`);
      } else {
        failureCount++;
        console.log(`    ❌ Failed`);
      }
    });
    
    await Promise.all(batchPromises);
    
    // Delay between batches to avoid rate limiting
    if (i + batchSize < recipes.length) {
      console.log(`  ⏳ Waiting ${delayMs}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 BACKFILL SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total recipes processed: ${recipes.length}`);
  console.log(`✅ Successful: ${successCount} (${((successCount / recipes.length) * 100).toFixed(1)}%)`);
  console.log(`❌ Failed: ${failureCount} (${((failureCount / recipes.length) * 100).toFixed(1)}%)`);
  console.log(`\n📈 Pattern Statistics:`);
  
  // Sort patterns by count
  const sortedPatterns = Array.from(patternStats.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10); // Top 10
  
  for (const [pattern, stats] of sortedPatterns) {
    console.log(`  ${pattern}: ${stats.count} recipes, strategies: ${Array.from(stats.strategies).join(', ')}`);
  }
  
  console.log('\n✅ Backfill complete!');
  console.log('   Check the recipe_import_attempts and recipe_extraction_patterns tables for results.\n');
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const limit = args.find(a => a.startsWith('--limit='))?.split('=')[1] || '1000';
  const batchSize = args.find(a => a.startsWith('--batch='))?.split('=')[1] || '10';
  const delay = args.find(a => a.startsWith('--delay='))?.split('=')[1] || '1000';
  
  backfillParserPatterns({
    limit: parseInt(limit, 10),
    batchSize: parseInt(batchSize, 10),
    delayMs: parseInt(delay, 10),
  }).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { backfillParserPatterns };

