-- Fix for http_post error when inserting notifications
-- This error occurs when another trigger on notifications table tries to call http_post
-- which doesn't exist or has the wrong signature

-- Option 1: Enable pg_net extension (if you need HTTP requests from triggers)
-- This is the recommended solution if you want push notifications to work
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Option 2: Check what triggers exist on notifications table
-- Run this to see all triggers:
/*
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled,
  pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger 
WHERE tgrelid = 'notifications'::regclass
AND tgisinternal = false;
*/

-- Option 3: If there's a push notification trigger that's failing,
-- you can temporarily disable it to test:
-- ALTER TABLE notifications DISABLE TRIGGER <trigger_name>;

-- Option 4: If the http_post function exists but has wrong signature,
-- check the actual function signature:
/*
SELECT 
  proname,
  pg_get_function_arguments(oid) as arguments,
  pg_get_functiondef(oid) as definition
FROM pg_proc
WHERE proname LIKE '%http%' OR proname LIKE '%post%';
*/

-- For now, our trigger function catches exceptions so the INSERT should still succeed
-- even if another trigger fails. The notification will be created, but the push/webhook
-- might not fire until the http_post issue is resolved.

