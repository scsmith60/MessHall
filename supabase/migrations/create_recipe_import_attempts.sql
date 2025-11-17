-- Track recipe import attempts for learning and improvement
CREATE TABLE IF NOT EXISTS recipe_import_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  site_type TEXT NOT NULL,
  parser_version TEXT NOT NULL DEFAULT 'v1',
  strategy_used TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  confidence_score TEXT CHECK (confidence_score IN ('low', 'medium', 'high')),
  ingredients_count INT,
  steps_count INT,
  raw_html_sample TEXT, -- First 5000 chars for pattern analysis
  error_message TEXT,
  user_corrected BOOLEAN DEFAULT FALSE, -- Did user manually fix after import?
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_import_attempts_site_version 
  ON recipe_import_attempts(site_type, parser_version);

CREATE INDEX IF NOT EXISTS idx_import_attempts_success 
  ON recipe_import_attempts(success, created_at);

CREATE INDEX IF NOT EXISTS idx_import_attempts_user_corrected 
  ON recipe_import_attempts(user_corrected, created_at) 
  WHERE user_corrected = TRUE;

CREATE INDEX IF NOT EXISTS idx_import_attempts_url 
  ON recipe_import_attempts(url);

-- Pattern learning table
CREATE TABLE IF NOT EXISTS recipe_extraction_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_type TEXT NOT NULL,
  html_pattern TEXT, -- Pattern identifier or regex
  extraction_method TEXT NOT NULL,
  parser_version TEXT NOT NULL DEFAULT 'v1',
  success_rate DECIMAL(5,2) DEFAULT 0.0,
  sample_count INT DEFAULT 0,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_type, html_pattern, extraction_method, parser_version)
);

CREATE INDEX IF NOT EXISTS idx_extraction_patterns_site 
  ON recipe_extraction_patterns(site_type, success_rate DESC);

-- Function to log import attempt
CREATE OR REPLACE FUNCTION log_recipe_import_attempt(
  p_url TEXT,
  p_site_type TEXT,
  p_parser_version TEXT,
  p_strategy_used TEXT,
  p_success BOOLEAN,
  p_confidence_score TEXT,
  p_ingredients_count INT,
  p_steps_count INT,
  p_raw_html_sample TEXT,
  p_error_message TEXT
) RETURNS UUID AS $$
DECLARE
  v_attempt_id UUID;
  v_user_id UUID;
BEGIN
  -- Get current user if available
  SELECT auth.uid() INTO v_user_id;
  
  -- Insert attempt
  INSERT INTO recipe_import_attempts (
    url, site_type, parser_version, strategy_used, success,
    confidence_score, ingredients_count, steps_count,
    raw_html_sample, error_message, user_id
  ) VALUES (
    p_url, p_site_type, p_parser_version, p_strategy_used, p_success,
    p_confidence_score, p_ingredients_count, p_steps_count,
    LEFT(p_raw_html_sample, 5000), p_error_message, v_user_id
  ) RETURNING id INTO v_attempt_id;
  
  RETURN v_attempt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark user correction
CREATE OR REPLACE FUNCTION mark_import_corrected(
  p_attempt_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE recipe_import_attempts
  SET user_corrected = TRUE
  WHERE id = p_attempt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update pattern success rate
CREATE OR REPLACE FUNCTION update_extraction_pattern(
  p_site_type TEXT,
  p_html_pattern TEXT,
  p_extraction_method TEXT,
  p_parser_version TEXT,
  p_success BOOLEAN
) RETURNS VOID AS $$
DECLARE
  v_pattern_id UUID;
  v_current_success_rate DECIMAL;
  v_current_count INT;
  v_new_success_rate DECIMAL;
BEGIN
  -- Try to find existing pattern
  SELECT id, success_rate, sample_count
  INTO v_pattern_id, v_current_success_rate, v_current_count
  FROM recipe_extraction_patterns
  WHERE site_type = p_site_type
    AND html_pattern = p_html_pattern
    AND extraction_method = p_extraction_method
    AND parser_version = p_parser_version;
  
  IF v_pattern_id IS NULL THEN
    -- Create new pattern
    INSERT INTO recipe_extraction_patterns (
      site_type, html_pattern, extraction_method, parser_version,
      success_rate, sample_count, last_seen_at
    ) VALUES (
      p_site_type, p_html_pattern, p_extraction_method, p_parser_version,
      CASE WHEN p_success THEN 100.0 ELSE 0.0 END,
      1, NOW()
    );
  ELSE
    -- Update existing pattern (moving average)
    v_new_success_rate := (
      (v_current_success_rate * v_current_count + 
       CASE WHEN p_success THEN 100.0 ELSE 0.0 END) / 
      (v_current_count + 1)
    );
    
    UPDATE recipe_extraction_patterns
    SET success_rate = v_new_success_rate,
        sample_count = v_current_count + 1,
        last_seen_at = NOW()
    WHERE id = v_pattern_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS policies
ALTER TABLE recipe_import_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_extraction_patterns ENABLE ROW LEVEL SECURITY;

-- Users can read their own attempts
CREATE POLICY "Users can read own import attempts"
  ON recipe_import_attempts
  FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Service role can do everything
CREATE POLICY "Service role full access to import attempts"
  ON recipe_import_attempts
  FOR ALL
  USING (auth.role() = 'service_role');

-- Anyone can read patterns (they're aggregated data)
CREATE POLICY "Anyone can read extraction patterns"
  ON recipe_extraction_patterns
  FOR SELECT
  USING (true);

-- Service role can write patterns
CREATE POLICY "Service role can write patterns"
  ON recipe_extraction_patterns
  FOR ALL
  USING (auth.role() = 'service_role');

