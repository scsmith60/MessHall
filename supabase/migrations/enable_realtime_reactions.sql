-- Enable Realtime for reactions table (if not already enabled)
-- This allows real-time subscriptions to work for emoji reactions

-- Add table to realtime publication if not already added
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'enlisted_club_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE enlisted_club_reactions;
  END IF;
END $$;

