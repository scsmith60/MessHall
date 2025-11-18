# Final Checklist - What You Need to Do

## ✅ What I've Done (No Action Needed)

1. ✅ **Integrated tracking into `capture.tsx`**
   - Tracks all import attempts (success/failure)
   - Tracks user corrections
   - Tracks abandons
   - Stores original import data

2. ✅ **Updated type definitions**
   - Added new strategy types to `StrategyName`

3. ✅ **Created all necessary files**
   - Database migrations
   - Parser system
   - Backfill script
   - Documentation

## ⚠️ What You Need to Do

### 1. Verify Database Migration (5 minutes)

Run this in Supabase SQL Editor:

```sql
-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('recipe_import_attempts', 'recipe_extraction_patterns');
```

**If tables don't exist:**
```bash
supabase migration up
```

**Or manually run:**
- Copy contents of `supabase/migrations/create_recipe_import_attempts.sql`
- Paste into Supabase SQL Editor
- Run it

### 2. Verify RLS Policies (2 minutes)

In Supabase Dashboard → Authentication → Policies:

Check that these policies exist:

**`recipe_import_attempts` table:**
- ✅ "Users can read own import attempts" (SELECT)
- ✅ "Service role full access" (ALL)

**`recipe_extraction_patterns` table:**
- ✅ "Anyone can read extraction patterns" (SELECT)
- ✅ "Service role can write patterns" (ALL)

**If policies are missing**, the migration should have created them. If not, you can create them manually (see `docs/MANUAL_SETUP_REQUIRED.md`).

### 3. Test the Integration (10 minutes)

1. **Test successful import:**
   - Import a recipe
   - Check: `SELECT * FROM recipe_import_attempts WHERE success = true ORDER BY created_at DESC LIMIT 1;`

2. **Test user correction:**
   - Import a recipe
   - Edit ingredients or steps
   - Save
   - Check: `SELECT * FROM recipe_import_attempts WHERE user_corrected = true ORDER BY created_at DESC LIMIT 1;`

3. **Test failed import:**
   - Try importing an invalid URL
   - Check: `SELECT * FROM recipe_import_attempts WHERE success = false ORDER BY created_at DESC LIMIT 1;`

## That's It!

Everything else is automated. The system will now:
- ✅ Track every import attempt
- ✅ Learn from successes and failures
- ✅ Track user corrections
- ✅ Build pattern database automatically

## Next Steps (After Testing)

1. **Monitor for 1 week** - Let it collect data
2. **Review patterns** - See what's working
3. **Create v2 parsers** - Based on learnings
4. **Gradually rollout** - Increase `rolloutPercentage`

## Troubleshooting

### "No data appearing in database"
- Check migration ran: `SELECT COUNT(*) FROM recipe_import_attempts;`
- Check RLS policies allow inserts
- Check console for errors
- Verify `.env` has `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### "user_corrected not working"
- Make sure you're actually editing (changing ingredients/steps)
- Check that import succeeded first
- Verify URL matches between import and save

### "TypeScript errors"
- Run: `npm install` to ensure dependencies
- Check that `lib/parsers/versioning.ts` exists
- Restart TypeScript server in your IDE

## Summary

**Manual steps required:**
1. ✅ Verify/run database migration
2. ✅ Verify RLS policies
3. ✅ Test the integration

**Everything else is done!** 🎉

The tracking system is fully integrated and ready to collect data.

