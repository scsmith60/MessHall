# Session Limits, Usage Tracking & Admin Controls - Implementation Guide

## ✅ What's Been Implemented

### 1. **30-Minute Session Limit** (Configurable)
- Sessions can be limited to 30 minutes (configurable per session)
- Countdown timer shows remaining time in header
- Warning at 5 minutes remaining
- Auto-end when time limit reached
- **Note:** With self-hosted Janus, this limit can be removed/extended since costs are fixed

### 2. **Usage Tracking & Limits**
- Monthly usage tracking (minutes used)
- Configurable monthly limits (default: 100K minutes = Cloudflare free tier)
- Concurrent session limits (default: 50)
- Prevents new streams when limits are reached

### 3. **Admin Kill Session**
- Admins can immediately terminate any active session
- Requires admin authentication (`is_admin` flag in profiles)
- Shows reason to participants
- Cleans up video room when killed

---

## 📋 Database Migration

Run this migration to add the new features:

```sql
-- Run: supabase/migrations/add_session_limits_and_admin_kill.sql
```

**What it adds:**
- `max_duration_minutes` to sessions (default: 30)
- `admin_killed`, `admin_kill_reason`, `killed_by_user_id`, `killed_at` to sessions
- `streaming_usage` table for monthly tracking
- `streaming_config` table for limits configuration
- Functions: `can_start_new_session()`, `get_monthly_usage()`, `admin_kill_session()`
- Triggers to auto-update usage when sessions end

---

## 🚀 How to Use

### **Setting Usage Limits**

Update limits in database:

```sql
-- Update monthly minute limit (default: 100,000)
UPDATE streaming_config 
SET value = '150000'::jsonb 
WHERE key = 'max_monthly_minutes';

-- Update concurrent session limit (default: 50)
UPDATE streaming_config 
SET value = '100'::jsonb 
WHERE key = 'max_concurrent_sessions';

-- Disable limits (for testing)
UPDATE streaming_config 
SET value = 'false'::jsonb 
WHERE key = 'usage_check_enabled';
```

### **Admin Kill Session**

**Via Edge Function:**
```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/admin-kill-session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "SESSION_UUID",
    "reason": "Violation of terms of service"
  }'
```

**Via Code:**
```typescript
await supabase.functions.invoke("admin-kill-session", {
  body: {
    session_id: sessionId,
    reason: "Reason for termination",
  },
});
```

**In UI:**
- Admin users see a warning icon (⚠️) in the header
- Click to kill session with optional reason

---

## 📊 Usage Monitoring

### **Check Current Month Usage**

```sql
SELECT * FROM get_monthly_usage();
```

Returns:
- `total_minutes`: Minutes used this month
- `limit_minutes`: Monthly limit
- `limit_reached`: Boolean if limit hit

### **View Historical Usage**

```sql
SELECT * FROM streaming_usage 
ORDER BY month_year DESC;
```

### **View Active Sessions**

```sql
SELECT 
  id,
  title,
  host_id,
  started_at,
  max_duration_minutes,
  EXTRACT(EPOCH FROM (NOW() - started_at)) / 60 as minutes_elapsed
FROM enlisted_club_sessions
WHERE status = 'active';
```

---

## ⚙️ Configuration Options

### **Streaming Config Keys:**

| Key | Default | Description |
|-----|---------|-------------|
| `max_monthly_minutes` | 50000 | Max streaming minutes per month (default, adjust to budget) |
| `max_concurrent_sessions` | 50 | Max active sessions at once |
| `session_duration_limit` | 30 | Default max session duration (minutes) |
| `usage_check_enabled` | true | Enable/disable usage limit checking |

### **Update Config:**

```sql
UPDATE streaming_config 
SET value = 'NEW_VALUE'::jsonb,
    updated_at = NOW()
WHERE key = 'KEY_NAME';
```

---

## 🎯 Edge Functions

### **1. `daily-create-room`**
- ✅ Checks usage limits before creating room
- ✅ Prevents streaming if limits reached
- ✅ Returns 429 error if limit exceeded

### **2. `admin-kill-session`** (NEW)
- ✅ Verifies admin status
- ✅ Kills session immediately
- ✅ Cleans up video room
- ✅ Records kill reason

---

## 📱 UI Features

### **Session Timer Display**
- Shows in header: "MM:SS remaining"
- Turns red when < 5 minutes
- Auto-updates every second

### **Usage Warnings**
- Banner shown when monthly limit reached
- Prevents starting new streams

### **Admin Controls**
- Warning icon (⚠️) in header for admins
- Click to kill session
- Confirmation dialog with reason field

---

## 🔧 Customization

### **Change Default Session Duration**

```sql
-- Update default for all new sessions
ALTER TABLE enlisted_club_sessions 
ALTER COLUMN max_duration_minutes SET DEFAULT 45;

-- Or per-session when creating
INSERT INTO enlisted_club_sessions (..., max_duration_minutes) 
VALUES (..., 60); -- 60 minutes
```

### **Adjust Monthly Limit**

```sql
-- Set to 200K minutes (Cloudflare at $200/month)
UPDATE streaming_config 
SET value = '200000'::jsonb 
WHERE key = 'max_monthly_minutes';
```

### **Adjust Concurrent Session Limit**

```sql
-- Allow 100 concurrent sessions
UPDATE streaming_config 
SET value = '100'::jsonb 
WHERE key = 'max_concurrent_sessions';
```

---

## 🚨 Error Handling

### **When Limits Are Reached:**

**Error Response:**
```json
{
  "ok": false,
  "error": "Streaming is currently unavailable. Monthly usage limit reached or too many concurrent sessions."
}
```

**UI Shows:**
- Usage limit banner
- "Start Video" button disabled
- Message explaining limit reached

### **When Session is Admin-Killed:**

**Session Status:**
- `status`: "ended"
- `admin_killed`: true
- `admin_kill_reason`: Reason provided
- `killed_at`: Timestamp

**UI Shows:**
- Red warning banner
- Termination message
- No video access

---

## 📈 Monitoring & Alerts

### **Check If Approaching Limits**

```sql
-- Get current month usage percentage
SELECT 
  month_year,
  total_minutes,
  (SELECT (value::text)::integer FROM streaming_config WHERE key = 'max_monthly_minutes') as limit,
  ROUND(100.0 * total_minutes / 
    (SELECT (value::text)::integer FROM streaming_config WHERE key = 'max_monthly_minutes'), 2) as usage_percent
FROM streaming_usage
WHERE month_year = to_char(CURRENT_DATE, 'YYYY-MM');
```

### **Set Up Alerts (Optional)**

You can create a cron job or scheduled function to alert when approaching limits:

```sql
-- Create alert function (run daily)
CREATE OR REPLACE FUNCTION check_usage_alerts()
RETURNS void AS $$
DECLARE
  current_usage INTEGER;
  limit_minutes INTEGER;
  usage_percent NUMERIC;
BEGIN
  SELECT COALESCE(total_minutes, 0) INTO current_usage
  FROM streaming_usage
  WHERE month_year = to_char(CURRENT_DATE, 'YYYY-MM');

  SELECT (value::text)::integer INTO limit_minutes
  FROM streaming_config WHERE key = 'max_monthly_minutes';

  usage_percent := 100.0 * current_usage / limit_minutes;

  -- Alert at 80% usage
  IF usage_percent >= 80 THEN
    -- Send notification (implement your notification system)
    RAISE NOTICE 'Usage at %.2f%% (% minutes / % minutes)', usage_percent, current_usage, limit_minutes;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## 🔐 Security

### **Admin Verification**
- Uses `profiles.is_admin` flag
- Edge function verifies admin status
- Only admins can kill sessions

### **RLS Policies**
- Admin policies added for config updates
- Usage stats readable by all (for transparency)
- Sessions can only be killed by admins

---

## 🧪 Testing

### **Test Usage Limits:**
1. Set low monthly limit: `UPDATE streaming_config SET value = '1000'::jsonb WHERE key = 'max_monthly_minutes';`
2. Create sessions until limit reached
3. Try to start new stream → Should be blocked
4. Reset limit when done

### **Test Session Timer:**
1. Create session with `max_duration_minutes = 1` (for quick test)
2. Start video
3. Wait 1 minute → Should auto-end

### **Test Admin Kill:**
1. Login as admin user
2. Create/join active session
3. Click warning icon → Kill session
4. Verify session ends and shows termination message

---

## 📚 Related Files

- **Migration:** `supabase/migrations/add_session_limits_and_admin_kill.sql`
- **Edge Function:** `supabase/functions/admin-kill-session/index.ts`
- **Updated Function:** `supabase/functions/daily-create-room/index.ts`
- **UI Component:** `app/enlisted-club/[id].tsx`
- **Janus Guide:** `JANUS_WEBRTC_SETUP_GUIDE.md`
- **Budget Guide:** `BUDGET_FRIENDLY_STREAMING_OPTIONS.md`

---

## ✅ Next Steps

1. **Run Migration:**
   ```bash
   # In Supabase Dashboard → SQL Editor
   # Copy and paste contents of add_session_limits_and_admin_kill.sql
   ```

2. **Set Admin Users:**
   ```sql
   UPDATE profiles SET is_admin = true WHERE id = 'USER_UUID';
   ```

3. **Configure Limits:**
   ```sql
   -- Adjust based on your budget (example: 50K minutes = $50/month with Cloudflare)
   UPDATE streaming_config SET value = '50000'::jsonb WHERE key = 'max_monthly_minutes';
   ```

4. **Deploy Edge Functions:**
   ```bash
   supabase functions deploy admin-kill-session
   ```

5. **Test Everything!**

---

**All features are ready to use!** 🎉

