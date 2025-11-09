-- reset_rejected_applications.sql
-- This migration allows users with rejected applications to reapply
-- Option 1: Delete old rejected applications (users can create fresh ones)
-- Option 2: Update rejected status to 'withdrawn' (keeps history)

-- OPTION 1: Delete rejected applications (uncomment to use)
-- This allows users to create completely fresh applications
-- DELETE FROM creator_applications WHERE status = 'rejected';

-- OPTION 2: Update rejected to withdrawn (keeps history, allows resubmission)
-- This preserves the rejection history but allows new applications
UPDATE creator_applications 
SET status = 'withdrawn' 
WHERE status = 'rejected';

-- Note: The monetization screen checks for the most recent application.
-- If you delete or mark as 'withdrawn', users will see status "none" 
-- and can apply again. The creator-apply function should allow creating
-- a new application even if old ones exist.

