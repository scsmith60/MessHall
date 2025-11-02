# Cloudflare Stream Integration Guide

## ✅ What's Been Implemented

1. ✅ **Edge Function** - `cloudflare-create-stream` - Creates live inputs
2. ✅ **Viewer Component** - `VideoStreamCloudflare.tsx` - HLS playback for viewers
3. ✅ **Session Integration** - Updated `[id].tsx` to use Cloudflare Stream
4. ✅ **State Management** - Added Cloudflare Stream state variables

## 🔧 Setup Required

### Step 1: Get Cloudflare Stream Credentials

1. **Sign up for Cloudflare** (if you don't have an account)
   - Go to https://dash.cloudflare.com
   - Create free account (or log in)

2. **Get Your Account ID**
   - Dashboard → Right sidebar → Copy **Account ID**

3. **Create API Token**
   - Go to **My Profile → API Tokens**
   - Click **"Create Token"**
   - Use **"Edit Cloudflare Stream"** template
   - Or create custom token with:
     - Permissions: `Cloudflare Stream:Edit`
     - Account Resources: Your account
   - Copy the token (starts with something like `...`)

### Step 2: Add Secrets to Supabase

1. Go to Supabase Dashboard
2. Navigate to **Edge Functions → cloudflare-create-stream → Settings → Secrets**
3. Add these secrets:
   - **Name:** `CLOUDFLARE_STREAM_API_KEY`
     - **Value:** Your API token from Step 1
   
   - **Name:** `CLOUDFLARE_ACCOUNT_ID`
     - **Value:** Your Account ID from Step 1

### Step 3: Deploy Edge Function

```bash
supabase functions deploy cloudflare-create-stream
```

Or via Supabase Dashboard:
- Go to **Edge Functions**
- Deploy `cloudflare-create-stream`

---

## 📱 How It Works

### For Hosts (Streaming):
1. Host taps "Start Video"
2. Edge function creates Cloudflare Stream live input
3. Returns RTMP URL + stream key
4. **Host needs to stream to RTMP URL** (see Streaming Setup below)
5. Viewers automatically get HLS URL to watch

### For Viewers:
1. Participant taps "Join Video"
2. Gets HLS URL from session (`video_url` field)
3. HLS player loads and plays stream
4. Low latency (~3-5 seconds)

---

## 🎥 Streaming Setup (Host Side)

**IMPORTANT:** Cloudflare Stream requires RTMP streaming from the host.

### Option 1: React Native RTMP Library (Recommended for Mobile)

For mobile streaming, you'll need an RTMP library:

```bash
npm install react-native-vision-camera  # Camera access
npm install @react-native-community/react-native-video  # Optional for reference
```

Then create a streaming component that:
1. Uses camera to capture video
2. Encodes to RTMP format
3. Streams to `rtmp_url` from Cloudflare

**Example structure:**
```typescript
// components/StreamToCloudflare.tsx
import { Camera } from 'react-native-vision-camera';
// Use RTMP library to stream to rtmpUrl
```

### Option 2: Desktop OBS Studio (Alternative)

If hosts prefer desktop:
1. Host opens OBS Studio
2. Add RTMP URL from app as streaming server
3. Start streaming

### Option 3: Hybrid Approach

- **Mobile viewers**: Watch via HLS in app
- **Mobile hosts**: Can use RTMP library OR switch to desktop
- **Desktop hosts**: Use OBS Studio

---

## 💰 Pricing

**Cloudflare Stream Pricing (No Free Tier):**
- **Starter Bundle:** $5/month = 5,000 minutes delivered + storage
- **Creator Bundle:** $50/month = 50,000 minutes delivered + storage
- **Pay-as-you-go:** $1.00 per 1,000 minutes delivered
- **Storage:** $5.00 per 1,000 minutes stored (if recording)

**Example Costs:**
- 5,000 minutes/month = **$5/month** (Starter Bundle) ✅
- 50,000 minutes/month = **$50/month** (Creator Bundle) ✅
- 100,000 minutes/month = **$100/month** (pay-as-you-go) 💰
- 500,000 minutes/month = **$500/month** (pay-as-you-go) 💰

**Note:** No free tier, but cheaper than Daily.co after Daily.co's 10K free minutes.

---

## 🔍 Technical Details

### Cloudflare Stream Live Inputs

When you create a live input:
- Returns `rtmps` URL + stream key (for streaming TO)
- Returns `playback.hls` URL (for viewers to watch)
- Auto-records if configured

### HLS Playback

Viewers watch via HLS (HTTP Live Streaming):
- Low latency: 3-5 seconds
- Adaptive bitrate
- Works on all devices
- Uses HLS.js library for web/mobile

### RTMP Streaming

Hosts stream via RTMPS (secure RTMP):
- Standard RTMP protocol
- Encrypted connection
- Requires RTMP client library
- Mobile RTMP libraries available for React Native

---

## 🐛 Troubleshooting

### "Cloudflare Stream not configured"
→ Check Supabase secrets are named correctly:
- `CLOUDFLARE_STREAM_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`

### "Failed to create stream"
→ Verify API token has correct permissions
→ Check Account ID is correct

### "Stream won't play"
→ Host must be actively streaming to RTMP URL
→ HLS URL only works while stream is live
→ Check stream status in Cloudflare dashboard

### "RTMP streaming not working"
→ Verify RTMP URL and stream key are correct
→ Test RTMP connection with OBS Studio first
→ Check network/firewall allows RTMP traffic

---

## 🚀 Next Steps

1. ✅ **Add Cloudflare credentials** to Supabase secrets
2. ✅ **Deploy edge function**
3. ⚠️ **Implement RTMP streaming** for hosts (mobile library needed)
4. ✅ **Test viewing** - should work immediately with HLS

---

## 📝 Notes

- **Current Status**: Viewer side is complete (HLS playback)
- **Pending**: Host streaming needs RTMP library implementation
- **Workaround**: Hosts can use desktop OBS Studio until mobile RTMP is implemented

The infrastructure is ready - you just need to add the streaming client for hosts!

