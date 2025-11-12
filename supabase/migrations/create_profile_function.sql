-- create_profile_function.sql
-- Creates a database function to safely create or update profiles
-- This function uses SECURITY DEFINER to bypass RLS policies

CREATE OR REPLACE FUNCTION public.create_or_update_profile(
  p_user_id UUID,
  p_username TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  -- Insert or update the profile
  INSERT INTO public.profiles (id, username, email)
  VALUES (p_user_id, p_username, p_email)
  ON CONFLICT (id) 
  DO UPDATE SET 
    username = EXCLUDED.username,
    email = EXCLUDED.email;
  
  -- Return success
  result := jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'username', p_username
  );
  
  RETURN result;
EXCEPTION
  WHEN unique_violation THEN
    -- Username already taken
    RAISE EXCEPTION 'Username already taken';
  WHEN OTHERS THEN
    -- Re-raise with context
    RAISE EXCEPTION 'Failed to create profile: %', SQLERRM;
END;
$$;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.create_or_update_profile(UUID, TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.create_or_update_profile(UUID, TEXT, TEXT) IS 
'Creates or updates a user profile. Uses SECURITY DEFINER to bypass RLS policies. Safe to call during signup.';



