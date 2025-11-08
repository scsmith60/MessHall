-- Create trigger to generate notifications when comments are added to recipes
-- This ensures:
-- 1. Recipe owners get notified when someone comments on their recipe
-- 2. Comment authors get notified when someone replies to their comment
-- (skips notification if the commenter is the recipe owner or parent comment author)

-- Ensure notifications table has recipe_id and comment_id columns
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES recipe_comments(id) ON DELETE CASCADE;

-- First, create a function that will be called by the trigger
-- Wrapped in exception handling so notification failures don't break comment insertion
-- SECURITY DEFINER allows the function to bypass RLS policies
CREATE OR REPLACE FUNCTION notify_recipe_owner_on_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipe_owner_id UUID;
  recipe_title TEXT;
  commenter_username TEXT;
  parent_comment_user_id UUID;
  notification_result TEXT;
BEGIN
  -- Debug: Log that trigger fired
  RAISE NOTICE 'Trigger fired: comment_id=%, recipe_id=%, user_id=%, parent_id=%', 
    NEW.id, NEW.recipe_id, NEW.user_id, NEW.parent_id;

  -- Get the recipe owner and title
  SELECT r.user_id, r.title
  INTO recipe_owner_id, recipe_title
  FROM recipes r
  WHERE r.id = NEW.recipe_id;

  -- If recipe not found, skip
  IF recipe_owner_id IS NULL THEN
    RAISE NOTICE 'Skipping notification: recipe not found for recipe_id=%', NEW.recipe_id;
    RETURN NEW;
  END IF;

  RAISE NOTICE 'Recipe owner found: owner_id=%, commenter_id=%', recipe_owner_id, NEW.user_id;

  -- Get the commenter's username for the notification
  SELECT username
  INTO commenter_username
  FROM profiles
  WHERE id = NEW.user_id;

  -- If this is a reply (has parent_id), get the parent comment author
  IF NEW.parent_id IS NOT NULL THEN
    SELECT user_id
    INTO parent_comment_user_id
    FROM recipe_comments
    WHERE id = NEW.parent_id;
  END IF;

  -- If this is a top-level comment (not a reply), notify recipe owner
  IF NEW.parent_id IS NULL THEN
    IF NEW.user_id = recipe_owner_id THEN
      RAISE NOTICE 'Skipping notification: commenter is recipe owner (self-comment)';
    ELSE
      RAISE NOTICE 'Creating notification for recipe owner: recipient=%, actor=%', recipe_owner_id, NEW.user_id;
      BEGIN
        INSERT INTO notifications (
          recipient_id,
          actor_id,
          notif_type,
          recipe_id,
          comment_id,
          title,
          body,
          is_read,
          created_at,
          updated_at
        ) VALUES (
          recipe_owner_id,                    -- recipient: recipe owner
          NEW.user_id,                        -- actor: commenter
          'comment',                          -- notification type
          NEW.recipe_id,                      -- recipe ID
          NEW.id,                             -- comment ID
          COALESCE(commenter_username, 'Someone') || ' commented on your recipe',  -- title
          COALESCE(recipe_title, 'your recipe'),  -- body: recipe title
          false,                              -- unread
          NOW(),                              -- created_at
          NOW()                               -- updated_at
        );
        RAISE NOTICE 'SUCCESS: Notification created for recipe owner (id: %)', recipe_owner_id;
        notification_result := 'Notification created for recipe owner';
      EXCEPTION WHEN OTHERS THEN
        -- Log detailed error for debugging
        RAISE WARNING 'Failed to create notification for recipe owner (recipe_id: %, commenter: %, owner: %): %', 
          NEW.recipe_id, NEW.user_id, recipe_owner_id, SQLERRM;
        RAISE WARNING 'Error details: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
        notification_result := 'Error: ' || SQLERRM;
      END;
    END IF;
  END IF;

  -- If this is a reply, notify parent comment author (if different from commenter)
  IF NEW.parent_id IS NOT NULL THEN
    IF parent_comment_user_id IS NULL THEN
      RAISE NOTICE 'Skipping notification: parent comment not found (parent_id=%)', NEW.parent_id;
    ELSIF NEW.user_id = parent_comment_user_id THEN
      RAISE NOTICE 'Skipping notification: commenter is parent author (self-reply)';
    ELSE
      RAISE NOTICE 'Creating notification for parent comment author: recipient=%, actor=%', parent_comment_user_id, NEW.user_id;
      BEGIN
        INSERT INTO notifications (
          recipient_id,
          actor_id,
          notif_type,
          recipe_id,
          comment_id,
          title,
          body,
          is_read,
          created_at,
          updated_at
        ) VALUES (
          parent_comment_user_id,             -- recipient: parent comment author
          NEW.user_id,                        -- actor: commenter
          'comment',                          -- notification type
          NEW.recipe_id,                      -- recipe ID
          NEW.id,                             -- comment ID
          COALESCE(commenter_username, 'Someone') || ' replied to your comment',  -- title
          COALESCE(recipe_title, 'your comment'),  -- body: recipe title
          false,                              -- unread
          NOW(),                              -- created_at
          NOW()                               -- updated_at
        );
        RAISE NOTICE 'SUCCESS: Notification created for parent comment author (id: %)', parent_comment_user_id;
        notification_result := 'Notification created for parent comment author';
      EXCEPTION WHEN OTHERS THEN
        -- Log detailed error for debugging
        RAISE WARNING 'Failed to create notification for parent comment author (parent_id: %, commenter: %, parent_author: %): %', 
          NEW.parent_id, NEW.user_id, parent_comment_user_id, SQLERRM;
        RAISE WARNING 'Error details: SQLSTATE=%, SQLERRM=%', SQLSTATE, SQLERRM;
        notification_result := 'Error: ' || SQLERRM;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger that fires after a comment is inserted
DROP TRIGGER IF EXISTS trigger_notify_recipe_owner_on_comment ON recipe_comments;
CREATE TRIGGER trigger_notify_recipe_owner_on_comment
  AFTER INSERT ON recipe_comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_recipe_owner_on_comment();

-- Add comment for documentation
COMMENT ON FUNCTION notify_recipe_owner_on_comment() IS 'Creates notifications when comments are added: (1) notifies recipe owner when someone comments on their recipe, (2) notifies parent comment author when someone replies to their comment. Skips notifications if the commenter is the recipe owner or parent comment author.';

-- Verify the trigger was created
-- You can run this query to check: SELECT * FROM pg_trigger WHERE tgname = 'trigger_notify_recipe_owner_on_comment';
-- To check if the function exists: SELECT * FROM pg_proc WHERE proname = 'notify_recipe_owner_on_comment';

-- Check for other triggers on notifications table that might interfere
-- Run this to see all triggers: SELECT * FROM pg_trigger WHERE tgrelid = 'notifications'::regclass;

-- NOTE: If you see errors about http_post function not existing, there's likely another trigger
-- on the notifications table trying to send push notifications. You may need to:
-- 1. Enable pg_net extension: CREATE EXTENSION IF NOT EXISTS pg_net;
-- 2. Or disable/modify that trigger if it's not needed
-- 3. Or ensure the http_post function signature matches what the trigger expects

-- NOTE: If notifications aren't being created, check:
-- 1. Supabase logs for WARNING messages from this function
-- 2. That RLS policies on notifications table allow inserts (SECURITY DEFINER should bypass, but verify)
-- 3. That the trigger is actually firing (check pg_trigger table)
-- 4. That the recipe owner is different from the commenter (no self-notifications)
-- 5. That other triggers on notifications table aren't failing and blocking the insert

