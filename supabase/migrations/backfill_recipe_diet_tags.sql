-- backfill_recipe_diet_tags.sql
-- Backfills diet_tags for all existing recipes using the classify_recipe_diet_tags function
-- 
-- Fixes applied:
-- - Added dairy to vegan check (vegan now excludes dairy, meat, eggs, honey, fish)
-- - Expanded dairy detection patterns (butter, cream, cheese variations, milk types, etc.)
-- - Expanded gluten detection patterns (bread products, pasta types, baked goods, etc.)
-- - Fixed word boundary matching for multi-word ingredients (e.g., "cream cheese", "sweetened condensed milk")

UPDATE public.recipes r
SET diet_tags = classify_recipe_diet_tags(
  r.title,
  ARRAY(
    SELECT ri.text
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = r.id
    ORDER BY ri.pos
  )
)
WHERE EXISTS (
  SELECT 1
  FROM public.recipe_ingredients ri
  WHERE ri.recipe_id = r.id
);

