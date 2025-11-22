-- fix_creator_status_constraint.sql
-- Fix the creator_status check constraint to ensure 'approved' is allowed

-- Drop the existing constraint if it exists (in case it was created with wrong values)
ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_creator_status_check;

-- Recreate the constraint with the correct values
ALTER TABLE profiles
ADD CONSTRAINT profiles_creator_status_check 
CHECK (creator_status IS NULL OR creator_status IN ('none', 'eligible', 'applied', 'approved', 'rejected'));

-- Add comment
COMMENT ON CONSTRAINT profiles_creator_status_check ON profiles IS 
'Ensures creator_status is one of: none, eligible, applied, approved, rejected, or NULL';







