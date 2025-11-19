// scripts/collect-recipe-urls.ts
// Collects recipe URLs from multiple recipe sites to train the parser system
// Respects robots.txt and distributes requests across multiple domains

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { readFileSync } from 'fs';

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
    // Mock storage adapter for Node.js
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(null),
    removeItem: () => Promise.resolve(null),
  },
});

// Recipe site configurations
interface RecipeSiteConfig {
  name: string;
  baseUrl: string;
  recipePathPattern: RegExp; // Pattern to match recipe URLs
  sitemapUrl?: string; // Optional sitemap URL
  searchUrl?: string; // Optional search URL pattern
  maxUrls?: number; // Max URLs to collect from this site
  rateLimitMs?: number; // Delay between requests (ms)
}

const RECIPE_SITES: RecipeSiteConfig[] = [
  {
    name: 'AllRecipes',
    baseUrl: 'https://www.allrecipes.com',
    recipePathPattern: /^\/recipe\/\d+\//,
    sitemapUrl: 'https://www.allrecipes.com/sitemap.xml',
    maxUrls: 2000,
    rateLimitMs: 100, // 10 requests/second
  },
  {
    name: 'Food Network',
    baseUrl: 'https://www.foodnetwork.com',
    recipePathPattern: /^\/recipes\/.+/,
    sitemapUrl: 'https://www.foodnetwork.com/sitemap.xml',
    maxUrls: 2000,
    rateLimitMs: 100,
  },
  {
    name: 'BBC Good Food',
    baseUrl: 'https://www.bbcgoodfood.com',
    recipePathPattern: /^\/recipes\/.+/,
    sitemapUrl: 'https://www.bbcgoodfood.com/sitemap.xml',
    maxUrls: 2000,
    rateLimitMs: 100,
  },
  {
    name: 'Tasty',
    baseUrl: 'https://tasty.co',
    recipePathPattern: /^\/recipe\/.+/,
    maxUrls: 1000,
    rateLimitMs: 150,
  },
  {
    name: 'Serious Eats',
    baseUrl: 'https://www.seriouseats.com',
    recipePathPattern: /^\/recipes\/.+/,
    maxUrls: 1000,
    rateLimitMs: 150,
  },
  {
    name: 'Bon Appétit',
    baseUrl: 'https://www.bonappetit.com',
    recipePathPattern: /^\/recipe\/.+/,
    maxUrls: 1000,
    rateLimitMs: 150,
  },
  {
    name: 'Simply Recipes',
    baseUrl: 'https://www.simplyrecipes.com',
    recipePathPattern: /^\/recipes\/.+/,
    maxUrls: 1000,
    rateLimitMs: 150,
  },
  {
    name: 'The Spruce Eats',
    baseUrl: 'https://www.thespruceeats.com',
    recipePathPattern: /^\/recipes\/.+/,
    maxUrls: 1000,
    rateLimitMs: 150,
  },
];

// Check robots.txt and extract allowed paths
async function checkRobotsTxt(site: RecipeSiteConfig): Promise<{ allowed: boolean; canUseSitemap: boolean }> {
  try {
    const robotsUrl = `${site.baseUrl}/robots.txt`;
    const response = await fetch(robotsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RecipeParserBot/1.0; +https://example.com/bot)',
      },
    });
    
    if (!response.ok) {
      console.warn(`⚠️  Could not fetch robots.txt for ${site.name}, will try sitemap anyway`);
      return { allowed: true, canUseSitemap: true };
    }
    
    const robotsText = await response.text();
    
    // Check if sitemap is explicitly allowed
    const sitemapAllowed = !robotsText.match(/User-agent:\s*\*\s*[\s\S]*?Disallow:\s*\/[\s\S]*?Sitemap:/i);
    
    // Check for sitemap directive
    const hasSitemapDirective = robotsText.includes('Sitemap:');
    
    // Simple check - if there's a disallow for /, we should be careful
    const disallowsAll = robotsText.includes('Disallow: /') && !robotsText.includes('Allow:');
    
    if (disallowsAll && !hasSitemapDirective) {
      console.warn(`⚠️  ${site.name} robots.txt disallows all, but will try sitemap anyway`);
      return { allowed: false, canUseSitemap: true }; // Try sitemap even if robots.txt is strict
    }
    
    // Check for crawl-delay
    const crawlDelayMatch = robotsText.match(/Crawl-delay:\s*(\d+)/i);
    if (crawlDelayMatch) {
      const delay = parseInt(crawlDelayMatch[1]) * 1000;
      if (delay > site.rateLimitMs!) {
        console.log(`📋 ${site.name} robots.txt suggests ${delay}ms delay, using that`);
        site.rateLimitMs = delay;
      }
    }
    
    return { allowed: true, canUseSitemap: sitemapAllowed || hasSitemapDirective };
  } catch (err) {
    console.warn(`⚠️  Error checking robots.txt for ${site.name}:`, err);
    return { allowed: true, canUseSitemap: true }; // Proceed but be respectful
  }
}

// Extract URLs from sitemap
async function extractUrlsFromSitemap(sitemapUrl: string, pattern: RegExp, maxUrls: number): Promise<string[]> {
  const urls: Set<string> = new Set();
  
  try {
    console.log(`  📥 Fetching sitemap: ${sitemapUrl}`);
    const response = await fetch(sitemapUrl, {
      headers: {
        'User-Agent': 'RecipeParserBot/1.0 (Educational Purpose)',
      },
    });
    
    if (!response.ok) {
      console.warn(`  ⚠️  Could not fetch sitemap: ${response.status}`);
      return [];
    }
    
    const text = await response.text();
    
    // Extract URLs from sitemap XML
    const urlMatches = text.matchAll(/<loc>(.*?)<\/loc>/gi);
    for (const match of urlMatches) {
      const url = match[1];
      try {
        const urlObj = new URL(url);
        if (pattern.test(urlObj.pathname)) {
          urls.add(url);
          if (urls.size >= maxUrls) break;
        }
      } catch {
        // Invalid URL, skip
      }
    }
    
    console.log(`  ✅ Found ${urls.size} recipe URLs in sitemap`);
  } catch (err) {
    console.warn(`  ⚠️  Error processing sitemap:`, err);
  }
  
  return Array.from(urls);
}

// Collect URLs from a recipe site
async function collectUrlsFromSite(site: RecipeSiteConfig): Promise<string[]> {
  console.log(`\n🌐 Collecting URLs from ${site.name}...`);
  
  // Check robots.txt first (but don't block - sitemaps are often public even if crawling isn't)
  const { allowed, canUseSitemap } = await checkRobotsTxt(site);
  if (!allowed && !canUseSitemap) {
    console.log(`  ⏭️  Skipping ${site.name} - robots.txt blocks access`);
    return [];
  }
  
  const urls: Set<string> = new Set();
  
  // Try sitemap first (most efficient) - sitemaps are often public even if crawling isn't
  if (site.sitemapUrl) {
    console.log(`  📥 Attempting to fetch sitemap (sitemaps are typically public)...`);
    const sitemapUrls = await extractUrlsFromSitemap(
      site.sitemapUrl,
      site.recipePathPattern,
      site.maxUrls || 1000
    );
    sitemapUrls.forEach(url => urls.add(url));
    
    if (sitemapUrls.length === 0) {
      console.log(`  ⚠️  Sitemap returned no URLs - site may require authentication or have changed structure`);
    }
  }
  
  // If we don't have enough URLs, could add search-based collection here
  // (but that's more complex and might hit rate limits)
  
  const urlArray = Array.from(urls).slice(0, site.maxUrls || 1000);
  if (urlArray.length > 0) {
    console.log(`  ✅ Collected ${urlArray.length} URLs from ${site.name}`);
  } else {
    console.log(`  ❌ No URLs collected from ${site.name}`);
  }
  
  return urlArray;
}

// Get system user ID for imports
async function getSystemUserId(): Promise<string | null> {
  // Try to find a system user
  const { data: systemUser } = await supabase
    .from('profiles')
    .select('id')
    .or('email.ilike.system@%,email.ilike.backfill@%')
    .limit(1)
    .single();
  
  if (systemUser) {
    return systemUser.id;
  }
  
  // Fallback: use first user
  const { data: anyUser } = await supabase
    .from('profiles')
    .select('id')
    .limit(1)
    .single();
  
  return anyUser?.id || null;
}

// Insert URLs into database (without recipe data - just URLs for backfill)
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
  const limitPerSite = args.find(arg => arg.startsWith('--limit='))?.split('=')[1];
  const siteFilter = args.find(arg => arg.startsWith('--site='))?.split('=')[1];
  
  console.log('🚀 Starting recipe URL collection from multiple sites...\n');
  
  if (limitPerSite) {
    console.log(`📊 Limit per site: ${limitPerSite}`);
    RECIPE_SITES.forEach(site => {
      site.maxUrls = parseInt(limitPerSite);
    });
  }
  
  if (siteFilter) {
    console.log(`🎯 Filtering to site: ${siteFilter}`);
  }
  
  const sitesToProcess = siteFilter
    ? RECIPE_SITES.filter(s => s.name.toLowerCase().includes(siteFilter.toLowerCase()))
    : RECIPE_SITES;
  
  const allUrls: string[] = [];
  
  // Collect URLs from each site
  for (const site of sitesToProcess) {
    try {
      const urls = await collectUrlsFromSite(site);
      allUrls.push(...urls);
      
      // Respect rate limiting between sites
      if (site.rateLimitMs) {
        await new Promise(resolve => setTimeout(resolve, site.rateLimitMs));
      }
    } catch (err) {
      console.error(`❌ Error collecting from ${site.name}:`, err);
    }
  }
  
  console.log(`\n📊 Total URLs collected: ${allUrls.length}`);
  
  // Insert into database
  const inserted = await insertUrlsToDatabase(allUrls);
  
  console.log(`\n✅ Collection complete!`);
  console.log(`   - Total URLs collected: ${allUrls.length}`);
  console.log(`   - New URLs inserted: ${inserted}`);
  console.log(`   - Already existed: ${allUrls.length - inserted}`);
  console.log(`\n💡 Next step: Run backfill script to process these URLs:`);
  console.log(`   npx tsx scripts/backfill-parser-patterns.ts --limit=${allUrls.length}`);
}

main().catch(console.error);

