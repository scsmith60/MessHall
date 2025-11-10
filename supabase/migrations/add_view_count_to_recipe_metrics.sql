-- add_view_count_to_recipe_metrics.sql
-- Adds view_count and viewed_at columns to recipes table
-- Since recipe_metrics is a VIEW, we add columns to the underlying recipes table
-- This is used for monetization eligibility (10,000 views in last 30 days requirement)

-- Add view_count column to recipes table if it doesn't exist
ALTER TABLE recipes
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

-- Add viewed_at column to recipes table if it doesn't exist (for 30-day eligibility window)
-- Note: This stores the last view timestamp. For detailed view tracking, consider a separate recipe_views table.
ALTER TABLE recipes
ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;

-- Add index for eligibility check (views in last 30 days)
CREATE INDEX IF NOT EXISTS idx_recipes_viewed_at 
ON recipes(viewed_at DESC)
WHERE viewed_at IS NOT NULL;

-- Add index for user + date range queries (for eligibility check)
CREATE INDEX IF NOT EXISTS idx_recipes_user_viewed 
ON recipes(user_id, viewed_at DESC)
WHERE viewed_at IS NOT NULL AND is_private = false;

-- Add comments for documentation
COMMENT ON COLUMN recipes.view_count IS 'Total view count for this recipe (used for monetization eligibility: 10,000 views in last 30 days)';
COMMENT ON COLUMN recipes.viewed_at IS 'Last view timestamp (used for 30-day eligibility window). For detailed tracking, use a separate recipe_views table.';

-- NOTE: If recipe_metrics is a VIEW that includes recipes, it will automatically include these new columns.
-- If you need to track individual views (not just totals), create a separate recipe_views table instead.

