// scripts/generate-recipe-urls.ts
// Generates recipe URLs directly from known recipe sites
// More reliable than scraping search engines

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

// Recipe site URL patterns
const RECIPE_SITE_PATTERNS = [
  {
    name: 'AllRecipes',
    baseUrl: 'https://www.allrecipes.com/recipe/',
    pattern: (id: number) => `${id}/recipe-name-${id}/`,
    minId: 10000,
    maxId: 300000,
    sample: 2000,
  },
  {
    name: 'Food Network',
    baseUrl: 'https://www.foodnetwork.com/recipes/',
    pattern: (id: number) => `recipe-${id}`,
    minId: 1000,
    maxId: 50000,
    sample: 2000,
  },
  {
    name: 'Food.com',
    baseUrl: 'https://www.food.com/recipe/',
    pattern: (id: number) => `recipe-${id}`,
    minId: 1000,
    maxId: 200000,
    sample: 2000,
  },
  {
    name: 'BBC Good Food',
    baseUrl: 'https://www.bbcgoodfood.com/recipes/',
    pattern: (id: number) => `recipe-${id}`,
    minId: 1,
    maxId: 10000,
    sample: 1000,
  },
];

// Generate random recipe URLs
function generateRecipeUrls(site: typeof RECIPE_SITE_PATTERNS[0], count: number): string[] {
  const urls: Set<string> = new Set();
  const range = site.maxId - site.minId;
  
  // Generate random IDs within the range
  while (urls.size < count) {
    const randomId = Math.floor(Math.random() * range) + site.minId;
    const url = site.baseUrl + site.pattern(randomId);
    urls.add(url);
  }
  
  return Array.from(urls);
}

// Verify URL exists (optional - can be slow)
async function verifyUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return response.ok && response.status === 200;
  } catch {
    return false;
  }
}

// Insert URLs into database
async function insertUrlsToDatabase(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;
  
  console.log(`\n💾 Inserting ${urls.length} URLs into database...`);
  
  const { data: existing } = await supabase
    .from('recipes')
    .select('source_url')
    .in('source_url', urls);
  
  const existingUrls = new Set(existing?.map(r => r.source_url) || []);
  const newUrls = urls.filter(url => !existingUrls.has(url));
  
  if (newUrls.length === 0) {
    console.log(`  ℹ️  All URLs already exist`);
    return 0;
  }
  
  console.log(`  📊 ${newUrls.length} new URLs (${urls.length - newUrls.length} already exist)`);
  
  // Get system user ID once (reuse for all batches)
  let systemUserId: string | null = null;
  
  // Try to find a system user (user with email like 'system@' or 'backfill@')
  const { data: systemUser } = await supabase
    .from('profiles')
    .select('id')
    .or('email.ilike.system@%,email.ilike.backfill@%')
    .limit(1)
    .single();
  
  if (systemUser) {
    systemUserId = systemUser.id;
    console.log(`  ✅ Using system user: ${systemUserId}`);
  } else {
    // If no system user exists, use the first user in the system
    const { data: anyUser } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)
      .single();
    
    if (anyUser) {
      systemUserId = anyUser.id;
      console.warn(`  ⚠️  No system user found. Using first user ${systemUserId} as system user`);
    } else {
      console.error(`  ❌ No users found in database. Cannot insert recipes without user_id.`);
      console.error(`  💡 Solution: Create a user account first, or modify recipes table to allow null user_id for system imports.`);
      return 0;
    }
  }
  
  const BATCH_SIZE = 100;
  let inserted = 0;
  
  for (let i = 0; i < newUrls.length; i += BATCH_SIZE) {
    const batch = newUrls.slice(i, i + BATCH_SIZE);
    
    const { error } = await supabase
      .from('recipes')
      .insert(
        batch.map(url => ({
          source_url: url,
          title: '',
          user_id: systemUserId,
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

async function main() {
  const args = process.argv.slice(2);
  const count = parseInt(args.find(arg => arg.startsWith('--count='))?.split('=')[1] || '1000');
  const siteName = args.find(arg => arg.startsWith('--site='))?.split('=')[1];
  const verify = args.includes('--verify');
  
  console.log('🚀 Generating recipe URLs from known sites...\n');
  
  const sites = siteName 
    ? RECIPE_SITE_PATTERNS.filter(s => s.name.toLowerCase().includes(siteName.toLowerCase()))
    : RECIPE_SITE_PATTERNS;
  
  if (sites.length === 0) {
    console.error(`❌ No sites found matching: ${siteName}`);
    process.exit(1);
  }
  
  const allUrls: string[] = [];
  const urlsPerSite = Math.ceil(count / sites.length);
  
  for (const site of sites) {
    console.log(`📝 Generating ${urlsPerSite} URLs for ${site.name}...`);
    const urls = generateRecipeUrls(site, urlsPerSite);
    allUrls.push(...urls);
    console.log(`  ✅ Generated ${urls.length} URLs`);
  }
  
  console.log(`\n📊 Total URLs generated: ${allUrls.length}`);
  
  if (verify) {
    console.log(`\n🔍 Verifying URLs (this may take a while)...`);
    const verifiedUrls: string[] = [];
    for (let i = 0; i < allUrls.length; i++) {
      const url = allUrls[i];
      if (await verifyUrl(url)) {
        verifiedUrls.push(url);
      }
      if ((i + 1) % 100 === 0) {
        console.log(`  Verified ${i + 1}/${allUrls.length} (${verifiedUrls.length} valid)`);
      }
    }
    console.log(`  ✅ Verified: ${verifiedUrls.length}/${allUrls.length} URLs are valid`);
    await insertUrlsToDatabase(verifiedUrls);
  } else {
    console.log(`\n💡 Note: URLs are not verified. Some may not exist.`);
    console.log(`   Use --verify to check URLs before inserting (slower but more accurate).`);
    await insertUrlsToDatabase(allUrls);
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`\n💡 Next: Run backfill script to process these URLs:`);
  console.log(`   npx tsx scripts/backfill-parser-patterns.ts --limit=${allUrls.length}`);
}

main().catch(console.error);

