# Jitsi Meet Quick Start Guide

## What You Need to Do (Just 1 Step!)

### Deploy the Edge Function

**Option 1: Using Supabase CLI** (Fastest)
```bash
cd c:\Dev\MessHall
supabase functions deploy jitsi-create-room
```

**Option 2: Using Supabase Dashboard** (If you don't have CLI)
1. Go to https://app.supabase.com/ → Your Project
2. Click **Edge Functions** in left sidebar
3. Click **"Create a new function"**
4. Name it: `jitsi-create-room`
5. Open `supabase/functions/jitsi-create-room/index.ts` in your project
6. Copy the **entire file contents**
7. Paste into the function editor
8. Click **"Deploy"** or **"Save"**

## That's It! ✅

No API keys, no secrets, no accounts needed. Jitsi Meet is completely free and uses public servers.

## How to Test

1. **As a Host:**
   - Create or open an Enlisted Club session
   - Click **"Start Video"** button
   - Video should load (you'll need to grant camera/mic permissions)

2. **As a Participant:**
   - Join a session
   - Click **"Join Video"** when host starts streaming
   - You'll see the host and other participants

## What Already Works

✅ **Code is ready** - App already uses Jitsi (VideoStreamJitsi component)
✅ **Edge Function is ready** - Just needs to be deployed
✅ **No configuration needed** - Jitsi uses public `meet.jit.si` servers

## Troubleshooting

**"Function not found" error?**
- Make sure you deployed `jitsi-create-room` function
- Check it appears in Supabase Dashboard → Edge Functions

**Video not loading?**
- Grant camera/mic permissions when prompted
- Check Edge Function logs in Supabase Dashboard
- Verify room URL is being generated

**Can't see other participants?**
- Make sure both users granted camera permissions
- Check both are in the same session
- Verify network connection

## Cost: $0/month Forever! 🎉

