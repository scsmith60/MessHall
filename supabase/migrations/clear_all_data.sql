-- clear_all_data.sql
-- ⚠️ WARNING: This script will DELETE ALL DATA from your database
-- It preserves schema, functions, triggers, and RLS policies
-- It does NOT affect migrations or edge functions
--
-- Usage: Run this migration to clear all user data before publishing
-- 
-- What gets cleared:
-- - All user data (profiles, recipes, comments, etc.)
-- - All auth users (auth.users table)
-- - All application data tables
-- 
-- What is preserved:
-- - Database schema (tables, columns, constraints)
-- - Functions and stored procedures
-- - Triggers
-- - RLS policies
-- - Indexes
-- - Migrations history

BEGIN;

-- Disable triggers temporarily to avoid issues during truncation
SET session_replication_role = 'replica';

-- Clear data tables in order (child tables first, then parent tables)
-- This order respects foreign key constraints
-- We use DO blocks to safely handle tables that might not exist

-- 1. Clear enlisted club related tables (child tables first)
DO $$ 
BEGIN
  TRUNCATE TABLE enlisted_club_reactions CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE enlisted_club_messages CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE enlisted_club_tips CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE enlisted_club_participants CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE enlisted_club_sessions CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 2. Clear recipe-related child tables
DO $$ 
BEGIN
  TRUNCATE TABLE recipe_views CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE recipe_comments CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE recipe_saves CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE recipe_likes CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE recipe_cooks CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE recipe_ingredients CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE recipe_steps CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 3. Clear social/interaction tables
DO $$ 
BEGIN
  TRUNCATE TABLE follows CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE user_blocks CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE notifications CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 3b. Clear shopping list tables
DO $$ 
BEGIN
  TRUNCATE TABLE shopping_list_items CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE shopping_lists CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 4. Clear other application tables
DO $$ 
BEGIN
  TRUNCATE TABLE product_suggestions CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE discovered_recipe_sites CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE streaming_usage CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE streaming_config CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ 
BEGIN
  TRUNCATE TABLE sponsored_slots CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 5. Clear creator applications (if exists)
DO $$ 
BEGIN
  TRUNCATE TABLE creator_applications CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 6. Clear recipes (this will cascade to any remaining related tables)
DO $$ 
BEGIN
  TRUNCATE TABLE recipes CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 7. Clear profiles (this will cascade to any remaining related tables)
DO $$ 
BEGIN
  TRUNCATE TABLE profiles CASCADE;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 8. Clear auth users (this is the source of truth for authentication)
-- Note: This will cascade to any tables that reference auth.users
-- We use DELETE instead of TRUNCATE because auth.users has special constraints
DELETE FROM auth.users;

-- Re-enable triggers
SET session_replication_role = 'origin';

COMMIT;

-- Note: Storage buckets need to be cleared separately using the Supabase Storage API
-- See clear_storage_buckets.ts script for that

