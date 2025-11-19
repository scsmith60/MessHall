// scripts/fix-missing-images.ts
// Fetches and adds missing images to recipes that have source_url but no image_url

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

// Fetch HTML from URL
async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

// Extract image URL from HTML
function extractImageUrl(html: string, sourceUrl: string): string | null {
  // Try OG image first
  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogImageMatch) {
    let imgUrl = ogImageMatch[1];
    // Handle relative URLs
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
    else if (imgUrl.startsWith('/')) {
      try {
        const urlObj = new URL(sourceUrl);
        imgUrl = urlObj.origin + imgUrl;
      } catch {
        return null;
      }
    }
    return imgUrl;
  }
  
  // Try Twitter image
  const twitterImageMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  if (twitterImageMatch) {
    let imgUrl = twitterImageMatch[1];
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
    else if (imgUrl.startsWith('/')) {
      try {
        const urlObj = new URL(sourceUrl);
        imgUrl = urlObj.origin + imgUrl;
      } catch {
        return null;
      }
    }
    return imgUrl;
  }
  
  // Try JSON-LD image
  const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const json = JSON.parse(match[1]);
      const image = json.image || json.thumbnailUrl || (Array.isArray(json.image) ? json.image[0] : null);
      if (image && typeof image === 'string') {
        let imgUrl = image;
        if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
        else if (imgUrl.startsWith('/')) {
          try {
            const urlObj = new URL(sourceUrl);
            imgUrl = urlObj.origin + imgUrl;
          } catch {
            continue;
          }
        }
        return imgUrl;
      }
    } catch {
      continue;
    }
  }
  
  // Try meta image tag
  const metaImageMatch = html.match(/<meta[^>]*name=["']image["'][^>]*content=["']([^"']+)["']/i);
  if (metaImageMatch) {
    let imgUrl = metaImageMatch[1];
    if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
    else if (imgUrl.startsWith('/')) {
      try {
        const urlObj = new URL(sourceUrl);
        imgUrl = urlObj.origin + imgUrl;
      } catch {
        return null;
      }
    }
    return imgUrl;
  }
  
  return null;
}

// Download image and upload to Supabase storage
async function downloadAndUploadImage(imageUrl: string, recipeId: string, userId: string): Promise<string | null> {
  try {
    // Download image
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.warn(`    ⚠️  Failed to download image: HTTP ${response.status}`);
      return null;
    }
    
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Determine file extension
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    
    // Upload to Supabase storage using service role (bypasses RLS)
    const fileName = `${userId}/${recipeId}/images/${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage
      .from('recipe-images')
      .upload(fileName, buffer, {
        contentType,
        upsert: false,
      });
    
    if (error) {
      console.warn(`    ⚠️  Failed to upload image: ${error.message}`);
      return null;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('recipe-images')
      .getPublicUrl(fileName);
    
    return urlData.publicUrl;
  } catch (err) {
    console.warn(`    ⚠️  Error processing image:`, err);
    return null;
  }
}

// Fix missing images for recipes
async function fixMissingImages(limit: number = 100, batchSize: number = 10, deleteInvalid: boolean = false) {
  console.log(`🔍 Finding recipes with source_url but no image_url...\n`);
  
  // Get recipes without images
  const { data: recipes, error } = await supabase
    .from('recipes')
    .select('id, source_url, user_id, image_url, title')
    .not('source_url', 'is', null)
    .is('image_url', null)
    .limit(limit);
  
  if (error) {
    console.error(`❌ Error fetching recipes:`, error.message);
    return;
  }
  
  if (!recipes || recipes.length === 0) {
    console.log(`✅ No recipes found without images!`);
    return;
  }
  
  console.log(`📊 Found ${recipes.length} recipes without images\n`);
  
  let fixed = 0;
  let failed = 0;
  let skipped = 0;
  
  // Process in batches
  for (let i = 0; i < recipes.length; i += batchSize) {
    const batch = recipes.slice(i, i + batchSize);
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(recipes.length / batchSize)} (${batch.length} recipes)...`);
    
    for (const recipe of batch) {
      try {
        if (!recipe.source_url || !recipe.user_id) {
          skipped++;
          continue;
        }
        
        console.log(`  🔍 Recipe ${recipe.id}: ${recipe.source_url.substring(0, 60)}...`);
        
        // Fetch HTML
        let html: string;
        try {
          html = await fetchHtml(recipe.source_url);
        } catch (err: any) {
          if (err.message.includes('404') || err.message.includes('Not Found')) {
            console.log(`    ⚠️  URL not found (404) - recipe may have invalid URL`);
            failed++;
            continue;
          }
          throw err; // Re-throw other errors
        }
        
        // Extract image URL
        const imageUrl = extractImageUrl(html, recipe.source_url);
        
        if (!imageUrl) {
          console.log(`    ❌ No image found in HTML`);
          failed++;
          continue;
        }
        
        console.log(`    ✅ Found image: ${imageUrl.substring(0, 60)}...`);
        
        // Download and upload
        const publicUrl = await downloadAndUploadImage(imageUrl, recipe.id, recipe.user_id);
        
        if (!publicUrl) {
          failed++;
          continue;
        }
        
        // Update recipe
        const { error: updateError } = await supabase
          .from('recipes')
          .update({ image_url: publicUrl })
          .eq('id', recipe.id);
        
        if (updateError) {
          console.warn(`    ⚠️  Failed to update recipe: ${updateError.message}`);
          failed++;
        } else {
          console.log(`    ✅ Image added successfully!`);
          fixed++;
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err: any) {
        if (err.message && (err.message.includes('404') || err.message.includes('Not Found'))) {
          console.log(`    ⚠️  URL not found (404)`);
          
          // Optionally delete invalid recipes
          if (deleteInvalid) {
            try {
              // Delete recipe and related data
              await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipe.id);
              await supabase.from('recipe_steps').delete().eq('recipe_id', recipe.id);
              await supabase.from('recipes').delete().eq('id', recipe.id);
              console.log(`    🗑️  Deleted invalid recipe`);
              skipped++;
            } catch (deleteErr) {
              console.warn(`    ⚠️  Failed to delete recipe: ${deleteErr}`);
              failed++;
            }
          } else {
            failed++;
          }
        } else {
          console.warn(`    ⚠️  Error processing recipe ${recipe.id}:`, err);
          failed++;
        }
      }
    }
    
    // Delay between batches
    if (i + batchSize < recipes.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`   - Fixed: ${fixed}`);
  console.log(`   - Failed: ${failed}`);
  console.log(`   - Skipped: ${skipped}`);
  console.log(`   - Total: ${recipes.length}`);
  
  if (failed > 0 && !deleteInvalid) {
    console.log(`\n💡 Tip: Many failures are likely due to invalid/generated URLs.`);
    console.log(`   Run with --delete-invalid to remove recipes with 404 URLs.`);
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '100');
  const batchSize = parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1] || '10');
  const deleteInvalid = args.includes('--delete-invalid');
  
  console.log('🚀 Starting image fix script...\n');
  console.log(`📊 Limit: ${limit} recipes`);
  console.log(`📦 Batch size: ${batchSize}`);
  if (deleteInvalid) {
    console.log(`🗑️  Will delete recipes with invalid URLs (404)`);
  }
  console.log('');
  
  await fixMissingImages(limit, batchSize, deleteInvalid);
}

main().catch(console.error);

