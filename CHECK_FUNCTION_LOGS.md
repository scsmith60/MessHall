# Check Function Logs - Debug 500 Error

Since environment variables are set, we need to see what the actual error is in the function logs.

## 🔍 **Step 1: Check Supabase Function Logs**

1. **Go to Supabase Dashboard**
2. Navigate to **Edge Functions** → **jitsi-create-room**
3. Click on **"Logs"** tab
4. **Try clicking "Start Video"** in your app again
5. **Check the logs** - you should see detailed error messages

The improved error handling will show you:
- `Missing environment variables` (if env vars not accessible)
- `JSON parse error` (if request body is invalid)
- `Session lookup error` (if database query fails)
- `Unhandled error` (with full stack trace)

## 🔄 **Step 2: Redeploy the Updated Function**

The function has been updated with better error handling. Make sure you redeploy:

### Via CLI:
```bash
supabase functions deploy jitsi-create-room
```

### Via Dashboard:
1. Go to **Edge Functions** → **jitsi-create-room**
2. Click **Edit**
3. Copy the code from `supabase/functions/jitsi-create-room/index.ts`
4. Paste and **Deploy**

## 🐛 **Common Issues After Checking Logs:**

### If you see "Session lookup error":
- **Database connection issue** or RLS policy blocking
- Service role key should bypass RLS, but check table exists

### If you see "Unhandled error":
- **Check the stack trace** in logs
- Usually a runtime error in the function code

### If logs are empty:
- Function might not be deployed yet
- Or logs haven't refreshed (wait a few seconds)

## 📋 **What to Share:**

After checking logs, please share:
1. **What error message** appears in the logs
2. **Any stack traces** shown
3. **When the error occurs** (immediately or after a delay)

This will help pinpoint the exact issue!

