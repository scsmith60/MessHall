# Manual Setup Required

## Database Changes (Already Done ✅)

The migration `create_recipe_import_attempts.sql` has already created:
- ✅ `recipe_import_attempts` table
- ✅ `recipe_extraction_patterns` table
- ✅ RPC functions: `log_recipe_import_attempt`, `mark_import_corrected`, `update_extraction_pattern`
- ✅ RLS policies

**No manual database changes needed!** Everything is ready.

## Code Changes (I'll Do This ✅)

I'll integrate tracking into `capture.tsx`:
- ✅ Track import attempts (success/failure)
- ✅ Track user corrections
- ✅ Track abandons
- ✅ Store original import data

## Environment Variables (You Need to Set)

Make sure your `.env` file has:
```env
EXPO_PUBLIC_SUPABASE_URL=https://xjayyiagelndsodkqaga.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**Note:** The tracking uses the anon key (not service role key) because it runs in the app, not a script.

## RLS Policies (Check These)

The migration should have set up RLS, but verify in Supabase Dashboard:

1. Go to **Authentication** → **Policies**
2. Check `recipe_import_attempts` table:
   - ✅ Users can read their own attempts
   - ✅ Service role has full access
3. Check `recipe_extraction_patterns` table:
   - ✅ Anyone can read (they're aggregated data)
   - ✅ Service role can write

If policies are missing, the migration should have created them. If not, you can create them manually:

```sql
-- For recipe_import_attempts
CREATE POLICY "Users can read own import attempts"
  ON recipe_import_attempts
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- For recipe_extraction_patterns  
CREATE POLICY "Anyone can read extraction patterns"
  ON recipe_extraction_patterns
  FOR SELECT
  USING (true);
```

## Testing

After integration, test by:
1. Import a recipe → Check `recipe_import_attempts` table
2. Edit and save → Check if `user_corrected` is set
3. Cancel import → Check if abandon is logged

## That's It!

Everything else is handled in code. No other manual setup needed.

