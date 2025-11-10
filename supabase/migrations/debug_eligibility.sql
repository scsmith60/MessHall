-- debug_eligibility.sql
-- Debug script to check why eligibility check is failing
-- Replace USER_ID_HERE with your actual user UUID

DO $$
DECLARE
  test_user_id UUID := '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID;
  v_followers_count INTEGER;
  v_views_30d INTEGER;
  v_recipes_count INTEGER;
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Debugging Eligibility for User: %', test_user_id;
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  
  -- Check followers
  SELECT COUNT(*) INTO v_followers_count
  FROM follows
  WHERE following_id = test_user_id;
  
  RAISE NOTICE 'Followers: % (need 500)', v_followers_count;
  
  -- Check recipes
  SELECT COUNT(*) INTO v_recipes_count
  FROM recipes
  WHERE user_id = test_user_id
    AND is_private = false;
  
  RAISE NOTICE 'Public Recipes: % (need 3)', v_recipes_count;
  
  -- Check views
  BEGIN
    SELECT COALESCE(SUM(view_count), 0) INTO v_views_30d
    FROM recipes
    WHERE user_id = test_user_id
      AND is_private = false
      AND viewed_at > NOW() - INTERVAL '30 days';
    
    RAISE NOTICE 'Views (last 30 days): % (need 10,000)', v_views_30d;
    
    -- Show individual recipe view counts
    RAISE NOTICE '';
    RAISE NOTICE 'Individual Recipe View Counts:';
    FOR rec IN 
      SELECT id, title, view_count, viewed_at,
             CASE 
               WHEN viewed_at > NOW() - INTERVAL '30 days' THEN '✓ Within 30 days'
               ELSE '✗ Older than 30 days'
             END as status
      FROM recipes
      WHERE user_id = test_user_id
        AND is_private = false
      ORDER BY viewed_at DESC NULLS LAST
    LOOP
      RAISE NOTICE '  Recipe: % | Views: % | Viewed: % | %', 
        COALESCE(rec.title, 'Untitled'), 
        COALESCE(rec.view_count, 0),
        COALESCE(rec.viewed_at::TEXT, 'NULL'),
        rec.status;
    END LOOP;
    
  EXCEPTION WHEN undefined_column THEN
    RAISE NOTICE 'ERROR: view_count or viewed_at columns do not exist in recipes table!';
    RAISE NOTICE 'Run the migration: add_view_count_to_recipe_metrics.sql';
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Summary:';
  RAISE NOTICE '  Followers: % / 500', v_followers_count;
  RAISE NOTICE '  Views: % / 10,000', v_views_30d;
  RAISE NOTICE '  Requirement: 500 followers OR 10,000 views';
  IF v_followers_count >= 500 OR v_views_30d >= 10000 THEN
    RAISE NOTICE '  Status: ✓ PASS';
  ELSE
    RAISE NOTICE '  Status: ✗ FAIL';
  END IF;
  RAISE NOTICE '========================================';
  
  -- Run the actual eligibility function
  RAISE NOTICE '';
  RAISE NOTICE 'Running check_creator_eligibility function...';
  
END $$;

-- Show the actual function result
SELECT * FROM check_creator_eligibility('9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID);

