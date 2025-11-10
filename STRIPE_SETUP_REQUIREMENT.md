# Stripe Setup as Required Checklist Item

## Overview
Stripe payment account setup is now a **required** step before users can apply for monetization. Users must complete Stripe onboarding before their application can be submitted.

## Implementation

### 1. SQL Function Check
The `check_creator_eligibility` function now checks for `stripe_account_id`:
- If `stripe_account_id` is NULL → adds `'stripe_account_setup'` to missing requirements
- User cannot apply until this requirement is met

### 2. Checklist Display
The eligibility checklist shows:
- **Label**: "Stripe payment account is set up"
- **Help**: "You need to complete Stripe onboarding to receive payments. This is the final step before applying."
- **Action**: Tappable item that opens Stripe onboarding link

### 3. User Flow

**When user checks eligibility:**
1. Checklist shows all requirements including Stripe setup
2. If Stripe not set up → shows as ❌ with tappable option
3. User taps → system creates/gets Stripe account and onboarding link
4. Link opens in browser → user completes Stripe onboarding
5. After completion → `stripe_account_id` is saved to profile
6. User refreshes checklist → Stripe requirement shows ✅
7. User can now apply

**When user applies:**
1. System automatically creates Stripe account if it doesn't exist
2. Generates onboarding link
3. Opens link automatically in browser
4. Sends email with link (if email service configured)
5. User completes Stripe setup
6. Application is submitted

**When admin resends link:**
1. Admin clicks "Resend Stripe Link" button
2. System creates/gets Stripe account
3. Generates new onboarding link
4. Sends email to user with link
5. Returns link for admin to share manually if needed

## Email Integration

Currently, email sending is **prepared but not fully implemented**. The functions log email details but don't actually send emails yet.

### To Enable Email Sending:

**Option 1: Resend (Recommended)**
1. Sign up at https://resend.com
2. Get your API key
3. Add to Supabase Edge Function secrets: `RESEND_API_KEY`
4. Uncomment the Resend code in:
   - `supabase/functions/admin-resend-stripe-onboarding/index.ts`
   - `supabase/functions/creator-apply/index.ts`

**Option 2: SendGrid**
1. Sign up at https://sendgrid.com
2. Get your API key
3. Add to Supabase Edge Function secrets: `SENDGRID_API_KEY`
4. Implement SendGrid API calls

**Option 3: Supabase SMTP**
1. Configure SMTP in `supabase/config.toml`
2. Use Supabase's built-in email templates

## Database Schema

Required columns in `profiles` table:
- `stripe_account_id` (TEXT) - Stores Stripe Connect account ID
- `details_submitted` (BOOLEAN) - Optional flag for onboarding completion

Run migration: `supabase/migrations/add_stripe_account_columns.sql`

## Testing

1. Check eligibility → should show Stripe requirement if not set up
2. Tap Stripe requirement → should open onboarding link
3. Complete Stripe onboarding → should update `stripe_account_id`
4. Check eligibility again → Stripe requirement should show ✅
5. Apply → should work now that all requirements are met

## Notes

- Stripe account IDs are safe to store (they're just identifiers, not secrets)
- Onboarding links expire after 24 hours
- Users can get new links by tapping the checklist item or asking admin
- Email sending is optional but recommended for better UX

