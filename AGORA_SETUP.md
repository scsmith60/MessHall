# Agora Video SDK Setup Guide

## Why Agora?

✅ **Native React Native SDK** - NO WebView, no permission issues!  
✅ **10,000 FREE minutes/month** - More than enough for testing  
✅ **Battle-tested** - Used by millions of users  
✅ **Low latency** - ~400ms globally  
✅ **Easy setup** - ~30 minutes  

---

## Step 1: Get Agora Account & App ID

1. Go to https://console.agora.io/
2. Sign up for free account
3. Create a new project
4. Copy your **App ID** (you'll need this)
5. Copy your **App Certificate** (optional, for secure tokens)

---

## Step 2: Install Agora SDK

```bash
npm install react-native-agora
```

For iOS, also install pods:
```bash
cd ios && pod install && cd ..
```

---

## Step 3: Configure Android

Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.BLUETOOTH" />
```

---

## Step 4: Configure iOS

The SDK should handle permissions automatically, but ensure you have:
- Camera usage description in `Info.plist`
- Microphone usage description in `Info.plist`

(These should already be in your app.json)

---

## Step 5: Add Agora App ID to Supabase

Add to Supabase Edge Function secrets:
```
AGORA_APP_ID=your_app_id_here
AGORA_APP_CERTIFICATE=your_app_certificate_here (optional)
```

---

## Step 6: Update Your Code

### In `app/enlisted-club/[id].tsx`:

```typescript
import VideoStreamAgora from "../../components/VideoStreamAgora";

// Replace VideoStreamJitsiFixed with:
<VideoStreamAgora
  appId={AGORA_APP_ID} // Get from Supabase secrets or environment
  channelName={channelName} // From agora-create-room response
  token={token} // Optional, for secure channels
  isHost={isHost}
  displayName={userProfile?.username}
  onError={(error) => {
    setNotice({
      visible: true,
      title: "Video Error",
      message: error,
    });
  }}
  onReady={() => {
    setVideoReady(true);
  }}
/>
```

### Update `startVideo` function:

```typescript
const { data, error } = await supabase.functions.invoke("agora-create-room", {
  body: { session_id: id, user_id: userId },
});

if (error || !data?.ok) {
  // Handle error
  return;
}

const channelName = data.channel_name;
// Use channelName with VideoStreamAgora component
```

---

## Step 7: Deploy Edge Function

```bash
supabase functions deploy agora-create-room
```

---

## Pricing

- **FREE:** 10,000 minutes/month
- **After free tier:** $3.99 per 1,000 minutes (video)
- **Example:** 50 users × 60 min = 3,000 min = **FREE** ✅

---

## Key Advantages Over Jitsi

1. ✅ **Native SDK** - No WebView permission issues
2. ✅ **Better performance** - Lower latency, better quality
3. ✅ **More reliable** - Enterprise-grade infrastructure
4. ✅ **Better mobile support** - Designed for React Native
5. ✅ **Easy to integrate** - Well-documented SDK

---

## Next Steps

1. Install SDK: `npm install react-native-agora`
2. Get App ID from Agora console
3. Add to Supabase secrets
4. Deploy edge function
5. Update component imports
6. Test!

---

## Troubleshooting

**"App ID not found"**  
→ Make sure you added `AGORA_APP_ID` to Supabase secrets

**"Permission denied"**  
→ Check Android manifest permissions

**"Can't see video"**  
→ Make sure you're calling `enableVideo()` before joining channel

**Need tokens for production?**  
→ See Agora docs for token generation (uses App Certificate)

---

**You're done! No more WebView permission issues!** 🎉

