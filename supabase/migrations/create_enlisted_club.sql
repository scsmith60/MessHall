-- Enlisted Club: Real-time collaborative cooking sessions
-- Like Clubhouse for recipes with video/audio and in-session tipping

-- Sessions table: tracks active cooking sessions
CREATE TABLE IF NOT EXISTS enlisted_club_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  max_participants INTEGER NOT NULL DEFAULT 50 CHECK (max_participants > 0 AND max_participants <= 1000),
  scheduled_start_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  video_url TEXT, -- Optional: external video URL (e.g., Daily.co, Agora, Twilio)
  room_id TEXT UNIQUE, -- Unique room identifier for video service
  total_tips_received_cents INTEGER NOT NULL DEFAULT 0, -- Denormalized sum of tips
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Participants table: tracks who's in each session
CREATE TABLE IF NOT EXISTS enlisted_club_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES enlisted_club_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('host', 'cohost', 'speaker', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  is_video_enabled BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(session_id, user_id) -- One participant record per user per session
);

-- Tips table: tracks tips sent during sessions
CREATE TABLE IF NOT EXISTS enlisted_club_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES enlisted_club_sessions(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- The host/creator receiving the tip
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  stripe_payment_intent_id TEXT UNIQUE, -- Stripe payment intent ID
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  message TEXT, -- Optional message with the tip
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_enlisted_sessions_status ON enlisted_club_sessions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_sessions_host ON enlisted_club_sessions(host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_sessions_recipe ON enlisted_club_sessions(recipe_id) WHERE recipe_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enlisted_sessions_scheduled ON enlisted_club_sessions(scheduled_start_at) WHERE scheduled_start_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enlisted_participants_session ON enlisted_club_participants(session_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_participants_user ON enlisted_club_participants(user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_participants_active ON enlisted_club_participants(session_id, left_at) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_enlisted_tips_session ON enlisted_club_tips(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_tips_to_user ON enlisted_club_tips(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_tips_from_user ON enlisted_club_tips(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enlisted_tips_status ON enlisted_club_tips(status, created_at DESC);

-- Trigger to update session updated_at
CREATE OR REPLACE FUNCTION update_enlisted_club_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_enlisted_club_sessions_updated_at
  BEFORE UPDATE ON enlisted_club_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_enlisted_club_sessions_updated_at();

-- Function to update total_tips_received_cents when tip status changes
CREATE OR REPLACE FUNCTION update_session_tip_total()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update on status changes to completed/failed
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    UPDATE enlisted_club_sessions
    SET total_tips_received_cents = total_tips_received_cents + NEW.amount_cents
    WHERE id = NEW.session_id;
  ELSIF OLD.status = 'completed' AND NEW.status != 'completed' THEN
    -- If tip was completed and now isn't, subtract it
    UPDATE enlisted_club_sessions
    SET total_tips_received_cents = GREATEST(0, total_tips_received_cents - OLD.amount_cents)
    WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_session_tip_total_trigger
  AFTER INSERT OR UPDATE ON enlisted_club_tips
  FOR EACH ROW
  EXECUTE FUNCTION update_session_tip_total();

-- Enable RLS
ALTER TABLE enlisted_club_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE enlisted_club_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE enlisted_club_tips ENABLE ROW LEVEL SECURITY;

-- RLS Policies for sessions
-- Anyone can view active/scheduled sessions
CREATE POLICY "Anyone can view active sessions" ON enlisted_club_sessions
  FOR SELECT USING (status IN ('scheduled', 'active'));

-- Hosts can view their own sessions regardless of status
CREATE POLICY "Hosts can view own sessions" ON enlisted_club_sessions
  FOR SELECT USING (auth.uid() = host_id);

-- Authenticated users can create sessions
CREATE POLICY "Authenticated users can create sessions" ON enlisted_club_sessions
  FOR INSERT WITH CHECK (auth.uid() = host_id);

-- Hosts can update their own sessions
CREATE POLICY "Hosts can update own sessions" ON enlisted_club_sessions
  FOR UPDATE USING (auth.uid() = host_id);

-- RLS Policies for participants
-- Anyone can view participants of active/scheduled sessions
CREATE POLICY "Anyone can view participants of active sessions" ON enlisted_club_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_participants.session_id
      AND status IN ('scheduled', 'active')
    )
  );

-- Users can view their own participant records
CREATE POLICY "Users can view own participant records" ON enlisted_club_participants
  FOR SELECT USING (auth.uid() = user_id);

-- Authenticated users can join sessions
CREATE POLICY "Authenticated users can join sessions" ON enlisted_club_participants
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own participant record (mute, video, leave)
CREATE POLICY "Users can update own participant record" ON enlisted_club_participants
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for tips
-- Users can view tips they sent or received
CREATE POLICY "Users can view own tips" ON enlisted_club_tips
  FOR SELECT USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

-- Anyone in an active session can view tips for that session
CREATE POLICY "Participants can view session tips" ON enlisted_club_tips
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enlisted_club_participants
      WHERE session_id = enlisted_club_tips.session_id
      AND user_id = auth.uid()
      AND left_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM enlisted_club_sessions
      WHERE id = enlisted_club_tips.session_id
      AND status IN ('active', 'ended')
    )
  );

-- Authenticated users can send tips
CREATE POLICY "Authenticated users can send tips" ON enlisted_club_tips
  FOR INSERT WITH CHECK (auth.uid() = from_user_id);

-- Service role can update tips (for payment processing)
CREATE POLICY "Service role can update tips" ON enlisted_club_tips
  FOR UPDATE USING (true);









