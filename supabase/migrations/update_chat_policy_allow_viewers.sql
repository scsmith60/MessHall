-- Update chat policy to allow any viewer (not just participants) to send messages
-- This matches the UI change where all viewers can chat

DROP POLICY IF EXISTS "Participants can send messages" ON enlisted_club_messages;

-- Anyone viewing active/scheduled sessions can send messages
CREATE POLICY "Anyone can send messages to active sessions" ON enlisted_club_messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_messages.session_id
      AND status IN ('scheduled', 'active')
    )
  );

