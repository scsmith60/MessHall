-- ============================================
-- Chat Messages Table Migration
-- ============================================
CREATE TABLE IF NOT EXISTS enlisted_club_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES enlisted_club_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(trim(message)) > 0 AND length(message) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_enlisted_messages_session ON enlisted_club_messages(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_messages_user ON enlisted_club_messages(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE enlisted_club_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for messages (drop first to avoid conflicts)
DROP POLICY IF EXISTS "Participants can view session messages" ON enlisted_club_messages;
CREATE POLICY "Participants can view session messages" ON enlisted_club_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enlisted_club_participants
      WHERE session_id = enlisted_club_messages.session_id
      AND user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_messages.session_id
      AND host_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Participants can send messages" ON enlisted_club_messages;
CREATE POLICY "Participants can send messages" ON enlisted_club_messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      EXISTS (
        SELECT 1 FROM enlisted_club_participants
        WHERE session_id = enlisted_club_messages.session_id
        AND user_id = auth.uid()
        AND left_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM enlisted_club_sessions
        WHERE id = enlisted_club_messages.session_id
        AND host_id = auth.uid()
        AND status IN ('scheduled', 'active')
      )
    )
    AND EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_messages.session_id
      AND status IN ('scheduled', 'active', 'ended')
    )
  );

DROP POLICY IF EXISTS "Users can delete own messages" ON enlisted_club_messages;
CREATE POLICY "Users can delete own messages" ON enlisted_club_messages
  FOR DELETE USING (
    auth.uid() = user_id
    AND created_at > NOW() - INTERVAL '5 minutes'
  );

-- ============================================
-- Reactions Table Migration
-- ============================================
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

-- RLS Policies for reactions (drop first to avoid conflicts)
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

