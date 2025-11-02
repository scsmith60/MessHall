-- Fix for get_monthly_usage function - Ambiguous column reference error
-- Run this in Supabase SQL Editor if you already ran the migration

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
  WHERE NOT EXISTS (SELECT 1 FROM streaming_usage u2 WHERE u2.month_year = month_to_check);
END;
$$ LANGUAGE plpgsql;

