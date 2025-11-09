-- export_classification_data.sql
-- Exports all data used for recipe classification so we can analyze misclassifications

SELECT 
  r.id,
  r.title,
  r.category_tags,
  r.diet_tags,
  ARRAY(
    SELECT ri.text
    FROM recipe_ingredients ri
    WHERE ri.recipe_id = r.id
    ORDER BY ri.pos
  ) as ingredients,
  r.created_at
FROM recipes r
WHERE EXISTS (
  SELECT 1
  FROM recipe_ingredients ri
  WHERE ri.recipe_id = r.id
)
ORDER BY r.created_at DESC;

