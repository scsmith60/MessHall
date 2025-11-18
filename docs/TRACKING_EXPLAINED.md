# Recipe Import Tracking System - How It Works

## Overview

The system tracks every recipe import attempt to learn which extraction methods work best. Here's how it works:

## What Gets Tracked

### 1. Import Attempt Start (`attempt-started`)
- **When**: At the very beginning of an import, before any extraction is tried
- **Purpose**: Track that an import was attempted, even if it fails completely
- **Strategy**: `'attempt-started'` (this is just a marker, not a real extraction strategy)
- **Success**: `false` (will be updated when we know the outcome)
- **Error Message**: `null` (not an error, just tracking)

### 2. Successful Import (Real Strategy)
- **When**: When extraction succeeds and we get meaningful recipe data
- **Purpose**: Record which strategy actually worked
- **Strategy**: The actual extraction method used (e.g., `'server-html-meta'`, `'ocr-screenshot'`, `'server-html-jsonld'`)
- **Success**: `true`
- **Stored Data**: Original ingredients/steps are stored in `originalImportDataRef` for later comparison

### 3. Failed Import
- **When**: When extraction fails or times out
- **Purpose**: Learn which strategies don't work
- **Strategy**: The strategy that was attempted (or `'timeout'`, `'error'`)
- **Success**: `false`
- **Error Message**: Why it failed

### 4. User Correction (`user-corrected`)
- **When**: When a user manually edits ingredients or steps before saving
- **Purpose**: Learn that the extraction wasn't perfect
- **Strategy**: `'user-corrected'`
- **Success**: `false` (technically a failure because user had to fix it)

## How User Correction Detection Works

### Comparison Method 1: In-Memory Reference (Primary)
When a recipe is saved, the system compares:

1. **Original Import Data** (stored in `originalImportDataRef`):
   - Ingredients and steps from the successful import
   - Normalized: trimmed, lowercased, filtered empty strings

2. **Saved Data** (what user actually saved):
   - Ingredients and steps from the form
   - Normalized: trimmed, lowercased, filtered empty strings

3. **Comparison Logic**:
   - **Ingredients**: Order-independent comparison (checks if all items match, regardless of order)
   - **Steps**: Order-dependent comparison (steps must match in the same order)
   - **Detects**: Added items, removed items, modified items, reordered items (for steps)

### Comparison Method 2: Database Fallback
If the in-memory reference is missing (user navigated away and came back):

1. **Query Database**: Find the most recent successful import attempt for this URL
2. **Compare Counts**: Compare ingredient/steps counts from import vs. saved
3. **Threshold**: Consider it a correction if:
   - Count differs by more than 2 items, OR
   - Count differs by more than 10% of original count

## Why You Might See Issues

### "user_corrected is false but I made edits"
**Possible causes:**
1. **Normalization**: The comparison normalizes both sides (trim, lowercase). If your edits were just formatting changes, they might not be detected.
2. **Order Independence**: For ingredients, the system checks if all items match regardless of order. If you just reordered ingredients, it might not detect it as a change.
3. **Missing Reference**: If `originalImportDataRef` was cleared (user navigated away), it falls back to database comparison which only checks counts, not content.

**Solution**: Check console logs for `[TRACKING]` messages to see what's being compared.

### "strategy_used says 'attempt-started' but no real strategy"
**Explanation**: 
- `'attempt-started'` is logged at the BEGINNING of import (before we know which strategy will work)
- A SEPARATE log entry is created when extraction succeeds with the actual strategy
- You should see TWO entries:
  1. `'attempt-started'` with `success=false`
  2. `'server-html-meta'` (or other strategy) with `success=true`

**To see the real strategy**: Query for `success=true` records, not `success=false` ones.

### "Where is the comparison happening?"
**Answer**: The comparison happens in the `onSave` function in `capture.tsx`:

1. **Line ~3368-3486**: User correction detection logic
2. **Compares**: What was imported vs. what was saved
3. **Data Sources**:
   - Primary: `originalImportDataRef.current` (in-memory, from successful import)
   - Fallback: `recipe_import_attempts` table (database, if ref is missing)

## Database Schema

### `recipe_import_attempts` Table
```sql
- id: UUID (primary key)
- url: TEXT (the source URL)
- site_type: TEXT (tiktok, instagram, etc.)
- parser_version: TEXT (v1, v2, etc.)
- strategy_used: TEXT (the extraction method or marker)
- success: BOOLEAN (did it work?)
- user_corrected: BOOLEAN (did user have to fix it?)
- ingredients_count: INT (how many ingredients were extracted)
- steps_count: INT (how many steps were extracted)
- error_message: TEXT (why it failed, null if successful)
- created_at: TIMESTAMP
```

## Querying the Data

### See all import attempts for a URL:
```sql
SELECT * FROM recipe_import_attempts 
WHERE url = 'https://...'
ORDER BY created_at DESC;
```

### See user corrections:
```sql
SELECT * FROM recipe_import_attempts 
WHERE user_corrected = true 
ORDER BY created_at DESC;
```

### See successful imports with real strategies:
```sql
SELECT * FROM recipe_import_attempts 
WHERE success = true 
  AND strategy_used != 'attempt-started'
ORDER BY created_at DESC;
```

### See which strategies work best:
```sql
SELECT strategy_used, 
       COUNT(*) as total_attempts,
       SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes,
       ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM recipe_import_attempts
WHERE strategy_used != 'attempt-started'
GROUP BY strategy_used
ORDER BY success_rate DESC;
```

## Debugging

### Enable Console Logging
The system logs detailed information to the console:

- `[TRACKING] Logged import attempt start: <id>` - Initial attempt logged
- `[TRACKING] Logged successful import: <id>, strategy: <strategy>` - Success logged
- `[TRACKING] Detected changes using in-memory ref:` - Changes detected
- `[TRACKING] ✅ Successfully marked attempt <id> as user-corrected` - Correction marked
- `[TRACKING] No changes detected - import was accurate` - No changes found

### Check What's Being Compared
Add this to see the actual data being compared:
```typescript
console.log('Original:', originalImportDataRef.current);
console.log('Saved:', { ingredients: ing, steps: stp });
```

## Improvements Made

1. **Better Comparison**: Now normalizes both sides and uses order-independent comparison for ingredients
2. **Database Fallback**: If in-memory ref is missing, compares against database counts
3. **Better Logging**: More detailed console logs to see what's happening
4. **Removed Error Message**: "attempt-started" no longer has misleading error message

