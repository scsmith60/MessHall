-- Add support for ingredient section headers
-- This allows recipes to have grouped ingredients like "For the Cake:" or "Chimichurri ingredients:"

ALTER TABLE recipe_ingredients 
ADD COLUMN IF NOT EXISTS section_name TEXT;

-- Create index for efficient querying by section
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_section 
ON recipe_ingredients(recipe_id, section_name, pos);

-- Add comment for documentation
COMMENT ON COLUMN recipe_ingredients.section_name IS 'Optional section header name (e.g., "For the Cake:", "Chimichurri ingredients:"). NULL means ingredient belongs to default/ungrouped section.';

