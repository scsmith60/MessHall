-- Update reactions policy to allow any viewer (not just participants) to send reactions
-- This allows users viewing active sessions to send reactions without being participants

DROP POLICY IF EXISTS "Participants can send reactions" ON enlisted_club_reactions;
DROP POLICY IF EXISTS "Anyone can send reactions to active sessions" ON enlisted_club_reactions;

-- Anyone viewing active/scheduled sessions can send reactions
CREATE POLICY "Anyone can send reactions to active sessions" ON enlisted_club_reactions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_reactions.session_id
      AND status IN ('scheduled', 'active')
    )
  );

