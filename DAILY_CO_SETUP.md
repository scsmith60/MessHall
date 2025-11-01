# Daily.co Video Integration Setup Guide

## Overview
We're using Daily.co for seamless video streaming in Enlisted Club sessions. Daily.co provides:
- ✅ High-quality video/audio
- ✅ Screen sharing
- ✅ Mobile SDK for React Native
- ✅ Reasonable pricing (free tier + pay-as-you-go)
- ✅ Easy integration with Supabase Edge Functions

## Setup Steps

### 1. Create Daily.co Account
1. Go to https://www.daily.co/
2. Sign up for a free account
3. Navigate to **Dashboard → API Keys**
4. Copy your **API Key** (starts with `XXXXXX`)

### 2. Add Daily API Key to Supabase
1. Go to your Supabase Dashboard
2. Navigate to **Project Settings → Edge Functions → Secrets**
3. Add a new secret:
   - **Name**: `DAILY_API_KEY`
   - **Value**: Your Daily.co API Key
4. Click **Save**

### 3. Deploy Edge Functions
The Edge Functions are already created:
- `supabase/functions/daily-create-room/index.ts` - Creates video rooms
- `supabase/functions/daily-get-token/index.ts` - Generates participant tokens

Deploy them:
```bash
supabase functions deploy daily-create-room
supabase functions deploy daily-get-token
```

### 4. Install React Native Package (Already Done)
```bash
npm install @daily-co/react-native-daily-js
```

## How It Works

### For Hosts:
1. When creating a session (or starting a scheduled one), the host clicks "Start Video"
2. Edge Function creates a Daily.co room
3. Host receives room URL + token
4. Video component loads and host can start streaming

### For Participants:
1. Participant joins session
2. When session goes live, participant automatically gets room token
3. Video component loads showing host and other participants
4. Can toggle camera/mic, react with emojis, tip host

## Pricing
- **Free Tier**: 2,000 participant-minutes/month
- **Paid**: $0.00195 per participant-minute after free tier
- **Example**: 100 participants for 60 minutes = 6,000 minutes = ~$8/month

## Features Enabled
- ✅ Video/audio streaming
- ✅ Screen sharing (host)
- ✅ Participant approval (host can control who joins)
- ✅ Mobile-optimized
- ✅ Chat (using our custom chat system)
- ✅ Reactions (emoji system)

## Testing
1. Create a test session as a host
2. Click "Start Video" button
3. Grant camera/mic permissions
4. Open session in another device/browser as participant
5. Verify video/audio works both ways

## Troubleshooting
- **"API key not configured"**: Check Supabase secrets
- **"Room creation failed"**: Verify Daily.co account is active
- **"Camera not working"**: Check device permissions
- **"Can't see other participants"**: Verify room_id is saved in session

