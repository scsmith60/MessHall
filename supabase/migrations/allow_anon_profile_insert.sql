-- allow_anon_profile_insert.sql
-- Allows anonymous users to insert their own profile during signup
-- This is needed because signup happens before the user is fully authenticated

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "anon can insert own profile during signup" ON public.profiles;

-- Create policy that allows anon users to insert a profile with their own id
-- This is safe because they can only set id = auth.uid(), and auth.uid() is set
-- by Supabase auth during the signup process
CREATE POLICY "anon can insert own profile during signup"
ON public.profiles
FOR INSERT
TO anon
WITH CHECK (id = auth.uid());

COMMENT ON POLICY "anon can insert own profile during signup" ON public.profiles IS
'Allows anonymous users to create their own profile during signup. The id must match auth.uid() which is set by Supabase auth.';

