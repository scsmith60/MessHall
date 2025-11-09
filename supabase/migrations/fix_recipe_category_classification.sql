-- fix_recipe_category_classification.sql
-- Reclassifies all recipes with the updated classification function
-- This fixes issues with:
-- - risotto incorrectly in pasta (removed from pasta pattern)
-- - soups incorrectly in breakfast (excluded soups from breakfast)
-- - tacos/wraps incorrectly in salads (salad pattern now requires "salad" or "slaw" and excludes wrap keywords)
-- - wraps/taquitos incorrectly in soups (excluded from soup pattern - checks wrap keywords FIRST)
-- - carne asada incorrectly in soups (added to beef pattern, excluded from soup pattern)
-- - buldak incorrectly in soups (added to chicken pattern)
-- - chicken poblano soup incorrectly in vegetarian (chicken pattern now includes poblano, vegetarian checks after meat detection)
-- - pulled pork tacos incorrectly as salad (salad now excludes wrap keywords)
-- - beef taquitos incorrectly as soup (soup checks wrap keywords first)
-- - chicken incorrectly in vegetarian (chicken detection improved, vegetarian only if no meat detected)
-- - soups incorrectly in drinks (drinks now excludes soups, sauces, condiments, and food items)
-- - chocolate roulade incorrectly in drinks (drinks excludes roulade, desserts, and food items)
-- - stuffed sweet potatoes incorrectly in desserts (desserts excludes stuffed dishes)
-- - chimichurri incorrectly in soups (soup pattern excludes sauces and condiments)
-- - pumpkin seeds and baked apples incorrectly in drinks (drinks excludes food items and cooking methods)
-- - beer battered, glazed donuts, etc. incorrectly in drinks (drinks excludes when combined with proteins/food items)
-- - caramel apple vodka lollipops incorrectly in drinks (drinks excludes lollipops, bars, candies)
-- - thanksgiving turkey brine incorrectly in soups (soup excludes brines)
-- - crispy parmesan roasted cauliflower incorrectly in desserts (desserts excludes cauliflower, scrambled eggs)
-- - croatian truffle scrambled eggs incorrectly in desserts (desserts excludes scrambled eggs, breakfast items)
-- - chicken in ingredients not detected (improved chicken detection with shredded/cooked/boneless patterns)
-- - desserts incorrectly as appetizers (appetizers now excludes desserts)
-- - dessert sushi incorrectly as seafood (seafood excludes dessert sushi items)

WITH classified AS (
  SELECT
    r.id,
    classify_recipe_categories(
      r.title,
      ARRAY(
        SELECT ri.text
        FROM public.recipe_ingredients ri
        WHERE ri.recipe_id = r.id
        ORDER BY ri.pos
      )
    ) AS new_category_tags
  FROM public.recipes r
  WHERE EXISTS (
    SELECT 1
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = r.id
  )
)
UPDATE public.recipes r
SET category_tags = c.new_category_tags
FROM classified c
WHERE r.id = c.id
  AND r.category_tags IS DISTINCT FROM c.new_category_tags;

