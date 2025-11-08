-- Enable realtime for enlisted_club_messages table
-- This allows real-time chat updates to be broadcast to all viewers

ALTER PUBLICATION supabase_realtime ADD TABLE enlisted_club_messages;

