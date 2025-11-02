# Quick Fix: Jitsi Edge Function Error

## 🚨 The Problem

Getting "edge function returned a non-2xx code" when clicking "Start Video".

## ✅ Solution: Deploy Edge Functions

The edge functions exist in code but **need to be deployed to Supabase**.

---

## 📋 Deploy Steps

### Option 1: Via Supabase CLI (Fastest)

```bash
cd C:\Dev\MessHall
supabase functions deploy jitsi-create-room
supabase functions deploy jitsi-get-token
```

### Option 2: Via Supabase Dashboard

1. Go to **Supabase Dashboard** → Your Project → **Edge Functions**

2. **Deploy `jitsi-create-room`:**
   - Click **"Create a new function"** or find existing
   - Function name: `jitsi-create-room` (exact match!)
   - Copy code from: `supabase/functions/jitsi-create-room/index.ts`
   - Paste and click **Deploy**

3. **Deploy `jitsi-get-token`:**
   - Click **"Create a new function"**
   - Function name: `jitsi-get-token` (exact match!)
   - Copy code from: `supabase/functions/jitsi-get-token/index.ts`
   - Paste and click **Deploy**

---

## 🔍 Verify Deployment

After deploying, verify functions exist:

1. **Supabase Dashboard** → **Edge Functions**
2. Should see:
   - ✅ `jitsi-create-room`
   - ✅ `jitsi-get-token`

---

## 🐛 Common Issues

### Issue 1: "Function not found" / 404
- **Fix:** Function not deployed yet - deploy it!

### Issue 2: "403 Forbidden"
- **Fix:** Check user is logged in and is the host
- **Check:** `user_id` matches `session.host_id`

### Issue 3: "404 Not Found" (Session)
- **Fix:** Session doesn't exist - check `session_id`

### Issue 4: "500 Internal Server Error"
- **Fix:** Check Supabase logs for database errors
- **Check:** RLS policies on `enlisted_club_sessions` table
- **Check:** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set

---

## 🧪 Test After Deployment

1. **Restart your app**
2. **Create a session** (as host)
3. **Click "Start Video"**
4. **Should work!** ✅

If still errors, check:
- Console logs (detailed errors now included)
- Supabase Dashboard → Edge Functions → Logs
- Status code will now be shown in error message

---

## 📝 Improved Error Messages

The app now shows detailed error messages:
- **Status code** (404, 403, 500, etc.)
- **Error message** from server
- **Full error details** in console

Look for messages like:
- `Edge function error (404): Function not found` → Not deployed
- `Edge function error (403): Only the host can create the video room` → Wrong user
- `Edge function error (500): Database error: ...` → Check logs
