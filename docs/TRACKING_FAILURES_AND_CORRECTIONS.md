# Tracking Failures and User Corrections

## The Problem You Identified

You're absolutely right! The backfill script only captures **successful** imports that made it to the database. This means we're missing:

1. **Failed attempts** - User tried to import but gave up
2. **User corrections** - User imported but had to manually fix everything
3. **Edge cases** - URLs that never worked

## Current Tracking (What We Have)

### ✅ What IS Being Tracked

1. **Backfill successes** - Recipes that worked (62% in your test)
2. **Live import attempts** - When `importRecipeWithVersioning` is called, it logs:
   - Successes → `recipe_import_attempts` table
   - Failures → `recipe_import_attempts` table with `success = false`

### ❌ What's NOT Being Tracked Yet

1. **User abandons** - User pastes URL but clicks cancel/back
2. **User corrections** - User manually edits after import
3. **Partial failures** - Import worked but user had to fix ingredients/steps

## Solution: Track Everything

### 1. Track Failed Import Attempts (Even Before Save)

We need to log when a user **tries** to import, not just when they **succeed**:

```typescript
// In capture.tsx - startImport function
const startImport = useCallback(async (url: string) => {
  const runId = ++importRunIdRef.current;
  
  // LOG THE ATTEMPT IMMEDIATELY (before trying)
  try {
    const siteType = await detectSiteType(url);
    const config = getParserConfig(siteType);
    
    // Log that user is attempting import
    await logImportAttempt({
      url,
      siteType,
      parserVersion: config.version,
      strategyUsed: 'attempt-started',
      success: false, // Will update to true if successful
      errorMessage: 'Import in progress...',
    });
  } catch (err) {
    // Silently fail - don't break import flow
  }
  
  // ... rest of import code ...
  
  // If import succeeds, update the attempt
  // If import fails, the attempt is already logged as failed
});
```

### 2. Track User Abandons

When user clicks cancel or navigates away:

```typescript
// In capture.tsx
const onCancel = useCallback(async () => {
  if (lastResolvedUrlRef.current) {
    // Log that user abandoned this import
    try {
      const siteType = await detectSiteType(lastResolvedUrlRef.current);
      const config = getParserConfig(siteType);
      
      await logImportAttempt({
        url: lastResolvedUrlRef.current,
        siteType,
        parserVersion: config.version,
        strategyUsed: 'user-abandoned',
        success: false,
        errorMessage: 'User cancelled import',
      });
    } catch (err) {
      // Silently fail
    }
  }
  
  // ... rest of cancel logic
});
```

### 3. Track User Corrections (Critical!)

When user saves an edited recipe, compare original vs. corrected:

```typescript
// In capture.tsx - onSave function
const onSave = useCallback(async () => {
  // ... existing save code ...
  
  // After successful save, check if user made corrections
  if (sourceUrl && originalImportData) {
    const ingredientsChanged = 
      originalImportData.ingredients.length !== ingredients.length ||
      originalImportData.ingredients.some((ing, i) => ing !== ingredients[i]);
    
    const stepsChanged = 
      originalImportData.steps.length !== steps.length ||
      originalImportData.steps.some((step, i) => step !== steps[i]);
    
    if (ingredientsChanged || stepsChanged) {
      // User had to correct the import - this is valuable feedback!
      try {
        const siteType = await detectSiteType(sourceUrl);
        const config = getParserConfig(siteType);
        
        // Mark the original import attempt as "needed correction"
        await supabase
          .from('recipe_import_attempts')
          .update({ user_corrected: true })
          .eq('url', sourceUrl)
          .order('created_at', { ascending: false })
          .limit(1);
        
        // Log what was wrong
        await logImportAttempt({
          url: sourceUrl,
          siteType,
          parserVersion: config.version,
          strategyUsed: 'user-corrected',
          success: false, // Technically failed because user had to fix it
          errorMessage: `User corrected: ${ingredientsChanged ? 'ingredients ' : ''}${stepsChanged ? 'steps' : ''}`,
          ingredientsCount: originalImportData.ingredients.length,
          stepsCount: originalImportData.steps.length,
        });
      } catch (err) {
        // Silently fail
      }
    }
  }
}, [/* ... */]);
```

### 4. Store Original Import Data

We need to remember what was imported so we can compare later:

```typescript
// In capture.tsx state
const [originalImportData, setOriginalImportData] = useState<{
  ingredients: string[];
  steps: string[];
} | null>(null);

// When import succeeds, store original data
const startImport = useCallback(async (url: string) => {
  // ... import code ...
  
  if (importedIngredients.length > 0 || importedSteps.length > 0) {
    // Store what was imported
    setOriginalImportData({
      ingredients: importedIngredients,
      steps: importedSteps,
    });
    
    // Set the UI state
    setIngredients(importedIngredients);
    setSteps(importedSteps);
  }
});
```

## Enhanced Database Schema

We might want to add a field to track correction details:

```sql
-- Add column to track what was corrected
ALTER TABLE recipe_import_attempts
ADD COLUMN IF NOT EXISTS correction_details JSONB;

-- Example correction_details:
-- {
--   "ingredients_changed": true,
--   "steps_changed": false,
--   "original_ingredients_count": 5,
--   "corrected_ingredients_count": 7,
--   "original_steps_count": 3,
--   "corrected_steps_count": 3
-- }
```

## What This Gives Us

### Real Failure Data
- **User abandons**: "This URL is too hard, user gave up"
- **User corrections**: "Import worked but was wrong, user had to fix it"
- **Partial failures**: "Got ingredients but not steps"

### Better Learning
- Know which patterns actually work (not just "made it to DB")
- Know which patterns users have to fix
- Identify edge cases that need new strategies

### Success Metrics
```sql
-- Real success rate (including corrections)
SELECT 
  COUNT(*) as total_attempts,
  SUM(CASE WHEN success AND NOT user_corrected THEN 1 ELSE 0 END) as truly_successful,
  SUM(CASE WHEN user_corrected THEN 1 ELSE 0 END) as needed_correction,
  SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failed,
  ROUND(100.0 * SUM(CASE WHEN success AND NOT user_corrected THEN 1 ELSE 0 END) / COUNT(*), 2) as real_success_rate
FROM recipe_import_attempts
WHERE created_at > NOW() - INTERVAL '7 days';
```

## Implementation Priority

### Phase 1: Track Corrections (High Priority)
- Store original import data
- Compare on save
- Mark attempts as `user_corrected = true`

### Phase 2: Track Abandons (Medium Priority)
- Log when user cancels
- Track time spent before abandon

### Phase 3: Track Partial Successes (Low Priority)
- Log when import gets some but not all data
- Track confidence scores

## The Real Answer

**You're right** - backfill only shows what worked. But:

1. **Live imports** will track failures (when integrated)
2. **User corrections** will show what "worked" but was wrong
3. **Abandons** will show what's too hard

The backfill is just the **starting point**. The real learning happens from:
- Live import attempts (success + failure)
- User corrections (shows what needs improvement)
- Abandoned attempts (shows what's broken)

## Next Steps

1. **Integrate tracking into capture.tsx** - Log all attempts
2. **Track corrections** - Compare original vs. saved
3. **Track abandons** - Log when user gives up
4. **Analyze the data** - See real success rates

Want me to help integrate this tracking into your capture.tsx file?

