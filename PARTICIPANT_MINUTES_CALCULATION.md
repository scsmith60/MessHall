# Participant Minutes - Critical Cost Calculation

## ⚠️ Important: Participant-Minutes Explained

**All streaming services charge per PARTICIPANT-MINUTE, not just minutes.**

### Example:
- **1 session:** Host streams for 30 minutes
- **200 viewers** join and watch
- **Total participant-minutes:** 200 participants × 30 minutes = **6,000 participant-minutes**

**NOT just 30 minutes!**

---

## 💰 Actual Costs with 200 Participants per Stream

### Scenario: 200 participants per session, 30-minute sessions

#### **1 Session (6,000 participant-minutes):**
- Daily.co: **FREE** ✅ (under 10K limit)
- Cloudflare: **$6/month** (6,000 / 1,000 × $1)
- Janus (self-hosted): **$40/month** (fixed cost)

#### **10 Sessions (60,000 participant-minutes):**
- Daily.co: (60,000 - 10,000) × $0.00195 = **$97.50/month**
- Cloudflare: 60,000 / 1,000 × $1 = **$60/month** ✅
- Janus: **$40/month** ✅

#### **50 Sessions (300,000 participant-minutes):**
- Daily.co: (300,000 - 10,000) × $0.00195 = **$565.50/month**
- Cloudflare: 300,000 / 1,000 × $1 = **$300/month** ✅
- Janus: **$40-80/month** ✅ (depending on server size)

#### **100 Sessions (600,000 participant-minutes):**
- Daily.co: (600,000 - 10,000) × $0.00195 = **$1,150.50/month**
- Cloudflare: 600,000 / 1,000 × $1 = **$600/month**
- Janus: **$80-150/month** ✅ (better server needed)

#### **500 Sessions (3,000,000 participant-minutes = 3M):**
- Daily.co: (3,000,000 - 10,000) × $0.00195 = **$5,830.50/month** 💰💰💰
- Cloudflare: 3,000,000 / 1,000 × $1 = **$3,000/month** 💰💰
- Janus: **$150-200/month** ✅ (with CDN)

#### **1,000 Sessions (6,000,000 participant-minutes = 6M):**
- Daily.co: (6,000,000 - 10,000) × $0.00195 = **$11,680.50/month** 💰💰💰💰
- Cloudflare: 6,000,000 / 1,000 × $1 = **$6,000/month** 💰💰💰
- Janus: **$200-300/month** ✅ (with CDN/bandwidth)

---

## 🎯 The Real Problem

**If you're expecting 200 participants per stream, costs scale very quickly!**

### Monthly Scenarios:

| Sessions/Month | Daily.co Cost | Cloudflare Cost | Janus Cost |
|----------------|---------------|-----------------|------------|
| 10 sessions | $97.50 | $60 | $40 ✅ |
| 50 sessions | $565.50 | $300 | $80 ✅ |
| 100 sessions | $1,150.50 | $600 | $150 ✅ |
| 500 sessions | $5,830.50 | $3,000 | $300 ✅ |
| 1,000 sessions | $11,680.50 | $6,000 | $500 ✅ |

**Self-hosted Janus becomes MUCH more attractive at scale!**

---

## 🛡️ Cost Control Strategies

### 1. **Reduce Participant Count (Per Session)**
- Limit concurrent viewers per session (e.g., max 50-100)
- Queue system for overflow
- Multiple simultaneous sessions to spread load

### 2. **Shorter Sessions**
- Keep 30-minute limit ✅ (you already have this)
- Or reduce to 20 minutes?

### 3. **Participant Limits**
- **Max 50 viewers per session** = Much lower costs
- Example: 50 viewers × 30 min = 1,500 participant-minutes
- 100 sessions = 150,000 participant-minutes
  - Daily.co: (150K - 10K) × $0.00195 = **$273/month**
  - Cloudflare: 150K / 1K × $1 = **$150/month**
  - Janus: **$40-80/month** ✅

### 4. **Usage Caps (You Already Have This!)**
- Set monthly limit based on budget
- Auto-disable streaming when limit reached
- Example: 150,000 participant-minutes/month = **$150 max with Cloudflare**

---

## 💡 Recommendations for 200 Participants/Stream

### **Option A: Participant Limit + Usage Cap**
- **Max 100 participants per session** (split popular sessions)
- **Monthly limit: 200,000 participant-minutes** = $200/month with Cloudflare
- Allows ~67 sessions/month with 100 participants each

### **Option B: Self-Hosted Janus (Best for Scale)**
- **Fixed cost: $40-200/month** (regardless of participants)
- **Unlimited usage** once infrastructure is set up
- Best if you expect > 50 sessions/month with 200 participants

### **Option C: Hybrid Approach**
- Use Daily.co free tier: 10K participant-minutes
- Switch to Cloudflare for overflow
- Still capped by usage limit system

---

## 📊 Cost Breakdown Examples

### **Conservative Usage (50 sessions/month, 100 participants each):**
- 50 × 100 × 30 = 150,000 participant-minutes
- Daily.co: **$273/month**
- Cloudflare: **$150/month** ✅
- Janus: **$40/month** ✅

### **Medium Usage (100 sessions/month, 150 participants each):**
- 100 × 150 × 30 = 450,000 participant-minutes
- Daily.co: **$858/month**
- Cloudflare: **$450/month**
- Janus: **$80/month** ✅

### **High Usage (200 sessions/month, 200 participants each):**
- 200 × 200 × 30 = 1,200,000 participant-minutes (1.2M)
- Daily.co: **$2,320.50/month** 💰💰
- Cloudflare: **$1,200/month** 💰
- Janus: **$150/month** ✅ (with CDN)

---

## ✅ Updated Recommendations

Given **200 participants per stream**:

1. **If < 50 sessions/month:** 
   - Use Daily.co or Cloudflare
   - Set usage limit to 300K participant-minutes = $300/month max

2. **If 50-200 sessions/month:**
   - **Self-hosted Janus is best** ($40-200/month vs $300-2,300)
   - Set up Janus server with CDN for reliability

3. **If > 200 sessions/month:**
   - **Absolutely use Janus** ($200-500/month vs $2,300-12,000)
   - Scale infrastructure as needed

---

## 🎯 Immediate Actions

1. **Add participant limit per session** (e.g., max 100)
2. **Adjust monthly usage limit** based on budget
3. **Consider self-hosting** if you expect scale
4. **Monitor participant counts** to forecast costs

**The 30-minute limit helps, but participant count is the real cost driver!**

