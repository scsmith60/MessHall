# Recipe URL Collection Guide

## Overview

The `collect-recipe-urls.ts` script collects recipe URLs from multiple recipe sites to train your parser system. It respects robots.txt and distributes requests across multiple domains.

## Features

- ✅ **Multi-Site Collection**: Collects from 8+ popular recipe sites
- ✅ **Robots.txt Respect**: Checks and respects robots.txt for each site
- ✅ **Rate Limiting**: Configurable delays between requests
- ✅ **Sitemap Parsing**: Efficiently extracts URLs from sitemaps
- ✅ **Duplicate Prevention**: Skips URLs already in your database
- ✅ **Batch Insertion**: Efficiently inserts URLs in batches

## Supported Sites

1. **AllRecipes** - 2,000 URLs max
2. **Food Network** - 2,000 URLs max
3. **BBC Good Food** - 2,000 URLs max
4. **Tasty** - 1,000 URLs max
5. **Serious Eats** - 1,000 URLs max
6. **Bon Appétit** - 1,000 URLs max
7. **Simply Recipes** - 1,000 URLs max
8. **The Spruce Eats** - 1,000 URLs max

## Usage

### Basic Usage (All Sites)
```bash
npx tsx scripts/collect-recipe-urls.ts
```

### Limit URLs Per Site
```bash
npx tsx scripts/collect-recipe-urls.ts --limit=500
```

### Collect from Specific Site
```bash
npx tsx scripts/collect-recipe-urls.ts --site=AllRecipes
```

## How It Works

1. **Robots.txt Check**: For each site, checks robots.txt to ensure we can proceed
2. **Sitemap Parsing**: Extracts recipe URLs from sitemap.xml files
3. **Pattern Matching**: Filters URLs to match recipe patterns
4. **Database Insert**: Inserts new URLs into `recipes` table (without recipe data)
5. **Backfill Ready**: URLs are ready for your backfill script to process

## Workflow

```bash
# Step 1: Collect URLs from multiple sites
npx tsx scripts/collect-recipe-urls.ts --limit=1000

# Step 2: Process URLs with backfill script
npx tsx scripts/backfill-parser-patterns.ts --limit=8000
```

## What Gets Inserted

The script inserts recipe records with:
- `source_url`: The recipe URL
- `title`: Empty (will be filled by backfill)
- `user_id`: null (system import)
- `created_at`: Current timestamp

**No ingredients, steps, or other data** - just URLs. The backfill script will fetch and process them.

## Rate Limiting

Each site has a default rate limit:
- AllRecipes, Food Network, BBC Good Food: 100ms between requests (10/sec)
- Other sites: 150ms between requests (~6.7/sec)

The script automatically adjusts based on robots.txt crawl-delay directives.

## Adding New Sites

Edit `scripts/collect-recipe-urls.ts` and add to `RECIPE_SITES` array:

```typescript
{
  name: 'New Recipe Site',
  baseUrl: 'https://www.newsite.com',
  recipePathPattern: /^\/recipes\/.+/,
  sitemapUrl: 'https://www.newsite.com/sitemap.xml',
  maxUrls: 1000,
  rateLimitMs: 150,
}
```

## Legal & Ethical Considerations

- ✅ Respects robots.txt
- ✅ Uses public sitemaps
- ✅ Rate limits requests
- ✅ Educational/research purpose
- ⚠️ Check each site's terms of service
- ⚠️ Don't overload servers
- ⚠️ Use collected data responsibly

## Troubleshooting

### "Could not fetch sitemap"
- Site might not have a public sitemap
- Network issue - try again later
- Site might block automated requests

### "robots.txt disallows all"
- Site doesn't allow automated access
- Script will skip that site automatically

### "All URLs already exist"
- URLs are already in your database
- Run backfill script instead to process them

## Expected Results

With default settings:
- **Total URLs**: ~10,000+ recipe URLs
- **Collection Time**: 10-30 minutes (depending on network)
- **Database Size**: ~10,000 new recipe records (URLs only)

## Next Steps

After collecting URLs:

1. **Run Backfill**: Process URLs to extract patterns
   ```bash
   npx tsx scripts/backfill-parser-patterns.ts --limit=10000
   ```

2. **Check Patterns**: See what the system learned
   ```sql
   SELECT * FROM recipe_extraction_patterns 
   ORDER BY success_rate DESC;
   ```

3. **Monitor Progress**: Check import attempts
   ```sql
   SELECT site_type, COUNT(*) as attempts, 
          SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes
   FROM recipe_import_attempts
   GROUP BY site_type;
   ```

