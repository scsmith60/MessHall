# Environment Variables Setup for Backfill Script

## Required Variables

The backfill script needs **two** environment variables:

### 1. Supabase URL
You already have this:
```env
EXPO_PUBLIC_SUPABASE_URL=https://xjayyiagelndsodkqaga.supabase.co
```

### 2. Service Role Key (⚠️ This is what you're missing!)

**This is different from the anon key!**

You need to add this to your `.env` file:
```env
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Where to Find Service Role Key

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **API**
4. Scroll down to **Project API keys**
5. Find **`service_role`** key (it's labeled as "secret" - this is the one!)
6. Click the eye icon to reveal it
7. Copy the entire key

## Complete .env File

Add this line to your `.env` file:

```env
# Your existing variables
EXPO_PUBLIC_SUPABASE_URL=https://xjayyiagelndsodkqaga.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# ADD THIS NEW LINE:
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Important Notes

⚠️ **Security Warning:**
- The **Service Role Key** has **full database access** (bypasses RLS)
- **Never commit it to git!**
- Make sure `.env` is in your `.gitignore`
- Only use it for server-side scripts (like this backfill)

✅ **Safe to commit:**
- `EXPO_PUBLIC_SUPABASE_URL` - Public URL (safe)
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` - Public key (safe, has RLS protection)

## Verify Setup

After adding the key, verify it works:

```bash
# Check if .env is loaded
node -e "require('dotenv').config(); console.log('URL:', process.env.EXPO_PUBLIC_SUPABASE_URL ? '✅' : '❌'); console.log('Service Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅' : '❌');"
```

## Run Backfill Again

Once you've added `SUPABASE_SERVICE_ROLE_KEY` to your `.env` file:

```bash
npx tsx scripts/backfill-parser-patterns.ts --limit=1000
```

## Troubleshooting

### "Missing SUPABASE_SERVICE_ROLE_KEY"
- Make sure you added it to `.env` (not just copied it)
- Make sure the file is named exactly `.env` (not `.env.example`)
- Restart your terminal/command prompt after adding it
- Check for typos in the variable name

### "Invalid API key"
- Make sure you copied the **entire** key (it's very long)
- Make sure you're using the **service_role** key, not the **anon** key
- Check for extra spaces or line breaks

### Still not working?
- Try using the full path: `SUPABASE_URL` instead of `EXPO_PUBLIC_SUPABASE_URL`
- Make sure dotenv is installed: `npm install dotenv`
- Check that `.env` file is in the project root (same directory as `package.json`)

