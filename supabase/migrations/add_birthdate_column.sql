-- add_birthdate_column.sql
-- Adds birthdate column to profiles table for age verification

-- Add birthdate column if it doesn't exist (for age verification)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS birthdate DATE;

-- Add comment for documentation
COMMENT ON COLUMN profiles.birthdate IS 'User birthdate for age verification (must be 18+ for monetization)';

