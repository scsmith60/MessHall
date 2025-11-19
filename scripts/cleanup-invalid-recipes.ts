// scripts/cleanup-invalid-recipes.ts
// Removes recipes with invalid source URLs (404 errors)

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

// Check if URL is valid (not 404)
async function isUrlValid(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

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

async function cleanupInvalidRecipes(limit: number = 100, dryRun: boolean = true) {
  console.log(`🔍 Finding recipes with source_url...\n`);
  
  if (dryRun) {
    console.log(`⚠️  DRY RUN MODE - No recipes will be deleted\n`);
  }
  
  // Get recipes with source URLs
  const { data: recipes, error } = await supabase
    .from('recipes')
    .select('id, source_url, title')
    .not('source_url', 'is', null)
    .limit(limit);
  
  if (error) {
    console.error(`❌ Error fetching recipes:`, error.message);
    return;
  }
  
  if (!recipes || recipes.length === 0) {
    console.log(`✅ No recipes found!`);
    return;
  }
  
  console.log(`📊 Checking ${recipes.length} recipes...\n`);
  
  let valid = 0;
  let invalid = 0;
  let deleted = 0;
  let errors = 0;
  
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];
    if (!recipe.source_url) continue;
    
    const progress = `[${i + 1}/${recipes.length}]`;
    console.log(`${progress} Checking: ${recipe.source_url.substring(0, 60)}...`);
    
    try {
      const isValid = await isUrlValid(recipe.source_url);
      
      if (isValid) {
        console.log(`  ✅ URL is valid`);
        valid++;
      } else {
        console.log(`  ❌ URL is invalid (404 or error)`);
        invalid++;
        
        if (!dryRun) {
          const deletedSuccess = await deleteRecipe(recipe.id);
          if (deletedSuccess) {
            console.log(`  🗑️  Deleted recipe: ${recipe.title || recipe.id}`);
            deleted++;
          } else {
            errors++;
          }
        }
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      console.warn(`  ⚠️  Error checking URL:`, err);
      errors++;
    }
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`   - Valid URLs: ${valid}`);
  console.log(`   - Invalid URLs: ${invalid}`);
  if (!dryRun) {
    console.log(`   - Deleted: ${deleted}`);
    console.log(`   - Errors: ${errors}`);
  } else {
    console.log(`\n💡 Run without --dry-run to actually delete invalid recipes:`);
    console.log(`   npx tsx scripts/cleanup-invalid-recipes.ts --limit=${recipes.length}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '100');
  const dryRun = !args.includes('--no-dry-run');
  
  console.log('🚀 Starting invalid recipe cleanup...\n');
  console.log(`📊 Limit: ${limit} recipes`);
  console.log(`🔍 Mode: ${dryRun ? 'DRY RUN (no deletions)' : 'LIVE (will delete)'}\n`);
  
  await cleanupInvalidRecipes(limit, dryRun);
}

main().catch(console.error);

