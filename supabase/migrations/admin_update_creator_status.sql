-- admin_update_creator_status.sql
-- Database function to update creator status (bypasses RLS)
-- This is a backup method if the Edge Function has issues

CREATE OR REPLACE FUNCTION admin_update_creator_status(
  p_user_id UUID,
  p_status TEXT,
  p_monetize_enabled_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, auth
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- Check if caller is admin
  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM profiles
  WHERE id = auth.uid();
  
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only admins can update creator status';
  END IF;
  
  -- Update the profile
  UPDATE profiles
  SET 
    creator_status = p_status,
    monetize_enabled_at = CASE 
      WHEN p_status = 'approved' AND p_monetize_enabled_at IS NOT NULL 
      THEN p_monetize_enabled_at
      WHEN p_status = 'approved' AND p_monetize_enabled_at IS NULL 
      THEN NOW()
      ELSE monetize_enabled_at  -- Don't change if not approving
    END
  WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found: %', p_user_id;
  END IF;
  
  RETURN TRUE;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION admin_update_creator_status TO authenticated;

-- Add comment
COMMENT ON FUNCTION admin_update_creator_status IS 
'Admin function to update creator_status and monetize_enabled_at. Bypasses RLS using SECURITY DEFINER.';



