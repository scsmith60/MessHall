// scripts/import-urls-from-file.ts
// Import recipe URLs from a JSON or CSV file
// Useful when you have recipe URLs from datasets, APIs, or manual collection

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  console.error('Please set these in your .env file');
  process.exit(1);
}

// Configure Supabase client for Node.js
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {},
  },
  db: {
    schema: 'public',
  },
  storage: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(null),
    removeItem: () => Promise.resolve(null),
  },
});

// Read URLs from JSON file
function readUrlsFromJson(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    // Handle different JSON structures
    if (Array.isArray(data)) {
      // Array of URLs or objects with url property
      return data.map(item => {
        if (typeof item === 'string') return item;
        if (item.url) return item.url;
        if (item.source_url) return item.source_url;
        if (item.recipe_url) return item.recipe_url;
        return null;
      }).filter(Boolean) as string[];
    }
    
    if (data.recipes && Array.isArray(data.recipes)) {
      return data.recipes.map((item: any) => {
        if (typeof item === 'string') return item;
        return item.url || item.source_url || item.recipe_url;
      }).filter(Boolean);
    }
    
    console.error('Unknown JSON structure. Expected array of URLs or { recipes: [...] }');
    return [];
  } catch (err) {
    console.error(`Error reading JSON file: ${err}`);
    return [];
  }
}

// Read URLs from CSV file
function readUrlsFromCsv(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const urls: string[] = [];
    
    // Try to detect if first line is header
    const firstLine = lines[0].toLowerCase();
    const urlColumnIndex = firstLine.includes('url') 
      ? firstLine.split(',').findIndex(col => col.includes('url'))
      : 0;
    
    for (let i = urlColumnIndex === 0 ? 0 : 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const columns = line.split(',');
      const url = columns[urlColumnIndex]?.trim().replace(/^"|"$/g, '');
      
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        urls.push(url);
      }
    }
    
    return urls;
  } catch (err) {
    console.error(`Error reading CSV file: ${err}`);
    return [];
  }
}

// Read URLs from text file (one URL per line)
function readUrlsFromText(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && (line.startsWith('http://') || line.startsWith('https://')));
  } catch (err) {
    console.error(`Error reading text file: ${err}`);
    return [];
  }
}

// Get system user ID for imports
async function getSystemUserId(): Promise<string | null> {
  const { data: systemUser } = await supabase
    .from('profiles')
    .select('id')
    .or('email.ilike.system@%,email.ilike.backfill@%')
    .limit(1)
    .single();
  
  if (systemUser) return systemUser.id;
  
  const { data: anyUser } = await supabase
    .from('profiles')
    .select('id')
    .limit(1)
    .single();
  
  return anyUser?.id || null;
}

// Insert URLs into database
async function insertUrlsToDatabase(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;
  
  console.log(`\n💾 Inserting ${urls.length} URLs into database...`);
  
  // Get system user ID
  const systemUserId = await getSystemUserId();
  if (!systemUserId) {
    console.error(`  ❌ No users found. Cannot insert recipes without user_id.`);
    console.error(`  💡 Solution: Create a user account first.`);
    return 0;
  }
  
  // Check which URLs already exist
  const { data: existing } = await supabase
    .from('recipes')
    .select('source_url')
    .in('source_url', urls);
  
  const existingUrls = new Set(existing?.map(r => r.source_url) || []);
  const newUrls = urls.filter(url => !existingUrls.has(url));
  
  if (newUrls.length === 0) {
    console.log(`  ℹ️  All URLs already exist in database`);
    return 0;
  }
  
  console.log(`  📊 ${newUrls.length} new URLs to insert (${urls.length - newUrls.length} already exist)`);
  
  // Insert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;
  
  for (let i = 0; i < newUrls.length; i += BATCH_SIZE) {
    const batch = newUrls.slice(i, i + BATCH_SIZE);
    
    const { error } = await supabase
      .from('recipes')
      .insert(
        batch.map(url => ({
          source_url: url,
          title: '', // Empty - will be filled by backfill
          user_id: systemUserId, // System import
          created_at: new Date().toISOString(),
        }))
      );
    
    if (error) {
      console.error(`  ❌ Error inserting batch ${i / BATCH_SIZE + 1}:`, error.message);
    } else {
      inserted += batch.length;
      console.log(`  ✅ Inserted batch ${i / BATCH_SIZE + 1}/${Math.ceil(newUrls.length / BATCH_SIZE)} (${inserted}/${newUrls.length})`);
    }
  }
  
  return inserted;
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find(arg => !arg.startsWith('--')) || args[0];
  
  if (!filePath) {
    console.error('Usage: npx tsx scripts/import-urls-from-file.ts <file-path>');
    console.error('\nSupported formats:');
    console.error('  - JSON: Array of URLs or { recipes: [...] }');
    console.error('  - CSV: URLs in first column or column named "url"');
    console.error('  - TXT: One URL per line');
    console.error('\nExample:');
    console.error('  npx tsx scripts/import-urls-from-file.ts recipes.json');
    console.error('  npx tsx scripts/import-urls-from-file.ts recipes.csv');
    console.error('  npx tsx scripts/import-urls-from-file.ts urls.txt');
    process.exit(1);
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }
  
  console.log(`🚀 Importing recipe URLs from: ${filePath}\n`);
  
  // Detect file type and read URLs
  let urls: string[] = [];
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.json') {
    console.log('📄 Reading JSON file...');
    urls = readUrlsFromJson(filePath);
  } else if (ext === '.csv') {
    console.log('📄 Reading CSV file...');
    urls = readUrlsFromCsv(filePath);
  } else {
    console.log('📄 Reading text file (one URL per line)...');
    urls = readUrlsFromText(filePath);
  }
  
  if (urls.length === 0) {
    console.error('❌ No valid URLs found in file');
    process.exit(1);
  }
  
  console.log(`✅ Found ${urls.length} URLs in file`);
  
  // Validate URLs
  const validUrls = urls.filter(url => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  });
  
  if (validUrls.length < urls.length) {
    console.warn(`⚠️  Filtered out ${urls.length - validUrls.length} invalid URLs`);
  }
  
  // Insert into database
  const inserted = await insertUrlsToDatabase(validUrls);
  
  console.log(`\n✅ Import complete!`);
  console.log(`   - URLs in file: ${urls.length}`);
  console.log(`   - Valid URLs: ${validUrls.length}`);
  console.log(`   - New URLs inserted: ${inserted}`);
  console.log(`   - Already existed: ${validUrls.length - inserted}`);
  console.log(`\n💡 Next step: Run backfill script to process these URLs:`);
  console.log(`   npx tsx scripts/backfill-parser-patterns.ts --limit=${inserted || validUrls.length}`);
}

main().catch(console.error);

