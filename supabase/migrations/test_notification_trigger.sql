-- Test script to verify the notification trigger is working
-- Run this after adding a comment to see what the trigger is doing

-- 1. Check if trigger exists and is enabled
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled,
  CASE tgenabled
    WHEN 'O' THEN 'origin'
    WHEN 'D' THEN 'disabled'
    WHEN 'R' THEN 'replica'
    WHEN 'A' THEN 'always'
    ELSE 'unknown'
  END as enabled_status
FROM pg_trigger 
WHERE tgname = 'trigger_notify_recipe_owner_on_comment';

-- 2. Check recent comments to see if trigger should have fired
SELECT 
  rc.id as comment_id,
  rc.recipe_id,
  rc.user_id as commenter_id,
  r.user_id as recipe_owner_id,
  rc.parent_id,
  CASE 
    WHEN rc.user_id = r.user_id THEN 'Self-comment (no notification)'
    WHEN rc.parent_id IS NOT NULL THEN 'Reply (should notify parent author)'
    ELSE 'Top-level comment (should notify recipe owner)'
  END as expected_notification,
  rc.created_at as comment_created_at
FROM recipe_comments rc
JOIN recipes r ON r.id = rc.recipe_id
ORDER BY rc.created_at DESC
LIMIT 10;

-- 3. Check if any notifications were created for those comments
SELECT 
  n.id,
  n.recipient_id,
  n.actor_id as commenter_id,
  n.notif_type,
  n.recipe_id,
  n.comment_id,
  n.title,
  n.created_at
FROM notifications n
WHERE n.comment_id IN (
  SELECT id FROM recipe_comments ORDER BY created_at DESC LIMIT 10
)
ORDER BY n.created_at DESC;

-- 4. Check Supabase logs for NOTICE and WARNING messages
-- Go to: Dashboard -> Logs -> Postgres Logs
-- Look for messages starting with "Trigger fired:" or "SUCCESS:" or "Failed to create notification"

