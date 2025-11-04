# Stripe Setup Guide for Enlisted Club Tipping

## 💰 Who Pays What?

### The 10% Platform Fee:
**Answer: The 10% fee comes FROM the tip amount, not from Stripe or anyone else.**

When someone tips $10.00:
- **$1.00 (10%)** → Goes to **MessHall** (your platform)
- **$9.00 (90%)** → Goes to the **host** (session creator)

**How it works technically:**
- Stripe charges the tipper the **full $10.00**
- Stripe automatically splits it:
  - Takes $1.00 as `application_fee_amount` → MessHall's Stripe account
  - Transfers $9.00 to host's Stripe Connect account → their bank account

**MessHall doesn't pay anything** - the fee is deducted from what the tipper pays.

---

## 🏢 Where MessHall (Platform) Signs Up

### Step 1: Create Stripe Account
1. Go to https://stripe.com
2. Click **"Sign up"** or **"Get started"**
3. Create your account (use your business email/name)
4. Complete business verification:
   - Business type (Individual/Sole Proprietorship/LLC/etc.)
   - Business address
   - Tax ID (SSN for individuals, EIN for businesses)
   - Bank account for receiving platform fees

### Step 2: Enable Stripe Connect
1. In Stripe Dashboard, go to **Settings → Connect**
2. Click **"Enable Connect"**
3. Choose **"Standard"** accounts (recommended for simplicity)
4. Complete any additional verification Stripe requires

### Step 3: Get API Keys
1. In Stripe Dashboard, go to **Developers → API keys**
2. Copy your **Secret key** (starts with `sk_`)
   - Use **Test mode** keys for development: `sk_test_...`
   - Use **Live mode** keys for production: `sk_live_...`

### Step 4: Add Secret to Supabase
1. Go to your Supabase Dashboard
2. Navigate to **Edge Functions → enlisted-club-tip → Settings**
3. Click **"Secrets"**
4. Add new secret:
   - **Name:** `STRIPE_SECRET_KEY`
   - **Value:** Your Stripe secret key (from Step 3)
5. Click **"Save"**

### Step 5: Set Up Payouts (For Platform Fees)
1. In Stripe Dashboard, go to **Settings → Bank accounts and scheduling**
2. Add your bank account
3. Set payout schedule (daily/weekly/monthly)
4. All platform fees ($1.00 from each $10 tip) will automatically transfer to this account

**That's it for MessHall!** You're now set up to:
- Collect 10% platform fees from tips
- Have fees automatically deposited to your bank account
- See all transactions in Stripe Dashboard

---

## 👤 Where Users Set Up Their Stripe (To Receive Tips)

### Flow Overview:
1. User applies to be a creator (Profile → Monetization → Apply)
2. Admin approves their application
3. Admin sends Stripe Connect onboarding link
4. User completes Stripe onboarding
5. User gets `stripe_account_id` saved to their profile
6. User can now receive tips!

### Detailed Steps:

#### For Users (Hosts/Creators):

**Step 1: Apply for Monetization**
- Go to **Profile → Monetization** (or Account settings)
- Tap **"Apply for Monetization"**
- Wait for admin approval (usually via email)

**Step 2: Get Stripe Onboarding Link**
- After approval, admin will send you a Stripe onboarding link
- This is typically done via:
  - Email (link sent by admin)
  - In-app notification
  - Admin can resend link from their dashboard

**Step 3: Complete Stripe Connect Onboarding**
1. Click the onboarding link (opens Stripe's secure form)
2. Fill out required information:
   - **Personal/Business Info:**
     - Full name
     - Email (usually pre-filled)
     - Phone number
     - Date of birth
   - **Business Details** (if applicable):
     - Business name
     - Business type
     - Tax ID
   - **Bank Account:**
     - Bank routing number
     - Account number
     - Account type (checking/savings)
3. Submit and wait for verification
4. Stripe may require additional verification:
   - Identity verification (upload ID)
   - Business verification (if business account)
   - Tax forms (W-9 in US)

**Step 4: Verification Complete**
- Once verified, Stripe automatically creates a `stripe_account_id`
- This gets saved to your profile in the `profiles.stripe_account_id` column
- You'll receive a confirmation email
- You can now receive tips!

#### For Admins (Creating Onboarding Links):

**Using the Admin Function:**
1. Go to admin dashboard (Owner tab)
2. Navigate to Creator Approvals
3. After approving a creator, you'll see **"Resend Stripe Link"** button
4. Click it → creates onboarding link
5. Share link with creator (email, message, etc.)

**Technical Implementation:**
The `admin-resend-stripe-onboarding` edge function:
```typescript
// Creates a Stripe Connect onboarding link
const accountLink = await stripe.accounts.createLoginLink(accountId);
// or
const onboardingLink = await stripe.accountLinks.create({
  account: accountId,
  type: 'account_onboarding',
  return_url: 'https://yourapp.com/monetization',
  refresh_url: 'https://yourapp.com/monetization',
});
```

**After User Completes Onboarding:**
- Stripe webhook notifies your server
- Your server saves `stripe_account_id` to `profiles` table
- User can now receive tips!

---

## 📊 Money Flow Diagram

```
Participant wants to tip $10.00
         ↓
Taps "Tip Host" button
         ↓
Enters payment info (Stripe Payment Sheet)
         ↓
Stripe charges $10.00 to participant's card
         ↓
Stripe splits the payment:
    ├─ $1.00 → MessHall's Stripe account (platform fee)
    │          └─ Auto-transfers to MessHall's bank (2-7 days)
    │
    └─ $9.00 → Host's Stripe Connect account (90% of tip)
               └─ Auto-transfers to Host's bank (2-7 days)
```

---

## 🔐 Security & Compliance

### What Stripe Handles:
- ✅ PCI compliance (card data security)
- ✅ Fraud prevention
- ✅ Identity verification
- ✅ Tax reporting (1099-K forms for US)
- ✅ Bank transfers
- ✅ Refunds/disputes

### What You (MessHall) Handle:
- ✅ Verifying users can receive tips (check `stripe_account_id`)
- ✅ Platform fee calculation (10%)
- ✅ Recording tip transactions in database
- ✅ Session/host validation

---

## 🧪 Testing

### Test Mode:
1. Use Stripe **test keys** (`sk_test_...`)
2. Use Stripe **test card numbers**:
   - Success: `4242 4242 4242 4242`
   - Decline: `4000 0000 0000 0002`
   - Any future expiry date, any CVC

### Test Connect Accounts:
1. Create test Connect accounts in Stripe Dashboard
2. Test onboarding flow
3. Verify `stripe_account_id` saves correctly
4. Test tip payment flow

---

## 📝 Summary Checklist

### For MessHall (Platform):
- [ ] Create Stripe account at stripe.com
- [ ] Enable Stripe Connect
- [ ] Get Secret API key
- [ ] Add `STRIPE_SECRET_KEY` to Supabase Edge Function secrets
- [ ] Add bank account for payouts
- [ ] Test in test mode first!

### For Users (Hosts):
- [ ] Apply for monetization (Profile → Monetization)
- [ ] Wait for admin approval
- [ ] Receive Stripe onboarding link from admin
- [ ] Complete Stripe Connect onboarding
- [ ] Verify `stripe_account_id` is saved (admin can check)
- [ ] Start receiving tips!

---

## ❓ FAQ

**Q: Does MessHall need to pay Stripe anything?**
A: Stripe charges transaction fees (2.9% + $0.30 per transaction), but these are **deducted from the payment amount** automatically. MessHall doesn't pay anything upfront.

**Q: What if a host hasn't completed Stripe onboarding?**
A: They can't receive tips. The tip button will be disabled with a message explaining they need to complete onboarding first.

**Q: How long does Stripe onboarding take?**
A: Usually 5-15 minutes to fill out, but verification can take 1-3 business days.

**Q: Can hosts see their earnings?**
A: Yes! They can log into their Stripe Dashboard to see all tips, transfers, and payouts.

**Q: What happens to tips if host's Stripe account is suspended?**
A: Stripe will hold the funds. Hosts need to resolve any issues with Stripe directly.

**Q: Can we change the platform fee percentage?**
A: Yes, edit the `application_fee_amount` calculation in `supabase/functions/enlisted-club-tip/index.ts` (line 168).

---

## 🚨 Important Notes

1. **Start in Test Mode:** Always test with Stripe test keys before going live
2. **Webhooks:** Set up Stripe webhooks to sync account status changes
3. **Tax Reporting:** Stripe automatically handles 1099-K forms for US users who earn $600+ per year
4. **Compliance:** Make sure you understand Stripe's terms and local payment regulations
5. **Monitoring:** Check Stripe Dashboard regularly for failed payments, disputes, etc.



