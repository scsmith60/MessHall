-- Fix RLS violation when ending sessions
-- The update_streaming_usage() trigger function needs SECURITY DEFINER to bypass RLS
-- when inserting into streaming_usage table

-- Recreate the function with SECURITY DEFINER
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
    -- This now runs with elevated privileges (SECURITY DEFINER) so it can bypass RLS
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission (already granted, but ensure it's there)
GRANT EXECUTE ON FUNCTION update_streaming_usage() TO authenticated;

