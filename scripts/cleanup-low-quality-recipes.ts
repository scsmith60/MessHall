// scripts/cleanup-low-quality-recipes.ts
// Deletes low-quality recipes (few ingredients, no images, etc.)
// Can filter by date to delete recipes imported today or in a date range

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: {} },
  db: { schema: 'public' },
  storage: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve(null), removeItem: () => Promise.resolve(null) },
});

// Delete recipe and all related data
async function deleteRecipe(recipeId: string): Promise<boolean> {
  try {
    // Delete in order (respecting foreign keys)
    await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId);
    await supabase.from('recipe_steps').delete().eq('recipe_id', recipeId);
    await supabase.from('recipe_comments').delete().eq('recipe_id', recipeId);
    await supabase.from('recipe_likes').delete().eq('recipe_id', recipeId);
    await supabase.from('recipe_cooks').delete().eq('recipe_id', recipeId);
    await supabase.from('recipes').delete().eq('id', recipeId);
    return true;
  } catch (err) {
    console.error(`    ❌ Error deleting recipe:`, err);
    return false;
  }
}

async function cleanupLowQualityRecipes(options: {
  dateFrom?: string; // ISO date string, e.g., '2024-01-15'
  dateTo?: string;   // ISO date string, e.g., '2024-01-15'
  todayOnly?: boolean;
  maxIngredients?: number; // Delete recipes with <= this many ingredients
  requireImage?: boolean;  // Delete recipes without images
  dryRun?: boolean;
}) {
  const { dateFrom, dateTo, todayOnly, maxIngredients = 3, requireImage = true, dryRun = true } = options;
  
  console.log('🔍 Finding low-quality recipes...\n');
  
  if (dryRun) {
    console.log(`⚠️  DRY RUN MODE - No recipes will be deleted\n`);
  }
  
  // Build query
  let query = supabase
    .from('recipes')
    .select('id, title, source_url, image_url, created_at');
  
  // Filter by date
  if (todayOnly) {
    const today = new Date().toISOString().split('T')[0];
    query = query.gte('created_at', `${today}T00:00:00Z`)
                  .lt('created_at', `${today}T23:59:59Z`);
    console.log(`📅 Filtering: Recipes created today (${today})`);
  } else if (dateFrom && dateTo) {
    query = query.gte('created_at', `${dateFrom}T00:00:00Z`)
                  .lte('created_at', `${dateTo}T23:59:59Z`);
    console.log(`📅 Filtering: Recipes from ${dateFrom} to ${dateTo}`);
  } else if (dateFrom) {
    query = query.gte('created_at', `${dateFrom}T00:00:00Z`);
    console.log(`📅 Filtering: Recipes from ${dateFrom} onwards`);
  }
  
  console.log(`📊 Criteria:`);
  console.log(`   - Max ingredients: ${maxIngredients} or fewer`);
  if (requireImage) {
    console.log(`   - Must have image (will delete recipes without images)`);
  }
  console.log('');
  
  const { data: recipes, error } = await query;
  
  if (error) {
    console.error(`❌ Error fetching recipes:`, error.message);
    return;
  }
  
  if (!recipes || recipes.length === 0) {
    console.log(`✅ No recipes found matching criteria!`);
    return;
  }
  
  console.log(`📊 Found ${recipes.length} recipes to check...\n`);
  
  // Get ingredient counts for each recipe
  const recipesWithCounts = await Promise.all(
    recipes.map(async (recipe: any) => {
      const { count } = await supabase
        .from('recipe_ingredients')
        .select('*', { count: 'exact', head: true })
        .eq('recipe_id', recipe.id);
      
      return {
        ...recipe,
        ingredientCount: count || 0,
      };
    })
  );
  
  // Filter to low-quality recipes
  const lowQuality = recipesWithCounts.filter((recipe: any) => {
    const hasFewIngredients = recipe.ingredientCount <= maxIngredients;
    const missingImage = requireImage && !recipe.image_url;
    return hasFewIngredients || missingImage;
  });
  
  console.log(`📊 Low-quality recipes found: ${lowQuality.length}\n`);
  
  if (lowQuality.length === 0) {
    console.log(`✅ No low-quality recipes found!`);
    return;
  }
  
  // Show summary
  const withFewIngredients = lowQuality.filter((r: any) => r.ingredientCount <= maxIngredients).length;
  const withoutImages = lowQuality.filter((r: any) => !r.image_url).length;
  
  console.log(`📈 Breakdown:`);
  console.log(`   - Recipes with ≤${maxIngredients} ingredients: ${withFewIngredients}`);
  console.log(`   - Recipes without images: ${withoutImages}`);
  console.log(`   - Total to delete: ${lowQuality.length}\n`);
  
  if (dryRun) {
    console.log(`\n💡 Run without --dry-run to actually delete:`);
    console.log(`   npx tsx scripts/cleanup-low-quality-recipes.ts --today --max-ingredients=${maxIngredients} --require-image --no-dry-run`);
    return;
  }
  
  // Delete recipes
  let deleted = 0;
  let errors = 0;
  
  console.log(`🗑️  Deleting ${lowQuality.length} recipes...\n`);
  
  for (let i = 0; i < lowQuality.length; i++) {
    const recipe = lowQuality[i];
    const progress = `[${i + 1}/${lowQuality.length}]`;
    
    const reasons = [];
    if (recipe.ingredientCount <= maxIngredients) reasons.push(`${recipe.ingredientCount} ingredients`);
    if (!recipe.image_url) reasons.push('no image');
    
    console.log(`${progress} Deleting: ${recipe.title || recipe.id.substring(0, 8)}... (${reasons.join(', ')})`);
    
    const success = await deleteRecipe(recipe.id);
    if (success) {
      deleted++;
    } else {
      errors++;
    }
    
    // Progress update every 10
    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${deleted} deleted, ${errors} errors\n`);
    }
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`   - Deleted: ${deleted}`);
  console.log(`   - Errors: ${errors}`);
  console.log(`   - Total: ${lowQuality.length}`);
}

async function main() {
  const args = process.argv.slice(2);
  
  const todayOnly = args.includes('--today');
  const dateFrom = args.find(arg => arg.startsWith('--from='))?.split('=')[1];
  const dateTo = args.find(arg => arg.startsWith('--to='))?.split('=')[1];
  const maxIngredients = parseInt(args.find(arg => arg.startsWith('--max-ingredients='))?.split('=')[1] || '3');
  const requireImage = args.includes('--require-image');
  const dryRun = !args.includes('--no-dry-run');
  
  console.log('🚀 Starting low-quality recipe cleanup...\n');
  
  await cleanupLowQualityRecipes({
    dateFrom,
    dateTo,
    todayOnly,
    maxIngredients,
    requireImage,
    dryRun,
  });
}

main().catch(console.error);

