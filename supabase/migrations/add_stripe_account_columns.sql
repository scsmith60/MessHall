-- add_stripe_account_columns.sql
-- Adds Stripe Connect account tracking columns to profiles table
-- 
-- Security Note: stripe_account_id is safe to store - it's just an identifier,
-- not a secret key. It cannot be used to access Stripe without the secret API key.
-- However, we still protect it with RLS policies.

-- Add stripe_account_id column (stores the Stripe Connect account ID)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

-- Add details_submitted column (tracks if user completed Stripe onboarding)
-- This is a boolean that indicates whether the user has submitted all required details
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS details_submitted BOOLEAN DEFAULT false;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_account_id 
ON profiles(stripe_account_id) 
WHERE stripe_account_id IS NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN profiles.stripe_account_id IS 
'Stripe Connect account ID (e.g., acct_xxx). Safe to store - this is just an identifier, not a secret key. Used to route payments to the correct Stripe account.';

COMMENT ON COLUMN profiles.details_submitted IS 
'Boolean indicating if user has completed Stripe Connect onboarding and submitted all required details. Updated via webhook or manual verification.';

-- Note: RLS policies should already protect this column since it's in the profiles table
-- Users can only see their own stripe_account_id (if your RLS policies allow it)
-- Admins can see all stripe_account_ids (if your RLS policies allow it)

