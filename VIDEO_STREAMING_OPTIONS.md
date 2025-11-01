# Video Streaming Options for Enlisted Club

## Pricing Comparison

### Daily.co ⭐ (Currently Implemented)
- ✅ **Free Tier**: **10,000 participant-minutes/month** (FREE)
- 💰 **Paid**: $0.003 per participant-minute after free tier
- **Examples**:
  - 100 participants × 60 minutes = 6,000 minutes = **FREE** ✅
  - 50 participants × 60 minutes = 3,000 minutes = **FREE** ✅
  - 166 hours of 1-on-1 sessions = **FREE** ✅
- **Monthly cost**: $0 if under 10,000 minutes
- **Requires**: Daily.co API key (free account)

### Jitsi Meet (100% FREE - Alternative Available)
- ✅ **Completely Free**: Unlimited usage forever
- ✅ **Open Source**: Self-hosted or use public servers
- ✅ **No API Keys Required**: Just room URLs
- ✅ **No Limits**: Use as much as you want
- ⚠️ **Setup**: Use public `meet.jit.si` (no setup) or self-host for privacy
- **Files Created**: `supabase/functions/jitsi-create-room/index.ts` and `components/VideoStreamJitsi.tsx`

### VideoSDK.live
- ✅ **Free Tier**: 10,000 minutes/month
- 💰 **Paid**: $0.003 per participant-minute

### Agora.io
- ✅ **Free Tier**: 10,000 minutes/month
- 💰 **Paid**: Variable pricing

### Amazon IVS 💰
- ❌ **No Free Tier**: Paid service
- 💰 **Real-Time**: ~$0.01-0.05 per participant-hour
- 💰 **Low-Latency**: $2/hour (input) + output costs
- **Example**: 50 participants × 1 hour = **$0.50-2.50**
- **Monthly**: ~$20-200+ depending on usage
- ✅ **Enterprise-grade**: Ultra-low latency (<300ms), 10,000+ viewers
- ⚠️ **Complex setup**: Requires AWS integration
- 📱 **React Native SDK**: Available but more complex than Jitsi

**See `AMAZON_IVS_COMPARISON.md` for detailed analysis.**

## Recommendation

**Currently Using: Jitsi Meet ✅** (100% FREE)

**Why Jitsi for Now:**
- ✅ **Zero cost** - No monthly fees, no per-participant charges
- ✅ **Unlimited usage** - Stream as much as you want
- ✅ **Simple setup** - No API keys, no AWS integration
- ✅ **Works great** - Perfect for 10-50 participant sessions

**When to Consider Amazon IVS:**
- 💰 **When making $500+ monthly revenue** from tips
- 📈 **100+ active sessions/month**
- 👥 **Regularly hitting 100+ participants** per session
- ⚡ **Need ultra-low latency** (<300ms critical)

**Cost Comparison:**
- **Jitsi Meet**: $0/month ✅ (CURRENT)
- **Amazon IVS**: $20-200+/month (depends on usage)
- **Daily.co**: $0-50/month (10K free minutes, then $0.003/min)

**See `AMAZON_IVS_COMPARISON.md` for detailed cost analysis.**

