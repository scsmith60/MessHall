# Deploy Jitsi Edge Functions

## 🚨 Important: Deploy These Functions

You need to deploy the Jitsi edge functions to Supabase. Here's how:

---

## Step 1: Deploy via CLI

```bash
# Navigate to your project root
cd C:\Dev\MessHall

# Deploy jitsi-create-room
supabase functions deploy jitsi-create-room

# Deploy jitsi-get-token
supabase functions deploy jitsi-get-token
```

---

## Step 2: Or Deploy via Supabase Dashboard

1. **Go to Supabase Dashboard**
   - Navigate to your project
   - Go to **Edge Functions**

2. **For `jitsi-create-room`:**
   - Click **"New Function"** or find existing one
   - Name: `jitsi-create-room`
   - Copy contents from `supabase/functions/jitsi-create-room/index.ts`
   - Paste into editor
   - Click **Deploy**

3. **For `jitsi-get-token`:**
   - Click **"New Function"**
   - Name: `jitsi-get-token`
   - Copy contents from `supabase/functions/jitsi-get-token/index.ts`
   - Paste into editor
   - Click **Deploy**

---

## Step 3: Test the Functions

### Test jitsi-create-room:

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/jitsi-create-room \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "YOUR_SESSION_ID",
    "user_id": "YOUR_USER_ID"
  }'
```

Should return:
```json
{
  "ok": true,
  "room_url": "https://meet.jit.si/enlisted-abc123..."
}
```

### Test jitsi-get-token:

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/jitsi-get-token \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "YOUR_SESSION_ID",
    "user_id": "YOUR_USER_ID"
  }'
```

---

## 🔍 Troubleshooting "Non-2xx Code" Error

### Common Issues:

1. **Function not deployed:**
   - Check Supabase Dashboard → Edge Functions
   - Verify `jitsi-create-room` and `jitsi-get-token` exist
   - If missing, deploy them

2. **Wrong function name:**
   - Function must be named exactly: `jitsi-create-room`
   - Case-sensitive!

3. **Authentication error:**
   - Make sure user is logged in
   - Check if `user_id` matches session `host_id`

4. **Session not found:**
   - Verify session exists in database
   - Check session_id is correct

5. **Database permissions:**
   - Edge function uses service role key
   - Should have full access

### Debug Steps:

1. **Check function logs:**
   ```bash
   supabase functions logs jitsi-create-room
   ```

2. **Add console.log to function:**
   - Already added error logging
   - Check Supabase Dashboard → Edge Functions → Logs

3. **Test with curl:**
   - See test commands above
   - This bypasses React Native and tests function directly

---

## ✅ After Deployment

Once functions are deployed:

1. **Restart your app**
2. **Try "Start Video" again**
3. **Check console logs** for detailed errors

---

## 📝 Edge Function Requirements

### Both functions need:
- ✅ Access to `enlisted_club_sessions` table
- ✅ Service role key (auto-provided by Supabase)
- ✅ CORS headers (already included)

### No additional secrets needed:
- ✅ Jitsi is free - no API keys!
- ✅ Uses public `meet.jit.si` server

---

## 🆘 Still Getting Errors?

1. **Check Supabase Dashboard → Edge Functions → Logs**
2. **Verify function names match exactly**
3. **Check RLS policies** on `enlisted_club_sessions` table
4. **Try direct curl test** to isolate issue

**The functions are ready - just need to deploy them!** 🚀

