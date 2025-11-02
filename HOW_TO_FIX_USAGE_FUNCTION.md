# How to Fix the get_monthly_usage Function Error

You're getting an error: `column reference "month_year" is ambiguous`

This happens because the SQL function has an ambiguous column reference. Here's how to fix it:

---

## Option 1: Run the Full Migration (If You Haven't Run It Yet)

If you **haven't run** the migration `add_session_limits_and_admin_kill.sql` yet:

1. **Go to Supabase Dashboard**
   - Open your project
   - Navigate to **SQL Editor**

2. **Copy the entire migration file:**
   - Open: `supabase/migrations/add_session_limits_and_admin_kill.sql`
   - Copy **ALL** the contents

3. **Paste and Run:**
   - Paste into SQL Editor
   - Click **Run** (or press Ctrl+Enter)
   - Wait for "Success" message

4. **Done!** The function will be created with the fix already applied.

---

## Option 2: Just Fix the Function (If Migration Already Ran)

If you **already ran** the migration before, you just need to update the function:

1. **Go to Supabase Dashboard**
   - Open your project
   - Navigate to **SQL Editor**

2. **Copy the fix SQL:**
   - Use the SQL from `FIX_GET_MONTHLY_USAGE_FUNCTION.sql` file
   - Or copy this:

```sql
CREATE OR REPLACE FUNCTION get_monthly_usage(target_month TEXT DEFAULT NULL)
RETURNS TABLE (
  month_year TEXT,
  total_minutes INTEGER,
  total_sessions INTEGER,
  limit_minutes INTEGER,
  limit_reached BOOLEAN
) AS $$
DECLARE
  month_to_check TEXT;
  limit_value INTEGER;
BEGIN
  month_to_check := COALESCE(target_month, to_char(CURRENT_DATE, 'YYYY-MM'));
  
  SELECT (value::text)::integer INTO limit_value
  FROM streaming_config WHERE key = 'max_monthly_minutes';

  RETURN QUERY
  SELECT
    COALESCE(u.month_year, month_to_check) as month_year,
    COALESCE(u.total_minutes, 0) as total_minutes,
    COALESCE(u.total_sessions, 0) as total_sessions,
    limit_value as limit_minutes,
    (COALESCE(u.total_minutes, 0) >= limit_value) as limit_reached
  FROM streaming_usage u
  WHERE u.month_year = month_to_check
  UNION ALL
  SELECT
    month_to_check,
    0,
    0,
    limit_value,
    false
  WHERE NOT EXISTS (SELECT 1 FROM streaming_usage u2 WHERE u2.month_year = month_to_check);
END;
$$ LANGUAGE plpgsql;
```

3. **Paste and Run:**
   - Paste into SQL Editor
   - Click **Run** (or press Ctrl+Enter)
   - Should see "Success. No rows returned"

4. **Done!** The error should now be fixed.

---

## Which Option Should I Use?

**Check if you have these tables:**
- `streaming_usage`
- `streaming_config`

**If YES** → Use **Option 2** (just fix the function)
**If NO** → Use **Option 1** (run the full migration)

---

## Verify It Works

After running either option, test the function:

```sql
SELECT * FROM get_monthly_usage();
```

Should return a row with usage data (or empty if no usage tracked yet).

---

## Quick Checklist

- [ ] Opened Supabase Dashboard → SQL Editor
- [ ] Pasted the appropriate SQL (Option 1 or Option 2)
- [ ] Clicked "Run"
- [ ] Saw "Success" message
- [ ] Tested with `SELECT * FROM get_monthly_usage();`
- [ ] Error is gone! ✅

