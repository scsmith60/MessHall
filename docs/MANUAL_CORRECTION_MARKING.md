# How to Manually Mark Import Attempts as User-Corrected

If the system didn't automatically detect that you corrected an import, you can manually mark it as corrected.

## Find the Attempt ID

First, find the attempt you want to mark:

```sql
SELECT 
  id,
  url,
  site_type,
  strategy_used,
  success,
  ingredients_count,
  steps_count,
  created_at
FROM recipe_import_attempts
WHERE url = 'https://www.tiktok.com/@thebkydpalate/video/7554458115484290318'
ORDER BY created_at DESC
LIMIT 5;
```

## Mark as Corrected

Once you have the attempt ID, mark it as corrected:

```sql
UPDATE recipe_import_attempts
SET user_corrected = true
WHERE id = 'YOUR_ATTEMPT_ID_HERE';
```

## Or Use the Function

You can also use the database function:

```sql
SELECT mark_import_corrected('YOUR_ATTEMPT_ID_HERE');
```

## Why It Might Not Auto-Detect

The system only auto-detects corrections if:

1. **In-memory tracking works**: The `originalImportDataRef` was populated when import succeeded
2. **Database comparison works**: There's a successful import attempt with ingredient/step counts to compare against

If the import only logged "attempt-started" (with `success: false` and `NULL` counts), the system now checks for this case and should mark it as corrected if you added ingredients/steps.

## Check What Was Learned

After marking as corrected, check the patterns:

```sql
SELECT 
  site_type,
  html_pattern,
  extraction_method,
  success_rate,
  sample_count
FROM recipe_extraction_patterns
WHERE site_type = 'tiktok'
ORDER BY last_seen_at DESC;
```

