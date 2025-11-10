# Fix Checklist: Remove 2FA, Add Stripe

## Issue
- 2FA is still showing in the checklist (should be removed)
- Stripe setup is not showing (should be added)

## What Was Changed

### 1. Edge Function (`supabase/functions/eligibility-check/index.ts`)
- ✅ Removed 2FA from `checklistMaster()` function
- ✅ Added Stripe setup item to `checklistMaster()` function

### 2. SQL Function (`supabase/migrations/create_creator_eligibility_check.sql`)
- ✅ 2FA check is already commented out (good)
- ✅ Stripe check is already added (good)

## What You Need To Do

### Step 1: Re-run the SQL Migration
Run this migration again to ensure the function is updated:
```sql
-- Run: supabase/migrations/create_creator_eligibility_check.sql
```

This will recreate the `check_creator_eligibility` function with the latest code.

### Step 2: Redeploy the Edge Function
The edge function needs to be redeployed to pick up the changes:

**Option A: Using Supabase CLI**
```bash
cd supabase
supabase functions deploy eligibility-check
```

**Option B: Using Supabase Dashboard**
1. Go to Edge Functions
2. Find `eligibility-check`
3. Click "Redeploy" or update the code

### Step 3: Clear Cache / Refresh App
- Pull down to refresh the monetization screen
- Or navigate away and back

## Expected Result

After these steps, the checklist should show:
1. ✅ You are 18 or older
2. ✅ No policy strikes in last 90 days
3. ✅ At least 3 published recipes
4. ✅ 500 followers OR 10,000 views (last 30 days)
5. ✅ Account is at least 30 days old
6. ⭕ Stripe payment account is set up (if not set up yet)

**2FA should NOT appear anymore.**

## Verification

After redeploying, check:
1. Open the monetization screen
2. Pull down to refresh
3. Verify 2FA is gone
4. Verify Stripe setup appears (as the last item)

