-- verify_views_for_eligibility.sql
-- Debug script to check why views aren't being counted for eligibility
-- Replace USER_ID_HERE with your actual user UUID

DO $$
DECLARE
  test_user_id UUID := '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID;
  v_views_30d INTEGER;
  v_followers_count INTEGER;
  recipe_count INTEGER;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Debugging Views for Eligibility';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'User ID: %', test_user_id;
  RAISE NOTICE '';
  
  -- Check if columns exist
  BEGIN
    SELECT COUNT(*) INTO recipe_count
    FROM recipes
    WHERE user_id = test_user_id
      AND is_private = false;
    
    RAISE NOTICE 'Public recipes: %', recipe_count;
    
    -- Check views from recipes table (what the function uses)
    SELECT COALESCE(SUM(view_count), 0) INTO v_views_30d
    FROM recipes
    WHERE user_id = test_user_id
      AND is_private = false
      AND viewed_at > NOW() - INTERVAL '30 days';
    
    RAISE NOTICE 'Views from recipes table (last 30 days): %', v_views_30d;
    
    -- Check views from recipe_metrics view
    SELECT COALESCE(SUM(view_count), 0) INTO v_views_30d
    FROM recipe_metrics
    WHERE recipe_id IN (
      SELECT id FROM recipes 
      WHERE user_id = test_user_id
        AND is_private = false
    )
    AND viewed_at > NOW() - INTERVAL '30 days';
    
    RAISE NOTICE 'Views from recipe_metrics view (last 30 days): %', v_views_30d;
    
    -- Show individual recipe details
    RAISE NOTICE '';
    RAISE NOTICE 'Individual Recipe Details:';
    FOR rec IN 
      SELECT 
        r.id,
        r.title,
        r.view_count as recipes_view_count,
        r.viewed_at as recipes_viewed_at,
        rm.view_count as metrics_view_count,
        rm.viewed_at as metrics_viewed_at,
        CASE 
          WHEN r.viewed_at > NOW() - INTERVAL '30 days' THEN '✓ Within 30 days'
          WHEN r.viewed_at IS NULL THEN '✗ NULL'
          ELSE '✗ Older than 30 days'
        END as recipes_status,
        CASE 
          WHEN rm.viewed_at > NOW() - INTERVAL '30 days' THEN '✓ Within 30 days'
          WHEN rm.viewed_at IS NULL THEN '✗ NULL'
          ELSE '✗ Older than 30 days'
        END as metrics_status
      FROM recipes r
      LEFT JOIN recipe_metrics rm ON rm.recipe_id = r.id
      WHERE r.user_id = test_user_id
        AND r.is_private = false
      ORDER BY r.viewed_at DESC NULLS LAST
    LOOP
      RAISE NOTICE '  Recipe: %', COALESCE(rec.title, 'Untitled');
      RAISE NOTICE '    recipes.view_count: % | recipes.viewed_at: % | %', 
        COALESCE(rec.recipes_view_count, 0),
        COALESCE(rec.recipes_viewed_at::TEXT, 'NULL'),
        rec.recipes_status;
      RAISE NOTICE '    metrics.view_count: % | metrics.viewed_at: % | %', 
        COALESCE(rec.metrics_view_count, 0),
        COALESCE(rec.metrics_viewed_at::TEXT, 'NULL'),
        rec.metrics_status;
    END LOOP;
    
  EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE 'ERROR: view_count or viewed_at columns do not exist!';
    RAISE NOTICE 'Run: add_view_count_to_recipe_metrics.sql';
  END;
  
  -- Check followers
  SELECT COUNT(*) INTO v_followers_count
  FROM follows
  WHERE following_id = test_user_id;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Summary:';
  RAISE NOTICE '  Followers: % / 500', v_followers_count;
  RAISE NOTICE '  Views (recipes table): % / 10,000', v_views_30d;
  RAISE NOTICE '  Requirement: 500 followers OR 10,000 views';
  IF v_followers_count >= 500 OR v_views_30d >= 10000 THEN
    RAISE NOTICE '  Status: ✓ SHOULD PASS';
  ELSE
    RAISE NOTICE '  Status: ✗ FAILING';
  END IF;
  RAISE NOTICE '========================================';
  
  -- Test the actual function
  RAISE NOTICE '';
  RAISE NOTICE 'Testing check_creator_eligibility function...';
  
END $$;

-- Show what the function returns
SELECT * FROM check_creator_eligibility('9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID);

-- Also check the raw data
SELECT 
  'recipes table' as source,
  COUNT(*) as recipe_count,
  SUM(view_count) as total_views,
  COUNT(*) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days') as recipes_within_30d,
  SUM(view_count) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days') as views_within_30d
FROM recipes
WHERE user_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID
  AND is_private = false

UNION ALL

SELECT 
  'recipe_metrics view' as source,
  COUNT(*) as recipe_count,
  SUM(view_count) as total_views,
  COUNT(*) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days') as recipes_within_30d,
  SUM(view_count) FILTER (WHERE viewed_at > NOW() - INTERVAL '30 days') as views_within_30d
FROM recipe_metrics
WHERE recipe_id IN (
  SELECT id FROM recipes 
  WHERE user_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID
    AND is_private = false
);

