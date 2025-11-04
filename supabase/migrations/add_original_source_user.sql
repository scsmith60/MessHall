-- Add original_source_user column to recipes table for copyright compliance
-- This stores the @username or source identifier from the original post (e.g., @cookingcreator from Instagram/TikTok)
-- The source_url column already exists and will be used for the hyperlink back to the original post

ALTER TABLE public.recipes
ADD COLUMN IF NOT EXISTS original_source_user TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.recipes.original_source_user IS 'Original @username or source identifier from the imported recipe (e.g., @cookingcreator). Used with source_url for copyright attribution.';

