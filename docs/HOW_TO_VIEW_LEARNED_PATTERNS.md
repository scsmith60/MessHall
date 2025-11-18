# How to View What the System Learned from Imports

## When Patterns Are Updated

The `recipe_extraction_patterns` table is updated in **two ways**:

### 1. Database Trigger (Automatic - Basic Learning)
**When:** Every time a recipe is saved with a `source_url`

**What it does:**
- Detects site type from URL (TikTok, Instagram, etc.)
- Creates a basic pattern: `"saved-recipe|{site_type}"`
- Marks it as 100% successful
- Updates `sample_count` and `last_seen_at`

**Location:** `supabase/migrations/learn_from_saved_recipes_trigger.sql`

**To see trigger activity:**
```sql
-- Check if trigger exists
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'trigger_learn_from_saved_recipe';

-- View recent pattern updates from trigger
SELECT 
  site_type,
  html_pattern,
  extraction_method,
  success_rate,
  sample_count,
  last_seen_at
FROM recipe_extraction_patterns
WHERE html_pattern LIKE 'saved-recipe%'
ORDER BY last_seen_at DESC
LIMIT 20;
```

### 2. Backfill Script (Manual - Detailed Learning)
**When:** You run the script manually

**What it does:**
- Fetches HTML from source URLs
- Extracts detailed patterns (e.g., "has-jsonld|mentions-ingredients|has-recipe-keyword")
- Tries different extraction strategies
- Updates patterns with success rates

**To run:**
```bash
npx tsx scripts/backfill-parser-patterns.ts --limit=50
```

## How to See What Was Learned

### View All Learned Patterns
```sql
SELECT 
  site_type,
  html_pattern,
  extraction_method,
  success_rate,
  sample_count,
  last_seen_at,
  created_at
FROM recipe_extraction_patterns
ORDER BY last_seen_at DESC;
```

### View Patterns for a Specific Site
```sql
SELECT 
  html_pattern,
  extraction_method,
  success_rate,
  sample_count,
  last_seen_at
FROM recipe_extraction_patterns
WHERE site_type = 'tiktok'  -- or 'instagram', 'recipe-site', etc.
ORDER BY success_rate DESC;
```

### View Most Successful Patterns
```sql
SELECT 
  site_type,
  html_pattern,
  extraction_method,
  success_rate,
  sample_count
FROM recipe_extraction_patterns
WHERE sample_count >= 3  -- Only patterns with multiple samples
ORDER BY success_rate DESC, sample_count DESC
LIMIT 20;
```

### View Recent Learning Activity
```sql
SELECT 
  site_type,
  html_pattern,
  extraction_method,
  success_rate,
  sample_count,
  last_seen_at
FROM recipe_extraction_patterns
WHERE last_seen_at > NOW() - INTERVAL '7 days'
ORDER BY last_seen_at DESC;
```

### See What Strategy Works Best for Each Pattern
```sql
SELECT 
  site_type,
  html_pattern,
  extraction_method,
  success_rate,
  sample_count,
  ROW_NUMBER() OVER (
    PARTITION BY site_type, html_pattern 
    ORDER BY success_rate DESC, sample_count DESC
  ) as rank
FROM recipe_extraction_patterns
ORDER BY site_type, html_pattern, rank;
```

## View Import Attempts (What Actually Happened)

### See All Import Attempts
```sql
SELECT 
  url,
  site_type,
  strategy_used,
  success,
  user_corrected,
  ingredients_count,
  steps_count,
  created_at
FROM recipe_import_attempts
ORDER BY created_at DESC
LIMIT 50;
```

### See Failed Imports
```sql
SELECT 
  url,
  site_type,
  strategy_used,
  error_message,
  created_at
FROM recipe_import_attempts
WHERE success = false
ORDER BY created_at DESC
LIMIT 20;
```

### See User-Corrected Imports (Where System Failed)
```sql
SELECT 
  url,
  site_type,
  strategy_used,
  ingredients_count,
  steps_count,
  created_at
FROM recipe_import_attempts
WHERE user_corrected = true
ORDER BY created_at DESC;
```

### See Success Rate by Strategy
```sql
SELECT 
  strategy_used,
  site_type,
  COUNT(*) as total_attempts,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM recipe_import_attempts
GROUP BY strategy_used, site_type
ORDER BY success_rate DESC;
```

## Current Status: Capture Screen Not Using Learning System

**⚠️ Important:** The capture screen (`app/(tabs)/capture.tsx`) is **NOT** currently using the learning system. It only:
- Logs import attempts to `recipe_import_attempts`
- Does NOT extract HTML patterns
- Does NOT update `recipe_extraction_patterns` during import
- Does NOT use learned patterns to choose strategies

**What IS working:**
- ✅ Database trigger updates patterns when recipes are saved
- ✅ Backfill script can learn from existing recipes
- ✅ Functions exist to use learning system (`lib/parsers/versioning.ts`, `lib/parsers/strategy-selector.ts`)

**To enable real-time learning:**
The capture screen needs to be updated to use `importRecipeWithVersioning()` from `lib/parsers/integration-helper.ts` instead of the current `handleRecipeSite()` function.

## Summary

**Patterns are updated:**
1. ✅ **Automatically** when recipes are saved (via database trigger) - basic learning
2. ✅ **Manually** when you run the backfill script - detailed learning
3. ❌ **NOT** during real-time imports in capture screen (needs integration)

**To see what was learned:**
- Check `recipe_extraction_patterns` table for learned patterns
- Check `recipe_import_attempts` table for import history
- Run the queries above to analyze learning data

