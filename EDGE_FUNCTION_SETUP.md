# Edge Function Setup Guide for Jitsi Meet (100% FREE)

## ✅ Jitsi Meet - No Setup Required!

**Jitsi Meet is completely free and requires NO API keys or accounts!**

Just deploy the function and you're done:
```bash
supabase functions deploy jitsi-create-room
```

That's it! No secrets, no keys, nothing else needed.

---

# (OLD) Daily.co Setup Guide (If you want to upgrade later)

## Step-by-Step Setup Instructions

### 1. Get Your Daily.co API Key

1. **Create/Login to Daily.co Account**
   - Go to https://www.daily.co/
   - Sign up for a free account (or login if you already have one)
   - Free tier includes: **10,000 participant-minutes/month** (FREE)
   - After free tier: $0.003 per participant-minute
   - **Example**: 100 participants × 60 minutes = 6,000 minutes = **FREE** ✅

2. **Navigate to API Keys**
   - Once logged in, go to **Dashboard**
   - Click on **Developers** → **API Keys** (or Settings → API Keys)
   - Your API key will look like: `1234567890abcdef1234567890abcdef` (long alphanumeric string)

3. **Copy Your API Key**
   - Click "Show" or "Copy" to reveal your API key
   - **Save this somewhere safe** - you'll need it in the next step

### 2. Add API Key to Supabase Secrets

1. **Open Supabase Dashboard**
   - Go to https://app.supabase.com/
   - Select your MessHall project

2. **Navigate to Edge Functions Secrets**
   - In the left sidebar, click **Edge Functions**
   - Click on the **Secrets** tab (or go to **Project Settings** → **Edge Functions** → **Secrets**)

3. **Add New Secret**
   - Click **"Add secret"** or **"New secret"**
   - **Name**: `DAILY_API_KEY`
   - **Value**: Paste your Daily.co API key from step 1
   - Click **"Save"** or **"Add secret"**

### 3. Deploy the Edge Functions

You have two options:

#### Option A: Using Supabase CLI (Recommended)

1. **Make sure Supabase CLI is installed**
   ```bash
   # Check if installed
   supabase --version
   
   # If not installed, install it:
   # Windows: Download from https://github.com/supabase/cli/releases
   # Or via npm: npm install -g supabase
   ```

2. **Link your project** (if not already linked)
   ```bash
   cd c:\Dev\MessHall
   supabase link --project-ref YOUR_PROJECT_REF
   ```
   - Find your project ref in Supabase Dashboard → Settings → General → Reference ID

3. **Deploy both functions**
   ```bash
   cd c:\Dev\MessHall
   supabase functions deploy daily-create-room
   supabase functions deploy daily-get-token
   ```

#### Option B: Using Supabase Dashboard

1. **Go to Edge Functions in Dashboard**
   - Supabase Dashboard → **Edge Functions**

2. **Create Function: daily-create-room**
   - Click **"Create a new function"** or **"New function"**
   - Name: `daily-create-room`
   - Copy the entire contents of `supabase/functions/daily-create-room/index.ts`
   - Paste into the editor
   - Click **"Deploy"** or **"Save"**

3. **Create Function: daily-get-token**
   - Click **"Create a new function"** again
   - Name: `daily-get-token`
   - Copy the entire contents of `supabase/functions/daily-get-token/index.ts`
   - Paste into the editor
   - Click **"Deploy"** or **"Save"**

### 4. Verify Setup

1. **Check Secrets**
   - Supabase Dashboard → Edge Functions → Secrets
   - Verify `DAILY_API_KEY` exists

2. **Check Functions**
   - Supabase Dashboard → Edge Functions
   - You should see both `daily-create-room` and `daily-get-token` listed

3. **Test (Optional)**
   - Create a test Enlisted Club session as a host
   - Try clicking "Start Video"
   - If you get an error, check the Edge Function logs in Supabase Dashboard

### 5. Troubleshooting

**Issue: "Daily.co API key not configured"**
- ✅ Make sure the secret is named exactly `DAILY_API_KEY` (case-sensitive)
- ✅ Verify the secret value is your actual Daily.co API key
- ✅ Try redeploying the functions after adding the secret

**Issue: "Failed to create Daily room"**
- ✅ Check your Daily.co account is active
- ✅ Verify your API key is valid (try using it in Daily.co dashboard)
- ✅ Check Edge Function logs for specific error messages

**Issue: Functions not deploying**
- ✅ Make sure you're in the correct directory (`c:\Dev\MessHall`)
- ✅ Verify Supabase CLI is linked to your project
- ✅ Check you have proper permissions in Supabase project

## Quick Checklist

- [ ] Daily.co account created
- [ ] API key copied
- [ ] Secret `DAILY_API_KEY` added to Supabase
- [ ] Function `daily-create-room` deployed
- [ ] Function `daily-get-token` deployed
- [ ] Tested creating a session and starting video

## What Happens Next

Once setup is complete:
1. **Hosts** can click "Start Video" to create a Daily.co room and begin streaming
2. **Participants** will see "Join Video" button when host starts streaming
3. **Video loads** in the WebView component showing all participants
4. **Tips, chat, and reactions** all work during video sessions

## Support

If you run into issues:
- Check Supabase Edge Function logs for error messages
- Verify Daily.co API key is valid in Daily.co dashboard
- Ensure both functions are deployed and secrets are set

