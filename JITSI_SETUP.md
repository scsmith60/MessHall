# Jitsi Meet Setup Guide (100% FREE, No API Keys!)

## Why Jitsi?
- ✅ **Completely Free Forever**: No limits, no monthly fees
- ✅ **No API Keys**: Just generate room URLs
- ✅ **No Setup Required**: Uses public `meet.jit.si` servers
- ✅ **Unlimited Usage**: Stream as much as you want

## Setup Steps (Super Simple!)

### 1. Deploy the Edge Function

That's it! No API keys, no accounts, nothing else needed.

**Using Supabase CLI:**
```bash
cd c:\Dev\MessHall
supabase functions deploy jitsi-create-room
```

**OR using Supabase Dashboard:**
1. Go to Supabase Dashboard → Edge Functions
2. Click "Create a new function"
3. Name: `jitsi-create-room`
4. Copy/paste code from `supabase/functions/jitsi-create-room/index.ts`
5. Deploy

### 2. That's It!

Seriously, that's all you need. Jitsi Meet uses public servers at `meet.jit.si`, so:
- ✅ No API keys to configure
- ✅ No secrets to add
- ✅ No accounts to create
- ✅ Just deploy and use!

## How It Works

1. **Host clicks "Start Video"**
   - Edge Function generates unique Jitsi room URL
   - Room URL saved to session
   - Video loads immediately

2. **Participants click "Join Video"**
   - Gets room URL from session
   - Joins same Jitsi room
   - Can see host and other participants

3. **Everyone streams for free!**
   - Unlimited participants
   - Unlimited minutes
   - Unlimited sessions

## Room URLs

Jitsi rooms look like:
- `https://meet.jit.si/enlisted-abc123-xyz`

Each session gets a unique room that only session participants can access.

## Privacy Note

Using public `meet.jit.si` means:
- ✅ Completely free
- ⚠️ Using Jitsi's public infrastructure
- ✅ No data stored by Jitsi (meetings are ephemeral)

**For production with privacy concerns**: You can self-host Jitsi later (same code, just point to your server).

## Troubleshooting

**Video not loading?**
- Check Edge Function is deployed
- Verify room URL is being generated
- Check browser console for errors

**Can't see other participants?**
- Make sure camera/mic permissions are granted
- Verify both users are in the same room
- Check network connection

## Next Steps (Optional)

If you grow and want more control:
1. **Self-host Jitsi**: Run your own server (~$10-20/month)
2. **Switch to Daily.co**: When you're making money, upgrade for better features
3. **Keep using public Jitsi**: It's free forever!

## Cost Summary

**Current Setup**: $0/month ✅
**Forever**: $0/month ✅

