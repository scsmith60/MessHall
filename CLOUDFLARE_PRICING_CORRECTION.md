# Cloudflare Stream Pricing Correction

## ❌ Previous Error
I incorrectly stated that Cloudflare Stream offers "100K free minutes/month". **This is not accurate.**

## ✅ Actual Cloudflare Stream Pricing

Based on Cloudflare's current pricing page:

### Bundles:
1. **Starter Bundle:** $5/month
   - 5,000 minutes of video delivered per month
   - 1,000 minutes of video stored
   - Images included

2. **Creator Bundle:** $50/month
   - 50,000 minutes of video delivered per month
   - 10,000 minutes of video stored
   - Images included

### Pay-as-You-Go:
- **$1.00 per 1,000 minutes delivered** (after bundle limits)
- **$5.00 per 1,000 minutes stored** (for recordings)

### No Free Tier
Cloudflare Stream does **not** have a standalone free tier. You must choose:
- A bundle (Starter or Creator)
- Or pay-as-you-go pricing

---

## 📊 Updated Cost Comparison

| Minutes/Month | Daily.co | Cloudflare (PAYG) | Cloudflare Bundle | Janus (Self-hosted) |
|----------------|----------|-------------------|-------------------|---------------------|
| 5,000 | **$0** ✅ | $5 | **$5** (Starter) | **$40** |
| 10,000 | **$0** ✅ | $10 | $10 (PAYG) | **$40** |
| 50,000 | $78 | $50 | **$50** (Creator) ✅ | **$40** ✅ |
| 100,000 | $175.50 | **$100** ✅ | $100 (PAYG) | **$40** ✅ |
| 500,000 | $955 | **$500** ✅ | $500 (PAYG) | **$80** ✅ |
| 1,000,000 | $1,950 | **$1,000** ✅ | $1,000 (PAYG) | **$150** ✅ |

**Best Options:**
- **< 10K minutes:** Daily.co (free) ✅
- **10K-50K minutes:** Cloudflare Creator Bundle ($50/month) ✅
- **50K+ minutes:** Self-hosted Janus ($40-150/month) ✅

---

## 🎯 Updated Recommendation

### For Your Use Case:

1. **Stick with Daily.co** for now (10K free minutes/month)
2. **Use 30-minute session limits** to control costs
3. **Monitor usage** - when you exceed 10K minutes:
   - Switch to Cloudflare Creator Bundle ($50/month for 50K minutes)
   - Or set up self-hosted Janus ($40-150/month unlimited)

### Cost Control Strategy:

With 30-minute session limits:
- Max session duration = 30 minutes
- Default monthly limit = 50,000 minutes (Cloudflare Creator Bundle)
- = Max 1,666 sessions/month at 30 min each
- Cost: **$50/month** (predictable)

This is **much better** than potentially hitting $20K/month with unlimited sessions!

---

## ✅ Files Updated

All documentation has been corrected to reflect actual Cloudflare Stream pricing:
- `BUDGET_FRIENDLY_STREAMING_OPTIONS.md`
- `CLOUDFLARE_STREAM_SETUP.md`
- `SESSION_LIMITS_AND_ADMIN_GUIDE.md`
- `supabase/migrations/add_session_limits_and_admin_kill.sql` (default limit changed to 50K)

---

**Sorry for the confusion!** The 30-minute limit and usage tracking are still the right solutions - they just use different pricing thresholds now.

