-- create_creator_eligibility_check.sql
-- Creates the check_creator_eligibility PostgreSQL function that checks all monetization requirements
-- Also ensures profiles.creator_status column exists

-- Add creator_status column if it doesn't exist
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS creator_status TEXT CHECK (creator_status IN ('none', 'eligible', 'applied', 'approved', 'rejected'));

-- Create the eligibility check function
CREATE OR REPLACE FUNCTION check_creator_eligibility(p_user UUID)
RETURNS TABLE (
  eligible BOOLEAN,
  missing TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth
AS $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_age_18_plus BOOLEAN := false;
  v_has_2fa BOOLEAN := false;
  v_no_recent_strikes BOOLEAN := true; -- Default to true if no strikes table exists
  v_recipes_count INTEGER := 0;
  v_followers_count INTEGER := 0;
  v_views_30d INTEGER := 0;
  v_account_age_days INTEGER := 0;
  v_user_created_at TIMESTAMPTZ;
  v_birthdate DATE;
BEGIN
  -- Get user creation date
  SELECT created_at INTO v_user_created_at
  FROM auth.users
  WHERE id = p_user;
  
  IF v_user_created_at IS NULL THEN
    -- User doesn't exist
    RETURN QUERY SELECT false, ARRAY['user_not_found']::TEXT[];
    RETURN;
  END IF;
  
  -- Check account age (must be at least 30 days old)
  v_account_age_days := EXTRACT(EPOCH FROM (NOW() - v_user_created_at)) / 86400;
  IF v_account_age_days < 30 THEN
    v_missing := array_append(v_missing, 'account_age_≥_30_days');
  END IF;
  
  -- Check age 18+ (if birthdate column exists in profiles)
  BEGIN
    SELECT birthdate INTO v_birthdate
    FROM profiles
    WHERE id = p_user;
    
    IF v_birthdate IS NOT NULL THEN
      -- Calculate age
      IF EXTRACT(YEAR FROM age(v_birthdate)) >= 18 THEN
        v_age_18_plus := true;
      ELSE
        v_missing := array_append(v_missing, 'age_18_plus');
      END IF;
    ELSE
      -- No birthdate set, assume not eligible (or you could make this optional)
      v_missing := array_append(v_missing, 'age_18_plus');
    END IF;
  EXCEPTION WHEN undefined_column THEN
    -- birthdate column doesn't exist, skip this check (or mark as missing)
    v_missing := array_append(v_missing, 'age_18_plus');
  END;
  
  -- Check 2FA (check auth.mfa_factors table)
  -- Note: This requires access to auth schema, which SECURITY DEFINER should allow
  BEGIN
    SELECT COUNT(*) > 0 INTO v_has_2fa
    FROM auth.mfa_factors
    WHERE user_id = p_user
      AND status = 'verified'
      AND factor_type IN ('totp', 'phone', 'webauthn'); -- Only verified factors
    
    IF NOT v_has_2fa THEN
      v_missing := array_append(v_missing, 'enable_2fa');
    END IF;
  EXCEPTION 
    WHEN undefined_table THEN
      -- MFA table doesn't exist (MFA not enabled in Supabase), mark as missing
      v_missing := array_append(v_missing, 'enable_2fa');
    WHEN insufficient_privilege THEN
      -- Can't access auth schema, mark as missing
      v_missing := array_append(v_missing, 'enable_2fa');
    WHEN OTHERS THEN
      -- Other error, mark as missing to be safe
      v_missing := array_append(v_missing, 'enable_2fa');
  END;
  
  -- Check for recent strikes (if strikes/moderation table exists)
  BEGIN
    SELECT COUNT(*) = 0 INTO v_no_recent_strikes
    FROM policy_strikes
    WHERE user_id = p_user
      AND created_at > NOW() - INTERVAL '90 days';
    
    IF NOT v_no_recent_strikes THEN
      v_missing := array_append(v_missing, 'no_recent_strikes');
    END IF;
  EXCEPTION 
    WHEN undefined_table THEN
      -- No strikes table, skip this check (assume no strikes)
      NULL;
    WHEN OTHERS THEN
      -- Other error, skip this check
      NULL;
  END;
  
  -- Check recipes count (at least 3 published recipes)
  SELECT COUNT(*) INTO v_recipes_count
  FROM recipes
  WHERE user_id = p_user
    AND is_private = false;
  
  IF v_recipes_count < 3 THEN
    v_missing := array_append(v_missing, 'recipes_≥_3');
  END IF;
  
  -- Check followers count
  -- Note: follows table has follower_id (who follows) and following_id (who is followed)
  -- To count followers of p_user, we count rows where following_id = p_user
  SELECT COUNT(*) INTO v_followers_count
  FROM follows
  WHERE following_id = p_user;
  
  -- Check views in last 30 days (if recipe_views table exists)
  BEGIN
    SELECT COALESCE(SUM(view_count), 0) INTO v_views_30d
    FROM recipe_views
    WHERE recipe_id IN (
      SELECT id FROM recipes WHERE user_id = p_user
    )
    AND viewed_at > NOW() - INTERVAL '30 days';
  EXCEPTION 
    WHEN undefined_table THEN
      -- No recipe_views table, use 0
      v_views_30d := 0;
    WHEN OTHERS THEN
      v_views_30d := 0;
  END;
  
  -- Check followers OR views requirement (500 followers OR 10,000 views)
  IF v_followers_count < 500 AND v_views_30d < 10000 THEN
    v_missing := array_append(v_missing, 'followers_≥_500_or_views30d_≥_10000');
  END IF;
  
  -- Return result
  RETURN QUERY SELECT
    array_length(v_missing, 1) IS NULL, -- eligible if no missing items
    v_missing;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION check_creator_eligibility(UUID) TO authenticated;

-- Add comment
COMMENT ON FUNCTION check_creator_eligibility IS 'Checks if a user meets all monetization eligibility requirements. Returns eligible status and list of missing requirement keys.';

