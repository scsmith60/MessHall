# Implementation Checklist

## Files Status

### ✅ Files I Created (New Files - Ready to Use)

#### Database Migrations
- ✅ `supabase/migrations/create_recipe_import_attempts.sql`
  - **Status**: Ready to run
  - **What it does**: Creates tables for tracking import attempts and patterns
  - **Action**: Run via `supabase migration up`

- ✅ `supabase/migrations/backfill_parser_patterns_function.sql`
  - **Status**: Ready to run (optional)
  - **What it does**: SQL helper functions for backfill stats
  - **Action**: Included in migration or run separately

#### Core Parser System
- ✅ `lib/parsers/versioning.ts`
  - **Status**: Ready to use
  - **What it does**: Parser version management and pattern extraction
  - **Action**: No action needed - just import and use

- ✅ `lib/parsers/strategy-selector.ts`
  - **Status**: Ready to use
  - **What it does**: Executes extraction strategies in optimal order
  - **Action**: No action needed - just import and use

- ✅ `lib/parsers/integration-helper.ts`
  - **Status**: Ready to use
  - **What it does**: Easy wrapper for integrating into existing code
  - **Action**: Import and use in `capture.tsx`

#### Backfill Script
- ✅ `scripts/backfill-parser-patterns.ts`
  - **Status**: Ready to run
  - **What it does**: Pre-populates pattern database from existing recipes
  - **Action**: Run via `npx tsx scripts/backfill-parser-patterns.ts`
  - **Dependencies**: Requires `@supabase/supabase-js` and `dotenv`

#### Documentation
- ✅ `docs/CAPTURE_IMPROVEMENT_STRATEGY.md` - Complete strategy document
- ✅ `docs/PARSER_VERSIONING_QUICKSTART.md` - Quick start guide
- ✅ `docs/BACKFILL_GUIDE.md` - Backfill instructions
- ✅ `docs/COMPLETE_SOLUTION_SUMMARY.md` - Overview
- ✅ `docs/IMPLEMENTATION_CHECKLIST.md` - This file

### 🔧 Files I Modified (Existing Files - Already Updated)

- ✅ `lib/fetch_meta.ts`
  - **Change**: Exported `fetchHtmlDesktop` function
  - **Status**: Already updated
  - **Action**: No action needed - change is already in place

### ⚠️ Files You Need to Modify (Manual Integration)

- ⚠️ `app/(tabs)/capture.tsx`
  - **Status**: Needs your integration
  - **What to do**: Add `importRecipeWithVersioning` call
  - **See**: `docs/PARSER_VERSIONING_QUICKSTART.md` for examples

---

## Step-by-Step Implementation

### Step 1: Install Dependencies (if needed)

```bash
# Check if you have these packages
npm list @supabase/supabase-js dotenv

# If not, install them
npm install @supabase/supabase-js dotenv
```

### Step 2: Run Database Migrations

```bash
# Option A: Using Supabase CLI
supabase migration up

# Option B: Using Supabase Dashboard
# 1. Go to SQL Editor
# 2. Copy contents of: supabase/migrations/create_recipe_import_attempts.sql
# 3. Run it
# 4. (Optional) Copy contents of: supabase/migrations/backfill_parser_patterns_function.sql
# 5. Run it
```

**Verify migration:**
```sql
-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('recipe_import_attempts', 'recipe_extraction_patterns');

-- Should return 2 rows
```

### Step 3: Set Up Environment Variables (for backfill script)

Create or update `.env` file in project root:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Where to find:**
- Supabase Dashboard → Settings → API
- `EXPO_PUBLIC_SUPABASE_URL`: Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service Role Key (secret!)

### Step 4: Run Backfill (Recommended - Pre-Train System)

```bash
# Test with small batch first
npx tsx scripts/backfill-parser-patterns.ts --limit=50 --batch=5

# If successful, backfill more
npx tsx scripts/backfill-parser-patterns.ts --limit=500 --batch=10 --delay=1500

# Continue until all recipes processed
npx tsx scripts/backfill-parser-patterns.ts --limit=1000 --batch=10 --delay=1500
```

**Check results:**
```sql
-- See learned patterns
SELECT * FROM recipe_extraction_patterns 
ORDER BY success_rate DESC 
LIMIT 10;

-- Check backfill stats
SELECT * FROM get_backfill_stats();
```

### Step 5: Integrate into Capture Flow (Manual Step)

Edit `app/(tabs)/capture.tsx`:

**Option A: Try versioned parser first, fallback to existing**

```typescript
// At the top of the file, add import
import { importRecipeWithVersioning } from '@/lib/parsers/integration-helper';

// In your startImport function, add this before existing code:
try {
  const versionedResult = await importRecipeWithVersioning(url);
  if (versionedResult.success && versionedResult.ingredients?.length >= 2) {
    // Use versioned result
    if (versionedResult.title) setTitle(versionedResult.title);
    if (versionedResult.ingredients) setIngredients(versionedResult.ingredients);
    if (versionedResult.steps) setSteps(versionedResult.steps);
    if (versionedResult.image) {
      // Handle image
    }
    dbg("✅ Versioned parser succeeded");
    return; // Success!
  }
} catch (error) {
  dbg("⚠️ Versioned parser failed, falling back to existing code:", error);
  // Continue to existing import code below
}
```

**Option B: Run in parallel, use whichever succeeds first**

```typescript
// Run both in parallel
const [versionedResult, existingResult] = await Promise.allSettled([
  importRecipeWithVersioning(url),
  // Your existing import code
]);

// Use whichever succeeded
if (versionedResult.status === 'fulfilled' && versionedResult.value.success) {
  // Use versioned result
} else if (existingResult.status === 'fulfilled') {
  // Use existing result
}
```

### Step 6: Add User Correction Tracking (Optional but Recommended)

When user saves an edited recipe, track corrections:

```typescript
// In your onSave or updateRecipeFull function
import { trackUserCorrection } from '@/lib/parsers/integration-helper';

// After successful save, if recipe was imported:
if (sourceUrl) {
  await trackUserCorrection(
    sourceUrl,
    originalIngredients, // Store these when importing
    correctedIngredients,
    originalSteps,
    correctedSteps
  );
}
```

### Step 7: Monitor and Adjust

```sql
-- Check success rates
SELECT 
  site_type,
  parser_version,
  COUNT(*) as total,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM recipe_import_attempts
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY site_type, parser_version
ORDER BY site_type, parser_version;
```

---

## Quick Reference: File Locations

```
📁 Project Root
├── 📁 supabase/migrations/
│   ├── ✅ create_recipe_import_attempts.sql (RUN THIS)
│   └── ✅ backfill_parser_patterns_function.sql (OPTIONAL)
│
├── 📁 lib/parsers/
│   ├── ✅ versioning.ts (READY - just import)
│   ├── ✅ strategy-selector.ts (READY - just import)
│   └── ✅ integration-helper.ts (READY - just import)
│
├── 📁 scripts/
│   └── ✅ backfill-parser-patterns.ts (RUN THIS)
│
├── 📁 app/(tabs)/
│   └── ⚠️ capture.tsx (YOU NEED TO MODIFY)
│
├── 📁 lib/
│   └── ✅ fetch_meta.ts (ALREADY UPDATED)
│
└── 📁 docs/
    └── ✅ All documentation files (READ FOR REFERENCE)
```

---

## Verification Checklist

After implementation, verify:

- [ ] Database migration ran successfully
- [ ] Tables `recipe_import_attempts` and `recipe_extraction_patterns` exist
- [ ] Backfill script ran (optional but recommended)
- [ ] Pattern database has entries (check `recipe_extraction_patterns` table)
- [ ] `importRecipeWithVersioning` integrated into `capture.tsx`
- [ ] Test import works with new system
- [ ] Check logs for successful pattern learning

---

## Troubleshooting

### Migration fails
- Check Supabase connection
- Verify you have admin permissions
- Check for syntax errors in SQL

### Backfill script fails
- Verify environment variables are set
- Check Supabase service role key is correct
- Ensure `@supabase/supabase-js` is installed
- Try smaller batch size: `--batch=5`

### Integration doesn't work
- Check imports are correct
- Verify `lib/parsers/` files are in place
- Check console for errors
- Fallback to existing code if needed

---

## Next Steps After Implementation

1. **Monitor for 1 week**: Let system collect data
2. **Review patterns**: Check what's working
3. **Create v2 parsers**: Based on learnings
4. **Gradually rollout**: Increase `rolloutPercentage` in config
5. **Iterate**: Continue improving based on data

---

## Summary

**Files to Run:**
1. ✅ Database migration: `create_recipe_import_attempts.sql`
2. ✅ Backfill script: `backfill-parser-patterns.ts` (recommended)

**Files Already Updated:**
1. ✅ `lib/fetch_meta.ts` - Exported function

**Files You Need to Modify:**
1. ⚠️ `app/(tabs)/capture.tsx` - Add integration code

**Files Ready to Use (No Action Needed):**
- All files in `lib/parsers/` - Just import and use
- All documentation files - Read for reference

