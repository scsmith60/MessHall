# One-Way Streaming Options (Free & Reliable)

Since you're doing **one-way streaming** (host streams, viewers watch) with **local chat**, here are your best options:

---

## 🎯 Quick Comparison

| Service | Free Tier | Latency | Setup Complexity | Reliability | Best For |
|---------|-----------|---------|------------------|-------------|----------|
| **Daily.co (Current)** | 10K min/month | ~1-2s | ⭐ Easy | ⭐⭐⭐⭐⭐ Excellent | Interactive or streaming |
| **YouTube Live** | Unlimited | ~10-30s | ⭐⭐⭐ Complex | ⭐⭐⭐⭐⭐ Excellent | One-way broadcasts |
| **Cloudflare Stream** | 100K min/month | ~3-5s | ⭐⭐ Moderate | ⭐⭐⭐⭐⭐ Excellent | Low-latency streaming |
| **Twitch** | Unlimited | ~5-10s | ⭐⭐ Moderate | ⭐⭐⭐⭐ Good | Gaming/streaming |
| **Owncast** | Free (self-host) | ~5-10s | ⭐⭐⭐⭐ Hard | ⭐⭐⭐ Depends on server | Full control |

---

## 🎬 Option 1: YouTube Live ⭐ (Free, Reliable)

### Pros:
- ✅ **100% Free** - Unlimited streaming
- ✅ **Extremely reliable** - YouTube infrastructure
- ✅ **No limits** - Stream as long as you want
- ✅ **High quality** - Handles any viewer count
- ✅ **Built-in recording** - Automatically saves VODs
- ✅ **Mobile-friendly** - Works great on phones

### Cons:
- ⚠️ **High latency** (10-30 seconds) - Not ideal for interactive cooking
- ⚠️ **Complex setup** - Requires:
  - YouTube channel setup
  - OAuth authentication
  - API keys from Google Cloud
  - Channel verification (can take 24h)
- ⚠️ **Not designed for private streams** - Public by default
- ⚠️ **No viewer count in API** (real-time)

### Setup Required:
1. Create YouTube channel
2. Enable YouTube Data API v3 in Google Cloud
3. Get OAuth credentials
4. Create live broadcast via API
5. Get RTMP stream key
6. Stream from app (requires RTMP library)
7. Embed YouTube player in WebView

### Best For:
- Public cooking shows
- When latency isn't critical (10-30s delay)
- When you want automatic VOD recordings
- When you need unlimited free streaming

---

## 🚀 Option 2: Daily.co Broadcast Mode (Recommended)

### What Changed:
Daily.co supports **broadcast mode** - host streams, viewers watch (one-way)

### Pros:
- ✅ **Already set up** - Just change config
- ✅ **Low latency** (~1-2 seconds)
- ✅ **Simple** - Same code, different mode
- ✅ **10K free minutes/month**
- ✅ **Private streams** - Only invited participants
- ✅ **Mobile-optimized** - Built for React Native

### Implementation:
Just modify your Daily.co room config to use broadcast mode:

```typescript
// In daily-create-room function
properties: {
  enable_screenshare: true,
  enable_chat: false, // You have your own chat
  start_video_off: false,
  start_audio_off: false,
  max_participants: session.max_participants || 50,
  // NEW: Broadcast mode
  enable_broadcast: true,
  enable_recording: false, // Optional
}
```

### Best For:
- **Your use case** - Already working, just needs config change
- Low latency needed
- Private sessions
- React Native mobile apps

---

## ☁️ Option 3: Cloudflare Stream (Best Latency)

### Pros:
- ✅ **100K free minutes/month** (10x Daily.co)
- ✅ **Low latency** (~3-5 seconds)
- ✅ **Reliable** - Cloudflare CDN
- ✅ **Easy embedding** - WebView-friendly
- ✅ **HLS streaming** - Works everywhere

### Cons:
- ⚠️ **Requires Cloudflare account**
- ⚠️ **RTMP ingest needed** (from app)
- ⚠️ **More setup** than Daily.co

### Best For:
- When you exceed Daily.co's 10K minutes
- Need lower latency than YouTube
- Want CDN-level reliability

---

## 🎮 Option 4: Twitch (Free but Gaming-Focused)

### Pros:
- ✅ **100% Free** - Unlimited
- ✅ **Reliable** - Big infrastructure
- ✅ **5-10s latency** - Better than YouTube

### Cons:
- ⚠️ **Gaming-focused** - Not ideal for cooking
- ⚠️ **Public streams** - Hard to make private
- ⚠️ **OAuth setup** - Similar to YouTube

### Best For:
- Public cooking streams
- When you want Twitch's audience

---

## 💡 My Recommendation

### For Your Use Case (One-Way + Local Chat):

**Stick with Daily.co but use Broadcast Mode** ⭐

Why:
1. ✅ Already working in your codebase
2. ✅ Low latency (crucial for cooking)
3. ✅ Just need config change (not a rewrite)
4. ✅ 10K free minutes/month is generous
5. ✅ Private streams
6. ✅ Mobile-optimized

**If you exceed 10K minutes/month:**
- Consider Cloudflare Stream (10x free tier)
- Or YouTube Live (unlimited, but high latency)

---

## 🔧 Quick Implementation: Daily.co Broadcast Mode

Here's the simple change needed:

### Update `supabase/functions/daily-create-room/index.ts`:

```typescript
// Change this part:
body: JSON.stringify({
  name: roomName,
  privacy: "public",
  properties: {
    exp: expiresAt,
    enable_screenshare: true,
    enable_chat: false, // ✅ You have local chat
    enable_knocking: true,
    start_video_off: false,
    start_audio_off: false,
    max_participants: session.max_participants || 50,
    // NEW: One-way broadcast mode
    enable_broadcast: true,
    // Optional: Set host as broadcaster, others as viewers
    enable_recording: false,
  },
}),
```

### Participants join as "viewers" (not interactive):
- Host: Streams video/audio
- Participants: Watch only (one-way)
- Chat: Handled in your app (already working)

---

## 📊 Latency Comparison for Cooking Sessions

| Service | Latency | Impact on Cooking |
|---------|---------|-------------------|
| Daily.co | 1-2s | ✅ Perfect - can follow along |
| Cloudflare | 3-5s | ✅ Good - slight delay |
| Twitch | 5-10s | ⚠️ Noticeable delay |
| YouTube | 10-30s | ❌ Too much delay for interactive |

**For cooking sessions, latency matters!** Participants need to see what host is doing in near-real-time.

---

## 🎯 Final Recommendation

**Keep Daily.co, enable broadcast mode** - Best balance of:
- ✅ Free (10K minutes/month)
- ✅ Low latency (1-2s)
- ✅ Already working
- ✅ Simple config change
- ✅ Private streams
- ✅ Mobile-optimized

YouTube Live is great for public broadcasts with 10-30s delay, but not ideal for interactive cooking sessions where timing matters.

Want me to implement the Daily.co broadcast mode changes?

