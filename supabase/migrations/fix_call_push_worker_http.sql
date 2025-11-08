-- Fix the call_push_worker_http function to use the correct http_post signature
-- The error shows it's calling: http_post(url => unknown, headers => jsonb, body => text)
-- But the available http_post function expects: http_post(url text, body jsonb, headers jsonb, params jsonb, timeout_milliseconds integer)

-- Step 1: Get the current function definition to see what it's doing
-- Run this first to see the current function:
/*
SELECT pg_get_functiondef(oid) as current_definition
FROM pg_proc
WHERE proname = 'call_push_worker_http';
*/

-- Step 2: Fix the function to use the correct http_post signature
-- The issue: body is being cast to text, but http_post expects jsonb
-- Also need to use the correct function signature from pg_net
CREATE OR REPLACE FUNCTION public.call_push_worker_http()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret TEXT;
  v_payload JSONB;
BEGIN
  -- Read the secret
  SELECT val INTO v_secret
  FROM public.app_secrets
  WHERE key = 'push_worker_secret'
  LIMIT 1;

  -- Build the payload as JSONB (not text)
  v_payload := jsonb_build_object('notification_id', NEW.id);

  -- Call http_post with the correct signature
  -- Use the http_post function that matches: (url text, body jsonb, headers jsonb, ...)
  -- Try net.http_post first (pg_net extension), fallback to http_post if needed
  PERFORM http_post(
    url := 'https://xjayyiagelndsodkqaga.supabase.co/functions/v1/push-worker',
    body := v_payload,  -- Keep as jsonb, don't cast to text
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't fail the notification insert
  RAISE WARNING 'Failed to call push worker: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Step 3: Re-enable the trigger
ALTER TABLE notifications ENABLE TRIGGER trg_call_push_worker_http;

-- Note: You may need to set the push_worker_url configuration:
-- ALTER DATABASE your_database SET app.push_worker_url = 'https://your-push-worker-url.com/notify';
-- Or use a different method to get the URL (environment variable, config table, etc.)

