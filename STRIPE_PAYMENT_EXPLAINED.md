# How Stripe Payments Work - Simple Explanation

## 💳 For Tippers (People Sending Tips)

### ✅ **NO Stripe Account Required!**

**Tippers just pay with their credit/debit card:**

1. User taps "Tip" button during a live session
2. Enters tip amount (e.g., $5.00)
3. Optional message
4. Taps "Send $5.00"
5. **Stripe Payment Sheet opens** (native iOS/Android payment UI)
   - User enters card number, expiry, CVC
   - OR uses Apple Pay / Google Pay
   - OR uses saved card (if they've paid before)
6. Payment processes
7. Money is charged to their card

**Where the money comes from:**
- **Their credit/debit card** (same as buying anything online)
- They don't need a Stripe account
- They don't need to sign up for anything
- Just like paying on Amazon, Uber, or any app

---

## 🏦 For Hosts (People Receiving Tips)

### ✅ **Stripe Connect Account Required**

**Hosts need to set up Stripe Connect (one time):**

1. Apply for monetization in the app
2. Admin approves
3. Receive Stripe onboarding link
4. Complete Stripe Connect setup:
   - Personal info (name, email, phone)
   - Bank account details (where money goes)
   - Identity verification (upload ID)
5. Stripe creates a Connect account
6. `stripe_account_id` is saved to their profile
7. **Now they can receive tips!**

**Where the money goes:**
- Tips are automatically transferred to their bank account
- Stripe handles all the transfers
- Typically takes 2-7 business days
- They can see all earnings in Stripe Dashboard

---

## 💰 Payment Flow Breakdown

When someone tips $10.00:

```
Tipper's Card: Charges $10.00
     ↓
Stripe Processes Payment
     ↓
Funds Split Automatically:
     ├─ $1.00 (10%) → MessHall Platform (platform fee)
     └─ $9.00 (90%) → Host's Stripe Connect Account
                       ↓
                  Host's Bank Account (2-7 days later)
```

**Additional Stripe fees:**
- Stripe charges **2.9% + $0.30** per transaction
- These fees are **deducted from the payment amount**
- So the $10 tip actually results in:
  - Stripe fee: ~$0.59 (2.9% + $0.30)
  - Platform fee: $1.00 (10%)
  - Host receives: ~$8.41 (remaining amount)

**Important:** The tipper pays $10.00 total. All fees come from that $10.

---

## 🔒 Security & Privacy

### For Tippers:
- Card details never touch your servers
- Handled directly by Stripe's secure payment sheet
- PCI compliant (Stripe handles all compliance)
- Can use Apple Pay / Google Pay for extra security

### For Hosts:
- Bank account details never shared with MessHall
- Only Stripe sees full banking info
- Host controls their Stripe account
- Can update bank details anytime in Stripe Dashboard

---

## 📱 User Experience

### Tipper Experience:
1. Tap tip button → See modal
2. Enter amount → Tap "Send"
3. Payment sheet appears → Enter card (or use Apple Pay)
4. Confirm payment → Done!
5. See success message → Tip appears in chat

**No account creation, no sign-up, just pay!**

### Host Experience:
1. One-time setup (5-15 minutes):
   - Apply for monetization
   - Complete Stripe onboarding
   - Verify identity
2. After setup:
   - Tips automatically appear
   - Money automatically transfers to bank
   - Can view earnings in Stripe Dashboard

---

## ❓ Common Questions

**Q: Can I tip if I don't have a credit card?**
A: Yes! You can use debit cards, prepaid cards, or digital wallets (Apple Pay, Google Pay).

**Q: Do tippers need to create a Stripe account?**
A: **NO!** Tippers just pay with their card, like any online purchase.

**Q: What if a host doesn't set up Stripe?**
A: The tip button is disabled and shows: "This host hasn't set up payment receiving yet."

**Q: Can hosts tip other hosts?**
A: Yes! Anyone can tip, as long as they're a participant in the session.

**Q: Are there refunds?**
A: Stripe handles refunds. Contact support if needed.

**Q: What about international users?**
A: Stripe supports 46+ countries. Hosts can receive tips in their local currency (converted automatically).

---

## 🎯 Summary

**Tippers:**
- ❌ No Stripe account needed
- ✅ Just pay with card (like any app)
- ✅ Money comes from their card/bank

**Hosts:**
- ✅ Need Stripe Connect account (one-time setup)
- ✅ Money goes to their bank account automatically
- ✅ Can see earnings in Stripe Dashboard

**Platform (MessHall):**
- ✅ Receives 10% platform fee automatically
- ✅ No manual processing needed
- ✅ All handled by Stripe Connect

