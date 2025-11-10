-- create_recipe_views_table.sql
-- Creates the recipe_views table to track recipe view counts
-- This table is used by the eligibility check to count views in the last 30 days
--
-- The eligibility requirement is: 500 followers OR 10,000 views in last 30 days

CREATE TABLE IF NOT EXISTS recipe_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  view_count INTEGER NOT NULL DEFAULT 1,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by recipe
CREATE INDEX IF NOT EXISTS idx_recipe_views_recipe_id ON recipe_views(recipe_id);

-- Index for eligibility check (views in last 30 days)
CREATE INDEX IF NOT EXISTS idx_recipe_views_viewed_at ON recipe_views(viewed_at DESC);

-- Index for recipe + date range queries
CREATE INDEX IF NOT EXISTS idx_recipe_views_recipe_date ON recipe_views(recipe_id, viewed_at DESC);

-- Enable RLS
ALTER TABLE recipe_views ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read view counts (public data)
CREATE POLICY "Anyone can read recipe views"
  ON recipe_views
  FOR SELECT
  USING (true);

-- Policy: Authenticated users can insert views (when they view a recipe)
CREATE POLICY "Authenticated users can insert recipe views"
  ON recipe_views
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Function to increment view count for a recipe
-- This can be called when a user views a recipe
CREATE OR REPLACE FUNCTION increment_recipe_view(p_recipe_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO recipe_views (recipe_id, view_count, viewed_at)
  VALUES (p_recipe_id, 1, NOW())
  ON CONFLICT DO NOTHING; -- If you want to update instead, use ON CONFLICT (recipe_id, viewed_at) DO UPDATE SET view_count = recipe_views.view_count + 1
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION increment_recipe_view(UUID) TO authenticated;

-- Add comment
COMMENT ON TABLE recipe_views IS 'Tracks recipe view counts for monetization eligibility (10,000 views in last 30 days requirement)';
COMMENT ON COLUMN recipe_views.view_count IS 'Number of views in this record (usually 1, but can be aggregated)';
COMMENT ON COLUMN recipe_views.viewed_at IS 'When the view(s) occurred (used for 30-day eligibility window)';

