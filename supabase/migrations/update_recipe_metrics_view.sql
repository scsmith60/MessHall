-- update_recipe_metrics_view.sql
-- Updates the recipe_metrics VIEW to include view_count and viewed_at columns
-- Based on the current view definition provided

-- Recreate the view with view_count and viewed_at added
CREATE OR REPLACE VIEW recipe_metrics AS
SELECT 
  id AS recipe_id,
  COALESCE(likes_count, 0)::bigint AS likes,
  COALESCE(saves_count, 0)::bigint AS saves,
  COALESCE(cooks_count, 0)::bigint AS cooks,
  COALESCE(comment_count, 0)::bigint AS comments,
  EXTRACT(epoch FROM now() - created_at) / 3600.0 AS age_hours,
  -- NEW: View tracking columns for monetization eligibility
  COALESCE(view_count, 0)::bigint AS view_count,
  viewed_at
FROM recipes r;

-- Grant permissions (preserve existing grants)
GRANT SELECT ON recipe_metrics TO authenticated;
GRANT SELECT ON recipe_metrics TO anon;

-- Add comment
COMMENT ON VIEW recipe_metrics IS 'Recipe metrics view including view counts for monetization eligibility (10,000 views in last 30 days requirement)';

