# How the Recipe Capture Learning System Works

## Overview

The system learns from recipes in three ways:

1. **Real-time Import Attempts**: Every time a user imports a recipe, the system logs the attempt and learns from it
2. **Saved Recipes Trigger**: When a recipe is saved to `public.recipes`, a database trigger automatically updates the learning database
3. **Backfill Script**: Periodically run the backfill script to process existing saved recipes and extract detailed patterns

## 1. Real-Time Learning (During Import)

When a user imports a recipe:

```
User imports recipe
  ↓
System logs "attempt-started" (no error message, just tracking)
  ↓
System tries extraction strategies
  ↓
If successful: Logs success with strategy, pattern, and metadata
  ↓
If failed: Logs failure with error details
  ↓
If user corrects: Marks original attempt as "user_corrected = true"
```

**What gets learned:**
- Which strategies work for which site types
- HTML patterns that indicate successful extraction
- Success rates for different pattern/strategy combinations

## 2. Learning from Saved Recipes (Database Trigger)

When a recipe is saved to `public.recipes`:

```
Recipe saved with source_url
  ↓
Database trigger fires automatically
  ↓
Extracts site type from URL
  ↓
Checks if recipe has ingredients/steps
  ↓
Updates recipe_extraction_patterns table
  ↓
Marks pattern as successful (100% success rate)
```

**What gets learned:**
- Which sites produce successful recipes
- Basic pattern associations (site type → strategy)
- Success indicators (recipes with ingredients/steps = good)

**Note:** The trigger provides basic learning. For detailed HTML pattern extraction, use the backfill script.

## 3. Backfill Script (Detailed Pattern Learning)

The backfill script (`scripts/backfill-parser-patterns.ts`) does deep analysis:

```
For each saved recipe with source_url:
  ↓
Fetch HTML from source URL
  ↓
Extract detailed HTML patterns (JSON-LD, microdata, keywords, etc.)
  ↓
Try different extraction strategies
  ↓
Log which strategies work for which patterns
  ↓
Update recipe_extraction_patterns with success rates
```

**What gets learned:**
- Detailed HTML patterns (e.g., "has-jsonld|mentions-ingredients|has-recipe-keyword")
- Strategy success rates for specific patterns
- Pattern → strategy mappings for future imports

**When to run:**
- Initially: To "teach" the system with existing recipes
- Periodically: To learn from newly saved recipes (weekly/monthly)
- After major site changes: To update patterns for sites that changed their HTML structure

## How Learning Improves Future Imports

1. **Pattern Matching**: When importing a new recipe, the system:
   - Fetches HTML
   - Extracts pattern (e.g., "has-jsonld|mentions-ingredients")
   - Checks `recipe_extraction_patterns` for this pattern
   - Uses the strategy with highest success rate first

2. **Success Rate Tracking**: The system tracks:
   - How many times a pattern/strategy combination succeeded
   - How many times it failed
   - Calculates success rate percentage

3. **User Corrections**: When a user manually edits a recipe:
   - Original import attempt is marked `user_corrected = true`
   - This indicates the extraction wasn't perfect
   - System learns to avoid that strategy for similar patterns

## Database Tables

### `recipe_import_attempts`
Tracks every import attempt:
- `success`: Did the import succeed?
- `user_corrected`: Did the user have to manually fix it?
- `strategy_used`: Which extraction method was used?
- `site_type`: TikTok, Instagram, etc.
- `error_message`: Why did it fail? (null for successful imports)

### `recipe_extraction_patterns`
Stores learned patterns:
- `html_pattern`: Pattern identifier (e.g., "has-jsonld|mentions-ingredients")
- `extraction_method`: Strategy name (e.g., "server-html-jsonld")
- `success_rate`: Percentage of successful extractions
- `sample_count`: How many times this pattern was seen

## Querying the Learning Data

### Check user corrections:
```sql
SELECT * FROM recipe_import_attempts 
WHERE user_corrected = true 
ORDER BY created_at DESC;
```

### See which strategies work best:
```sql
SELECT site_type, extraction_method, success_rate, sample_count
FROM recipe_extraction_patterns
ORDER BY success_rate DESC, sample_count DESC;
```

### Find patterns that need improvement:
```sql
SELECT site_type, html_pattern, extraction_method, success_rate
FROM recipe_extraction_patterns
WHERE success_rate < 50
ORDER BY sample_count DESC;
```

## Troubleshooting

### "user_corrected never shows true"
- Make sure `originalImportDataRef.current.attemptId` is being stored when import succeeds
- Check console logs for `[TRACKING]` messages
- Verify the `markImportCorrected` function is being called

### "error_message says 'Import in progress...'"
- This was fixed: "attempt-started" logs no longer have error messages
- Only failed attempts have error messages
- Successful attempts have `error_message = null`

### "Where does learning data come from?"
- **During import**: Real-time logging in `capture.tsx`
- **When saved**: Database trigger `learn_from_saved_recipe()`
- **From existing recipes**: Backfill script processes `public.recipes` table

## Next Steps

1. **Run the migration**: Apply `learn_from_saved_recipes_trigger.sql` to enable automatic learning from saved recipes
2. **Run backfill**: Process existing recipes to build initial pattern database
3. **Monitor**: Check `recipe_extraction_patterns` periodically to see what the system is learning
4. **Iterate**: Use the data to improve parsers and create v2/v3 versions

