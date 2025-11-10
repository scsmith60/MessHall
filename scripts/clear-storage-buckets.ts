/**
 * clear-storage-buckets.ts
 * 
 * ⚠️ WARNING: This script will DELETE ALL FILES from your storage buckets
 * 
 * This script clears all files from Supabase storage buckets:
 * - recipe-images
 * - avatars
 * - sponsored-images
 * - support
 * 
 * Usage:
 *   1. Set your Supabase URL and service role key as environment variables:
 *      export SUPABASE_URL="https://your-project.supabase.co"
 *      export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
 * 
 *   2. Clear all buckets:
 *      npx tsx scripts/clear-storage-buckets.ts
 * 
 *   3. Clear a specific path within a bucket:
 *      npx tsx scripts/clear-storage-buckets.ts --path bucket-name path-prefix
 *      Example: npx tsx scripts/clear-storage-buckets.ts --path recipe-images recipes
 * 
 * Or run directly with Node.js if you have the dependencies:
 *   node --loader ts-node/esm scripts/clear-storage-buckets.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL:', SUPABASE_URL ? '✓' : '✗');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? '✓' : '✗');
  console.error('\nPlease set these environment variables before running this script.');
  process.exit(1);
}

// Create admin client with service role key (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// List of buckets to clear
const BUCKETS_TO_CLEAR = [
  'recipe-images',
  'avatars',
  'sponsored-images',
  'support'
];

/**
 * Clear a specific path within a bucket (e.g., "recipes" folder)
 */
async function clearPath(bucketName: string, pathPrefix: string): Promise<void> {
  console.log(`\n🗑️  Clearing path: ${bucketName}/${pathPrefix}...`);
  
  try {
    const allPaths: string[] = [];
    
    async function collectPaths(prefix: string) {
      const { data: items, error } = await supabase.storage
        .from(bucketName)
        .list(prefix, {
          limit: 1000,
          offset: 0
        });

      if (error) {
        console.error(`   ⚠️  Error listing ${prefix}: ${error.message}`);
        return;
      }

      if (!items || items.length === 0) {
        return;
      }

      for (const item of items) {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        
        if (item.id === null) {
          // It's a folder, recurse
          await collectPaths(fullPath);
        } else {
          // It's a file
          allPaths.push(fullPath);
        }
      }
    }

    await collectPaths(pathPrefix);

    if (allPaths.length === 0) {
      console.log(`   ✓ No files found at path: ${pathPrefix}`);
      return;
    }

    console.log(`   Found ${allPaths.length} file(s) to delete...`);

    // Delete in batches of 100 (Supabase limit)
    const batchSize = 100;
    for (let i = 0; i < allPaths.length; i += batchSize) {
      const batch = allPaths.slice(i, i + batchSize);
      const { error: deleteError } = await supabase.storage
        .from(bucketName)
        .remove(batch);

      if (deleteError) {
        console.error(`   ❌ Error deleting batch: ${deleteError.message}`);
      } else {
        console.log(`   ✓ Deleted batch ${Math.floor(i / batchSize) + 1} (${batch.length} files)`);
      }
    }

    console.log(`   ✅ Successfully cleared path: ${bucketName}/${pathPrefix}`);
  } catch (error) {
    console.error(`   ❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function clearBucket(bucketName: string): Promise<void> {
  console.log(`\n🗑️  Clearing bucket: ${bucketName}...`);
  
  try {
    // List all files in the bucket
    const { data: files, error: listError } = await supabase.storage
      .from(bucketName)
      .list('', {
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (listError) {
      console.error(`   ❌ Error listing files: ${listError.message}`);
      return;
    }

    if (!files || files.length === 0) {
      console.log(`   ✓ Bucket is already empty`);
      return;
    }

    console.log(`   Found ${files.length} file(s)/folder(s)`);

    // Delete all files
    // Note: We need to get all file paths recursively
    const allPaths: string[] = [];
    
    async function collectPaths(prefix: string = '') {
      const { data: items, error } = await supabase.storage
        .from(bucketName)
        .list(prefix, {
          limit: 1000,
          offset: 0
        });

      if (error) {
        console.error(`   ⚠️  Error listing ${prefix}: ${error.message}`);
        return;
      }

      if (!items) return;

      for (const item of items) {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        
        if (item.id === null) {
          // It's a folder, recurse
          await collectPaths(fullPath);
        } else {
          // It's a file
          allPaths.push(fullPath);
        }
      }
    }

    await collectPaths();

    if (allPaths.length === 0) {
      console.log(`   ✓ No files to delete`);
      return;
    }

    console.log(`   Deleting ${allPaths.length} file(s)...`);

    // Delete in batches of 100 (Supabase limit)
    const batchSize = 100;
    for (let i = 0; i < allPaths.length; i += batchSize) {
      const batch = allPaths.slice(i, i + batchSize);
      const { error: deleteError } = await supabase.storage
        .from(bucketName)
        .remove(batch);

      if (deleteError) {
        console.error(`   ❌ Error deleting batch: ${deleteError.message}`);
      } else {
        console.log(`   ✓ Deleted batch ${Math.floor(i / batchSize) + 1} (${batch.length} files)`);
      }
    }

    console.log(`   ✅ Successfully cleared bucket: ${bucketName}`);
  } catch (error) {
    console.error(`   ❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  // Check if a specific path was requested via command line argument
  const args = process.argv.slice(2);
  if (args.length >= 2 && args[0] === '--path') {
    // Usage: npx tsx scripts/clear-storage-buckets.ts --path bucket-name path-prefix
    // Example: npx tsx scripts/clear-storage-buckets.ts --path recipe-images recipes
    const bucketName = args[1];
    const pathPrefix = args[2] || '';
    
    console.log('🚀 Clearing specific storage path...');
    console.log(`📦 Supabase URL: ${SUPABASE_URL}`);
    console.log(`📁 Path: ${bucketName}/${pathPrefix}`);
    
    await clearPath(bucketName, pathPrefix);
    console.log('\n✅ Path cleanup complete!');
    return;
  }

  // Default: clear all buckets
  console.log('🚀 Starting storage bucket cleanup...');
  console.log(`📦 Supabase URL: ${SUPABASE_URL}`);
  console.log(`📋 Buckets to clear: ${BUCKETS_TO_CLEAR.join(', ')}`);
  console.log('\n💡 Tip: To clear a specific path, use:');
  console.log('   npx tsx scripts/clear-storage-buckets.ts --path bucket-name path-prefix');
  console.log('   Example: npx tsx scripts/clear-storage-buckets.ts --path recipe-images recipes\n');

  for (const bucket of BUCKETS_TO_CLEAR) {
    await clearBucket(bucket);
  }

  console.log('\n✅ Storage cleanup complete!');
  console.log('\n⚠️  Remember to also run the SQL migration: clear_all_data.sql');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

