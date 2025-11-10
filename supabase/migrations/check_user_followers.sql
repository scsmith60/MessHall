-- check_user_followers.sql
-- Quick queries to check a user's follower count and eligibility
-- Replace 'YOUR_USER_ID_HERE' with your actual user UUID

-- ============================================
-- QUERY 1: Check follower count
-- ============================================
SELECT 
  COUNT(*) as follower_count,
  'Need 500+' as requirement,
  CASE 
    WHEN COUNT(*) >= 500 THEN '✓ PASS - Has 500+ followers'
    ELSE '✗ FAIL - Only has ' || COUNT(*) || ' followers'
  END as status
FROM follows
WHERE following_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID;

-- ============================================
-- QUERY 2: Check recipe views (alternative requirement)
-- ============================================
SELECT 
  COALESCE(SUM(view_count), 0) as total_views_30d,
  'Need 10,000+' as requirement,
  CASE 
    WHEN COALESCE(SUM(view_count), 0) >= 10000 THEN '✓ PASS - Has 10,000+ views'
    ELSE '✗ FAIL - Only has ' || COALESCE(SUM(view_count), 0) || ' views'
  END as status
FROM recipes
WHERE user_id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID
  AND is_private = false
  AND viewed_at > NOW() - INTERVAL '30 days';

-- ============================================
-- QUERY 3: Check all eligibility requirements
-- ============================================
SELECT * FROM check_creator_eligibility('9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID);

-- ============================================
-- QUERY 4: Detailed status check
-- ============================================
SELECT 
  p.id,
  u.email,
  -- Age check
  CASE 
    WHEN p.birthdate IS NOT NULL AND EXTRACT(YEAR FROM age(p.birthdate)) >= 18 
    THEN '✓ Age 18+' 
    ELSE '✗ Age requirement not met (age: ' || EXTRACT(YEAR FROM age(p.birthdate)) || ')'
  END as age_check,
  -- Account age check
  CASE 
    WHEN (NOW() - u.created_at)::INTEGER >= 30 
    THEN '✓ Account 30+ days old (' || (NOW() - u.created_at)::INTEGER || ' days)'
    ELSE '✗ Account too new (' || (NOW() - u.created_at)::INTEGER || ' days)'
  END as account_age_check,
  -- Recipes check
  (SELECT COUNT(*) FROM recipes WHERE user_id = p.id AND is_private = false) as public_recipes,
  CASE 
    WHEN (SELECT COUNT(*) FROM recipes WHERE user_id = p.id AND is_private = false) >= 3 
    THEN '✓ 3+ recipes' 
    ELSE '✗ Need 3 recipes'
  END as recipes_check,
  -- Followers check
  (SELECT COUNT(*) FROM follows WHERE following_id = p.id) as followers,
  CASE 
    WHEN (SELECT COUNT(*) FROM follows WHERE following_id = p.id) >= 500 
    THEN '✓ 500+ followers' 
    ELSE '✗ Need 500 followers'
  END as followers_check,
  -- Views check (alternative)
  COALESCE((
    SELECT SUM(view_count) 
    FROM recipes 
    WHERE user_id = p.id
      AND is_private = false
      AND viewed_at > NOW() - INTERVAL '30 days'
  ), 0) as views_30d,
  CASE 
    WHEN COALESCE((
      SELECT SUM(view_count) 
      FROM recipes 
      WHERE user_id = p.id
        AND is_private = false
        AND viewed_at > NOW() - INTERVAL '30 days'
    ), 0) >= 10000 
    THEN '✓ 10,000+ views' 
    ELSE '✗ Need 10,000 views'
  END as views_check
FROM profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.id = '9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID;

