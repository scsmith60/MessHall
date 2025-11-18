# Backfill Guide: Pre-Populating Parser Patterns

## Overview

Before going live with the versioned parser system, you can "teach" it by backfilling patterns from your existing successful recipe imports. This gives the system a head start with known-good patterns.

## What Gets Backfilled

1. **Import Attempts**: Logs successful extractions from existing recipes
2. **Pattern Learning**: Extracts HTML patterns and maps them to successful strategies
3. **Success Rates**: Calculates which strategies work best for which patterns

## Prerequisites

1. Database migration must be run:
   ```bash
   supabase migration up
   ```

2. Environment variables set:
   - `EXPO_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (for full access)

## Method 1: TypeScript Script (Recommended)

### Setup

1. Install dependencies (if not already):
   ```bash
   npm install @supabase/supabase-js dotenv
   ```

2. Create `.env` file in project root:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

### Run Backfill

```bash
# Basic usage (processes 1000 recipes, 10 at a time)
npx tsx scripts/backfill-parser-patterns.ts

# Custom options
npx tsx scripts/backfill-parser-patterns.ts --limit=500 --batch=5 --delay=2000
```

**Options:**
- `--limit=N`: Maximum number of recipes to process (default: 1000)
- `--batch=N`: Number of recipes to process in parallel (default: 10)
- `--delay=N`: Milliseconds to wait between batches (default: 1000)

### What It Does

1. Fetches all recipes with `source_url` that have ingredients/steps
2. For each recipe:
   - Detects site type (TikTok, Instagram, etc.)
   - Fetches HTML from source URL
   - Extracts HTML pattern
   - Tries extraction strategies
   - Logs successful strategies
   - Updates pattern success rates

3. Prints summary statistics

### Example Output

```
🚀 Starting parser pattern backfill...
   Limit: 1000 recipes
   Batch size: 10
   Delay: 1000ms between batches
   Parser version: v1

📊 Fetching recipes with source URLs (limit: 1000)...
✅ Found 847 recipes with source URLs and ingredients/steps

📦 Processing batch 1/85 (10 recipes)...
  🔄 Chocolate Chip Cookies...
    ✅ Success (pattern: has-sigi|mentions-ingredients, strategy: server-html-sigi)
  🔄 Pasta Carbonara...
    ✅ Success (pattern: has-jsonld|mentions-steps, strategy: server-html-jsonld)
  ...

============================================================
📊 BACKFILL SUMMARY
============================================================
Total recipes processed: 847
✅ Successful: 623 (73.6%)
❌ Failed: 224 (26.4%)

📈 Pattern Statistics:
  has-sigi|mentions-ingredients: 245 recipes, strategies: server-html-sigi
  has-jsonld|mentions-steps: 189 recipes, strategies: server-html-jsonld
  has-meta|mentions-ingredients: 98 recipes, strategies: server-html-meta
  ...
```

## Method 2: SQL Function (Basic)

For a quick check of what recipes are available:

```sql
-- Get statistics
SELECT * FROM get_backfill_stats();

-- Process a small batch (returns URL structure patterns only)
SELECT * FROM backfill_parser_patterns_batch(100, 0);
```

**Note:** The SQL function only extracts basic URL patterns. For full HTML pattern extraction and strategy testing, use the TypeScript script.

## Method 3: Gradual Backfill

Instead of backfilling everything at once, you can backfill gradually:

```bash
# Day 1: Backfill 100 recipes
npx tsx scripts/backfill-parser-patterns.ts --limit=100

# Day 2: Backfill next 100
# (Script will skip already processed URLs)

# Continue until all recipes are processed
```

The system automatically skips URLs that have already been processed (based on `recipe_import_attempts` table).

## Monitoring Progress

### Check Statistics

```sql
-- Overall progress
SELECT * FROM get_backfill_stats();

-- Success rate by site type
SELECT 
  site_type,
  COUNT(*) as total,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM recipe_import_attempts
GROUP BY site_type;

-- Top learned patterns
SELECT 
  site_type,
  html_pattern,
  extraction_method,
  success_rate,
  sample_count
FROM recipe_extraction_patterns
ORDER BY success_rate DESC, sample_count DESC
LIMIT 20;
```

### Check What's Left

```sql
-- Recipes not yet processed
SELECT COUNT(*)
FROM recipes r
WHERE r.source_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM recipe_import_attempts a 
    WHERE a.url = r.source_url
  );
```

## Best Practices

### 1. Start Small
- Begin with `--limit=100` to test
- Verify results before processing thousands

### 2. Rate Limiting
- Use `--delay=2000` (2 seconds) to avoid overwhelming source sites
- Adjust based on site response times

### 3. Batch Size
- Start with `--batch=5` for slower sites
- Increase to `--batch=10` or `--batch=20` for faster sites

### 4. Monitor Failures
- Check failed imports: `SELECT * FROM recipe_import_attempts WHERE success = false LIMIT 10;`
- Common issues: URLs no longer accessible, site structure changed

### 5. Re-run Periodically
- Some URLs may have been inaccessible initially
- Re-run monthly to catch newly accessible URLs

## Troubleshooting

### "Could not fetch HTML"
- URL may be dead or require authentication
- Site may be blocking requests
- **Solution**: These are logged as failures and won't break the process

### "No successful extraction strategy found"
- Site structure may have changed
- URL may not contain recipe data
- **Solution**: These help identify patterns that need new strategies

### Rate Limiting
- Some sites (Instagram, TikTok) may rate limit
- **Solution**: Increase `--delay` between batches

### Memory Issues
- Processing thousands of recipes can use memory
- **Solution**: Process in smaller batches with `--limit` and multiple runs

## Expected Results

After backfilling:

1. **Pattern Database**: `recipe_extraction_patterns` table populated with learned patterns
2. **Import History**: `recipe_import_attempts` table with success/failure records
3. **Better Performance**: New imports automatically use proven strategies first

## Next Steps

After backfilling:

1. **Review Patterns**: Check which patterns are most common
2. **Create v2 Parsers**: Build improved parsers based on learnings
3. **Enable v2**: Gradually rollout new parsers
4. **Monitor**: Watch success rates improve

## Example: Full Backfill Workflow

```bash
# 1. Test with small batch
npx tsx scripts/backfill-parser-patterns.ts --limit=50 --batch=5

# 2. Check results
# (Review in Supabase dashboard or run SQL queries)

# 3. Backfill in chunks (to avoid timeouts)
npx tsx scripts/backfill-parser-patterns.ts --limit=500 --batch=10 --delay=1500

# 4. Continue until all processed
npx tsx scripts/backfill-parser-patterns.ts --limit=500 --batch=10 --delay=1500

# 5. Review statistics
# (Run SQL queries to see learned patterns)

# 6. Create v2 parsers based on learnings
# (Edit lib/parsers/versioning.ts)

# 7. Enable v2 with small rollout
# (Set rolloutPercentage: 5 in config)
```

## Cost Considerations

- **API Calls**: Minimal - only fetches HTML (no AI calls)
- **Database**: Small - just logging attempts and patterns
- **Time**: ~1-2 seconds per recipe (with delays)

For 1000 recipes: ~30-60 minutes total time, minimal cost.

## Success Criteria

After backfilling, you should see:

- ✅ 60-80% of recipes successfully processed
- ✅ 10-20 distinct patterns learned
- ✅ Clear strategy preferences per pattern
- ✅ Ready to create v2 parsers based on data

The system is now "taught" and ready for production use!

