# Next Steps: Improving Recipe Capture System

## Current Status

Based on your tracking data:
- ✅ **Generic sites**: 96% success (23/24) - Excellent!
- ⚠️ **TikTok**: 48% success (40/83) - Needs improvement
- ❌ **Recipe-site**: 26% success (246/954) - Major issue
- ❌ **Instagram**: 0% success (0/18) - Critical issue

## Immediate Next Steps

### 1. Collect REAL Recipe URLs (Not Generated)

**Problem**: The generated URLs were fake (404s). We need real recipe URLs.

**Solution A: Use Search Script** (Recommended)
```bash
# Search for real recipe URLs from actual sites
npx tsx scripts/search-and-collect-urls.ts \
  --queries="chicken recipes,pasta recipes,dessert recipes,breakfast recipes" \
  --max=200 \
  --insert-db
```

**Solution B: Use Public Datasets**
- Download RecipeNLG or Recipe1M dataset
- Extract recipe URLs
- Import using: `npx tsx scripts/import-urls-from-file.ts recipes.json`

**Solution C: Manual Collection**
- Collect URLs from RSS feeds, Reddit, etc.
- Save to text file
- Import: `npx tsx scripts/import-urls-from-file.ts urls.txt`

### 2. Process Real URLs with Backfill

Once you have real URLs:
```bash
# Process them to learn patterns
npx tsx scripts/backfill-parser-patterns.ts --limit=1000
```

This will:
- Extract HTML patterns from real recipes
- Try different extraction strategies
- Learn which methods work for which patterns
- Build the pattern database

### 3. Fix Critical Issues

#### Instagram (0% success)
```sql
-- Check what's failing
SELECT strategy_used, error_message, COUNT(*) 
FROM recipe_import_attempts 
WHERE site_type = 'instagram' 
GROUP BY strategy_used, error_message;
```

**Likely issues**:
- Instagram blocks server-side scraping
- Need WebView/OCR approach
- May need to update extraction logic

#### Recipe-site (26% success)
```sql
-- See which patterns are failing
SELECT html_pattern, extraction_method, success_rate, sample_count
FROM recipe_extraction_patterns
WHERE site_type = 'recipe-site'
ORDER BY sample_count DESC;
```

**Likely issues**:
- JSON-LD extraction not working for many sites
- HTML parsing too strict
- Need better fallback strategies

### 4. Improve Extraction Strategies

Based on learned patterns, create v2 parsers:

1. **For recipe-sites**: Improve JSON-LD and microdata extraction
2. **For Instagram**: Focus on WebView + OCR approach
3. **For TikTok**: Optimize SIGI_STATE parsing

### 5. Monitor and Iterate

```sql
-- Weekly check: What's working?
SELECT 
  site_type,
  strategy_used,
  COUNT(*) as attempts,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM recipe_import_attempts
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY site_type, strategy_used
ORDER BY site_type, success_rate DESC;
```

## Recommended Workflow

### Week 1: Data Collection
1. ✅ Clean up bad data (DONE)
2. Collect 500-1000 real recipe URLs using search script
3. Process with backfill script
4. Review learned patterns

### Week 2: Pattern Analysis
1. Analyze which patterns work best
2. Identify common failure patterns
3. Create v2 parsers for failing patterns
4. Test v2 parsers on subset of data

### Week 3: Implementation
1. Deploy v2 parsers with 10% rollout
2. Monitor success rates
3. Gradually increase rollout percentage
4. Fix issues as they arise

### Week 4: Optimization
1. Review user corrections
2. Identify patterns that need user fixes
3. Improve those specific extraction methods
4. Target 90%+ success rate

## Quick Wins

### 1. Fix Instagram (Highest Priority)
- Instagram is completely failing (0%)
- Likely needs WebView approach
- Check existing Instagram extraction code

### 2. Improve Recipe-Site Success
- 26% is very low
- Many sites use JSON-LD - ensure extraction is working
- Add better fallbacks

### 3. Optimize TikTok
- 48% is okay but can improve
- Focus on SIGI_STATE parsing improvements

## Success Metrics

Track these weekly:
- Overall success rate (target: 90%+)
- Success rate by site type
- User correction rate (target: <5%)
- Average ingredients/steps extracted

## Tools Available

- ✅ Tracking system (working)
- ✅ Backfill script (ready)
- ✅ URL collection scripts (ready)
- ✅ Pattern learning (ready)
- ⚠️ Need: Real recipe URLs to train on

## Next Action

**Start here**: Collect real recipe URLs
```bash
npx tsx scripts/search-and-collect-urls.ts \
  --queries="chicken recipes,pasta recipes" \
  --max=200 \
  --insert-db
```

Then process them:
```bash
npx tsx scripts/backfill-parser-patterns.ts --limit=400
```

This will give you real data to learn from and improve the system.

