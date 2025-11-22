-- Complete fix for notification system
-- This enables pg_net so push notifications work for comment notifications
-- (Planner meal reminders use local device notifications and don't need this)

-- Step 1: Enable pg_net extension
-- Note: In Supabase, you may need to enable this via Dashboard -> Database -> Extensions
-- If you get a permission error, use the Dashboard instead
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 2: Verify pg_net is enabled
SELECT 
  extname, 
  extversion,
  CASE 
    WHEN extname = 'pg_net' THEN '✅ pg_net is enabled'
    ELSE '❌ pg_net is NOT enabled'
  END as status
FROM pg_extension 
WHERE extname = 'pg_net';

-- Step 3: Verify http_post function exists
SELECT 
  proname,
  pg_get_function_arguments(oid) as arguments
FROM pg_proc
WHERE proname = 'http_post';

-- If the above queries return rows, everything is set up correctly!
-- If they return no rows, you need to enable pg_net via Supabase Dashboard:
-- 1. Go to Dashboard -> Database -> Extensions
-- 2. Search for "pg_net"
-- 3. Click "Enable"

-- After enabling, test by adding a comment and checking if notifications are created







