-- set_4k_views_per_recipe.sql
-- Sets 4,000 views per recipe for a user (for testing eligibility)
-- This spreads views across all the user's public recipes

DO $$
DECLARE
  target_user_id UUID := '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID;
  recipe_count INTEGER;
  total_views INTEGER;
BEGIN
  -- Count user's public recipes
  SELECT COUNT(*) INTO recipe_count
  FROM recipes
  WHERE user_id = target_user_id
    AND is_private = false;
  
  RAISE NOTICE 'Found % public recipes for user', recipe_count;
  
  IF recipe_count = 0 THEN
    RAISE NOTICE 'No public recipes found. Creating 3 test recipes...';
    
    -- Create 3 test recipes if none exist
    FOR i IN 1..3 LOOP
      INSERT INTO recipes (user_id, title, is_private, created_at)
      VALUES (
        target_user_id,
        'Test Recipe ' || i || ' - Eligibility Test',
        false,
        NOW() - (i * INTERVAL '2 days')
      );
    END LOOP;
    
    recipe_count := 3;
    RAISE NOTICE 'Created 3 test recipes';
  END IF;
  
  -- Update each recipe with 4,000 views
  -- Spread the viewed_at dates across the last 30 days
  UPDATE recipes
  SET 
    view_count = 4000,
    viewed_at = NOW() - (RANDOM() * INTERVAL '30 days')
  WHERE user_id = target_user_id
    AND is_private = false;
  
  -- Calculate total views
  SELECT COALESCE(SUM(view_count), 0) INTO total_views
  FROM recipes
  WHERE user_id = target_user_id
    AND is_private = false
    AND viewed_at > NOW() - INTERVAL '30 days';
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Views Set Successfully!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Recipes updated: %', recipe_count;
  RAISE NOTICE 'Views per recipe: 4,000';
  RAISE NOTICE 'Total views (last 30 days): %', total_views;
  RAISE NOTICE 'Requirement: 10,000 views';
  IF total_views >= 10000 THEN
    RAISE NOTICE 'Status: ✓ PASS - Meets requirement!';
  ELSE
    RAISE NOTICE 'Status: ✗ FAIL - Need more recipes or views';
    RAISE NOTICE '   (You need at least 3 recipes with 4,000 views each = 12,000 total)';
  END IF;
  RAISE NOTICE '========================================';
  
END $$;

-- Verify the results
SELECT 
  COUNT(*) as recipes_updated,
  SUM(view_count) as total_views,
  MIN(viewed_at) as oldest_view,
  MAX(viewed_at) as newest_view,
  CASE 
    WHEN SUM(view_count) >= 10000 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as status
FROM recipes
WHERE user_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID
  AND is_private = false
  AND viewed_at > NOW() - INTERVAL '30 days';

-- Show individual recipe view counts
SELECT 
  id,
  title,
  view_count,
  viewed_at,
  CASE 
    WHEN viewed_at > NOW() - INTERVAL '30 days' THEN '✓ Within 30 days'
    ELSE '✗ Older than 30 days'
  END as status
FROM recipes
WHERE user_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID
  AND is_private = false
ORDER BY viewed_at DESC NULLS LAST;

