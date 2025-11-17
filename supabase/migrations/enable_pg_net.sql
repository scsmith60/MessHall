-- Enable pg_net extension to fix http_post errors
-- This is required for the push notification trigger to work
-- Run this in your Supabase SQL editor

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Verify it's enabled
SELECT extname, extversion 
FROM pg_extension 
WHERE extname = 'pg_net';

-- If the above returns a row, pg_net is enabled
-- If it returns no rows, you may need to contact Supabase support
-- as some extensions require special permissions






