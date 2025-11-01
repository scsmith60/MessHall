# Quick Deploy Commands

## If using Supabase CLI:

```bash
# Navigate to project
cd c:\Dev\MessHall

# Deploy both functions
supabase functions deploy daily-create-room
supabase functions deploy daily-get-token
```

## Manual Setup Checklist:

1. ✅ Get Daily.co API key from https://daily.co → Dashboard → Developers → API Keys
2. ✅ Add to Supabase: Dashboard → Edge Functions → Secrets → Add `DAILY_API_KEY`
3. ✅ Deploy functions (see commands above or use Dashboard)

That's it! Video streaming will work after these 3 steps.

