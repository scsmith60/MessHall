-- Backfill original_source_user for existing recipes
-- This extracts @username from source_url using PostgreSQL regex functions
-- Run this after add_original_source_user.sql migration

-- Update recipes with TikTok URLs (https://www.tiktok.com/@username/video/...)
UPDATE public.recipes
SET original_source_user = '@' || (regexp_match(source_url, '/@([^/]+)'))[1]
WHERE source_url IS NOT NULL
  AND original_source_user IS NULL
  AND source_url ~* 'tiktok\.com/@[^/]+';

-- Update recipes with Instagram URLs (https://www.instagram.com/username/p/... or /username/reel/...)
UPDATE public.recipes
SET original_source_user = '@' || (regexp_match(source_url, 'instagram\.com/([^/]+)/(?:p|reel|tv)/'))[1]
WHERE source_url IS NOT NULL
  AND original_source_user IS NULL
  AND source_url ~* 'instagram\.com/[^/]+/(?:p|reel|tv)/'
  AND (regexp_match(source_url, 'instagram\.com/([^/]+)/(?:p|reel|tv)/'))[1] !~ '^\d+$'; -- Don't match if it's just numbers

-- Update recipes with YouTube URLs (https://www.youtube.com/@channelname)
UPDATE public.recipes
SET original_source_user = '@' || (regexp_match(source_url, '/@([^/?#]+)'))[1]
WHERE source_url IS NOT NULL
  AND original_source_user IS NULL
  AND (source_url ~* 'youtube\.com/@' OR source_url ~* 'youtu\.be/');

-- Update recipes with Pinterest URLs (https://www.pinterest.com/username/...)
UPDATE public.recipes
SET original_source_user = '@' || (regexp_match(source_url, 'pinterest\.com/([^/]+)'))[1]
WHERE source_url IS NOT NULL
  AND original_source_user IS NULL
  AND source_url ~* 'pinterest\.com/[^/]+'
  AND (regexp_match(source_url, 'pinterest\.com/([^/]+)'))[1] != 'pin';

-- Generic fallback: extract any @username pattern from the URL
UPDATE public.recipes
SET original_source_user = (regexp_match(source_url, '@([a-zA-Z0-9._-]+)'))[1]
WHERE source_url IS NOT NULL
  AND original_source_user IS NULL
  AND source_url ~ '@[a-zA-Z0-9._-]+'
  AND NOT (source_url ~* 'tiktok\.com' OR source_url ~* 'instagram\.com' OR source_url ~* 'youtube\.com' OR source_url ~* 'youtu\.be' OR source_url ~* 'pinterest\.com');

-- Show summary
DO $$
DECLARE
  total_updated INTEGER;
  total_with_source INTEGER;
  total_with_original_user INTEGER;
BEGIN
  -- Count recipes updated
  SELECT COUNT(*) INTO total_updated
  FROM public.recipes
  WHERE original_source_user IS NOT NULL;
  
  -- Count recipes with source_url
  SELECT COUNT(*) INTO total_with_source
  FROM public.recipes
  WHERE source_url IS NOT NULL;
  
  -- Count recipes with both
  SELECT COUNT(*) INTO total_with_original_user
  FROM public.recipes
  WHERE source_url IS NOT NULL AND original_source_user IS NOT NULL;
  
  RAISE NOTICE 'Backfill Summary:';
  RAISE NOTICE '  Total recipes with source_url: %', total_with_source;
  RAISE NOTICE '  Recipes with original_source_user: %', total_updated;
  RAISE NOTICE '  Recipes with both (attribution complete): %', total_with_original_user;
END $$;

