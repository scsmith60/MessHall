# Fix Eligibility Checklist - Required Files

## Quick Fix (Run These 2 Files in Order):

### 1. **add_view_count_to_recipe_metrics.sql**
   - **Purpose**: Adds `view_count` and `viewed_at` columns to the `recipes` table
   - **Why**: The eligibility function needs these columns to count views
   - **Run this FIRST**

### 2. **create_creator_eligibility_check.sql**
   - **Purpose**: Creates/updates the `check_creator_eligibility` function
   - **Why**: This function checks all requirements including views
   - **Run this SECOND** (uses CREATE OR REPLACE, so safe to run again)

## Optional (If You Need to Set Test Data):

### 3. **set_4k_views_per_recipe.sql**
   - **Purpose**: Sets 4,000 views per recipe for testing
   - **Why**: Only needed if you need to set/update view counts
   - **Skip if you already have views set**

## After Running:

1. **Refresh your app** - Pull down to refresh or navigate away and back
2. **Test the function**:
   ```sql
   SELECT * FROM check_creator_eligibility('9858a5cf-8652-432f-9c43-f3bcfe58fce9'::UUID);
   ```

## Summary:
**Just run these 2 files in order:**
1. `add_view_count_to_recipe_metrics.sql`
2. `create_creator_eligibility_check.sql`

That's it! The other 45 files are for other features or testing.

