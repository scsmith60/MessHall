-- Trigger to automatically learn from recipes when they are saved
-- This processes the recipe's source_url to extract patterns and update the learning database

CREATE OR REPLACE FUNCTION learn_from_saved_recipe()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_url TEXT;
  v_site_type TEXT;
  v_html_pattern TEXT;
  v_strategy TEXT;
  v_has_ingredients BOOLEAN;
  v_has_steps BOOLEAN;
BEGIN
  -- Only process if recipe has a source_url
  IF NEW.source_url IS NULL OR NEW.source_url = '' THEN
    RETURN NEW;
  END IF;

  v_source_url := NEW.source_url;

  -- Determine site type from URL
  IF v_source_url LIKE '%tiktok.com%' OR v_source_url LIKE '%tiktok%' THEN
    v_site_type := 'tiktok';
  ELSIF v_source_url LIKE '%instagram.com%' OR v_source_url LIKE '%instagram%' THEN
    v_site_type := 'instagram';
  ELSIF v_source_url LIKE '%facebook.com%' OR v_source_url LIKE '%facebook%' THEN
    v_site_type := 'facebook';
  ELSE
    v_site_type := 'recipe-site';
  END IF;

  -- Check if recipe has meaningful data (ingredients or steps)
  SELECT 
    EXISTS(SELECT 1 FROM recipe_ingredients WHERE recipe_id = NEW.id LIMIT 1),
    EXISTS(SELECT 1 FROM recipe_steps WHERE recipe_id = NEW.id LIMIT 1)
  INTO v_has_ingredients, v_has_steps;

  -- Only learn from recipes that have at least ingredients or steps
  IF NOT v_has_ingredients AND NOT v_has_ingredients THEN
    RETURN NEW;
  END IF;

  -- Try to fetch HTML from the source URL to extract patterns
  -- Note: This is a simplified pattern - in practice, you might want to:
  -- 1. Store HTML in a separate table when recipes are imported
  -- 2. Or call an external service to fetch HTML
  -- 3. Or rely on the backfill script to process saved recipes periodically
  
  -- For now, we'll create a generic pattern based on site type
  -- The backfill script will handle detailed pattern extraction
  v_html_pattern := 'saved-recipe|' || v_site_type;
  v_strategy := 'server-html-meta'; -- Default strategy for saved recipes

  -- Update extraction pattern to indicate this site/pattern has successful recipes
  INSERT INTO recipe_extraction_patterns (
    site_type,
    html_pattern,
    extraction_method,
    parser_version,
    success_rate,
    sample_count,
    last_seen_at
  ) VALUES (
    v_site_type,
    v_html_pattern,
    v_strategy,
    'v1',
    100.0, -- Saved recipes are considered 100% successful
    1,
    NOW()
  )
  ON CONFLICT (site_type, html_pattern, extraction_method, parser_version)
  DO UPDATE SET
    sample_count = recipe_extraction_patterns.sample_count + 1,
    last_seen_at = NOW(),
    -- Maintain high success rate for saved recipes
    success_rate = GREATEST(recipe_extraction_patterns.success_rate, 90.0);

  RETURN NEW;
END;
$$;

-- Create trigger that fires after a recipe is inserted
DROP TRIGGER IF EXISTS trigger_learn_from_saved_recipe ON recipes;
CREATE TRIGGER trigger_learn_from_saved_recipe
  AFTER INSERT ON recipes
  FOR EACH ROW
  WHEN (NEW.source_url IS NOT NULL AND NEW.source_url != '')
  EXECUTE FUNCTION learn_from_saved_recipe();

COMMENT ON FUNCTION learn_from_saved_recipe() IS 
'Automatically learns from saved recipes by updating extraction patterns. This helps the system learn which strategies work for which sites.';

-- Note: This trigger provides basic learning. For detailed pattern extraction,
-- run the backfill script periodically: npx tsx scripts/backfill-parser-patterns.ts

