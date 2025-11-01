-- Fix RLS Policy for Reactions
-- This allows hosts to send reactions even if they haven't explicitly joined as participants

DROP POLICY IF EXISTS "Participants can send reactions" ON enlisted_club_reactions;

CREATE POLICY "Participants can send reactions" ON enlisted_club_reactions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_reactions.session_id
      AND status IN ('scheduled', 'active')
      AND (
        -- User is a participant
        EXISTS (
          SELECT 1 FROM enlisted_club_participants
          WHERE session_id = enlisted_club_reactions.session_id
          AND user_id = auth.uid()
          AND left_at IS NULL
        )
        -- OR user is the host
        OR host_id = auth.uid()
      )
    )
  );

