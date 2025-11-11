-- fix_discovered_sites_html_method.sql
-- Allow 'html' as a detection method for discovered recipe sites

-- Drop the existing constraint
ALTER TABLE discovered_recipe_sites 
DROP CONSTRAINT IF EXISTS discovered_recipe_sites_detection_method_check;

-- Recreate the constraint with 'html' included
ALTER TABLE discovered_recipe_sites
ADD CONSTRAINT discovered_recipe_sites_detection_method_check 
CHECK (detection_method IN ('jsonld', 'microdata', 'html'));

-- Add comment
COMMENT ON CONSTRAINT discovered_recipe_sites_detection_method_check ON discovered_recipe_sites IS 
'Ensures detection_method is one of: jsonld, microdata, or html';

