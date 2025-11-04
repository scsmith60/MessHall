/**
 * Backfill script to populate original_source_user for existing recipes
 * 
 * This script:
 * 1. Finds all recipes with source_url but no original_source_user
 * 2. Extracts the username from the source_url using the extractSourceUser utility
 * 3. Updates those recipes with the extracted username
 * 
 * Usage:
 *   npx tsx scripts/backfill-original-source-user.ts
 *   or
 *   node --loader ts-node/esm scripts/backfill-original-source-user.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   - EXPO_PUBLIC_SUPABASE_URL or SUPABASE_URL');
  console.error('   - SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY');
  console.error('\n💡 Tip: Use service role key (not anon key) to bypass RLS');
  process.exit(1);
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Extract username from URL (same logic as lib/extractSourceUser.ts)
 */
function extractSourceUserFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;

  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // TikTok: https://www.tiktok.com/@username/video/123456
    if (hostname.includes('tiktok.com')) {
      const match = urlObj.pathname.match(/\/@([^/]+)/);
      if (match && match[1]) {
        return `@${match[1]}`;
      }
    }

    // Instagram: https://www.instagram.com/p/ABC123/ or /reel/ABC123/
    if (hostname.includes('instagram.com')) {
      const pathMatch = urlObj.pathname.match(/^\/([^/]+)\/(?:p|reel|tv)\//);
      if (pathMatch && pathMatch[1] && !pathMatch[1].match(/^\d+$/)) {
        return `@${pathMatch[1]}`;
      }
    }

    // YouTube: https://www.youtube.com/@channelname
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      const match = urlObj.pathname.match(/\/@([^/]+)/);
      if (match && match[1]) {
        return `@${match[1]}`;
      }
    }

    // Pinterest: https://www.pinterest.com/username/board/
    if (hostname.includes('pinterest.com')) {
      const match = urlObj.pathname.match(/^\/([^/]+)/);
      if (match && match[1] && match[1] !== 'pin') {
        return `@${match[1]}`;
      }
    }

    // Generic: if URL contains @username pattern, extract it
    const genericMatch = url.match(/@([a-zA-Z0-9._-]+)/);
    if (genericMatch && genericMatch[1]) {
      return `@${genericMatch[1]}`;
    }

    return null;
  } catch (e) {
    // If URL parsing fails, try regex fallback
    const fallbackMatch = url.match(/@([a-zA-Z0-9._-]+)/);
    if (fallbackMatch && fallbackMatch[1]) {
      return `@${fallbackMatch[1]}`;
    }
    return null;
  }
}

async function backfillOriginalSourceUser() {
  console.log('🔄 Starting backfill of original_source_user...\n');

  try {
    // Step 1: Find all recipes with source_url but no original_source_user
    console.log('📋 Fetching recipes with source_url but no original_source_user...');
    const { data: recipes, error: fetchError } = await supabase
      .from('recipes')
      .select('id, title, source_url, original_source_user')
      .not('source_url', 'is', null)
      .is('original_source_user', null);

    if (fetchError) {
      throw fetchError;
    }

    if (!recipes || recipes.length === 0) {
      console.log('✅ No recipes found that need backfilling. All done!');
      return;
    }

    console.log(`   Found ${recipes.length} recipes to process\n`);

    // Step 2: Process each recipe
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const recipe of recipes) {
      if (!recipe.source_url) {
        skipped++;
        continue;
      }

      const extractedUser = extractSourceUserFromUrl(recipe.source_url);

      if (!extractedUser) {
        console.log(`   ⏭️  Skipping "${recipe.title}" - no username found in URL: ${recipe.source_url}`);
        skipped++;
        continue;
      }

      // Step 3: Update the recipe
      const { error: updateError } = await supabase
        .from('recipes')
        .update({ original_source_user: extractedUser })
        .eq('id', recipe.id);

      if (updateError) {
        console.error(`   ❌ Error updating "${recipe.title}":`, updateError.message);
        errors++;
      } else {
        console.log(`   ✅ Updated "${recipe.title}" → ${extractedUser}`);
        updated++;
      }
    }

    // Step 4: Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Backfill Summary:');
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped} (no username in URL)`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📝 Total processed: ${recipes.length}`);
    console.log('='.repeat(50));

  } catch (error: any) {
    console.error('\n❌ Backfill failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the backfill
backfillOriginalSourceUser()
  .then(() => {
    console.log('\n✨ Backfill completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });

