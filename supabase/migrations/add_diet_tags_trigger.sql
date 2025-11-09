-- add_diet_tags_trigger.sql
-- Creates triggers to automatically classify diet_tags when recipes are created or updated

-- Trigger for INSERT (when recipe is created) - classify after creation
CREATE OR REPLACE FUNCTION update_recipe_diet_tags_on_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_ingredients TEXT[];
BEGIN
  -- Get all ingredients for this recipe (might be empty on initial insert)
  SELECT ARRAY_AGG(ri.text ORDER BY ri.pos)
  INTO v_ingredients
  FROM public.recipe_ingredients ri
  WHERE ri.recipe_id = NEW.id;

  -- Update diet_tags
  UPDATE public.recipes
  SET diet_tags = classify_recipe_diet_tags(NEW.title, COALESCE(v_ingredients, ARRAY[]::TEXT[]))
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for INSERT (when recipe is created)
DROP TRIGGER IF EXISTS trigger_classify_recipe_diet_tags_insert ON public.recipes;
CREATE TRIGGER trigger_classify_recipe_diet_tags_insert
  AFTER INSERT ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION update_recipe_diet_tags_on_insert();

-- Trigger for UPDATE (when title changes) - classify after title update
CREATE OR REPLACE FUNCTION update_recipe_diet_tags_on_title_change()
RETURNS TRIGGER AS $$
DECLARE
  v_ingredients TEXT[];
BEGIN
  -- Get all ingredients for this recipe
  SELECT ARRAY_AGG(ri.text ORDER BY ri.pos)
  INTO v_ingredients
  FROM public.recipe_ingredients ri
  WHERE ri.recipe_id = NEW.id;

  -- Update diet_tags
  UPDATE public.recipes
  SET diet_tags = classify_recipe_diet_tags(NEW.title, COALESCE(v_ingredients, ARRAY[]::TEXT[]))
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for UPDATE (when title changes)
DROP TRIGGER IF EXISTS trigger_classify_recipe_diet_tags_update ON public.recipes;
CREATE TRIGGER trigger_classify_recipe_diet_tags_update
  AFTER UPDATE OF title ON public.recipes
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION update_recipe_diet_tags_on_title_change();

-- Trigger for when ingredients are added/updated/deleted
CREATE OR REPLACE FUNCTION update_recipe_diet_tags_on_ingredient_change()
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

  -- Update diet_tags
  UPDATE public.recipes
  SET diet_tags = classify_recipe_diet_tags(v_title, COALESCE(v_ingredients, ARRAY[]::TEXT[]))
  WHERE id = COALESCE(NEW.recipe_id, OLD.recipe_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_classify_diet_tags_on_ingredient_insert ON public.recipe_ingredients;
CREATE TRIGGER trigger_classify_diet_tags_on_ingredient_insert
  AFTER INSERT ON public.recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION update_recipe_diet_tags_on_ingredient_change();

DROP TRIGGER IF EXISTS trigger_classify_diet_tags_on_ingredient_update ON public.recipe_ingredients;
CREATE TRIGGER trigger_classify_diet_tags_on_ingredient_update
  AFTER UPDATE ON public.recipe_ingredients
  FOR EACH ROW
  WHEN (OLD.text IS DISTINCT FROM NEW.text)
  EXECUTE FUNCTION update_recipe_diet_tags_on_ingredient_change();

DROP TRIGGER IF EXISTS trigger_classify_diet_tags_on_ingredient_delete ON public.recipe_ingredients;
CREATE TRIGGER trigger_classify_diet_tags_on_ingredient_delete
  AFTER DELETE ON public.recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION update_recipe_diet_tags_on_ingredient_change();

