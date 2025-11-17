-- Require approved creator status to create Enlisted Club sessions
-- This ensures only vetted creators can host sessions and receive tips

-- Drop the old policy that allowed any authenticated user
DROP POLICY IF EXISTS "Authenticated users can create sessions" ON enlisted_club_sessions;

-- Create new policy that requires approved creator status
CREATE POLICY "Only approved creators can create sessions" ON enlisted_club_sessions
  FOR INSERT WITH CHECK (
    auth.uid() = host_id
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND creator_status = 'approved'
    )
  );

-- Add a comment explaining the policy
COMMENT ON POLICY "Only approved creators can create sessions" ON enlisted_club_sessions IS
  'Only users with creator_status = ''approved'' can create new Enlisted Club sessions. This ensures quality control and that hosts can receive tips.';






