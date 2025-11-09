-- fix_eligibility_function_schema.sql
-- Ensure the function is accessible and in the correct schema

-- Make sure the function is in the public schema
ALTER FUNCTION check_creator_eligibility(UUID) SET SCHEMA public;

-- Re-grant permissions (in case they were lost)
GRANT EXECUTE ON FUNCTION public.check_creator_eligibility(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_creator_eligibility(UUID) TO anon;

-- Test the function (replace with a real user ID)
-- SELECT * FROM public.check_creator_eligibility('YOUR_USER_ID_HERE'::uuid);

