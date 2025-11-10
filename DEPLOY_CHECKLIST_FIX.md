# Deploy Checklist Fix - Remove 2FA, Add Stripe

## Current Issue
- ❌ 2FA is still showing in the checklist
- ❌ Stripe setup is NOT showing
- ✅ All other requirements are working

## Root Cause
The edge function `eligibility-check` hasn't been redeployed with the updated code.

## Solution

### Step 1: Verify Code is Updated
The code is already updated:
- ✅ 2FA removed from `checklistMaster()` in `eligibility-check/index.ts`
- ✅ Stripe added to `checklistMaster()` in `eligibility-check/index.ts`
- ✅ SQL function has Stripe check (already in database)

### Step 2: Redeploy Edge Function

**Option A: Using Supabase CLI (Recommended)**
```bash
cd supabase
supabase functions deploy eligibility-check
```

**Option B: Using Supabase Dashboard**
1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **Edge Functions** in the left sidebar
4. Find `eligibility-check`
5. Click the **"..."** menu → **"Edit"**
6. Copy the contents of `supabase/functions/eligibility-check/index.ts`
7. Paste into the editor
8. Click **"Deploy"**

### Step 3: Verify SQL Function is Updated
Run this to ensure the SQL function has Stripe check:
```sql
-- Run: supabase/migrations/create_creator_eligibility_check.sql
-- This ensures the function checks for stripe_account_id
```

### Step 4: Clear Cache & Refresh
1. Close and reopen the app
2. OR pull down to refresh the monetization screen
3. OR navigate away and back

## Expected Result After Deployment

The checklist should show:
1. ✅ You are 18 or older
2. ✅ No policy strikes in last 90 days
3. ✅ At least 3 published recipes
4. ✅ 500 followers OR 10,000 views (last 30 days)
5. ✅ Account is at least 30 days old
6. ⭕ Stripe payment account is set up (if not set up yet)

**2FA should be completely gone.**

## Verification

After redeploying:
1. Open monetization screen
2. Pull down to refresh
3. Check that 2FA is gone
4. Check that Stripe appears as the last item

If Stripe shows as ✅, it means you already have `stripe_account_id` set in your profile.
If it shows as ⭕, tap it to get the Stripe onboarding link.

