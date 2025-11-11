-- Discovered Recipe Sites Table
-- Auto-populated when users encounter recipe sites not in our hardcoded list

CREATE TABLE IF NOT EXISTS discovered_recipe_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname TEXT NOT NULL UNIQUE, -- e.g., "example.com" (normalized, no www)
  detection_method TEXT NOT NULL CHECK (detection_method IN ('jsonld', 'microdata', 'html')),
  first_discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  discovery_count INTEGER NOT NULL DEFAULT 1, -- How many times we've seen recipes from this site
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_discovered_recipe_sites_hostname ON discovered_recipe_sites(hostname);
CREATE INDEX IF NOT EXISTS idx_discovered_recipe_sites_last_seen ON discovered_recipe_sites(last_seen_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE discovered_recipe_sites ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read discovered sites (public knowledge)
CREATE POLICY "Anyone can read discovered recipe sites"
  ON discovered_recipe_sites
  FOR SELECT
  USING (true);

-- Policy: Only authenticated users can insert (when they discover a site)
CREATE POLICY "Authenticated users can insert discovered sites"
  ON discovered_recipe_sites
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Policy: Allow updates (the RPC function will handle auth)
CREATE POLICY "Authenticated users can update discovered sites"
  ON discovered_recipe_sites
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Function to upsert a discovered site
-- This function runs with SECURITY DEFINER to bypass RLS, but still checks auth
CREATE OR REPLACE FUNCTION upsert_discovered_recipe_site(
  p_hostname TEXT,
  p_detection_method TEXT
)
RETURNS discovered_recipe_sites
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result discovered_recipe_sites;
BEGIN
  -- Only allow authenticated users (not anonymous)
  IF auth.role() != 'authenticated' THEN
    RAISE EXCEPTION 'Only authenticated users can discover recipe sites';
  END IF;

  INSERT INTO discovered_recipe_sites (hostname, detection_method, discovery_count)
  VALUES (p_hostname, p_detection_method, 1)
  ON CONFLICT (hostname) 
  DO UPDATE SET
    detection_method = EXCLUDED.detection_method, -- Update method if we find a better one
    last_seen_at = NOW(),
    discovery_count = discovered_recipe_sites.discovery_count + 1,
    updated_at = NOW()
  RETURNING * INTO v_result;
  
  RETURN v_result;
END;
$$;

