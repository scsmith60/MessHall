# Backfill Original Source User

This script backfills the `original_source_user` field for existing recipes that have a `source_url` but no `original_source_user` populated.

## Prerequisites

1. **Run the migration first**: Make sure you've run the `add_original_source_user.sql` migration:
   ```bash
   supabase db push
   ```

2. **Set environment variables**: You need your Supabase credentials. You can either:
   
   **Option A: Set environment variables directly**
   ```bash
   export EXPO_PUBLIC_SUPABASE_URL="your-supabase-url"
   export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
   ```
   
   **Option B: Use a .env file** (requires `dotenv` package)
   ```bash
   npm install dotenv
   ```
   Then add to your `.env` file:
   ```
   EXPO_PUBLIC_SUPABASE_URL=your-supabase-url
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

   **Important**: Use the **service role key** (not the anon key) to bypass RLS and update all recipes.

## Running the Script

### Using Node.js (recommended):
```bash
node scripts/backfill-original-source-user.js
```

### Using TypeScript (if you have ts-node):
```bash
npx tsx scripts/backfill-original-source-user.ts
```

## What It Does

1. Finds all recipes with `source_url` but no `original_source_user`
2. Extracts the username from the URL (e.g., `@username` from TikTok/Instagram URLs)
3. Updates those recipes with the extracted username
4. Shows a summary of what was updated

## Example Output

```
🔄 Starting backfill of original_source_user...

📋 Fetching recipes with source_url but no original_source_user...
   Found 15 recipes to process

   ✅ Updated "Raspberry Swirl Christmas Roll" → @cookingcreator
   ✅ Updated "Southern Italian Thanksgiving" → @italiancook
   ⏭️  Skipping "Recipe Title" - no username found in URL: https://example.com/recipe
   ...

==================================================
📊 Backfill Summary:
   ✅ Updated: 12
   ⏭️  Skipped: 3 (no username in URL)
   ❌ Errors: 0
   📝 Total processed: 15
==================================================

✨ Backfill completed successfully!
```

## Notes

- The script only processes recipes where a username can be extracted from the URL
- Recipes with URLs that don't contain a username pattern (like `@username`) will be skipped
- The script is safe to run multiple times - it only updates recipes that don't already have `original_source_user`

