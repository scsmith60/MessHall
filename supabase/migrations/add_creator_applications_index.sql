-- add_creator_applications_index.sql
-- Adds index on creator_applications.user_id for faster queries
-- This prevents timeout issues when querying applications

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_creator_applications_user_id 
ON creator_applications(user_id, submitted_at DESC);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_creator_applications_status 
ON creator_applications(status) 
WHERE status IN ('pending', 'approved', 'rejected', 'withdrawn');

-- Add comment
COMMENT ON INDEX idx_creator_applications_user_id IS 
'Index for fast lookup of user applications ordered by submission date';

COMMENT ON INDEX idx_creator_applications_status IS 
'Index for filtering applications by status';

