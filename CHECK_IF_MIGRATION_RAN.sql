-- Check if migration already ran - Run this in Supabase SQL Editor first!

-- Check if tables exist
SELECT 'streaming_usage table exists' as status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'streaming_usage'
);

SELECT 'streaming_config table exists' as status
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'streaming_config'
);

-- Check if function exists (even if broken)
SELECT 'get_monthly_usage function exists' as status
WHERE EXISTS (
  SELECT 1 FROM information_schema.routines 
  WHERE routine_schema = 'public' 
  AND routine_name = 'get_monthly_usage'
);

