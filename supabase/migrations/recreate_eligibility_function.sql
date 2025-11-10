-- recreate_eligibility_function.sql
-- Recreates the check_creator_eligibility function to ensure it has the latest code
-- Run the full create_creator_eligibility_check.sql migration to recreate the function

-- Just run this to recreate the function:
-- The CREATE OR REPLACE in create_creator_eligibility_check.sql will update it

-- But first, let's test what the function currently returns:
SELECT * FROM check_creator_eligibility('9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID);

-- Then manually verify the views calculation:
SELECT 
  'Manual calculation' as check_type,
  SUM(view_count) as total_views_30d,
  COUNT(*) as recipe_count,
  CASE 
    WHEN SUM(view_count) >= 10000 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as status
FROM recipes
WHERE user_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID
  AND is_private = false
  AND viewed_at > NOW() - INTERVAL '30 days';

