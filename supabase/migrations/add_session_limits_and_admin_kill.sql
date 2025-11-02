-- Add session limits, usage tracking, and admin kill functionality

-- 1. Add max_duration_minutes to sessions (default 30 minutes)
ALTER TABLE enlisted_club_sessions 
ADD COLUMN IF NOT EXISTS max_duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (max_duration_minutes > 0 AND max_duration_minutes <= 120);

-- 1b. Add max_concurrent_viewers to sessions (to limit participant count per session)
ALTER TABLE enlisted_club_sessions 
ADD COLUMN IF NOT EXISTS max_concurrent_viewers INTEGER CHECK (max_concurrent_viewers IS NULL OR (max_concurrent_viewers > 0 AND max_concurrent_viewers <= 1000));

-- 2. Add admin_killed flag and reason
ALTER TABLE enlisted_club_sessions
ADD COLUMN IF NOT EXISTS admin_killed BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS admin_kill_reason TEXT,
ADD COLUMN IF NOT EXISTS killed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS killed_at TIMESTAMPTZ;

-- 3. Create monthly usage tracking table
CREATE TABLE IF NOT EXISTS streaming_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_year TEXT NOT NULL, -- Format: 'YYYY-MM' (e.g., '2024-01')
  total_minutes INTEGER NOT NULL DEFAULT 0,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(month_year)
);

-- 4. Add monthly usage limit configuration (can be updated by admins)
CREATE TABLE IF NOT EXISTS streaming_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE, -- e.g., 'max_monthly_minutes', 'max_concurrent_sessions'
  value JSONB NOT NULL, -- Flexible value storage
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Insert default config values
INSERT INTO streaming_config (key, value, description) VALUES
  ('max_monthly_minutes', '300000'::jsonb, 'Maximum PARTICIPANT-minutes allowed per month (300K = $300/month with Cloudflare, adjust to budget). Note: This counts viewers × duration.'),
  ('max_concurrent_sessions', '50'::jsonb, 'Maximum concurrent active sessions'),
  ('session_duration_limit', '30'::jsonb, 'Default maximum session duration in minutes'),
  ('usage_check_enabled', 'true'::jsonb, 'Whether to enforce usage limits')
ON CONFLICT (key) DO NOTHING;

-- 6. Function to check if new sessions can be started
CREATE OR REPLACE FUNCTION can_start_new_session()
RETURNS BOOLEAN AS $$
DECLARE
  current_month TEXT;
  current_usage INTEGER;
  max_minutes INTEGER;
  concurrent_sessions INTEGER;
  max_concurrent INTEGER;
  check_enabled BOOLEAN;
BEGIN
  -- Check if usage limits are enabled
  SELECT (value::text)::boolean INTO check_enabled
  FROM streaming_config WHERE key = 'usage_check_enabled';
  
  IF check_enabled = false THEN
    RETURN true; -- Limits disabled, allow all sessions
  END IF;

  -- Get current month
  current_month := to_char(CURRENT_DATE, 'YYYY-MM');

  -- Check concurrent sessions limit
  SELECT (value::text)::integer INTO max_concurrent
  FROM streaming_config WHERE key = 'max_concurrent_sessions';

  SELECT COUNT(*) INTO concurrent_sessions
  FROM enlisted_club_sessions
  WHERE status = 'active' AND started_at IS NOT NULL;

  IF concurrent_sessions >= max_concurrent THEN
    RETURN false; -- Too many concurrent sessions
  END IF;

  -- Check monthly minutes limit
  SELECT (value::text)::integer INTO max_minutes
  FROM streaming_config WHERE key = 'max_monthly_minutes';

  SELECT COALESCE(total_minutes, 0) INTO current_usage
  FROM streaming_usage
  WHERE month_year = current_month;

  IF current_usage >= max_minutes THEN
    RETURN false; -- Monthly limit reached
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- 7. Function to get monthly usage
CREATE OR REPLACE FUNCTION get_monthly_usage(target_month TEXT DEFAULT NULL)
RETURNS TABLE (
  month_year TEXT,
  total_minutes INTEGER,
  total_sessions INTEGER,
  limit_minutes INTEGER,
  limit_reached BOOLEAN
) AS $$
DECLARE
  month_to_check TEXT;
  limit_value INTEGER;
BEGIN
  month_to_check := COALESCE(target_month, to_char(CURRENT_DATE, 'YYYY-MM'));
  
  SELECT (value::text)::integer INTO limit_value
  FROM streaming_config WHERE key = 'max_monthly_minutes';

  RETURN QUERY
  SELECT
    COALESCE(u.month_year, month_to_check) as month_year,
    COALESCE(u.total_minutes, 0) as total_minutes,
    COALESCE(u.total_sessions, 0) as total_sessions,
    limit_value as limit_minutes,
    (COALESCE(u.total_minutes, 0) >= limit_value) as limit_reached
  FROM streaming_usage u
  WHERE u.month_year = month_to_check
  UNION ALL
  SELECT
    month_to_check,
    0,
    0,
    limit_value,
    false
  WHERE NOT EXISTS (SELECT 1 FROM streaming_usage WHERE month_year = month_to_check);
END;
$$ LANGUAGE plpgsql;

-- 8. Function to update usage when session ends (calculates PARTICIPANT-minutes)
CREATE OR REPLACE FUNCTION update_streaming_usage()
RETURNS TRIGGER AS $$
DECLARE
  session_duration_minutes INTEGER;
  avg_participants NUMERIC;
  participant_minutes INTEGER;
  current_month TEXT;
BEGIN
  -- Only update when session changes from active to ended
  IF OLD.status = 'active' AND NEW.status = 'ended' AND NEW.started_at IS NOT NULL THEN
    current_month := to_char(NEW.started_at, 'YYYY-MM');
    
    -- Calculate session duration in minutes
    IF NEW.ended_at IS NOT NULL THEN
      session_duration_minutes := EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60;
    ELSE
      session_duration_minutes := EXTRACT(EPOCH FROM (NOW() - NEW.started_at)) / 60;
    END IF;

    -- Calculate average concurrent participants during session
    SELECT COALESCE(AVG(participant_count), 1) INTO avg_participants
    FROM (
      SELECT COUNT(*) as participant_count
      FROM enlisted_club_participants
      WHERE session_id = NEW.id
      AND joined_at <= COALESCE(NEW.ended_at, NOW())
      AND (left_at IS NULL OR left_at >= NEW.started_at)
      GROUP BY EXTRACT(EPOCH FROM (joined_at - NEW.started_at))::INTEGER / 60
    ) participant_counts;

    -- Calculate participant-minutes (duration × average participants)
    participant_minutes := session_duration_minutes * GREATEST(avg_participants, 1);

    -- Update or insert usage record (using participant-minutes, not just minutes)
    INSERT INTO streaming_usage (month_year, total_minutes, total_sessions)
    VALUES (current_month, participant_minutes, 1)
    ON CONFLICT (month_year) DO UPDATE
    SET 
      total_minutes = streaming_usage.total_minutes + participant_minutes,
      total_sessions = streaming_usage.total_sessions + 1,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Create trigger to auto-update usage
DROP TRIGGER IF EXISTS update_streaming_usage_trigger ON enlisted_club_sessions;
CREATE TRIGGER update_streaming_usage_trigger
  AFTER UPDATE ON enlisted_club_sessions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION update_streaming_usage();

-- 10. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_streaming_usage_month ON streaming_usage(month_year);
CREATE INDEX IF NOT EXISTS idx_sessions_admin_killed ON enlisted_club_sessions(admin_killed, killed_at) WHERE admin_killed = true;
CREATE INDEX IF NOT EXISTS idx_sessions_active_started ON enlisted_club_sessions(status, started_at) WHERE status = 'active';

-- 11. RLS Policies for streaming_config (admins can update)
ALTER TABLE streaming_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE streaming_usage ENABLE ROW LEVEL SECURITY;

-- Anyone can read config (for checking limits)
CREATE POLICY "Anyone can read streaming config" ON streaming_config
  FOR SELECT USING (true);

-- Only admins can update config
CREATE POLICY "Admins can update streaming config" ON streaming_config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Anyone can read usage stats (for transparency)
CREATE POLICY "Anyone can read streaming usage" ON streaming_usage
  FOR SELECT USING (true);

-- 12. Update sessions RLS to allow admins to kill sessions
DROP POLICY IF EXISTS "Admins can kill sessions" ON enlisted_club_sessions;
CREATE POLICY "Admins can kill sessions" ON enlisted_club_sessions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- 13. Function for admins to kill a session
CREATE OR REPLACE FUNCTION admin_kill_session(
  target_session_id UUID,
  kill_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  is_user_admin BOOLEAN;
BEGIN
  -- Check if user is admin
  SELECT COALESCE(is_admin, false) INTO is_user_admin
  FROM profiles
  WHERE id = auth.uid();

  IF NOT is_user_admin THEN
    RAISE EXCEPTION 'Only admins can kill sessions';
  END IF;

  -- Kill the session
  UPDATE enlisted_club_sessions
  SET 
    status = 'ended',
    admin_killed = true,
    admin_kill_reason = kill_reason,
    killed_by_user_id = auth.uid(),
    killed_at = NOW(),
    ended_at = NOW()
  WHERE id = target_session_id AND status = 'active';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. Grant execute permission
GRANT EXECUTE ON FUNCTION admin_kill_session TO authenticated;
GRANT EXECUTE ON FUNCTION can_start_new_session TO authenticated;
GRANT EXECUTE ON FUNCTION get_monthly_usage TO authenticated;

