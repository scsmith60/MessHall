-- test_meet_all_requirements.sql
-- This script sets up a test user to meet ALL monetization eligibility requirements
-- 
-- USAGE:
-- 1. Replace 'YOUR_USER_ID_HERE' with an actual user UUID from auth.users
-- 2. Run this migration: npx supabase migration up
--    OR run directly in SQL Editor: paste this and replace the user ID
--
-- This will:
-- - Set birthdate to make user 25 years old
-- - Create 3 published recipes
-- - Create 500 followers
-- - Set account created_at to 60 days ago
-- - Ensure no policy strikes

-- ============================================
-- STEP 1: Replace this with your test user ID
-- ============================================
-- Get a user ID from: SELECT id, email FROM auth.users LIMIT 1;
DO $$
DECLARE
  test_user_id UUID;
  recipe_id_1 UUID;
  recipe_id_2 UUID;
  recipe_id_3 UUID;
  follower_id UUID;
  i INTEGER;
BEGIN
  -- ============================================
  -- REPLACE THIS WITH YOUR ACTUAL USER ID
  -- ============================================
  -- Option 1: Use a specific user ID
  -- test_user_id := 'YOUR_USER_ID_HERE'::UUID;
  
  -- Option 2: Use the first user in the system
  SELECT id INTO test_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  
  IF test_user_id IS NULL THEN
    RAISE EXCEPTION 'No users found. Please create a user account first.';
  END IF;
  
  RAISE NOTICE 'Setting up test data for user: %', test_user_id;
  
  -- ============================================
  -- STEP 2: Set birthdate (25 years old)
  -- ============================================
  UPDATE profiles
  SET birthdate = (CURRENT_DATE - INTERVAL '25 years')::DATE
  WHERE id = test_user_id;
  
  IF NOT FOUND THEN
    -- Create profile if it doesn't exist
    INSERT INTO profiles (id, birthdate)
    VALUES (test_user_id, (CURRENT_DATE - INTERVAL '25 years')::DATE)
    ON CONFLICT (id) DO UPDATE SET birthdate = (CURRENT_DATE - INTERVAL '25 years')::DATE;
  END IF;
  
  RAISE NOTICE '✓ Set birthdate to 25 years ago';
  
  -- ============================================
  -- STEP 3: Set account age to 60 days old
  -- ============================================
  UPDATE auth.users
  SET created_at = NOW() - INTERVAL '60 days'
  WHERE id = test_user_id;
  
  RAISE NOTICE '✓ Set account created_at to 60 days ago';
  
  -- ============================================
  -- STEP 4: Create 3 published recipes
  -- ============================================
  -- Check if recipes table exists and has required columns
  BEGIN
    -- Recipe 1
    INSERT INTO recipes (user_id, title, is_private, created_at)
    VALUES (
      test_user_id,
      'Test Recipe 1 - Meets Requirements',
      false,
      NOW() - INTERVAL '10 days'
    )
    RETURNING id INTO recipe_id_1;
    
    -- Recipe 2
    INSERT INTO recipes (user_id, title, is_private, created_at)
    VALUES (
      test_user_id,
      'Test Recipe 2 - Meets Requirements',
      false,
      NOW() - INTERVAL '8 days'
    )
    RETURNING id INTO recipe_id_2;
    
    -- Recipe 3
    INSERT INTO recipes (user_id, title, is_private, created_at)
    VALUES (
      test_user_id,
      'Test Recipe 3 - Meets Requirements',
      false,
      NOW() - INTERVAL '5 days'
    )
    RETURNING id INTO recipe_id_3;
    
    RAISE NOTICE '✓ Created 3 published recipes';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠ Could not create recipes: %', SQLERRM;
    -- Recipes might already exist, that's okay
  END;
  
  -- ============================================
  -- STEP 5: Create 500 followers
  -- ============================================
  -- We'll create fake follower records
  -- Note: This assumes the follows table structure
  BEGIN
    -- Delete existing follows to start fresh
    DELETE FROM follows WHERE following_id = test_user_id;
    
    -- Create 500 fake followers
    -- We'll use a loop to create follower records
    -- Note: In a real scenario, these would be real user IDs
    -- For testing, we'll create them using a pattern
    
    -- First, get or create some test follower users
    FOR i IN 1..500 LOOP
      -- Try to use existing users as followers, or create test data
      -- This is a simplified version - you might need to adjust based on your schema
      BEGIN
        INSERT INTO follows (follower_id, following_id, created_at)
        SELECT 
          u.id,
          test_user_id,
          NOW() - (RANDOM() * INTERVAL '30 days')
        FROM auth.users u
        WHERE u.id != test_user_id
        ORDER BY RANDOM()
        LIMIT 1
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        -- If we run out of users, create a dummy entry
        -- Adjust this based on your actual follows table structure
        NULL;
      END;
    END LOOP;
    
    RAISE NOTICE '✓ Created 500 followers (or as many as possible with existing users)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠ Could not create followers: %', SQLERRM;
    RAISE NOTICE '   You may need to manually create follower records';
  END;
  
  -- ============================================
  -- STEP 6: Ensure no policy strikes
  -- ============================================
  BEGIN
    DELETE FROM policy_strikes WHERE user_id = test_user_id;
    RAISE NOTICE '✓ Ensured no policy strikes';
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE '✓ No policy_strikes table (that''s fine)';
  END;
  
  -- ============================================
  -- STEP 7: Verify the setup
  -- ============================================
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Test Setup Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'User ID: %', test_user_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Now test the eligibility check:';
  RAISE NOTICE 'SELECT * FROM check_creator_eligibility(''%'');', test_user_id;
  RAISE NOTICE '';
  
END $$;

-- ============================================
-- VERIFICATION QUERY
-- ============================================
-- Run this after the script to verify everything worked:
/*
SELECT 
  p.id,
  p.birthdate,
  EXTRACT(YEAR FROM age(p.birthdate)) as age,
  (NOW() - u.created_at)::INTEGER as account_age_days,
  (SELECT COUNT(*) FROM recipes WHERE user_id = p.id AND is_private = false) as public_recipes,
  (SELECT COUNT(*) FROM follows WHERE following_id = p.id) as followers
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.id = 'YOUR_USER_ID_HERE';
*/

