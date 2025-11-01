# Daily.co Quick Setup Guide

## ✅ Code Migration Complete!

I've already switched your app from Jitsi to Daily.co. Here's what changed:

### Changes Made:
1. ✅ Replaced `VideoStreamJitsi` → `VideoStream` component
2. ✅ Updated function calls from `jitsi-create-room` → `daily-create-room`
3. ✅ Added token handling for participants (`daily-get-token`)
4. ✅ Fixed TypeScript types

### What You Need to Do:

## Step 1: Get Daily.co API Key (2 minutes)

1. Go to https://daily.co
2. Sign up for a free account (or log in)
3. Go to **Dashboard → Developers → API Keys**
4. Copy your API key (starts with something like `abcd1234efgh5678...`)

## Step 2: Add API Key to Supabase (1 minute)

1. Go to your Supabase Dashboard
2. Navigate to **Project Settings → Edge Functions → Secrets**
3. Click **"Add a new secret"**
4. Enter:
   - **Name:** `DAILY_API_KEY`
   - **Value:** (paste your Daily.co API key)
5. Click **Save**

## Step 3: Deploy Edge Functions (1 minute)

Run these commands in your terminal:

```bash
supabase functions deploy daily-create-room
supabase functions deploy daily-get-token
```

Or deploy via Supabase Dashboard:
1. Go to **Edge Functions** in Supabase
2. Deploy `daily-create-room` and `daily-get-token`

## Step 4: Test It! 🎉

1. Open your app
2. Create or join an Enlisted Club session
3. Click "Start Video" (host) or "Join Video" (participant)
4. Grant camera/mic permissions
5. Video should load! 🚀

---

## 🆓 Free Tier Details

- **10,000 participant-minutes/month FREE**
- Examples:
  - 100 people × 60 min = 6,000 min = **FREE** ✅
  - 50 people × 60 min = 3,000 min = **FREE** ✅
  - 166 hours of 1-on-1 sessions = **FREE** ✅

After 10K minutes: $0.00195 per participant-minute (~$0.12/hour for 100 people)

---

## 🐛 Troubleshooting

### "Daily.co API key not configured"
→ Check Step 2 - make sure the secret is named exactly `DAILY_API_KEY`

### "Failed to create Daily room"
→ Verify your Daily.co account is active and API key is valid

### "Camera not working"
→ Check device permissions in Settings

### Video won't load
→ Make sure both edge functions are deployed and working
→ Check browser console for errors (if testing on web)

---

## 📚 Next Steps

- **Test thoroughly** with multiple participants
- **Monitor usage** in Daily.co dashboard (check you're staying under 10K free minutes)
- **Upgrade plan** when needed (if you exceed free tier)

---

## 💡 Why Daily.co > Jitsi?

✅ **Better API** - More reliable, cleaner integration  
✅ **Better documentation** - Easier to troubleshoot  
✅ **Better mobile support** - Works better in React Native  
✅ **Free tier** - 10K minutes/month is generous  
✅ **No native dependencies** - Pure WebView (no build issues!)  

You're all set! 🎉

