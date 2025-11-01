-- ============================================================
-- Fix RLS policies for planner_meals table
-- This allows users to manage their own meal planner entries
-- ============================================================

-- STEP 1: Check if user_id column exists and add it if missing
-- (Uncomment this section if user_id doesn't exist)
/*
ALTER TABLE planner_meals 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill existing rows with a default (or leave NULL if appropriate)
-- Update existing meals to belong to the first user (adjust as needed)
-- UPDATE planner_meals SET user_id = (SELECT id FROM auth.users LIMIT 1) WHERE user_id IS NULL;
*/

-- STEP 2: Ensure RLS is enabled on the table
ALTER TABLE planner_meals ENABLE ROW LEVEL SECURITY;

-- STEP 3: Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view their own planner meals" ON planner_meals;
DROP POLICY IF EXISTS "Users can insert their own planner meals" ON planner_meals;
DROP POLICY IF EXISTS "Users can update their own planner meals" ON planner_meals;
DROP POLICY IF EXISTS "Users can delete their own planner meals" ON planner_meals;

-- STEP 4: Create RLS policies

-- Policy 1: Allow users to SELECT their own meals
CREATE POLICY "Users can view their own planner meals"
ON planner_meals
FOR SELECT
USING (auth.uid() = user_id);

-- Policy 2: Allow users to INSERT their own meals
CREATE POLICY "Users can insert their own planner meals"
ON planner_meals
FOR INSERT
WITH CHECK (auth.uid() = COALESCE(user_id, auth.uid()));

-- Policy 3: Allow users to UPDATE their own meals (THIS IS THE CRITICAL ONE THAT'S MISSING!)
CREATE POLICY "Users can update their own planner meals"
ON planner_meals
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = COALESCE(user_id, auth.uid()));

-- Policy 4: Allow users to DELETE their own meals
CREATE POLICY "Users can delete their own planner meals"
ON planner_meals
FOR DELETE
USING (auth.uid() = user_id);

-- STEP 5: Verify the policies were created
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive, 
  roles, 
  cmd, 
  qual, 
  with_check
FROM pg_policies
WHERE tablename = 'planner_meals'
ORDER BY policyname;

-- STEP 6: Test query to verify you can see your meals
-- (Run this in your SQL editor to test)
-- SELECT id, recipe_id, meal_date, meal_slot, user_id 
-- FROM planner_meals 
-- WHERE user_id = auth.uid() 
-- LIMIT 5;

