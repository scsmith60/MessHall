-- Fix the push notification trigger that's causing http_post errors
-- The trigger trg_call_push_worker_http is trying to use http_post but pg_net isn't enabled

-- Step 1: Enable pg_net extension (required for http_post function)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 2: Check the call_push_worker_http function to see what it's trying to do
-- Run this to see the function definition:
/*
SELECT 
  proname,
  pg_get_function_arguments(oid) as arguments,
  pg_get_functiondef(oid) as definition
FROM pg_proc
WHERE proname = 'call_push_worker_http';
*/

-- Step 3: If enabling pg_net doesn't work or you get permission errors, 
-- temporarily disable the push notification trigger so notifications can be created:
-- ALTER TABLE notifications DISABLE TRIGGER trg_call_push_worker_http;

-- To re-enable it later:
-- ALTER TABLE notifications ENABLE TRIGGER trg_call_push_worker_http;

-- Option B: Modify the function to handle errors gracefully
-- (This would require seeing the function definition first)

-- Note: Our comment notification trigger should still work even if this trigger fails,
-- because it uses exception handling. However, enabling pg_net will fix the error
-- and allow push notifications to work properly.

