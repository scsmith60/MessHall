// scripts/search-and-collect-urls.ts
// Searches Google/DuckDuckGo for recipe URLs and collects them automatically
// Example: "chicken recipes" will find recipe URLs from various sites

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
  process.exit(1);
}

// Configure Supabase client for Node.js
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: { headers: {} },
  db: { schema: 'public' },
  storage: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(null),
    removeItem: () => Promise.resolve(null),
  },
});

// Known recipe site domains to filter results
const RECIPE_DOMAINS = [
  'allrecipes.com', 'food.com', 'foodnetwork.com', 'epicurious.com',
  'bonappetit.com', 'seriouseats.com', 'simplyrecipes.com', 'delish.com',
  'tasty.co', 'tasteofhome.com', 'myrecipes.com', 'cookinglight.com',
  'eatingwell.com', 'realsimple.com', 'southernliving.com', 'bhg.com',
  'marthastewart.com', 'jamieoliver.com', 'gordonramsay.com', 'bbcgoodfood.com',
  'bettycrocker.com', 'pillsbury.com', 'kingarthurbaking.com',
  'cookieandkate.com', 'budgetbytes.com', 'skinnytaste.com', 'thekitchn.com',
  'minimalistbaker.com', 'pinchofyum.com', 'recipetineats.com',
  'sallysbakingaddiction.com', 'smittenkitchen.com', 'halfbakedharvest.com',
];

// Search DuckDuckGo (free, no API key needed)
async function searchDuckDuckGo(query: string, maxResults: number = 100): Promise<string[]> {
  const urls: Set<string> = new Set();
  
  try {
    console.log(`🔍 Searching DuckDuckGo for: "${query}"`);
    
    // Try multiple DuckDuckGo endpoints
    const searchUrls = [
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    ];
    
    for (const searchUrl of searchUrls) {
      try {
        const response = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
        });
        
        if (!response.ok) {
          console.warn(`  ⚠️  DuckDuckGo search failed: ${response.status}`);
          continue;
        }
        
        const html = await response.text();
        
        // Debug: save HTML to see what we're getting
        if (urls.size === 0) {
          console.log(`  📄 HTML length: ${html.length} chars`);
        }
        
        // Try multiple patterns to extract URLs
        const patterns = [
          // Pattern 1: result__url class
          /<a[^>]*class="[^"]*result__url[^"]*"[^>]*href="([^"]+)"/gi,
          // Pattern 2: result-link class
          /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"/gi,
          // Pattern 3: Any link with href
          /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/gi,
          // Pattern 4: DuckDuckGo redirect URLs (uddg=)
          /uddg=([^&"'>]+)/gi,
        ];
        
        for (const pattern of patterns) {
          const matches = html.matchAll(pattern);
          for (const match of matches) {
            let url = match[1];
            
            // Handle DuckDuckGo redirect URLs
            if (url.startsWith('http')) {
              try {
                url = decodeURIComponent(url);
              } catch {
                // Not a URL-encoded string, use as-is
              }
            }
            
            try {
              // Handle relative URLs
              if (!url.startsWith('http')) {
                if (url.startsWith('//')) {
                  url = 'https:' + url;
                } else if (url.startsWith('/')) {
                  continue; // Skip relative URLs
                } else {
                  continue; // Skip invalid URLs
                }
              }
              
              const urlObj = new URL(url);
              const hostname = urlObj.hostname.replace(/^www\./, '').toLowerCase();
              
              // Check if it's a recipe site
              const isRecipeSite = RECIPE_DOMAINS.some(domain => hostname.includes(domain.toLowerCase()));
              
              if (isRecipeSite) {
                // Check if it looks like a recipe URL (more lenient)
                const isRecipeUrl = urlObj.pathname.match(/\/recipe|\/recipes|\/r\//i) || 
                                   urlObj.pathname.length > 10; // Most recipe URLs are longer
                
                if (isRecipeUrl) {
                  urls.add(url);
                  if (urls.size >= maxResults) break;
                }
              }
            } catch (e) {
              // Invalid URL, skip
            }
          }
          
          if (urls.size >= maxResults) break;
        }
        
        if (urls.size > 0) {
          console.log(`  ✅ Found ${urls.size} recipe URLs from DuckDuckGo`);
          break; // Success, no need to try other endpoints
        }
      } catch (err) {
        console.warn(`  ⚠️  Error with search URL ${searchUrl}:`, err);
        continue;
      }
    }
    
    if (urls.size === 0) {
      console.warn(`  ⚠️  No recipe URLs found. Trying alternative method...`);
      // Try searching with site: filter
      return await searchDuckDuckGoWithSiteFilter(query, maxResults);
    }
  } catch (err) {
    console.error(`  ❌ Error searching DuckDuckGo:`, err);
  }
  
  return Array.from(urls);
}

// Alternative: Search with site: filters for better results
async function searchDuckDuckGoWithSiteFilter(query: string, maxResults: number): Promise<string[]> {
  const urls: Set<string> = new Set();
  
  // Search each recipe site individually
  const topSites = ['allrecipes.com', 'foodnetwork.com', 'food.com', 'bbcgoodfood.com', 'simplyrecipes.com'];
  
  for (const site of topSites) {
    try {
      const siteQuery = `${query} site:${site}`;
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(siteQuery)}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      
      // Extract all URLs from the page
      const urlPattern = /https?:\/\/[^\s"<>]+/gi;
      const matches = html.matchAll(urlPattern);
      
      for (const match of matches) {
        try {
          const url = match[0].replace(/[.,;!?]+$/, ''); // Remove trailing punctuation
          const urlObj = new URL(url);
          
          if (urlObj.hostname.includes(site) && 
              (urlObj.pathname.match(/\/recipe|\/recipes/i) || urlObj.pathname.length > 10)) {
            urls.add(url);
            if (urls.size >= maxResults) break;
          }
        } catch {
          // Invalid URL
        }
      }
      
      if (urls.size >= maxResults) break;
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.warn(`  ⚠️  Error searching ${site}:`, err);
    }
  }
  
  if (urls.size > 0) {
    console.log(`  ✅ Found ${urls.size} recipe URLs using site-specific searches`);
  }
  
  return Array.from(urls);
}

// Search Google Custom Search API (requires API key)
async function searchGoogle(query: string, apiKey: string, searchEngineId: string, maxResults: number = 100): Promise<string[]> {
  const urls: Set<string> = new Set();
  
  try {
    console.log(`🔍 Searching Google for: "${query}"`);
    
    // Google Custom Search API allows 100 results per query (10 per page, 10 pages max)
    const resultsPerPage = 10;
    const maxPages = Math.min(10, Math.ceil(maxResults / resultsPerPage));
    
    for (let page = 0; page < maxPages; page++) {
      const startIndex = page * resultsPerPage + 1;
      const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&start=${startIndex}&num=${resultsPerPage}`;
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`  ⚠️  Rate limited, waiting 1 second...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        console.warn(`  ⚠️  Google API error: ${response.status}`);
        break;
      }
      
      const data = await response.json();
      
      if (data.items) {
        for (const item of data.items) {
          const url = item.link;
          try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.replace(/^www\./, '');
            
            // Check if it's a recipe site
            if (RECIPE_DOMAINS.some(domain => hostname.includes(domain))) {
              // Check if it looks like a recipe URL
              if (urlObj.pathname.match(/\/recipe|\/recipes|\/r\//i)) {
                urls.add(url);
                if (urls.size >= maxResults) break;
              }
            }
          } catch {
            // Invalid URL, skip
          }
        }
      }
      
      if (!data.items || data.items.length < resultsPerPage) {
        break; // No more results
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`  ✅ Found ${urls.size} recipe URLs from Google`);
  } catch (err) {
    console.error(`  ❌ Error searching Google:`, err);
  }
  
  return Array.from(urls);
}

// Search with site-specific queries
async function searchForRecipeUrls(searchQueries: string[], options: {
  useGoogle?: boolean;
  googleApiKey?: string;
  googleSearchEngineId?: string;
  maxResultsPerQuery?: number;
  saveToFile?: string;
  insertToDatabase?: boolean;
}): Promise<string[]> {
  const allUrls: Set<string> = new Set();
  const maxResultsPerQuery = options.maxResultsPerQuery || 100;
  
  for (const query of searchQueries) {
    let urls: string[] = [];
    
    if (options.useGoogle && options.googleApiKey && options.googleSearchEngineId) {
      urls = await searchGoogle(query, options.googleApiKey, options.googleSearchEngineId, maxResultsPerQuery);
    } else {
      urls = await searchDuckDuckGo(query, maxResultsPerQuery);
    }
    
    urls.forEach(url => allUrls.add(url));
    
    // Rate limiting between queries
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  const urlArray = Array.from(allUrls);
  
  // Save to file if requested
  if (options.saveToFile) {
    const ext = path.extname(options.saveToFile).toLowerCase();
    if (ext === '.json') {
      fs.writeFileSync(options.saveToFile, JSON.stringify(urlArray, null, 2));
    } else if (ext === '.txt') {
      fs.writeFileSync(options.saveToFile, urlArray.join('\n'));
    } else {
      fs.writeFileSync(options.saveToFile, urlArray.join('\n'));
    }
    console.log(`\n💾 Saved ${urlArray.length} URLs to ${options.saveToFile}`);
  }
  
  // Insert to database if requested
  if (options.insertToDatabase) {
    await insertUrlsToDatabase(urlArray);
  }
  
  return urlArray;
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

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const queryArg = args.find(arg => arg.startsWith('--query='))?.split('=')[1];
  const queriesArg = args.find(arg => arg.startsWith('--queries='))?.split('=')[1];
  const maxResults = parseInt(args.find(arg => arg.startsWith('--max='))?.split('=')[1] || '100');
  const saveFile = args.find(arg => arg.startsWith('--save='))?.split('=')[1];
  const useGoogle = args.includes('--google');
  const googleApiKey = process.env.GOOGLE_API_KEY || args.find(arg => arg.startsWith('--google-key='))?.split('=')[1];
  const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || args.find(arg => arg.startsWith('--google-cx='))?.split('=')[1];
  const insertDb = args.includes('--insert-db') || !saveFile; // Default to DB if no file specified
  
  // Build search queries
  let searchQueries: string[] = [];
  
  if (queriesArg) {
    // Multiple queries separated by comma
    searchQueries = queriesArg.split(',').map(q => q.trim());
  } else if (queryArg) {
    // Single query
    searchQueries = [queryArg];
  } else {
    // Default: search for common recipe types
    searchQueries = [
      'chicken recipes',
      'pasta recipes',
      'dessert recipes',
      'breakfast recipes',
      'dinner recipes',
      'vegetarian recipes',
      'baking recipes',
    ];
  }
  
  // Don't add complex site filters - they might reduce results
  // Just ensure "recipe" is in the query
  searchQueries = searchQueries.map(q => {
    if (!q.toLowerCase().includes('recipe')) {
      return `${q} recipe`;
    }
    return q;
  });
  
  console.log('🚀 Starting recipe URL collection via search...\n');
  console.log(`📋 Search queries: ${searchQueries.join(', ')}`);
  console.log(`📊 Max results per query: ${maxResults}`);
  if (useGoogle) {
    console.log(`🔍 Using Google Custom Search API`);
  } else {
    console.log(`🔍 Using DuckDuckGo (free, no API key needed)`);
  }
  console.log('');
  
  // Search and collect
  const urls = await searchForRecipeUrls(searchQueries, {
    useGoogle,
    googleApiKey,
    googleSearchEngineId,
    maxResultsPerQuery: maxResults,
    saveToFile: saveFile,
    insertToDatabase: insertDb,
  });
  
  console.log(`\n✅ Collection complete!`);
  console.log(`   - Total unique URLs found: ${urls.length}`);
  console.log(`\n💡 Next step: Run backfill script to process these URLs:`);
  console.log(`   npx tsx scripts/backfill-parser-patterns.ts --limit=${urls.length}`);
}

main().catch(console.error);

