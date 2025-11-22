-- Diagnostic queries to debug notification trigger issues
-- Run these in your Supabase SQL editor to check if everything is set up correctly

-- 1. Check if the trigger exists
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled,
  tgisinternal as is_internal
FROM pg_trigger 
WHERE tgname = 'trigger_notify_recipe_owner_on_comment';

-- 2. Check if the function exists
SELECT 
  proname as function_name,
  prokind as kind,
  prosecdef as security_definer,
  prosrc as source_code
FROM pg_proc 
WHERE proname = 'notify_recipe_owner_on_comment';

-- 3. Check notifications table structure
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'notifications'
ORDER BY ordinal_position;

-- 4. Check RLS policies on notifications table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'notifications';

-- 5. Test the trigger manually (replace with actual IDs from your database)
-- This simulates what happens when a comment is inserted
/*
DO $$
DECLARE
  test_recipe_id UUID := 'YOUR_RECIPE_ID_HERE';
  test_commenter_id UUID := 'YOUR_COMMENTER_ID_HERE';
  test_recipe_owner_id UUID;
BEGIN
  -- Get recipe owner
  SELECT user_id INTO test_recipe_owner_id
  FROM recipes
  WHERE id = test_recipe_id;
  
  RAISE NOTICE 'Recipe owner: %', test_recipe_owner_id;
  RAISE NOTICE 'Commenter: %', test_commenter_id;
  
  -- Try to insert a notification directly (this is what the trigger does)
  IF test_recipe_owner_id IS NOT NULL AND test_recipe_owner_id != test_commenter_id THEN
    BEGIN
      INSERT INTO notifications (
        recipient_id,
        actor_id,
        notif_type,
        title,
        body,
        is_read,
        created_at,
        updated_at
      ) VALUES (
        test_recipe_owner_id,
        test_commenter_id,
        'comment',
        'Test notification',
        'Test body',
        false,
        NOW(),
        NOW()
      );
      RAISE NOTICE 'SUCCESS: Notification inserted successfully';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'ERROR: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'SKIPPED: Recipe owner is null or same as commenter';
  END IF;
END $$;
*/

-- 6. Check recent comments to see if trigger should have fired
SELECT 
  rc.id as comment_id,
  rc.recipe_id,
  rc.user_id as commenter_id,
  r.user_id as recipe_owner_id,
  rc.created_at as comment_created_at,
  CASE 
    WHEN rc.user_id = r.user_id THEN 'Self-comment (no notification)'
    WHEN rc.parent_id IS NOT NULL THEN 'Reply (notify parent author)'
    ELSE 'Top-level comment (should notify recipe owner)'
  END as notification_type
FROM recipe_comments rc
JOIN recipes r ON r.id = rc.recipe_id
ORDER BY rc.created_at DESC
LIMIT 10;

-- 7. Check if any notifications were created recently
SELECT 
  id,
  recipient_id,
  actor_id,
  notif_type,
  title,
  created_at
FROM notifications
ORDER BY created_at DESC
LIMIT 10;







