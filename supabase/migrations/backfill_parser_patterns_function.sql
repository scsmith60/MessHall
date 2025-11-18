-- SQL function to backfill parser patterns from existing recipes
-- This can be run directly in Supabase SQL editor for faster execution
-- Note: This version uses fetchMeta which needs to be called from application code
-- For pure SQL approach, see the TypeScript script instead

-- Function to backfill patterns for a batch of recipes
CREATE OR REPLACE FUNCTION backfill_parser_patterns_batch(
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
) RETURNS TABLE(
  recipe_id UUID,
  source_url TEXT,
  site_type TEXT,
  pattern_extracted TEXT,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_recipe RECORD;
  v_site_type TEXT;
  v_pattern TEXT;
  v_url TEXT;
BEGIN
  -- Get recipes with source URLs
  FOR v_recipe IN
    SELECT 
      r.id,
      r.source_url,
      COUNT(DISTINCT ri.id) as ingredients_count,
      COUNT(DISTINCT rs.id) as steps_count
    FROM recipes r
    LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    LEFT JOIN recipe_steps rs ON rs.recipe_id = r.id
    WHERE r.source_url IS NOT NULL
      AND r.source_url != ''
    GROUP BY r.id, r.source_url
    HAVING COUNT(DISTINCT ri.id) > 0 OR COUNT(DISTINCT rs.id) > 0
    ORDER BY r.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  LOOP
    v_url := v_recipe.source_url;
    
    -- Detect site type from URL
    v_site_type := CASE
      WHEN v_url ~* 'tiktok\.com' THEN 'tiktok'
      WHEN v_url ~* 'instagram\.com' THEN 'instagram'
      WHEN v_url ~* 'facebook\.com' THEN 'facebook'
      WHEN v_url ~* '(allrecipes|food\.com|foodnetwork|epicurious|bonappetit|seriouseats|simplyrecipes|delish|tasty|tasteofhome|myrecipes|cookinglight|eatingwell|realsimple|southernliving|bhg|marthastewart|jamieoliver|gordonramsay|bbcgoodfood|bettycrocker|pillsbury|kingarthurbaking|kosher|justapinch|meishichina|howtocookthat|cookieandkate|budgetbytes|skinnytaste|thekitchn|minimalistbaker|minikitchenmagic|pinchofyum|recipetineats|sallysbakingaddiction|smittenkitchen|halfbakedharvest|gimmesomeoven|damndelicious|twopeasandtheirpod|lilluna|365daysofbakingandmore|spoonfulofflavor|loveandlemons|thepioneerwoman|tastesbetterfromscratch|onceuponachef|iwashyoudry|spendwithpennies|chef-in-training|the-girl-who-ate-everything|theslowroasteditalian|dinneratthezoo|dinnerthendessert|wellplated|ambitiouskitchen|averiecooks|cafe-delites)\.' THEN 'recipe-site'
      ELSE 'generic'
    END;
    
    -- Extract basic pattern from URL structure
    -- Note: Full HTML pattern extraction requires fetching the page,
    -- which should be done via the TypeScript script
    v_pattern := CASE
      WHEN v_url ~* 'tiktok\.com/video/' THEN 'tiktok-video-url'
      WHEN v_url ~* 'tiktok\.com/@' THEN 'tiktok-user-url'
      WHEN v_url ~* 'instagram\.com/p/' THEN 'instagram-post-url'
      WHEN v_url ~* 'instagram\.com/reel/' THEN 'instagram-reel-url'
      WHEN v_url ~* 'instagram\.com/tv/' THEN 'instagram-tv-url'
      ELSE 'generic-url'
    END;
    
    -- Log that we processed this recipe
    -- The actual extraction and pattern learning should be done via TypeScript
    -- as it requires fetching HTML and parsing
    
    RETURN QUERY SELECT
      v_recipe.id,
      v_url,
      v_site_type,
      v_pattern,
      true, -- Mark as processed
      'Pattern extracted from URL structure. Full extraction requires TypeScript script.'::TEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to get backfill statistics
CREATE OR REPLACE FUNCTION get_backfill_stats()
RETURNS TABLE(
  total_recipes_with_source INT,
  recipes_with_ingredients INT,
  recipes_with_steps INT,
  recipes_processed INT,
  patterns_learned INT,
  top_patterns JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      (SELECT COUNT(*) FROM recipes WHERE source_url IS NOT NULL) as total_with_source,
      (SELECT COUNT(DISTINCT r.id) 
       FROM recipes r
       JOIN recipe_ingredients ri ON ri.recipe_id = r.id
       WHERE r.source_url IS NOT NULL) as with_ingredients,
      (SELECT COUNT(DISTINCT r.id)
       FROM recipes r
       JOIN recipe_steps rs ON rs.recipe_id = r.id
       WHERE r.source_url IS NOT NULL) as with_steps,
      (SELECT COUNT(DISTINCT url) FROM recipe_import_attempts) as processed,
      (SELECT COUNT(DISTINCT html_pattern) FROM recipe_extraction_patterns) as patterns
  )
  SELECT
    stats.total_with_source::INT,
    stats.with_ingredients::INT,
    stats.with_steps::INT,
    stats.processed::INT,
    stats.patterns::INT,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'pattern', html_pattern,
        'success_rate', success_rate,
        'sample_count', sample_count
      ) ORDER BY success_rate DESC)
      FROM recipe_extraction_patterns
      LIMIT 10
    ) as top_patterns
  FROM stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment
COMMENT ON FUNCTION backfill_parser_patterns_batch IS 
'Processes a batch of recipes with source URLs. Returns basic pattern info. Full extraction requires TypeScript script.';

COMMENT ON FUNCTION get_backfill_stats IS 
'Returns statistics about backfill progress and learned patterns.';

