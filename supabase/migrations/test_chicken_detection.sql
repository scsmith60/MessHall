-- Test query to verify chicken detection works for "CREAMY CHICKEN POBLANO SOUP"
-- This should return has_chicken = true and should NOT be vegetarian

SELECT 
  r.id,
  r.title,
  r.category_tags,
  classify_recipe_categories(
    r.title,
    ARRAY(
      SELECT ri.text
      FROM recipe_ingredients ri
      WHERE ri.recipe_id = r.id
      ORDER BY ri.pos
    )
  ) as new_category_tags,
  ARRAY(
    SELECT ri.text
    FROM recipe_ingredients ri
    WHERE ri.recipe_id = r.id
    ORDER BY ri.pos
  ) as ingredients
FROM recipes r
WHERE r.title ILIKE '%chicken poblano soup%'
LIMIT 5;

