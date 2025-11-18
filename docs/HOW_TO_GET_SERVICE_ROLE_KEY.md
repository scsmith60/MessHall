# How to Get Your Supabase Service Role Key

## Step-by-Step Instructions

### Step 1: Go to Supabase Dashboard
1. Open your browser
2. Go to: https://supabase.com/dashboard
3. Sign in if needed

### Step 2: Select Your Project
1. Click on your project name in the left sidebar
   - Your project URL shows: `https://xjayyiagelndsodkqaga.supabase.co`
   - So your project should be visible in the list

### Step 3: Navigate to API Settings
1. In the left sidebar, click on **Settings** (gear icon at the bottom)
2. Click on **API** in the settings menu

### Step 4: Find the Service Role Key
1. Scroll down to the section labeled **"Project API keys"**
2. You'll see two keys:
   - **`anon` `public`** - This is your anon key (you already have this)
   - **`service_role` `secret`** - This is what you need! ⚠️

### Step 5: Reveal and Copy the Key
1. Find the row with **`service_role`** and **`secret`** labels
2. Click the **eye icon** 👁️ to reveal the key (it's hidden by default)
3. Click the **copy icon** 📋 next to the key to copy it
4. The key is very long (starts with `eyJ...`)

### Step 6: Add to Your .env File
1. Open your `.env` file in the project root
2. Add this line:
   ```env
   SUPABASE_SERVICE_ROLE_KEY=paste-the-key-here
   ```
3. Replace `paste-the-key-here` with the actual key you copied
4. Save the file

## Visual Guide

The API settings page looks like this:

```
┌─────────────────────────────────────────┐
│  Settings > API                          │
├─────────────────────────────────────────┤
│                                          │
│  Project URL                             │
│  https://xjayyiagelndsodkqaga.supabase.co│
│                                          │
│  Project API keys                        │
│  ┌─────────────────────────────────────┐ │
│  │ anon          public                │ │
│  │ eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...│
│  │ [👁️] [📋]                            │ │
│  └─────────────────────────────────────┘ │
│  ┌─────────────────────────────────────┐ │
│  │ service_role  secret  ⚠️            │ │ ← THIS ONE!
│  │ eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...│
│  │ [👁️] [📋]                            │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ⚠️ The service_role key has full access │
│     to your database. Keep it secret!    │
└─────────────────────────────────────────┘
```

## What the Key Looks Like

The service role key is a long JWT token that looks like:
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqYXl5aWFlZ2VuZHNvZGtxYWdhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY5ODc2NDMyMCwiZXhwIjoyMDE0MzI0MzIwfQ.very-long-string-here...
```

It's typically 200+ characters long.

## Security Warning

⚠️ **IMPORTANT:**
- The service role key has **full database access** (bypasses Row Level Security)
- **Never commit it to git!**
- Make sure your `.env` file is in `.gitignore`
- Only use it for server-side scripts (like the backfill script)
- Don't use it in client-side code (React Native app)

## Verify It's Working

After adding the key to your `.env` file, test it:

```bash
# Run the backfill script
npx tsx scripts/backfill-parser-patterns.ts --limit=10

# If it works, you'll see:
# ✅ Found X recipes with source URLs...
# If it fails, you'll see a clear error message
```

## Troubleshooting

### "I don't see the service_role key"
- Make sure you're in **Settings → API** (not just Settings)
- Scroll down - it's below the Project URL section
- If you still don't see it, you might need project owner/admin access

### "The key is hidden and I can't reveal it"
- Click the eye icon 👁️ to toggle visibility
- If it doesn't work, try refreshing the page
- Make sure you have admin/owner permissions

### "I copied it but it's not working"
- Make sure you copied the **entire** key (it's very long)
- Check for extra spaces before/after
- Make sure the `.env` file is in the project root (same folder as `package.json`)
- Restart your terminal after adding it

### "Still getting 'Missing SUPABASE_SERVICE_ROLE_KEY'"
1. Verify the `.env` file is in the project root
2. Check the variable name is exactly: `SUPABASE_SERVICE_ROLE_KEY` (no typos)
3. Make sure there's no space around the `=` sign
4. Try restarting your terminal/command prompt
5. Verify dotenv is installed: `npm list dotenv`

## Alternative: Check via Supabase CLI

If you have Supabase CLI installed:

```bash
supabase status
```

This will show your project details, but won't show the service role key (for security).

## Need Help?

If you're still having trouble:
1. Double-check you're in the right place: **Settings → API**
2. Make sure you have owner/admin access to the project
3. Try copying the key again (it's very long, make sure you got it all)
4. Check that your `.env` file is saved and in the correct location

