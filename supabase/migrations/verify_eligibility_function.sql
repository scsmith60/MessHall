-- verify_eligibility_function.sql
-- Quick check to see if the function exists and works

-- Check if function exists
SELECT 
  proname as function_name,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc 
WHERE proname = 'check_creator_eligibility';

-- Test the function (replace with a real user ID)
-- SELECT * FROM check_creator_eligibility('00000000-0000-0000-0000-000000000000'::uuid);

