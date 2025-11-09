-- check_chicken_poblano.sql
-- Quick query to check the chicken poblano soup classification issue

SELECT 
  id,
  title,
  category_tags,
  diet_tags,
  created_at
FROM recipes 
WHERE title ILIKE '%chicken poblano%'
ORDER BY created_at DESC
LIMIT 10;

-- Also check if vegetarian tag is incorrectly applied
SELECT 
  id,
  title,
  category_tags,
  CASE 
    WHEN 'vegetarian' = ANY(category_tags) THEN '❌ HAS VEGETARIAN TAG'
    ELSE '✅ No vegetarian tag'
  END as vegetarian_status
FROM recipes 
WHERE title ILIKE '%chicken poblano%'
ORDER BY created_at DESC;

