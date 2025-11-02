# Setup Jitsi Edge Functions

## ✅ **NO JITSI API KEY NEEDED!**

Jitsi is **100% FREE** and uses the public `meet.jit.si` server. **No API keys, no authentication, nothing!**

However, your Supabase Edge Functions need access to your Supabase database credentials.

---

## 🔑 **What You DO Need: Supabase Environment Variables**

Your edge functions need these **Supabase** environment variables (NOT Jitsi - these are for database access):

1. **`SUPABASE_URL`** - Your Supabase project URL
2. **`SUPABASE_SERVICE_ROLE_KEY`** - Your Supabase service role key

These should be **automatically available** in Supabase Edge Functions, but sometimes they need to be set manually.

---

## 📋 **Step-by-Step Setup**

### Option 1: Check if Variables are Auto-Injected

Supabase usually injects these automatically. If they're not working:

### Option 2: Set Environment Variables Manually

1. **Go to Supabase Dashboard:**
   - Open your project
   - Navigate to **Edge Functions** → **jitsi-create-room**

2. **Check Settings/Secrets:**
   - Look for **"Secrets"** or **"Environment Variables"** section
   - If empty, add these:
     - **Name:** `SUPABASE_URL`
       **Value:** `https://your-project-id.supabase.co` (your project URL)
     - **Name:** `SUPABASE_SERVICE_ROLE_KEY`
       **Value:** Get this from **Settings** → **API** → **service_role key** (the secret one)

3. **Redeploy the function:**
   - After setting variables, redeploy the function

---

## 🚀 **Deploy Functions**

### Via CLI (Recommended):
```bash
supabase functions deploy jitsi-create-room
supabase functions deploy jitsi-get-token
```

### Via Dashboard:
1. Copy code from `supabase/functions/jitsi-create-room/index.ts`
2. Paste into Dashboard → Edge Functions → jitsi-create-room
3. Deploy
4. Repeat for `jitsi-get-token`

---

## 🔍 **Verify Setup**

After deploying, check the logs:

1. **Supabase Dashboard** → **Edge Functions** → **jitsi-create-room** → **Logs**
2. Try "Start Video" in your app
3. Check logs for:
   - ✅ Success messages
   - ❌ "Missing environment variables" → Set them manually
   - ❌ Database errors → Check RLS policies

---

## 🐛 **Troubleshooting**

### Error: "Missing environment variables"
- **Fix:** Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in function secrets

### Error: "Database error: ..."
- **Fix:** Check Row Level Security (RLS) policies on `enlisted_club_sessions` table
- **Fix:** Ensure service role key has proper permissions

### Error: 403 Forbidden
- **Fix:** User is not the host of the session

### Error: 404 Not Found
- **Fix:** Session doesn't exist or wrong `session_id`

---

## 📝 **Summary**

- ✅ **Jitsi = FREE, no API keys needed**
- ✅ **Supabase env vars = Usually auto-injected**
- ✅ **If 500 error = Check Supabase logs for details**
- ✅ **Deploy both functions** (`jitsi-create-room` and `jitsi-get-token`)

The improved error handling will now show you exactly what's wrong in the logs!

