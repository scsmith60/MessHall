-- get_recipe_metrics_definition.sql
-- Run this first to see the current recipe_metrics VIEW definition
-- Then use that to update the view properly

-- Get the current view definition
SELECT pg_get_viewdef('recipe_metrics', true) as view_definition;

-- Also show what columns it currently has
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'recipe_metrics'
  AND table_schema = 'public'
ORDER BY ordinal_position;

