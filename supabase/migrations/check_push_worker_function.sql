-- Check the call_push_worker_http function to see how it's calling http_post
-- This will help us understand why it's failing

SELECT 
  proname,
  pg_get_function_arguments(oid) as arguments,
  pg_get_functiondef(oid) as definition
FROM pg_proc
WHERE proname = 'call_push_worker_http';

-- This will show us the function definition so we can see:
-- 1. What parameters it expects
-- 2. How it's calling http_post
-- 3. What we need to fix



