-- test_eligibility_directly.sql
-- Test the eligibility function directly to see what it's returning

-- Test with your user ID
SELECT * FROM check_creator_eligibility('9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID);

-- Also manually check what the function should see
SELECT 
  'Manual Check' as check_type,
  COUNT(*) as recipe_count,
  SUM(view_count) as total_views,
  COUNT(*) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days') as recipes_within_30d,
  SUM(view_count) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days') as views_within_30d,
  CASE 
    WHEN SUM(view_count) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days') >= 10000 
    THEN '✓ PASS - Has 10,000+ views'
    ELSE '✗ FAIL - Only ' || COALESCE(SUM(view_count) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days'), 0) || ' views'
  END as status
FROM recipes
WHERE user_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID
  AND is_private = false;

-- Check if there are any NULL viewed_at dates that might be causing issues
SELECT 
  COUNT(*) as total_recipes,
  COUNT(view_count) as recipes_with_view_count,
  COUNT(viewed_at) as recipes_with_viewed_at,
  COUNT(*) FILTER (WHERE viewed_at IS NULL) as recipes_with_null_viewed_at,
  COUNT(*) FILTER (WHERE view_count IS NULL OR view_count = 0) as recipes_with_zero_views
FROM recipes
WHERE user_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID
  AND is_private = false;

