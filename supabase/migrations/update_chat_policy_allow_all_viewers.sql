-- Update chat policy to allow any viewer (not just participants) to view messages
-- This matches the UI change where all viewers can see chat

DROP POLICY IF EXISTS "Participants can view session messages" ON enlisted_club_messages;

-- Anyone viewing active/scheduled/ended sessions can view messages
CREATE POLICY "Anyone can view messages for active sessions" ON enlisted_club_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_messages.session_id
      AND status IN ('scheduled', 'active', 'ended')
    )
  );

