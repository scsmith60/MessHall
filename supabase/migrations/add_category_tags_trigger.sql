-- add_category_tags_trigger.sql
-- Creates a trigger to automatically classify recipes when they are created or updated

-- Trigger for UPDATE (when title changes) - classify after title update
CREATE OR REPLACE FUNCTION update_recipe_category_tags_on_title_change()
RETURNS TRIGGER AS $$
DECLARE
  v_ingredients TEXT[];
BEGIN
  -- Get all ingredients for this recipe
  SELECT ARRAY_AGG(ri.text ORDER BY ri.pos)
  INTO v_ingredients
  FROM public.recipe_ingredients ri
  WHERE ri.recipe_id = NEW.id;

  -- Update category_tags
  UPDATE public.recipes
  SET category_tags = classify_recipe_categories(NEW.title, COALESCE(v_ingredients, ARRAY[]::TEXT[]))
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for UPDATE (when title changes)
DROP TRIGGER IF EXISTS trigger_classify_recipe_categories_update ON public.recipes;
CREATE TRIGGER trigger_classify_recipe_categories_update
  AFTER UPDATE OF title ON public.recipes
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION update_recipe_category_tags_on_title_change();

-- Trigger for when ingredients are added/updated/deleted
CREATE OR REPLACE FUNCTION update_recipe_category_tags_on_ingredient_change()
RETURNS TRIGGER AS $$
DECLARE
  v_ingredients TEXT[];
  v_title TEXT;
BEGIN
  -- Get recipe title
  SELECT r.title INTO v_title
  FROM public.recipes r
  WHERE r.id = COALESCE(NEW.recipe_id, OLD.recipe_id);

  -- Get all ingredients for this recipe
  SELECT ARRAY_AGG(ri.text ORDER BY ri.pos)
  INTO v_ingredients
  FROM public.recipe_ingredients ri
  WHERE ri.recipe_id = COALESCE(NEW.recipe_id, OLD.recipe_id);

  -- Update category_tags
  UPDATE public.recipes
  SET category_tags = classify_recipe_categories(v_title, COALESCE(v_ingredients, ARRAY[]::TEXT[]))
  WHERE id = COALESCE(NEW.recipe_id, OLD.recipe_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_classify_on_ingredient_insert ON public.recipe_ingredients;
CREATE TRIGGER trigger_classify_on_ingredient_insert
  AFTER INSERT ON public.recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION update_recipe_category_tags_on_ingredient_change();

DROP TRIGGER IF EXISTS trigger_classify_on_ingredient_update ON public.recipe_ingredients;
CREATE TRIGGER trigger_classify_on_ingredient_update
  AFTER UPDATE ON public.recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION update_recipe_category_tags_on_ingredient_change();

DROP TRIGGER IF EXISTS trigger_classify_on_ingredient_delete ON public.recipe_ingredients;
CREATE TRIGGER trigger_classify_on_ingredient_delete
  AFTER DELETE ON public.recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION update_recipe_category_tags_on_ingredient_change();

