# How the System Knows When a User Has Set Up Stripe

## Overview
The system detects when a user has completed Stripe Connect onboarding by checking the `profiles.stripe_account_id` field in the database.

## Security: Is It Safe to Store Stripe Account IDs?

**✅ YES - It's safe to store Stripe account IDs in your database.**

- **Stripe account IDs are NOT sensitive credentials** - they're just identifiers (like `acct_1234567890`)
- They cannot be used to access Stripe accounts or make payments without your secret API key
- They're similar to storing a user ID or email address - public identifiers, not secrets
- **What you should NOT store**: Secret API keys (`sk_...`), webhook signing secrets, or any authentication tokens

**Best Practices:**
- ✅ Store account IDs in database (safe)
- ✅ Use environment variables for API keys (never in database)
- ✅ Protect with RLS policies (users can only see their own)
- ✅ Encrypt database at rest (standard practice)

## Detection Method

### Database Fields
- **Field Name**: `stripe_account_id` (TEXT)
- **Field Name**: `details_submitted` (BOOLEAN)
- **Table**: `profiles`
- **Purpose**: 
  - `stripe_account_id`: Stores the Stripe Connect account ID (e.g., `acct_xxx`)
  - `details_submitted`: Tracks if user completed onboarding (optional, can verify via Stripe API instead)

### How It Works

1. **When User Applies for Monetization**:
   - The `creator-apply` edge function automatically creates a Stripe Connect account
   - The Stripe account ID is saved to `profiles.stripe_account_id`
   - An onboarding link is generated and sent to the user

2. **When User Completes Onboarding**:
   - Stripe sends a webhook notification (if configured)
   - The system can verify the account status by checking:
     - `profiles.stripe_account_id` exists (account was created)
     - `profiles.details_submitted` boolean (if tracked separately)
   - The account status can be verified via Stripe API: `account.details_submitted`

3. **Checking Account Status**:
   ```typescript
   // In code, check like this:
   const { data: profile } = await supabase
     .from('profiles')
     .select('stripe_account_id, details_submitted')
     .eq('id', user_id)
     .maybeSingle();

   const isStripeSetup = !!profile?.stripe_account_id;
   // OR check details_submitted if you track that separately
   const isStripeComplete = profile?.details_submitted === true;
   ```

## Current Implementation

### In Creator Approvals Screen
- Shows: `Stripe: ✅ Onboarded` if `details_submitted || stripe_account_id` exists
- Shows: `Stripe: ⭕ Not done` if neither exists

### In Monetization Screen
- Checks `stripe_account_id` to determine if user can receive tips
- Displays Stripe setup status to the user

### In Tip Processing
- `enlisted-club-tip` function checks for `stripe_account_id` before processing payments
- Returns error if `stripe_account_id` is missing

## Webhook Integration (Optional)

To automatically update `details_submitted` when user completes onboarding:

1. **Set up Stripe Webhook**:
   - Go to Stripe Dashboard → Developers → Webhooks
   - Add endpoint: `https://your-project.supabase.co/functions/v1/stripe-webhook`
   - Subscribe to: `account.updated` event

2. **Create Webhook Handler**:
   ```typescript
   // supabase/functions/stripe-webhook/index.ts
   // Listen for account.updated events
   // When account.details_submitted === true, update profiles.details_submitted
   ```

## Manual Verification

Admins can manually check Stripe account status:
1. Go to Stripe Dashboard → Connect → Accounts
2. Find the account by `stripe_account_id`
3. Check "Details submitted" status in Stripe UI

## Summary

- **Primary Detection**: `profiles.stripe_account_id` field (if exists, account was created)
- **Completion Status**: `profiles.details_submitted` boolean OR verify via Stripe API
- **Auto-Creation**: Happens when user applies for monetization
- **Verification**: Can be done via Stripe API or webhook

