# Fix Stripe Setup Error

## Error: "Edge Function returned a non-2xx status code"

This error occurs when the `admin-resend-stripe-onboarding` function returns an error status (not 200).

## Common Causes & Fixes

### 1. Function Not Deployed
**Symptom**: Function doesn't exist or returns 404/500

**Fix**: Deploy the function
```bash
cd supabase
supabase functions deploy admin-resend-stripe-onboarding
```

### 2. Stripe Secret Key Not Set
**Symptom**: Function returns "Stripe not configured"

**Fix**: Add Stripe secret key as environment variable
1. Go to Supabase Dashboard → Edge Functions → `admin-resend-stripe-onboarding`
2. Click "Settings" or "Secrets"
3. Add secret: `STRIPE_SECRET_KEY` = `sk_test_...` (your Stripe secret key)
4. Save and redeploy

**Or using CLI:**
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_key_here
```

### 3. Missing Service Role Key
**Symptom**: Can't get user email

**Fix**: Service role key should be auto-set, but verify:
- Supabase automatically provides `SUPABASE_SERVICE_ROLE_KEY`
- If missing, check your Supabase project settings

### 4. User Not Found
**Symptom**: Returns "User not found"

**Fix**: 
- Make sure you're logged in
- Check that `user_id` is being passed correctly
- Verify the user exists in `profiles` table

## Quick Debug Steps

1. **Check Function Logs**:
   - Go to Supabase Dashboard → Edge Functions → `admin-resend-stripe-onboarding`
   - Click "Logs" to see error messages
   - Look for the console.log messages we added

2. **Test Function Directly**:
   ```bash
   # Using Supabase CLI
   supabase functions invoke admin-resend-stripe-onboarding \
     --body '{"user_id":"your-user-id-here"}'
   ```

3. **Verify Stripe Key**:
   - Make sure you're using a **test key** (`sk_test_...`) for development
   - Get it from: https://dashboard.stripe.com/test/apikeys

## After Fixing

1. Redeploy the function:
   ```bash
   supabase functions deploy admin-resend-stripe-onboarding
   ```

2. Refresh the app and try again

3. Check the error message - it should now be more descriptive

## Expected Behavior

When working correctly:
1. User taps "Stripe payment account is set up" item
2. Function creates/gets Stripe account
3. Function generates onboarding link
4. Link opens in browser
5. User completes Stripe onboarding

If it fails, you'll now see a more helpful error message explaining what went wrong.

