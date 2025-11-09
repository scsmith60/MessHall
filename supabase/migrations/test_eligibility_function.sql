-- test_eligibility_function.sql
-- Test the check_creator_eligibility function directly
-- Replace the UUID with a real user ID from your auth.users table

-- First, get a test user ID
SELECT id, email FROM auth.users LIMIT 1;

-- Then test the function (replace with actual user ID)
-- Example:
-- SELECT * FROM check_creator_eligibility('00000000-0000-0000-0000-000000000000'::uuid);

-- Or test with your own user ID (if you know it)
-- SELECT * FROM check_creator_eligibility(auth.uid());

-- Check permissions
SELECT 
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  r.rolname as granted_to
FROM pg_proc p
JOIN pg_proc_acl a ON p.oid = a.oid
JOIN pg_roles r ON a.grantee = r.oid
WHERE p.proname = 'check_creator_eligibility';

