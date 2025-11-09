-- create_product_suggestions.sql
-- Creates table for managing product suggestions

CREATE TABLE IF NOT EXISTS product_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_name TEXT NOT NULL,
  store TEXT NOT NULL,
  product_title TEXT NOT NULL,
  product_id TEXT NOT NULL,
  brand TEXT,
  variant TEXT,
  is_default BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_product_suggestions_lookup 
  ON product_suggestions(ingredient_name, store, is_default DESC, priority DESC);

-- Index for owner management
CREATE INDEX IF NOT EXISTS idx_product_suggestions_store 
  ON product_suggestions(store, ingredient_name);

-- Index for ingredient search
CREATE INDEX IF NOT EXISTS idx_product_suggestions_ingredient 
  ON product_suggestions(ingredient_name);

-- Unique partial index: only one default per ingredient+store combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_suggestions_unique_default
  ON product_suggestions(ingredient_name, store)
  WHERE is_default = true;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_product_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_suggestions_updated_at
  BEFORE UPDATE ON product_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_product_suggestions_updated_at();

-- RLS Policies
ALTER TABLE product_suggestions ENABLE ROW LEVEL SECURITY;

-- Anyone can read
CREATE POLICY "Anyone can read product suggestions"
  ON product_suggestions
  FOR SELECT
  USING (true);

-- Only admins can manage
CREATE POLICY "Only admins can manage product suggestions"
  ON product_suggestions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Insert initial examples
INSERT INTO product_suggestions (ingredient_name, store, product_title, product_id, brand, variant, is_default, priority)
VALUES
  ('eggs', 'walmart', 'Large Eggs', 'w-eggs-12', 'Great Value', '12 count', true, 10),
  ('eggs', 'amazon', 'Large Eggs', 'A-EGGS-12', 'Amazon Basics', '12 count', true, 10),
  ('sugar', 'walmart', 'Granulated Sugar', 'w-sugar-4lb', 'Great Value', '4 lb bag', true, 10),
  ('sugar', 'amazon', 'Granulated Sugar', 'A-SUGAR-4LB', 'Amazon Basics', '4 lb bag', true, 10),
  ('flour', 'walmart', 'All-Purpose Flour', 'w-flour-5lb', 'Great Value', '5 lb bag', true, 10),
  ('flour', 'amazon', 'All-Purpose Flour', 'A-FLOUR-5LB', 'Amazon Basics', '5 lb bag', true, 10),
  ('milk', 'walmart', 'Whole Milk', 'w-milk-1gal', 'Great Value', '1 gallon', true, 10),
  ('milk', 'amazon', 'Whole Milk', 'A-MILK-1GAL', 'Amazon Basics', '1 gallon', true, 10)
ON CONFLICT (ingredient_name, store) WHERE is_default = true
DO NOTHING;
