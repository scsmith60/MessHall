# Enlisted Club Tipping - How It Works

## 💰 For Tippers (Session Participants)

### How to Tip:
1. Join an active Enlisted Club cooking session
2. Tap the **"Tip Host"** button
3. Enter amount ($0.50 - $500.00)
4. Optionally add a message
5. Complete payment via Stripe payment sheet
6. Host receives your tip!

### Where Your Money Goes:
When you tip $10.00:
- **Stripe charges your card:** $10.00
- **$9.00 (90%)** → Goes directly to the host's Stripe Connect account → Their bank account
- **$1.00 (10%)** → Goes to MessHall's Stripe account (platform fee) → MessHall's bank account
- Money is transferred to bank accounts automatically by Stripe (usually within 2-7 business days)

**Important:** The 10% fee comes FROM the tip amount - MessHall doesn't pay anything. You (the tipper) pay the full $10, which gets split automatically.

### Payment Security:
- All payments processed securely through Stripe
- Your card details never touch our servers
- Stripe handles all PCI compliance

---

## 🎯 For Hosts (Session Creators)

### To Receive Tips:
1. Go to **Profile → Monetization**
2. Complete Stripe Connect onboarding:
   - Provide business/personal information
   - Link your bank account
   - Verify your identity (if required)
3. Once approved, you'll receive a `stripe_account_id` saved to your profile
4. Now you can receive tips during sessions!

### How You Get Paid:
1. Participants send tips during your session
2. Stripe creates a payment intent with your account as the destination
3. After payment succeeds, money is automatically transferred to your Stripe account
4. Stripe sends funds to your linked bank account (typically 2-7 business days)
5. You can track all tips in your Stripe Dashboard

### Tips Flow:
```
Participant pays $10.00
    ↓
Platform fee: -$1.00 (10%)
    ↓
You receive: $9.00
    ↓
Stripe transfers to your bank: $9.00
```

### Requirements:
- Must have completed Stripe Connect onboarding
- Must have verified `stripe_account_id` in your profile
- Sessions show a "Tip Host" button only if you're set up

---

## 🔧 Technical Details

### Database Tables:
- `enlisted_club_tips`: Records all tip transactions
- `profiles.stripe_account_id`: Stores each host's Stripe Connect account ID

### Payment Flow:
1. Client calls `enlisted-club-tip` edge function
2. Function validates session, participant, and recipient
3. Function checks if host has `stripe_account_id`
4. Function creates Stripe Payment Intent with:
   - `transfer_data.destination` = host's Stripe account
   - `application_fee_amount` = 10% of tip amount
5. Returns `client_secret` to client
6. Client completes payment via Stripe payment sheet
7. Stripe automatically transfers funds to host's account

### Stripe Connect Setup:
Hosts use Stripe Connect Standard accounts, which allows:
- Direct transfers to their bank account
- Automatic payouts (Stripe handles the transfer)
- Full Stripe dashboard access
- Tax reporting via Stripe

---

## ❓ FAQ

**Q: Can I tip before joining a session?**
A: No, you must be a participant in the session to send tips.

**Q: What if the host hasn't set up payments?**
A: The "Tip Host" button will be disabled with a message explaining they need to complete Stripe onboarding.

**Q: Are tips refundable?**
A: Tips follow standard Stripe refund policies. Contact support for refund requests.

**Q: When does the host get their money?**
A: Stripe typically processes payouts to bank accounts within 2-7 business days after payment.

**Q: What if payment fails?**
A: The tip will be marked as "failed" in the database. You can try again with a different payment method.

**Q: Is there a minimum/maximum tip?**
A: Minimum: $0.50, Maximum: $500.00

---

## 🚀 Setting Up Stripe Connect

### For Platform Owners:
1. Create a Stripe account at https://stripe.com
2. Enable Stripe Connect in your dashboard
3. Get your `STRIPE_SECRET_KEY` from API keys section
4. Add it as a secret to your `enlisted-club-tip` edge function
5. Test with Stripe test mode first!

### For Hosts (done via app):
The onboarding flow is triggered when hosts visit Profile → Monetization and complete the Stripe Connect onboarding link provided by your admin approval system.

