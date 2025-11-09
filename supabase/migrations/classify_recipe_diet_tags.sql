-- classify_recipe_diet_tags.sql
-- Creates a function to automatically classify recipes into diet_tags
-- based on title and ingredients using SQL pattern matching
-- Returns array of: 'vegan', 'gluten_free', 'dairy_free'

CREATE OR REPLACE FUNCTION classify_recipe_diet_tags(
  p_title TEXT,
  p_ingredients TEXT[]
) RETURNS TEXT[] AS $$
DECLARE
  v_diet_tags TEXT[] := ARRAY[]::TEXT[];
  v_search_text TEXT;
  v_blob TEXT;
  
  has_gluten BOOLEAN := false;
  has_dairy BOOLEAN := false;
  has_meat BOOLEAN := false;
  has_eggs BOOLEAN := false;
  has_honey BOOLEAN := false;
  has_fish BOOLEAN := false;
BEGIN
  -- Combine title and ingredients into searchable text
  v_search_text := lower(coalesce(p_title, '') || ' ' || array_to_string(coalesce(p_ingredients, ARRAY[]::TEXT[]), ' '));
  v_blob := v_search_text;
  
  -- Check for GLUTEN-containing ingredients
  -- Wheat, barley, rye, spelt, farro, semolina, durum, bulgur, couscous, etc.
  -- Also check for bread products, pasta, baked goods
  has_gluten := v_blob ~ '(^|[^a-z])(wheat|flour|bread|breadcrumbs?|panko|pasta|noodles?|spaghetti|penne|fusilli|farfalle|macaroni|rigatoni|fettuccine|linguine|lasagna|tortellini|ravioli|gnocchi|vermicelli|udon|ramen|soba|barley|rye|spelt|farro|semolina|durum|bulgur|couscous|malt|malted|beer|ale|soy\s+sauce|worcestershire|miso|seitan|wheat\s+gluten|vital\s+wheat\s+gluten|all-purpose\s+flour|bread\s+flour|cake\s+flour|pastry\s+flour|self-rising\s+flour|self\s+rising\s+flour|whole\s+wheat|wholemeal|graham\s+flour|wheat\s+berries|wheat\s+bran|wheat\s+germ|matzo|matzah|matzoh|pita|tortilla|wrap|bun|roll|bagel|pretzel|cracker|biscuit|crouton|stuffing|dressing|breaded|fried|batter|dough|yeast|baking\s+powder|baking\s+soda|hoagie|hoagies?|sub\s+roll|sub\s+rolls?|french\s+bread|italian\s+bread|sourdough|baguette|ciabatta|focaccia|naan|pita\s+bread|tortilla|tortillas?|wraps?|buns?|rolls?|bagels?|pretzels?|crackers?|biscuits?|croutons?|graham\s+crackers?|ritz\s+crackers?|saltines?|oyster\s+crackers?|wheat\s+crackers?|rye\s+crackers?|pasta|noodles?|spaghetti|penne|fusilli|farfalle|macaroni|rigatoni|fettuccine|linguine|lasagna|tortellini|ravioli|gnocchi|vermicelli|udon|ramen|soba|angel\s+hair|capellini|bucatini|pappardelle|tagliatelle|orecchiette|campanelle|cavatelli|gemelli|rotini|rotelle|radiatore|ruote|conchiglie|shells?|manicotti|cannelloni|ziti|mostaccioli|casarecce|trofie|strozzapreti|pici|pizza\s+dough|pizza\s+crust|pie\s+crust|pie\s+dough|pastry|puff\s+pastry|phyllo|filo|dough|bread\s+dough|pizza\s+dough|pie\s+dough|pastry\s+dough)([^a-z]|$)';
  
  -- Check for DAIRY-containing ingredients
  -- Milk, cheese, butter, cream, yogurt, etc. - comprehensive list
  has_dairy := v_blob ~ '(^|[^a-z])(milk|butter|cream|creme|sour\s+cream|cream\s+cheese|cheese|mozzarella|cheddar|parmesan|parm|gouda|feta|ricotta|brie|camembert|swiss|provolone|monterey|jack|pepper\s+jack|colby|havarti|muenster|gruyere|gruyère|fontina|asiago|pecorino|romano|manchego|goat\s+cheese|sheep\s+cheese|yogurt|yoghurt|greek\s+yogurt|kefir|buttermilk|half\s+and\s+half|heavy\s+cream|whipping\s+cream|light\s+cream|evaporated\s+milk|condensed\s+milk|sweetened\s+condensed\s+milk|powdered\s+milk|dry\s+milk|whey|casein|lactose|ghee|clarified\s+butter|margarine|ice\s+cream|gelato|sherbet|frozen\s+yogurt|custard|pudding|mascarpone|mascarpone\s+cheese|cottage\s+cheese|neufchatel|quark|fromage\s+blanc|labneh|yogurt\s+cheese|kefir\s+cheese|sour\s+milk|clabbered\s+milk|dairy|crème\s+fraîche|creme\s+fraiche|sour\s+cream|whipped\s+cream|heavy\s+whipping\s+cream|double\s+cream|single\s+cream|clotted\s+cream|devonshire\s+cream|buttercream|cream\s+cheese|philadelphia|boursin|boursault|stilton|roquefort|gorgonzola|blue\s+cheese|goat\s+cheese|chèvre|feta|halloumi|paneer|queso|queso\s+fresco|queso\s+blanco|burrata|buffalo\s+mozzarella|fresh\s+mozzarella|string\s+cheese|cream\s+cheese|mascarpone|ricotta|cottage\s+cheese|farmer\s+cheese|pot\s+cheese|curd\s+cheese|quark|fromage\s+blanc|labneh|kefir|buttermilk|sour\s+cream|greek\s+yogurt|plain\s+yogurt|vanilla\s+yogurt|yogurt|yoghurt|whole\s+milk|2%\s+milk|1%\s+milk|skim\s+milk|low\s+fat\s+milk|full\s+milk|full\s+cream\s+milk|heavy\s+cream|heavy\s+whipping\s+cream|light\s+cream|half\s+and\s+half|evaporated\s+milk|condensed\s+milk|sweetened\s+condensed\s+milk|powdered\s+milk|dry\s+milk|butter|unsalted\s+butter|salted\s+butter|clarified\s+butter|ghee|margarine|buttercream|cream\s+cheese\s+frosting|cream\s+cheese\s+icing|butter\s+frosting|butter\s+icing)([^a-z]|$)';
  
  -- Check for MEAT (for vegan check)
  has_meat := v_blob ~ '(^|[^a-z])(chicken|beef|pork|turkey|duck|goose|lamb|veal|venison|bison|rabbit|game|bacon|ham|sausage|salami|pepperoni|chorizo|prosciutto|pancetta|guanciale|speck|capicola|coppa|mortadella|andouille|kielbasa|bratwurst|meat|ground beef|ground pork|ground turkey|ground chicken|steak|roast|brisket|ribs?|chops?|cutlets?|tenderloin|sirloin|ribeye|filet|mignon|hamburger|burger|meatballs?|meatloaf|meat loaf|carnitas?|pulled pork|pulled chicken|pulled beef|barbacoa|al pastor|adobada?)([^a-z]|$)';
  
  -- Check for EGGS (for vegan check)
  has_eggs := v_blob ~ '(^|[^a-z])(egg|eggs|egg whites?|egg yolks?|whole eggs?|scrambled eggs?|fried eggs?|poached eggs?|hard-boiled eggs?|soft-boiled eggs?|deviled eggs?|mayonnaise|mayo|aioli|hollandaise|béarnaise|meringue|egg wash|egg substitute|egg replacer)([^a-z]|$)';
  
  -- Check for HONEY (for vegan check - some vegans avoid honey)
  has_honey := v_blob ~ '(^|[^a-z])(honey|bee pollen|royal jelly|beeswax)([^a-z]|$)';
  
  -- Check for FISH/SEAFOOD (for vegan check)
  has_fish := v_blob ~ '(^|[^a-z])(fish|salmon|tuna|cod|haddock|hake|pollock|tilapia|catfish|mahi|swordfish|halibut|snapper|grouper|monkfish|flounder|sole|trout|bass|pike|whitefish|anchovy|anchovies|sardine|sardines?|mackerel|herring|shrimp|prawn|prawns?|crab|crabs?|lobster|lobsters?|scallops?|scallop|clam|clams?|mussel|mussels?|oyster|oysters?|squid|calamari|octopus|cuttlefish|sea urchin|uni|eel|unagi|caviar|roe|fish roe|salmon roe|tobiko|masago|ikura|seafood)([^a-z]|$)';
  
  -- Build output array
  -- Only add tags if the recipe does NOT contain those ingredients
  
  -- Gluten-free: only if no gluten detected
  IF NOT has_gluten THEN
    v_diet_tags := array_append(v_diet_tags, 'gluten_free');
  END IF;
  
  -- Dairy-free: only if no dairy detected
  IF NOT has_dairy THEN
    v_diet_tags := array_append(v_diet_tags, 'dairy_free');
  END IF;
  
  -- Vegan: only if no meat, eggs, honey, fish, OR DAIRY detected
  IF NOT (has_meat OR has_eggs OR has_honey OR has_fish OR has_dairy) THEN
    v_diet_tags := array_append(v_diet_tags, 'vegan');
  END IF;
  
  RETURN v_diet_tags;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

