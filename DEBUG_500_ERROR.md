# Debugging 500 Error: Jitsi Edge Function

## 🔍 What We Know

You're getting a **500 Internal Server Error** from the `jitsi-create-room` function. This means:
- ✅ Function **IS deployed** (otherwise you'd get 404)
- ❌ Function is **crashing** internally

## 🚨 Most Common Causes

### 1. Missing Environment Variables (MOST LIKELY)

The function needs these environment variables set in Supabase:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Fix:**
1. Go to **Supabase Dashboard** → Your Project → **Edge Functions** → **jitsi-create-room**
2. Click **Settings** or **Secrets**
3. Ensure these are set:
   - `SUPABASE_URL` = Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = Your service role key (from Settings → API)

### 2. Function Needs Redeploy

After fixing the code, you need to redeploy:

```bash
supabase functions deploy jitsi-create-room
```

Or via Dashboard:
1. Go to **Edge Functions** → **jitsi-create-room**
2. Click **Edit**
3. Copy the updated code from `supabase/functions/jitsi-create-room/index.ts`
4. Paste and click **Deploy**

### 3. Check Function Logs

The function now has better error logging. Check:

1. **Supabase Dashboard** → **Edge Functions** → **jitsi-create-room** → **Logs**
2. Look for:
   - `Missing environment variables` → Set env vars
   - `JSON parse error` → Invalid request
   - `Session lookup error` → Database/RLS issue
   - `Unhandled error` → Check stack trace

## 🧪 Testing After Fix

1. **Redeploy the function** (with improved error handling)
2. **Set environment variables** if missing
3. **Try "Start Video" again**
4. **Check logs** for detailed error messages
5. **Check console** - should now show more detailed error

## 📝 What I Just Fixed

The function now:
- ✅ Validates environment variables before use
- ✅ Better JSON parsing error handling
- ✅ More detailed error logging
- ✅ Returns clearer error messages

## 🔗 Next Steps

1. **Redeploy** the updated function
2. **Verify** environment variables are set
3. **Test** again - should get a clearer error message
4. **Check logs** if still failing

The improved error handling should now tell us exactly what's wrong!

