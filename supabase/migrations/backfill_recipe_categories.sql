-- backfill_recipe_categories.sql
-- Backfills category_tags for all existing recipes using the classification function

UPDATE public.recipes r
SET category_tags = classify_recipe_categories(
  r.title,
  ARRAY(
    SELECT ri.text
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = r.id
    ORDER BY ri.pos
  )
)
WHERE category_tags IS NULL OR array_length(category_tags, 1) IS NULL;

-- Also update recipes that might have outdated or incomplete categories
UPDATE public.recipes r
SET category_tags = classify_recipe_categories(
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

