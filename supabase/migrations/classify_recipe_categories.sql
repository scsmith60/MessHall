-- classify_recipe_categories.sql
-- Creates a function to automatically classify recipes into category_tags
-- based on title and ingredients using SQL ILIKE pattern matching (similar to old mh_classify_categories_recipe)
-- Uses word boundaries and ignores stock/broth/bouillon

CREATE OR REPLACE FUNCTION classify_recipe_categories(
  p_title TEXT,
  p_ingredients TEXT[]
) RETURNS TEXT[] AS $$
DECLARE
  v_categories TEXT[] := ARRAY[]::TEXT[];
  v_search_text TEXT;
  v_blob TEXT;
  
  -- Don't count stock/broth/bouillon
  re_stock TEXT := '(stock|broth|bouillon|base|consomm[eé])';
  
  has_bbq BOOLEAN := false;
  has_app BOOLEAN := false;
  has_breakfast BOOLEAN := false;
  has_chicken BOOLEAN := false;
  has_beef BOOLEAN := false;
  has_pork BOOLEAN := false;
  has_seafood BOOLEAN := false;
  has_pasta BOOLEAN := false;
  has_salad BOOLEAN := false;
  has_soup BOOLEAN := false;
  has_vegetarian BOOLEAN := false;
  has_drinks BOOLEAN := false;
  has_desserts BOOLEAN := false;
BEGIN
  -- Combine title and ingredients into searchable text
  v_search_text := lower(coalesce(p_title, '') || ' ' || array_to_string(coalesce(p_ingredients, ARRAY[]::TEXT[]), ' '));
  v_blob := v_search_text;
  
  -- BBQ
  has_bbq := v_blob ~ '(bbq|barbecue|barbeque|smoked|smoker|dry rub|bark|mop sauce|bbq sauce|ribs?|brisket|pulled pork|burnt ends|smoke ring|hickory|mesquite|grilled|grilling|charcoal|grill)';
  
  -- Appetizers (EXPANDED - includes fries, mini items, etc.)
  has_app := v_blob ~ '(appetizer|starter|snack|dip|finger food|bites?|sliders?|wings?|boneless wings?|tenders?|nuggets?|mozzarella sticks?|mozz sticks?|cheese curds?|fries?|french fries?|loaded fries?|onion rings?|potato skins?|jalapeñ?o poppers?|popper(s)?|spring rolls?|egg rolls?|quesadill(a|as)|taquitos?|empanadas?|bruschetta|tapas|canape|stuffed mushrooms?|skewers?|kebabs?|crostini|nachos?|chips?|crackers?|pita chips?|tortilla chips?|salsa|guacamole|hummus|baba ganoush|tzatziki|ranch|spinach dip|artichoke dip|buffalo dip|seven layer dip|pico de gallo|sour cream|mini [^ ]+|miniature|bite[s]? sized|hors d''oeuvre|hors d''oeuvres|canap[ée]s?|deviled eggs?|stuffed eggs?|meatballs?|cocktail meatballs?|pigs? in a blanket|sausage rolls?|pinwheels?|pin wheels?|roll ups?|cucumber bites?|tomato bites?|caprese bites?|bacon wrapped|bacon wrapped [^ ]+|stuffed jalapeñ?os?|cheese ball|cheese balls?|crab dip|shrimp dip|buffalo wings?|chicken wings?|drumettes?|flat(s)?|chicken tenders?|potato wedges?|sweet potato fries?|waffle fries?|curly fries?|tater tots?|tots?|hash browns?|hashbrowns?|potato pancakes?|latkes?|zucchini fritters?|corn fritters?|hush puppies?|fritters?|beignets?|doughnut holes?|donut holes?|mini [^ ]+ [^ ]+|baby [^ ]+|cocktail [^ ]+|single serve|single-serving|appetizer size|starter size)';
  
  -- Breakfast
  has_breakfast := v_blob ~ '(breakfast|brunch|pancake|pancakes?|waffle|waffles?|french toast|scrambled eggs?|omelet|omelette|frittata|breakfast burrito|breakfast sandwich|bacon and eggs?|cereal|oatmeal|porridge|granola|muesli|hash brown|hashbrown|home fries?|breakfast casserole|breakfast hash|breakfast bowl|breakfast wrap|breakfast tacos?|breakfast pizza|eggs? benedict|eggs? florentine|eggs? royale|shakshuka|eggs? in purgatory|chilaquiles|huevos rancheros|breakfast quesadilla|breakfast enchiladas?|breakfast skillet|breakfast scramble|breakfast bake|breakfast muffins?|breakfast cookies?|breakfast bars?|energy bars?|protein bars?|granola bars?|breakfast smoothie|breakfast shake|overnight oats?|chiapudding|chia pudding|yogurt parfait|parfait|acai bowl|smoothie bowl|breakfast salad|breakfast greens?|scrambled tofu|tofu scramble|vegan eggs?|just eggs?|breakfast sausage|sausage patties?|sausage links?|breakfast links?|breakfast patties?|canadian bacon|back bacon|ham steak|breakfast ham|breakfast potatoes?|breakfast sweet potatoes?|breakfast rice|breakfast quinoa|breakfast farro|breakfast barley|breakfast couscous)';
  
  -- Chicken (real pieces/forms only, ignore stock - includes compound dishes like butter chicken)
  has_chicken := (v_blob ~ '(^|[^a-z])(whole\s+chicken|rotisserie\s+chicken|ground\s+chicken|chicken\s*(thighs?|breasts?|drumsticks?|wings?|tenders?|cutlets?|legs?|quarters?|pieces?|parts?|dish|recipe|dinner|meal|curry|stir\s+fry|teriyaki|alfredo|marsala|parmesan|piccata|francese|scarpariello|cacciatore|saltimbocca|korma|tikka|masala|vindaloo|biryani|tandoori|butter\s+chicken|garlic\s+butter\s+chicken|lemon\s+chicken|orange\s+chicken|general\s+tsos?\s+chicken|general\s+gaos?\s+chicken|sesame\s+chicken|sweet\s+and\s+sour\s+chicken|kung\s+pao\s+chicken|moo\s+goo\s+gai\s+pan|chicken\s+and\s+rice|chicken\s+and\s+dumplings?|chicken\s+and\s+waffles?|chicken\s+and\s+biscuits?|chicken\s+nuggets?|chicken\s+tenders?|chicken\s+wings?|fried\s+chicken|roast\s+chicken|grilled\s+chicken|baked\s+chicken|braised\s+chicken|poached\s+chicken|steamed\s+chicken|chicken\s+soup|chicken\s+stew|chicken\s+chili|chicken\s+salad|chicken\s+sandwich|chicken\s+burger|chicken\s+tacos?|chicken\s+quesadilla|chicken\s+enchiladas?|chicken\s+fajitas?|chicken\s+burrito|chicken\s+sliders?))([^a-z]|$)') AND NOT (v_blob ~ ('chicken.{0,20}' || re_stock));
  
  -- Beef (BIG list - from old code plus more)
  has_beef := (v_blob ~ '(^|[^a-z])(ground\s+beef|beef(\s+(steak|short\s*ribs?|brisket|sirloin|ribeye|rib\s*eye|tomahawk|chuck|oxtail|tenderloin|ribs?|tips|roast|stew|jerky|burger|burgers?|hamburger|hamburgers?|meatballs?|meatloaf|meat loaf))?|filet\s+mignon|tenderloin\s+steak|chateaubriand|flank\s+steak|skirt\s+steak|hanger\s+steak|tri[-\s]?tip(\s+steak)?|new\s+york\s+strip|n\.?y\.?\s*strip|ny\s*strip|strip\s+steak|strip\s+loin|sirloin\s+steak|porterhouse|t[-\s]?bone|prime\s+rib|tomahawk|denver\s+steak|flat\s*iron\s+steak|bavette(\s+steak)?|picanha|culotte(\s+steak)?|rump\s*cap|london\s+broil|chuck\s+roast|rump\s+roast|sirloin\s+tip\s+roast|top\s+round\s+roast|bottom\s+round\s+roast|eye\s+of\s+round\s+roast|tri[-\s]?tip\s+roast|tenderloin\s+roast|standing\s+rib\s+roast|rib\s+roast|pot\s+roast|beef\s+roast|corned\s+beef|pastrami|beef\s+stroganoff|beef\s+wellington|beef\s+bourguignon|beef\s+rendang|beef\s+curry|beef\s+stir\s+fry|beef\s+bulgogi|beef\s+teriyaki|beef\s+fajitas?|beef\s+tacos?|beef\s+enchiladas?|beef\s+quesadilla|beef\s+empanadas?|beef\s+sliders?)([^a-z]|$)') AND NOT (v_blob ~ ('beef.{0,20}' || re_stock));
  
  -- Pork (EXPANDED - more flexible matching for cured meats)
  has_pork := (v_blob ~ '(^|[^a-z])(pulled\s+pork|pork\s*(shoulder|butt|ribs?|loin|tenderloin|chops?|cutlets?|belly|roast|stew|carnitas?|adobada?|al\s+pastor|barbacoa|sliders?|tacos?|quesadilla|empanadas?)|bacon|ham|ham\s+steak|ham\s+hock|pork\s+hock|pancetta|guanciale|prosciutto|prosciutto\s+di\s+parma|serrano\s+ham|iberico\s+ham|jamón|jamón\s+ibérico|jamón\s+serrano|speck|capicola|coppa|sopressata|mortadella|salami|pepperoni|chorizo|andouille|kielbasa|bratwurst|bratwursts?|sausage|sausages?|pork\s+sausage|italian\s+sausage|breakfast\s+sausage|sausage\s+links?|sausage\s+patties?|pork\s+belly|pork\s+rinds?|chicharrones?|pork\s+skin|pork\s+cracklings?|pork\s+fat|lard|pork\s+meatballs?|pork\s+meatloaf|pork\s+loaf|pork\s+chop|pork\s+chops?|pork\s+loin|pork\s+tenderloin|pork\s+shoulder|pork\s+butt|pork\s+ribs?|country\s+ham|virginia\s+ham|black\s+forest\s+ham|honey\s+ham|spiral\s+ham|baked\s+ham|glazed\s+ham|smoked\s+ham|boiled\s+ham)([^a-z]|$)') AND NOT (v_blob ~ ('pork.{0,20}' || re_stock));
  
  -- Seafood (BIG list - from old code plus more)
  has_seafood := (v_blob ~ '(^|[^a-z])(shrimp|prawn|prawns?|crab|crabs?|lobster|lobsters?|scallops?|scallop|clam|clams?|mussel|mussels?|oyster(?!\s*mushroom)|oysters?|conch|conchs?|cockles?|cockle|octopus|squid|calamari|cuttlefish|sea\s*urchin|uni|fish|salmon(\s+steaks?)?|tuna(\s+steaks?)?|cod|haddock|hake|pollock|tilapia|catfish|mahi[-\s]?mahi(\s+steaks?)?|swordfish(\s+steaks?)?|halibut(\s+steaks?)?|snapper|red\s*snapper|grouper|monkfish|flounder|sole|plaice|lingcod|walleye|perch|yellowtail|amberjack|sea\s*bass|branzino|mackerel|sardine|sardines?|anchov(?:y|ies)|trout|arctic\s+char|rainbow\s+trout|brook\s+trout|steelhead|bass|striped\s+bass|largemouth\s+bass|smallmouth\s+bass|pike|pickerel|whitefish|lake\s+trout|salmon\s+trout|caviar|roe|fish\s+roe|salmon\s+roe|tobiko|masago|ikura|unagi|eel|sea\s+urchin|sea\s+cucumber|sea\s+snail|whelk|abalone|geoduck|razor\s+clam|razor\s+clams?|langoustine|langoustines?|crayfish|crawfish|crawdads?|lobster\s+tail|lobster\s+tails?|crab\s+legs?|crab\s+meat|king\s+crab|snow\s+crab|dungeness\s+crab|blue\s+crab|soft\s+shell\s+crab|hard\s+shell\s+crab|stone\s+crab|jumbo\s+shrimp|colossal\s+shrimp|tiger\s+shrimp|white\s+shrimp|pink\s+shrimp|rock\s+shrimp|spot\s+shrimp|sushi|sashimi|poke|ceviche|crudo|tartare|seafood\s+tower|seafood\s+platter|seafood\s+boil|low\s+country\s+boil|crab\s+boil|shrimp\s+boil)([^a-z]|$)') AND NOT (v_blob ~ ('seafood.{0,20}' || re_stock));
  
  -- Pasta/noodles/rice dishes (EXPANDED - includes risotto, paella, etc.)
  has_pasta := v_blob ~ '(^|[^a-z])(pasta|noodle(s)?|spaghetti|penne|fusilli|farfalle|mac(aroni)?|rigatoni|fettuccine|linguine|lasagna|lasagne|tortellini|ravioli|gnocchi|vermicelli|udon|ramen|soba|angel\s+hair|capellini|bucatini|pappardelle|tagliatelle|tagliolini|orecchiette|campanelle|cavatelli|gemelli|rotini|rotelle|radiatore|ruote|conchiglie|shells?|manicotti|cannelloni|ziti|penne\s+rigate|mostaccioli|casarecce|trofie|strozzapreti|pici|carbonara|alfredo|marinara|bolognese|pesto|arrabbiata|puttanesca|amatriciana|cacio\s+e\s+pepe|aglio\s+e\s+olio|primavera|vodka\s+sauce|pink\s+sauce|white\s+sauce|béchamel|pomodoro|tomato\s+sauce|meat\s+sauce|ragu|chow\s+mein|lo\s+mein|pad\s+thai|pad\s+see\s+ew|pho|somen|shirataki|konjac|glass\s+noodles?|rice\s+noodles?|bean\s+thread\s+noodles?|cellophane\s+noodles?|risotto|paella|jambalaya|pilaf|pilau|biryani|fried\s+rice|sticky\s+rice|arroz\s+con\s+pollo|arroz\s+rojo|arroz\s+valenciana|sushi\s+rice|sushi\s+rolls?|onigiri|rice\s+bowl|grain\s+bowl|burrito\s+bowl|rice\s+dishes?|rice\s+preparation)([^a-z]|$)';
  
  -- Salad (EXPANDED)
  has_salad := v_blob ~ '(salad|caesar\s+salad|greek\s+salad|cobb\s+salad|waldorf\s+salad|coleslaw|potato\s+salad|pasta\s+salad|fruit\s+salad|green\s+salad|side\s+salad|house\s+salad|garden\s+salad|wedge\s+salad|nicoise|chef\s+salad|chef''s\s+salad|antipasto\s+salad|caprese\s+salad|insalata|caprese|panzanella|fattoush|tabbouleh|tabouleh|quinoa\s+salad|rice\s+salad|grain\s+salad|farro\s+salad|barley\s+salad|bulgur\s+salad|couscous\s+salad|bean\s+salad|chickpea\s+salad|lentil\s+salad|edamame\s+salad|tofu\s+salad|chicken\s+salad|tuna\s+salad|shrimp\s+salad|crab\s+salad|lobster\s+salad|egg\s+salad|ham\s+salad|macaroni\s+salad|german\s+potato\s+salad|american\s+potato\s+salad|mayonnaise\s+potato\s+salad|mustard\s+potato\s+salad|slaw|cabbage\s+slaw|broccoli\s+slaw|carrot\s+slaw|kohlrabi\s+slaw|apple\s+slaw|asian\s+slaw|thai\s+slaw|vietnamese\s+slaw|korean\s+slaw|japanese\s+slaw|chinese\s+slaw|ambrosia\s+salad|jello\s+salad|gelatin\s+salad|whip\s+salad|sunshine\s+salad|watergate\s+salad|pistachio\s+salad|strawberry\s+pretzel\s+salad|seven\s+layer\s+salad|layered\s+salad|taco\s+salad|mexican\s+salad|southwest\s+salad|southwestern\s+salad|mediterranean\s+salad|middle\s+eastern\s+salad|italian\s+salad|french\s+salad|spanish\s+salad|german\s+salad|russian\s+salad|olivier\s+salad|ensalada|ensaladas?)';
  
  -- Soup (EXPANDED - but ignore stock/broth/bouillon when used as ingredient)
  -- Prioritize soup if "soup" is in the name, even if it contains seafood
  -- First check if "soup" appears as a whole word (most reliable indicator)
  -- This catches "She-Crab Soup", "crab soup", "chicken soup", etc.
  -- Use simple pattern matching - "soup" with word boundaries or explicit patterns
  IF v_blob ~ '\ysoup\y' OR v_blob ~ '(^|[^a-z])soup([^a-z]|$)' THEN
    has_soup := true;
  ELSIF v_blob ~ '(stew|chowder|bisque|consomme|gumbo|gazpacho|minestrone|chili|potage|ramen|pho|miso\s+soup|chicken\s+soup|beef\s+stew|vegetable\s+soup|tomato\s+soup|tomato\s+bisque|cream\s+of\s+tomato|butternut\s+squash\s+soup|squash\s+soup|pumpkin\s+soup|carrot\s+soup|carrot\s+ginger\s+soup|broccoli\s+soup|cream\s+of\s+broccoli|broccoli\s+cheddar\s+soup|cauliflower\s+soup|cream\s+of\s+cauliflower|mushroom\s+soup|cream\s+of\s+mushroom|onion\s+soup|french\s+onion\s+soup|potato\s+soup|cream\s+of\s+potato|potato\s+leek\s+soup|leek\s+soup|vichyssoise|zucchini\s+soup|corn\s+chowder|clam\s+chowder|manhattan\s+clam\s+chowder|new\s+england\s+clam\s+chowder|seafood\s+chowder|fish\s+chowder|lobster\s+bisque|crab\s+bisque|shrimp\s+bisque|she[-\s]crab[-\s]*soup|she-crab\s+soup|she\s+crab\s+soup|shecrab\s+soup|crab\s+soup|oyster\s+stew|seafood\s+stew|bouillabaisse|cioppino|jambalaya|gumbo\s+ya\s+ya|chicken\s+noodle\s+soup|chicken\s+and\s+rice\s+soup|chicken\s+and\s+dumplings?|matzo\s+ball\s+soup|matzah\s+ball\s+soup|matzoh\s+ball\s+soup|chicken\s+and\s+stars|alphabet\s+soup|beef\s+barley\s+soup|beef\s+and\s+vegetable\s+soup|irish\s+stew|beef\s+bourguignon|coq\s+au\s+vin|osso\s+buco|ratatouille|vegetable\s+stew|pasta\s+e\s+fagioli|pasta\s+fagioli|pasta\s+fazool|escarole\s+soup|escarole\s+and\s+beans?|lentil\s+soup|split\s+pea\s+soup|black\s+bean\s+soup|white\s+bean\s+soup|navy\s+bean\s+soup|chickpea\s+soup|garbanzo\s+bean\s+soup|chili\s+con\s+carne|chili\s+verde|white\s+chili|turkey\s+chili|vegetarian\s+chili|vegan\s+chili|black\s+bean\s+chili|three\s+bean\s+chili|chili\s+mac)' THEN
    has_soup := true;
  ELSE
    has_soup := false;
  END IF;
  -- Exclude if it's just mentioning stock/broth as an ingredient
  IF has_soup AND v_blob ~ ('(stock|broth|bouillon|base|consommé).{0,30}(only|ingredient|for|used|as|in|with|to|make|add|use)') THEN
    has_soup := false;
  END IF;
  
  -- Vegetarian (only if no meat detected)
  IF NOT (has_chicken OR has_beef OR has_pork OR has_seafood) THEN
    has_vegetarian := v_blob ~ '(vegetarian|veggie|veggies|meatless|plant-based|tofu|tempeh|seitan|lentils?|beans?|chickpeas?|garbanzo\s+beans?|quinoa|vegetable|veggie\s+burger|meat-free|plant\s+burger|impossible\s+burger|beyond\s+burger|veggie\s+meat|meat\s+substitute|meat\s+alternative|jackfruit|mushroom\s+burger|black\s+bean\s+burger|chickpea\s+burger|lentil\s+burger|quinoa\s+burger|veggie\s+meatballs?|veggie\s+meatloaf|veggie\s+sausage|veggie\s+chorizo|veggie\s+crumbles?|textured\s+vegetable\s+protein|tvp|soy\s+protein|pea\s+protein|hemp\s+protein|plant\s+protein|vegetable\s+protein|veggie\s+protein|meatless\s+monday|meat-free\s+monday|vegetarian\s+monday)';
  END IF;
  
  -- Drinks (COMPREHENSIVE - but exclude if it's clearly a savory dish)
  -- First check if it's clearly NOT a drink (savory indicators or food categories)
  IF (has_beef OR has_chicken OR has_pork OR has_seafood OR has_pasta OR has_soup OR has_salad OR has_app OR has_bbq) THEN
    -- If it has food categories, it's not a drink
    has_drinks := false;
  ELSIF v_blob ~ '(^|[^a-z])(risotto|paella|pasta|noodle|spaghetti|sauce|stir\s+fry|main\s+course|entree|dinner|lunch|breakfast\s+(dish|meal|food)|recipe|dish|meal)([^a-z]|$)' THEN
    -- If it mentions food dishes, it's not a drink
    has_drinks := false;
  ELSIF v_blob ILIKE ANY(ARRAY[
    '%drink%', '%drinks%', '%beverage%', '%beverages%', '%cocktail%', '%cocktails%',
    '%smoothie%', '%smoothies%', '%juice%', '%juices%', '%shake%', '%shakes%', '%milkshake%',
    '%lemonade%', '%iced tea%', '%iced coffee%', '%coffee%', '%tea%', '%latte%', '%cappuccino%',
    '%espresso%', '%mocha%', '%frappe%', '%frappuccino%', '%macchiato%', '%americano%',
    '%margarita%', '%margaritas%', '%frozen margarita%', '%margarita on the rocks%', '%mojito%', '%mojitos%', '%sangria%', '%mimosa%', '%mimosas%',
    '%martini%', '%martinis%', '%dirty martini%', '%vodka martini%', '%gin martini%', '%daiquiri%', '%daiquiris%', '%frozen daiquiri%', '%pina colada%', '%cosmopolitan%',
    '%old fashioned%', '%whiskey sour%', '%manhattan%', '%negroni%', '%aperol spritz%', '%on the rocks%', '%rocks%', '%neat%', '%straight up%', '%straight%',
    '%frozen%', '%frozen drink%', '%frozen cocktail%', '%blended%', '%blended drink%', '%mudslide%', '%mudslides%', '%long island iced tea%', '%long island%',
    '%sex on the beach%', '%tequila sunrise%', '%bahama mama%', '%hurricane%', '%mai tai%', '%zombie%', '%scorpion%', '%fog cutter%', '%blue hawaii%',
    '%whiskey%', '%bourbon%', '%scotch%', '%vodka%', '%gin%', '%rum%', '%tequila%', '%mezcal%', '%brandy%', '%cognac%', '%liqueur%', '%schnapps%',
    '%amaretto%', '%kahlua%', '%baileys%', '%irish cream%', '%grand marnier%', '%cointreau%', '%triple sec%', '%blue curacao%', '%chambord%',
    '%sloe gin%', '%southern comfort%', '%jagermeister%', '%fireball%', '%sambuca%', '%ouzo%', '%arak%', '%raki%', '%limoncello%', '%frangelico%',
    '%mocktail%', '%mocktails%', '%punch%', '%soda%', '%pop%', '%cola%', '%ginger ale%',
    '%tonic%', '%seltzer%', '%sparkling water%', '%hot chocolate%', '%cocoa%', '%cider%',
    '%hot toddy%', '%mulled wine%', '%eggnog%', '%horchata%', '%agua fresca%', '%boba%',
    '%bubble tea%', '%chai%', '%matcha%', '%turmeric latte%', '%golden milk%', '%kombucha%',
    '%kefir%', '%prosecco%', '%champagne%', '%wine%', '%beer%', '%wine spritzer%',
    '%mulled cider%', '%chocolate milk%', '%slush%', '%slushie%', '%smoothie bowl%', '%acai bowl%',
    '%protein shake%', '%meal replacement shake%', '%green smoothie%', '%fruit smoothie%',
    '%vegetable smoothie%', '%detox smoothie%', '%breakfast smoothie%', '%post-workout smoothie%',
    '%pre-workout smoothie%', '%juice cleanse%', '%juice fast%', '%fresh juice%', '%cold pressed juice%',
    '%orange juice%', '%apple juice%', '%cranberry juice%', '%grape juice%', '%grapefruit juice%',
    '%pineapple juice%', '%tomato juice%', '%vegetable juice%', '%carrot juice%', '%beet juice%',
    '%celery juice%', '%wheatgrass juice%', '%green juice%', '%cortado%', '%flat white%', '%piccolo%',
    '%ristretto%', '%lungo%', '%doppio%', '%affogato%', '%con panna%', '%café au lait%', '%café latte%',
    '%café mocha%', '%café breve%', '%café con leche%', '%green tea%', '%black tea%', '%white tea%',
    '%oolong tea%', '%herbal tea%', '%chamomile tea%', '%peppermint tea%', '%ginger tea%', '%rooibos tea%',
    '%hibiscus tea%', '%jasmine tea%', '%earl grey%', '%english breakfast tea%', '%chai latte%', '%dirty chai%',
    '%matcha latte%', '%matcha tea%', '%bubble tea%', '%thai tea%', '%vietnamese coffee%', '%cafe sua da%'
  ]) THEN
    has_drinks := true;
  ELSE
    has_drinks := false;
  END IF;
  
  -- Desserts (COMPREHENSIVE - but exclude if it's clearly a savory dish)
  -- First check if it's clearly NOT a dessert (savory indicators or meat categories)
  IF (has_beef OR has_chicken OR has_pork OR has_seafood OR has_pasta OR has_soup OR has_salad) THEN
    -- If it has savory categories, it's not a dessert
    has_desserts := false;
  ELSIF v_blob ~ '(^|[^a-z])(szechuan|sichuan|spicy\s+(beef|chicken|pork|sauce|dish)|savory|meat|fish|vegetable\s+(stir|sauce|dish)|noodle\s+(dish|soup|bowl|recipe)|pasta\s+(dish|dinner|recipe)|sauce\s+(for|with|recipe)|main\s+course|entree|dinner|lunch)([^a-z]|$)' THEN
    has_desserts := false;
  ELSIF v_blob ILIKE ANY(ARRAY[
    '%dessert%', '%desserts%', '%treat%', '%treats%', '%cake%', '%cakes%',
    '%cupcake%', '%cupcakes%', '%cookie%', '%cookies%', '%brownie%', '%brownies%',
    '%pie%', '%pies%', '%tart%', '%tarts%', '%pudding%', '%puddings%', '%custard%',
    '%custards%', '%mousse%', '%mousses%', '%ice cream%', '%gelato%', '%sorbet%',
    '%sherbet%', '%frozen yogurt%', '%froyo%', '%popsicle%', '%ice pop%', '%frozen treat%',
    '%pastry%', '%pastries%', '%croissant%', '%croissants%', '%donut%', '%donuts%',
    '%doughnut%', '%doughnuts%', '%muffin%', '%muffins%', '%scone%', '%scones%',
    '%biscuit%', '%biscuits%', '%cinnamon roll%', '%sticky bun%', '%danish%', '%eclair%',
    '%eclairs%', '%cannoli%', '%cannolis%', '%chocolate%', '%fudge%', '%truffle%',
    '%truffles%', '%ganache%', '%cheesecake%', '%cheesecakes%', '%tiramisu%',
    '%creme brulee%', '%creme brulée%', '%crème brulee%', '%crème brulée%', '%flan%',
    '%panna cotta%', '%pavlova%', '%macaron%', '%macarons%', '%macaroon%', '%macaroons%',
    '%cobbler%', '%cobblers%', '%crisp%', '%crisps%', '%crumble%', '%crumbles%',
    '%bread pudding%', '%french toast%', '%candy%', '%candies%', '%caramel%', '%toffee%',
    '%nougat%', '%marshmallow%', '%marshmallows%', '%lollipop%', '%lollipops%', '%gummy%',
    '%gummies%', '%jelly%', '%jellies%', '%baklava%', '%knafeh%', '%halva%', '%halvah%',
    '%gulab jamun%', '%jalebi%', '%churro%', '%churros%', '%tres leches%', '%tres leches cake%',
    '%crema catalana%', '%ice cream sandwich%', '%ice cream cake%', '%sundae%', '%sundaes%',
    '%parfait%', '%parfaits%', '%trifle%', '%trifles%', '%souffle%', '%soufflé%', '%soufflés%',
    '%crepe%', '%crepes%', '%funnel cake%', '%funnel cakes%', '%beignets%', '%beignet%',
    '%zeppole%', '%zeppoles%', '%profiteroles%', '%profiterole%', '%cream puffs%', '%cream puff%',
    '%napoleon%', '%napoleons%', '%mille-feuille%', '%opera cake%', '%black forest%', '%red velvet%',
    '%carrot cake%', '%banana bread%', '%pound cake%', '%angel food cake%', '%chiffon cake%',
    '%sponge cake%', '%fruitcake%', '%fruit cake%', '%gingerbread%', '%shortbread%', '%biscotti%',
    '%biscotto%', '%madeleines%', '%madeleine%', '%sables%', '%sable%', '%petit fours%', '%petit four%',
    '%anise biscotti%', '%almond biscotti%', '%chocolate biscotti%', '%pistachio biscotti%',
    '%hazelnut biscotti%', '%walnut biscotti%', '%pecan biscotti%', '%macadamia biscotti%',
    '%cashew biscotti%', '%gingerbread men%', '%gingerbread houses%', '%shortbread cookies%',
    '%chocolate chip cookies%', '%sugar cookies%', '%snickerdoodles%', '%oatmeal cookies%',
    '%peanut butter cookies%', '%thumbprint cookies%', '%butter cookies%', '%sprinkle cookies%',
    '%m&m cookies%', '%monster cookies%', '%no-bake cookies%', '%rice krispie treats%',
    '%rice krispies%', '%marshmallow treats%', '%fudge%', '%chocolate fudge%', '%peanut butter fudge%',
    '%maple fudge%', '%vanilla fudge%', '%rocky road%', '%divinity%', '%pulled sugar%', '%spun sugar%',
    '%cotton candy%', '%candy floss%', '%fairy floss%', '%taffy%', '%saltwater taffy%', '%caramel%',
    '%caramels%', '%salted caramel%', '%caramel sauce%', '%butterscotch%', '%butterscotch sauce%',
    '%toffee%', '%english toffee%', '%heath bar%', '%skor bar%', '%nougat%', '%torrone%', '%turron%',
    '%marshmallow%', '%marshmallows%', '%homemade marshmallows%', '%fluffernutter%', '%smore%',
    '%smores%', '%lollipop%', '%lollipops%', '%sucker%', '%suckers%', '%hard candy%', '%hard candies%',
    '%gummy%', '%gummies%', '%gummy bears%', '%gummy worms%', '%gummy fish%', '%gummy sharks%',
    '%jelly%', '%jellies%', '%jelly beans%', '%jelly bellies%', '%fruit snacks%', '%fruit roll-ups%',
    '%fruit by the foot%', '%fruit leather%', '%fruit leathers%', '%licorice%', '%red vines%',
    '%twizzlers%', '%starburst%', '%skittles%', '%m&ms%', '%mnms%', '%smarties%', '%nerds%',
    '%nerds rope%', '%sour patch kids%', '%sour patch%', '%sour skittles%', '%sour gummy worms%',
    '%sour gummy bears%', '%sour candy%', '%sour treats%', '%sugar cookies%', '%whoopie pie%',
    '%gooey butter cake%', '%sticky toffee pudding%', '%sticky date pudding%', '%monkey bread%',
    '%pull apart bread%', '%cinnamon roll%', '%cinnamon bun%', '%cinnamon swirl%', '%snickerdoodles%',
    '%thumbprint cookies%', '%butter cookies%', '%sprinkle cookies%', '%m&m cookies%', '%monster cookies%',
    '%no-bake cookies%', '%rice krispie treats%', '%rice krispies%', '%marshmallow treats%',
    '%chocolate fudge%', '%peanut butter fudge%', '%maple fudge%', '%rocky road%', '%divinity%',
    '%cotton candy%', '%candy floss%', '%taffy%', '%saltwater taffy%', '%salted caramel%',
    '%caramel sauce%', '%butterscotch%', '%butterscotch sauce%', '%english toffee%', '%torrone%',
    '%homemade marshmallows%', '%fluffernutter%', '%smore%', '%smores%', '%hard candy%',
    '%fruit leather%', '%fruit roll-ups%', '%fruit by the foot%',
    -- Bread-based desserts (sweet breads)
    '%banana bread%', '%zucchini bread%', '%pumpkin bread%', '%carrot bread%', '%apple bread%',
    '%cinnamon bread%', '%chocolate chip bread%', '%lemon bread%', '%orange bread%', '%cranberry bread%',
    '%blueberry bread%', '%strawberry bread%', '%raspberry bread%', '%cherry bread%', '%peach bread%',
    '%mango bread%', '%coconut bread%', '%almond bread%', '%walnut bread%', '%pecan bread%',
    '%nut bread%', '%sweet bread%', '%quick bread%', '%coffee cake%', '%coffee bread%',
    '%brioche%', '%challah%', '%babka%', '%cinnamon babka%', '%chocolate babka%',
    '%stollen%', '%panettone%', '%pandoro%', '%king cake%', '%kings cake%',
    '%rugelach%', '%kolache%', '%kolach%', '%sweet roll%', '%sweet rolls%',
    '%cinnamon roll%', '%cinnamon bun%', '%cinnamon swirl%', '%honey bun%', '%glazed bun%',
    '%sticky bun%', '%sticky buns%', '%monkey bread%', '%pull apart bread%', '%caramel roll%',
    '%pecan roll%', '%orange roll%', '%lemon roll%', '%maple roll%', '%cream cheese roll%',
    '%christmas roll%', '%holiday roll%', '%raspberry swirl%', '%raspberry swirl roll%', '%swirl roll%',
    '%berry swirl%', '%fruit swirl%', '%chocolate swirl%', '%vanilla swirl%', '%caramel swirl%',
    '%cinnamon swirl roll%', '%nut roll%', '%poppy seed roll%', '%almond roll%', '%walnut roll%',
    '%pecan swirl roll%', '%apple swirl roll%', '%cherry roll%', '%strawberry roll%', '%blueberry roll%'
  ]) THEN
    has_desserts := true;
  ELSE
    has_desserts := false;
  END IF;
  
  -- Build output array
  IF has_bbq THEN v_categories := array_append(v_categories, 'bbq'); END IF;
  IF has_app THEN v_categories := array_append(v_categories, 'appetizers'); END IF;
  IF has_breakfast THEN v_categories := array_append(v_categories, 'breakfast'); END IF;
  IF has_chicken THEN v_categories := array_append(v_categories, 'chicken'); END IF;
  IF has_beef THEN v_categories := array_append(v_categories, 'beef'); END IF;
  IF has_pork THEN v_categories := array_append(v_categories, 'pork'); END IF;
  IF has_seafood THEN v_categories := array_append(v_categories, 'seafood'); END IF;
  IF has_pasta THEN v_categories := array_append(v_categories, 'pasta'); END IF;
  IF has_salad THEN v_categories := array_append(v_categories, 'salad'); END IF;
  IF has_soup THEN v_categories := array_append(v_categories, 'soup'); END IF;
  IF has_vegetarian THEN v_categories := array_append(v_categories, 'vegetarian'); END IF;
  IF has_drinks THEN v_categories := array_append(v_categories, 'drinks'); END IF;
  IF has_desserts THEN v_categories := array_append(v_categories, 'desserts'); END IF;
  
  RETURN v_categories;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
