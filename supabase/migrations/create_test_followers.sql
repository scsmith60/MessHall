-- create_test_followers.sql
-- Creates 500 follower records for a specific user
-- The eligibility check counts rows in the 'follows' table, NOT profiles.followers
--
-- USAGE: Replace USER_ID_HERE with your actual user UUID

DO $$
DECLARE
  target_user_id UUID := '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID;
  existing_followers INTEGER;
  needed_followers INTEGER;
  available_users INTEGER;
  i INTEGER;
  dummy_user_id UUID;
BEGIN
  -- Count existing followers
  SELECT COUNT(*) INTO existing_followers
  FROM follows
  WHERE following_id = target_user_id;
  
  RAISE NOTICE 'Current followers: %', existing_followers;
  
  needed_followers := 500 - existing_followers;
  
  IF needed_followers <= 0 THEN
    RAISE NOTICE 'Already have 500+ followers!';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Need to create % more followers', needed_followers;
  
  -- Count available users (excluding target user)
  SELECT COUNT(*) INTO available_users
  FROM auth.users
  WHERE id != target_user_id;
  
  RAISE NOTICE 'Available users in system: %', available_users;
  
  -- Strategy 1: Use existing users as followers
  IF available_users > 0 THEN
    INSERT INTO follows (follower_id, following_id, created_at)
    SELECT 
      u.id,
      target_user_id,
      NOW() - (RANDOM() * INTERVAL '30 days')
    FROM auth.users u
    WHERE u.id != target_user_id
      AND NOT EXISTS (
        SELECT 1 FROM follows f 
        WHERE f.follower_id = u.id 
        AND f.following_id = target_user_id
      )
    LIMIT needed_followers
    ON CONFLICT DO NOTHING;
    
    -- Check how many we created
    SELECT COUNT(*) INTO existing_followers
    FROM follows
    WHERE following_id = target_user_id;
    
    needed_followers := 500 - existing_followers;
    RAISE NOTICE 'After using existing users: % followers (need % more)', existing_followers, needed_followers;
  END IF;
  
  -- Strategy 2: If we still need more, create dummy follower records
  -- We'll create records using random UUIDs for followers
  -- Note: This might fail if your follows table has foreign key constraints
  IF needed_followers > 0 THEN
    RAISE NOTICE 'Creating % dummy follower records...', needed_followers;
    
    BEGIN
      -- Create dummy follower records
      -- If your follows table has FK constraints, you may need to create actual user accounts first
      FOR i IN 1..needed_followers LOOP
        BEGIN
          INSERT INTO follows (follower_id, following_id, created_at)
          VALUES (
            gen_random_uuid(), -- Generate a random UUID for follower
            target_user_id,
            NOW() - (RANDOM() * INTERVAL '30 days')
          )
          ON CONFLICT DO NOTHING;
        EXCEPTION WHEN foreign_key_violation THEN
          -- If FK constraint fails, try using existing users in a loop
          -- This will reuse existing users multiple times if needed
          INSERT INTO follows (follower_id, following_id, created_at)
          SELECT 
            u.id,
            target_user_id,
            NOW() - (RANDOM() * INTERVAL '30 days')
          FROM auth.users u
          WHERE u.id != target_user_id
          ORDER BY RANDOM()
          LIMIT 1
          ON CONFLICT DO NOTHING;
        END;
      END LOOP;
      
      RAISE NOTICE '✓ Created dummy follower records';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '⚠ Could not create dummy records: %', SQLERRM;
      RAISE NOTICE '   Error details: %', SQLSTATE;
      RAISE NOTICE '   Alternative: Create 10,000 recipe views instead (see script below)';
    END;
  END IF;
  
  -- Final count
  SELECT COUNT(*) INTO existing_followers
  FROM follows
  WHERE following_id = target_user_id;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Final follower count: %', existing_followers;
  RAISE NOTICE '========================================';
  
  IF existing_followers >= 500 THEN
    RAISE NOTICE '✓ SUCCESS: User now has 500+ followers!';
  ELSE
    RAISE NOTICE '⚠ WARNING: Only % followers created. Need 500.', existing_followers;
    RAISE NOTICE '   Alternative: Create 10,000 recipe views instead (see below)';
  END IF;
  
END $$;

-- Verify the count
SELECT 
  COUNT(*) as follower_count,
  'Need 500+' as requirement,
  CASE 
    WHEN COUNT(*) >= 500 THEN '✓ PASS'
    ELSE '✗ FAIL'
  END as status
FROM follows
WHERE following_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID;

-- Test eligibility
SELECT * FROM check_creator_eligibility('9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID);

