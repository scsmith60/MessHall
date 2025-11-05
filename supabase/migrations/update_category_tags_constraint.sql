-- update_category_tags_constraint.sql
-- Updates the recipes_category_tags_allowed check constraint to include new categories:
-- breakfast, salad, soup, vegetarian, drinks, desserts

-- Drop the old constraint if it exists
ALTER TABLE public.recipes
DROP CONSTRAINT IF EXISTS recipes_category_tags_allowed;

-- Add the updated constraint with all allowed category tags
ALTER TABLE public.recipes
ADD CONSTRAINT recipes_category_tags_allowed
CHECK (
  category_tags IS NULL OR
  category_tags <@ ARRAY[
    'bbq',
    'appetizers',
    'breakfast',
    'chicken',
    'beef',
    'pork',
    'seafood',
    'pasta',
    'salad',
    'soup',
    'vegetarian',
    'drinks',
    'desserts'
  ]::TEXT[]
);

