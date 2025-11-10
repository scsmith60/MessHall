# Clearing All Data Before Publishing

This guide explains how to clear all user data and storage from your Supabase project without affecting your schema, functions, or migrations.

## ⚠️ Warning

**This will permanently delete ALL user data, including:**
- All users and profiles
- All recipes
- All comments
- All storage files (images, avatars, etc.)
- All application data

**This will NOT affect:**
- Database schema (tables, columns, constraints)
- Functions and stored procedures
- Triggers
- RLS policies
- Indexes
- Migrations history
- Edge functions

## Steps to Clear Data

### 1. Clear Database Tables

Run the SQL migration to clear all data from tables:

```bash
# If using Supabase CLI locally
supabase db reset

# OR apply just the clear_all_data migration
supabase migration up clear_all_data
```

Or manually run the SQL in `supabase/migrations/clear_all_data.sql` using:
- Supabase Dashboard SQL Editor
- psql
- Any PostgreSQL client

### 2. Clear Storage Buckets

Run the TypeScript script to clear all storage buckets:

```bash
# Set your environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Run the script
npx tsx scripts/clear-storage-buckets.ts
```

Or if you prefer Node.js directly:

```bash
node --loader ts-node/esm scripts/clear-storage-buckets.ts
```

**Note:** You need your Supabase Service Role Key (not the anon key) to clear storage. You can find it in:
- Supabase Dashboard → Settings → API → `service_role` key (secret)

### 3. Verify

After running both scripts, verify that:
- ✅ All tables are empty (check in Supabase Dashboard)
- ✅ All storage buckets are empty (check in Storage section)
- ✅ Schema, functions, and policies are still intact

## Alternative: Using Supabase Dashboard

If you prefer using the UI:

### Clear Tables:
1. Go to Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `supabase/migrations/clear_all_data.sql`
3. Run the query

### Clear Storage:
1. Go to Supabase Dashboard → Storage
2. For each bucket (`recipe-images`, `avatars`, `sponsored-images`, `support`):
   - Click on the bucket
   - Select all files
   - Click "Delete"

## What Gets Cleared

### Database Tables:
- `auth.users` - All authentication users
- `profiles` - All user profiles
- `recipes` - All recipes
- `recipe_comments` - All comments
- `recipe_views` - All view tracking
- `recipe_saves` - All recipe saves/bookmarks
- `recipe_likes` - All recipe likes
- `recipe_cooks` - All recipe cook records
- `recipe_ingredients` - All recipe ingredients
- `recipe_steps` - All recipe steps
- `follows` - All user follow relationships
- `user_blocks` - All user blocking relationships
- `shopping_lists` - All shopping lists
- `shopping_list_items` - All shopping list items
- `enlisted_club_sessions` - All cooking sessions
- `enlisted_club_participants` - All session participants
- `enlisted_club_tips` - All tips
- `enlisted_club_messages` - All chat messages
- `enlisted_club_reactions` - All reactions
- `product_suggestions` - All product suggestions
- `discovered_recipe_sites` - All discovered sites
- `streaming_usage` - All streaming usage data
- `streaming_config` - All streaming config (⚠️ this will be cleared too)
- `sponsored_slots` - All sponsored content slots
- `notifications` - All notifications
- `creator_applications` - All creator applications

### Storage Buckets:
- `recipe-images` - All recipe images
- `avatars` - All user avatars
- `sponsored-images` - All sponsored content images
- `support` - All support screenshots/files

## After Clearing

Once data is cleared, your database will be in a clean state ready for production. New users can sign up and start using the app fresh.

## Restoring Data

⚠️ **There is no way to restore data after running these scripts.** Make sure you:
- Have backups if you need to restore later
- Are absolutely sure you want to clear everything
- Have exported any data you want to keep

