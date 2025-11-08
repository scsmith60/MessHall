-- Add emoji reactions table for Enlisted Club sessions
CREATE TABLE IF NOT EXISTS enlisted_club_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES enlisted_club_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('❤️', '🔥', '👏', '💯', '😍', '🤩', '😮', '😂')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_enlisted_reactions_session ON enlisted_club_reactions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_reactions_user ON enlisted_club_reactions(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE enlisted_club_reactions ENABLE ROW LEVEL SECURITY;

-- Enable Realtime for reactions table
ALTER PUBLICATION supabase_realtime ADD TABLE enlisted_club_reactions;

-- RLS Policies for reactions
-- Anyone in the session can view reactions
DROP POLICY IF EXISTS "Participants can view reactions" ON enlisted_club_reactions;
CREATE POLICY "Participants can view reactions" ON enlisted_club_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enlisted_club_participants
      WHERE session_id = enlisted_club_reactions.session_id
      AND user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_reactions.session_id
      AND host_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_reactions.session_id
      AND status IN ('scheduled', 'active')
    )
  );

-- Anyone viewing active/scheduled sessions can send reactions
DROP POLICY IF EXISTS "Participants can send reactions" ON enlisted_club_reactions;
CREATE POLICY "Anyone can send reactions to active sessions" ON enlisted_club_reactions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_reactions.session_id
      AND status IN ('scheduled', 'active')
    )
  );

