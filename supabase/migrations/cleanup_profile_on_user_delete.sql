-- cleanup_profile_on_user_delete.sql
-- Ensures we remove leftover profile rows whenever a Supabase auth user is deleted.
-- Without this, deleting a user from Auth leaves public.profiles rows behind.
-- Those stale rows keep their unique email value, so re-signing up with the same
-- address throws "Database error finding user" (HTTP 500) during auth.signup.

-- Function that deletes the profile for the user being removed.
CREATE OR REPLACE FUNCTION public.handle_deleted_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete profile row that matches the auth.users primary key.
  DELETE FROM public.profiles WHERE id = OLD.id;
  RETURN OLD;
END;
$$;

-- Trigger that fires after an auth.users row is deleted.
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deleted_user();

COMMENT ON FUNCTION public.handle_deleted_user() IS
'Deletes the matching public.profiles row when an auth user is removed to avoid stale unique emails.';

