-- quick_test_eligible_user.sql
-- Quick script to make a user meet all requirements
-- 
-- USAGE:
-- Option 1: Replace USER_ID_HERE with your actual user UUID
-- Option 2: Use the first user in your system (automatically selected)
--
-- This sets:
-- - Birthdate to 25 years ago (meets 18+ requirement)
-- - Account age to 60 days (meets 30+ days requirement)
-- - Creates 3 published recipes
-- - Creates 500 followers (using existing users or test data)
-- - Ensures no policy strikes

DO $$
DECLARE
  current_user_id UUID;
  recipe_count INTEGER;
  follower_count INTEGER;
  i INTEGER;
BEGIN
  -- Option 1: Use a specific user ID (replace with your actual user ID)
  -- current_user_id := 'USER_ID_HERE'::UUID;
  
  -- Option 2: Automatically use the first user in the system
  SELECT id INTO current_user_id 
  FROM auth.users 
  ORDER BY created_at 
  LIMIT 1;
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'No users found. Please create a user account first.';
  END IF;
  
  RAISE NOTICE 'Setting up test data for user: %', current_user_id;
  
  -- 1. Set birthdate (25 years old)
  INSERT INTO profiles (id, birthdate)
  VALUES (current_user_id, (CURRENT_DATE - INTERVAL '25 years')::DATE)
  ON CONFLICT (id) DO UPDATE 
  SET birthdate = (CURRENT_DATE - INTERVAL '25 years')::DATE;
  RAISE NOTICE '✓ Birthdate set to 25 years ago';
  
  -- 2. Set account age to 60 days
  UPDATE auth.users
  SET created_at = NOW() - INTERVAL '60 days'
  WHERE id = current_user_id;
  RAISE NOTICE '✓ Account age set to 60 days';
  
  -- 3. Create 3 published recipes (if they don't exist)
  SELECT COUNT(*) INTO recipe_count
  FROM recipes
  WHERE user_id = current_user_id AND is_private = false;
  
  IF recipe_count < 3 THEN
    FOR i IN (recipe_count + 1)..3 LOOP
      INSERT INTO recipes (user_id, title, is_private, created_at)
      VALUES (
        current_user_id,
        'Test Recipe ' || i || ' - Eligibility Test',
        false,
        NOW() - (i * INTERVAL '2 days')
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
    RAISE NOTICE '✓ Created % published recipes', (3 - recipe_count);
  ELSE
    RAISE NOTICE '✓ Already have % recipes (need 3)', recipe_count;
  END IF;
  
  -- 4. Create 500 followers
  -- First, count existing followers
  SELECT COUNT(*) INTO follower_count
  FROM follows
  WHERE following_id = current_user_id;
  
  IF follower_count < 500 THEN
    -- Create followers using existing users (excluding self)
    -- This will create up to 500 followers from existing users
    INSERT INTO follows (follower_id, following_id, created_at)
    SELECT 
      u.id,
      current_user_id,
      NOW() - (RANDOM() * INTERVAL '30 days')
    FROM auth.users u
    WHERE u.id != current_user_id
      AND NOT EXISTS (
        SELECT 1 FROM follows f 
        WHERE f.follower_id = u.id 
        AND f.following_id = current_user_id
      )
    LIMIT (500 - follower_count)
    ON CONFLICT DO NOTHING;
    
    -- If we still need more, we could create dummy entries
    -- but for testing, using real users is better
    SELECT COUNT(*) INTO follower_count
    FROM follows
    WHERE following_id = current_user_id;
    
    RAISE NOTICE '✓ Created % followers (target: 500)', follower_count;
    
    IF follower_count < 500 THEN
      RAISE NOTICE '⚠ Only % followers created. You may need more users in the system.', follower_count;
      RAISE NOTICE '   Alternative: Create 10,000 recipe views instead (see below)';
    END IF;
  ELSE
    RAISE NOTICE '✓ Already have % followers', follower_count;
  END IF;
  
  -- 5. Alternative: Create 10,000 views instead of followers
  -- Uncomment this if you prefer views over followers:
  /*
  UPDATE recipes
  SET 
    view_count = 2000, -- 2000 views per recipe
    viewed_at = NOW() - (RANDOM() * INTERVAL '30 days')
  WHERE id IN (
    SELECT id FROM recipes
    WHERE user_id = current_user_id
      AND is_private = false
    LIMIT 5 -- 5 recipes × 2000 = 10,000 total views
  );
  RAISE NOTICE '✓ Created 10,000 recipe views';
  */
  
  -- 6. Remove any policy strikes
  BEGIN
    DELETE FROM policy_strikes WHERE user_id = current_user_id;
    RAISE NOTICE '✓ Removed any policy strikes';
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE '✓ No policy_strikes table (that''s fine)';
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Setup Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Test eligibility:';
  RAISE NOTICE 'SELECT * FROM check_creator_eligibility(''%'');', current_user_id;
  
END $$;

-- Verify the setup (run this separately after the DO block)
-- Replace USER_ID_HERE with the same user ID you used above
/*
SELECT 
  p.id,
  p.birthdate,
  EXTRACT(YEAR FROM age(p.birthdate)) as age,
  (NOW() - u.created_at)::INTEGER as account_age_days,
  (SELECT COUNT(*) FROM recipes WHERE user_id = p.id AND is_private = false) as public_recipes,
  (SELECT COUNT(*) FROM follows WHERE following_id = p.id) as followers,
  CASE 
    WHEN p.birthdate IS NOT NULL AND EXTRACT(YEAR FROM age(p.birthdate)) >= 18 
    THEN '✓ Age 18+' 
    ELSE '✗ Age requirement not met' 
  END as age_check,
  CASE 
    WHEN (NOW() - u.created_at)::INTEGER >= 30 
    THEN '✓ Account 30+ days old' 
    ELSE '✗ Account too new' 
  END as account_age_check,
  CASE 
    WHEN (SELECT COUNT(*) FROM recipes WHERE user_id = p.id AND is_private = false) >= 3 
    THEN '✓ 3+ recipes' 
    ELSE '✗ Need 3 recipes' 
  END as recipes_check,
  CASE 
    WHEN (SELECT COUNT(*) FROM follows WHERE following_id = p.id) >= 500 
    THEN '✓ 500+ followers' 
    ELSE '✗ Need 500 followers' 
  END as followers_check
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.id = 'USER_ID_HERE'::UUID;

-- Test the eligibility function
SELECT * FROM check_creator_eligibility('USER_ID_HERE'::UUID);
*/

