# Apply Chat & Reactions Migrations

The chat and reactions tables haven't been created yet. Here's how to apply them:

## Option 1: Supabase Dashboard (Easiest - Recommended)

1. **Go to Supabase Dashboard**
   - Navigate to https://app.supabase.com/
   - Select your MessHall project

2. **Open SQL Editor**
   - Click **SQL Editor** in the left sidebar
   - Click **"New query"**

3. **Apply Chat Migration**
   - Open `supabase/migrations/add_enlisted_club_chat.sql`
   - Copy the entire contents
   - Paste into SQL Editor
   - Click **"Run"** or press `Ctrl+Enter`

4. **Apply Reactions Migration**
   - Open `supabase/migrations/add_enlisted_club_reactions.sql`
   - Copy the entire contents
   - Paste into SQL Editor (or create a new query)
   - Click **"Run"** or press `Ctrl+Enter`

5. **Verify Tables Created**
   - Go to **Table Editor** in left sidebar
   - You should now see:
     - `enlisted_club_messages` ✅
     - `enlisted_club_reactions` ✅

## Option 2: Supabase CLI (If you have it set up)

```bash
cd c:\Dev\MessHall
supabase db push
```

This will apply all pending migrations.

## What These Migrations Create

### `enlisted_club_messages` Table
- Stores chat messages for sessions
- Real-time updates for all participants
- Users can delete their own messages within 5 minutes

### `enlisted_club_reactions` Table
- Stores emoji reactions (❤️, 🔥, 👏, 💯, etc.)
- Real-time floating emoji animations
- Participants can send reactions to sessions

## After Applying

Once these tables are created:
- ✅ Chat will work in real-time
- ✅ Emoji reactions will work
- ✅ Those console warnings will disappear
- ✅ Participants can send messages during sessions

## Troubleshooting

**If you get permission errors:**
- Make sure you're logged in as project owner
- Check that RLS policies are being created (they're in the migration files)

**If tables don't appear:**
- Refresh the Table Editor
- Check SQL Editor for error messages
- Verify migrations ran successfully

