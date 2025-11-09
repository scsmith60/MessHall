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
  v_title TEXT;
  
  title_has_salad BOOLEAN := false;
  title_has_dessert BOOLEAN := false;
  title_has_wrap_keywords BOOLEAN := false;
  contains_soup_keywords BOOLEAN := false;
  
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
  v_title := lower(coalesce(p_title, ''));
  title_has_wrap_keywords := v_title ~ '(tacos?|taquitos?|burritos?|quesadillas?|enchiladas?|fajitas?|wraps?|sandwich(?:es)?|burgers?|pizza|flatbread|nachos?|sliders?)';
  title_has_salad := (v_title ~ 'salad')
    OR ((v_title ~ 'coleslaw') AND NOT title_has_wrap_keywords)
    OR ((v_title ~ '(^|[^a-z])slaw([^a-z]|$)') AND NOT title_has_wrap_keywords);
  contains_soup_keywords := v_blob ~ '(soup|stew|chowder|broth|bisque|gumbo|gazpacho|pho|ramen|udon|pozole|posole|laksa|hot\s+pot|noodle\s+soup|congee|porridge|chili\b)';
  title_has_dessert := v_title ILIKE ANY(ARRAY[
    '%dessert%', '%desserts%', '%treat%', '%treats%', '%cake%', '%cakes%',
    '%cupcake%', '%cupcakes%', '%cookie%', '%cookies%', '%brownie%', '%brownies%',
    '% bar%', '%bars%', '%pie%', '%pies%', '%tart%', '%tarts%', '%pudding%', '%puddings%', '%custard%',
    '%custards%', '%mousse%', '%mousses%', '%ice cream%', '%gelato%', '%sorbet%',
    '%sherbet%', '%frozen yogurt%', '%froyo%', '%popsicle%', '%ice pop%', '%pastry%', '%pastries%',
    '%croissant%', '%croissants%', '%donut%', '%donuts%', '%doughnut%', '%doughnuts%',
    '%muffin%', '%muffins%', '%scone%', '%scones%', '%biscuit%', '%biscuits%', '%cinnamon roll%',
    '%sticky bun%', '%danish%', '%eclair%', '%eclairs%', '%cannoli%', '%cannolis%', '%chocolate%', '%fudge%',
    '%truffle%', '%truffles%', '%ganache%', '%cheesecake%', '%cheesecakes%', '%tiramisu%',
    '%creme brulee%', '%flan%', '%panna cotta%', '%pavlova%',
    '%macaron%', '%macarons%', '%macaroon%', '%macaroons%', '%cobbler%', '%cobblers%',
    '%crisp%', '%crisps%', '%crumble%', '%crumbles%', '%bread pudding%', '%french toast%',
    '%candy%', '%candies%', '%caramel%', '%toffee%', '%nougat%', '%marshmallow%', '%marshmallows%',
    '%lollipop%', '%lollipops%', '%gummy%', '%gummies%', '%baklava%', '%halva%', '%halvah%',
    '%gulab jamun%', '%jalebi%', '%churro%', '%churros%', '%tres leches%', '%tres leches cake%',
    '%ice cream sandwich%', '%ice cream cake%', '%sundae%', '%sundaes%', '%parfait%', '%parfaits%',
    '%trifle%', '%trifles%', '%souffle%', '%souffles%', '%crepe%', '%crepes%',
    '%funnel cake%', '%funnel cakes%', '%beignets%', '%beignet%', '%zeppole%', '%zeppoles%',
    '%profiteroles%', '%profiterole%', '%cream puffs%', '%cream puff%', '%opera cake%', '%black forest%',
    '%red velvet%', '%carrot cake%', '%banana bread%', '%pound cake%', '%angel food cake%', '%chiffon cake%',
    '%sponge cake%', '%fruitcake%', '%fruit cake%', '%gingerbread%', '%shortbread%', '%biscotti%',
    '%madeleine%', '%madeleines%', '%sable%', '%sables%', '%petit four%', '%petit fours%',
    '%rice krispie%', '%rice crispy%', '%marshmallow treat%', '%divinity%', '%cotton candy%', '%taffy%',
    '%saltwater taffy%', '%sweet roll%', '%sweet rolls%', '%honey bun%', '%glazed bun%', '%monkey bread%',
    '%pull apart bread%', '%caramel roll%', '%pecan roll%', '%orange roll%', '%lemon roll%', '%maple roll%',
    '%cream cheese roll%', '%raspberry swirl%', '%berry swirl%', '%fruit swirl%', '%chocolate swirl%', '%vanilla swirl%',
    '%caramel swirl%', '%nut roll%', '%poppy seed roll%', '%almond roll%', '%walnut roll%', '%pecan roll%',
    '%apple roll%', '%cherry roll%', '%strawberry roll%', '%blueberry roll%', '%sweet bread%', '%sweet breads%',
    '%sweet bun%', '%sweet buns%', '%sweet tart%', '%roulade%', '%torte%', '%tortes%'
  ]);
  
  -- BBQ
  has_bbq := v_blob ~ '(bbq|barbecue|barbeque|smoked|smoker|dry rub|bark|mop sauce|bbq sauce|ribs?|brisket|pulled pork|burnt ends|smoke ring|hickory|mesquite|grilled|grilling|charcoal|grill)';
  
  -- Appetizers (EXPANDED - includes fries, mini items, etc.)
  -- BUT exclude if it's clearly a dessert (cookies, cakes, pies, etc.)
  has_app := (
    v_blob ~ '(appetizer|starter|snack|dip|finger food|bites?|sliders?|wings?|boneless wings?|tenders?|nuggets?)' OR
    v_blob ~ '(mozzarella sticks?|mozz sticks?|cheese curds?|fries?|french fries?|loaded fries?|onion rings?|potato skins?)' OR
    v_blob ~ '(jalapeñ?o poppers?|poppers?|spring rolls?|egg rolls?|quesadilla|quesadillas|taquitos?|empanadas?|bruschetta|tapas|canape)' OR
    v_blob ~ '(stuffed mushrooms?|skewers?|kebabs?|crostini|nachos?|chips?|crackers?|pita chips?|tortilla chips?|salsa|guacamole|hummus|baba ganoush|tzatziki|ranch)' OR
    v_blob ~ '(spinach dip|artichoke dip|buffalo dip|seven layer dip|pico de gallo|sour cream|miniature|bite sized|bites sized)' OR
    v_blob ~ '(hors d''oeuvre|hors d''oeuvres|canapes?|canapés?|deviled eggs?|stuffed eggs?|meatballs?|cocktail meatballs?|pigs? in a blanket|sausage rolls?)' OR
    v_blob ~ '(pinwheels?|pin wheels?|roll ups?|cucumber bites?|tomato bites?|caprese bites?|bacon wrapped|stuffed jalapeñ?os?)' OR
    v_blob ~ '(cheese ball|cheese balls?|crab dip|shrimp dip|buffalo wings?|chicken wings?|drumettes?|flats?|chicken tenders?)' OR
    v_blob ~ '(potato wedges?|sweet potato fries?|waffle fries?|curly fries?|tater tots?|tots?|hash browns?|hashbrowns?|potato pancakes?|latkes?)' OR
    v_blob ~ '(zucchini fritters?|corn fritters?|hush puppies?|fritters?|beignets?|doughnut holes?|donut holes?)' OR
    v_blob ~ '(single serve|single-serving|appetizer size|starter size|mini |baby |cocktail )'
  ) AND NOT (title_has_dessert OR v_title ~ '(cookie|cookies?|cake|cakes?|pie|pies?|tart|tarts?|brownie|brownies?|muffin|muffins?|scone|scones?|biscuit|biscuits?|donut|donuts?|doughnut|doughnuts?|cheesecake|cheesecakes?|pudding|puddings?|custard|custards?|mousse|mousses?|ice cream|gelato|sorbet|sherbet|frozen yogurt|froyo|popsicle|ice pop|pastry|pastries?|croissant|croissants?|cinnamon roll|sticky bun|danish|eclair|eclairs?|cannoli|cannolis?|chocolate|fudge|truffle|truffles?|ganache|tiramisu|creme brulee|flan|panna cotta|pavlova|macaron|macarons?|macaroon|macaroons?|cobbler|cobblers?|crisp|crisps?|crumble|crumbles?|bread pudding|french toast|candy|candies?|caramel|toffee|nougat|marshmallow|marshmallows?|lollipop|lollipops?|gummy|gummies?|baklava|halva|halvah|gulab jamun|jalebi|churro|churros?|tres leches|tres leches cake|ice cream sandwich|ice cream cake|sundae|sundaes?|parfait|parfaits?|trifle|trifles?|souffle|souffles?|crepe|crepes?|funnel cake|funnel cakes?|beignets?|beignet|zeppole|zeppoles?|profiteroles?|profiterole|cream puffs?|cream puff|opera cake|black forest|red velvet|carrot cake|banana bread|pound cake|angel food cake|chiffon cake|sponge cake|fruitcake|fruit cake|gingerbread|shortbread|biscotti|madeleine|madeleines?|sable|sables?|petit four|petit fours?|rice krispie|rice crispy|marshmallow treat|divinity|cotton candy|taffy|saltwater taffy|sweet roll|sweet rolls?|honey bun|glazed bun|monkey bread|pull apart bread|caramel roll|pecan roll|orange roll|lemon roll|maple roll|cream cheese roll|raspberry swirl|berry swirl|fruit swirl|chocolate swirl|vanilla swirl|caramel swirl|nut roll|poppy seed roll|almond roll|walnut roll|pecan roll|apple roll|cherry roll|strawberry roll|blueberry roll|sweet bread|sweet breads?|sweet bun|sweet buns?|sweet tart|roulade|torte|tortes?|bars?|crunch bars?|chocolate bars?|caramel bars?|toffee bars?|shortbread|biscuits?|galette|galettes?)');
  
  -- Breakfast (exclude soups - "zuppa" means soup in Italian, not breakfast)
  -- Only match if it's clearly breakfast-related and NOT a soup
  has_breakfast := v_blob ~ '(breakfast|brunch|pancake|pancakes?|waffle|waffles?|french toast|scrambled eggs?|omelet|omelette|frittata|breakfast burrito|breakfast sandwich|bacon and eggs?|cereal|oatmeal|porridge|granola|muesli|hash brown|hashbrown|home fries?|breakfast casserole|breakfast hash|breakfast bowl|breakfast wrap|breakfast tacos?|breakfast pizza|eggs? benedict|eggs? florentine|eggs? royale|shakshuka|eggs? in purgatory|chilaquiles|huevos rancheros|breakfast quesadilla|breakfast enchiladas?|breakfast skillet|breakfast scramble|breakfast bake|breakfast muffins?|breakfast cookies?|breakfast bars?|energy bars?|protein bars?|granola bars?|breakfast smoothie|breakfast shake|overnight oats?|chiapudding|chia pudding|yogurt parfait|parfait|acai bowl|smoothie bowl|breakfast salad|breakfast greens?|scrambled tofu|tofu scramble|vegan eggs?|just eggs?|breakfast sausage|sausage patties?|sausage links?|breakfast links?|breakfast patties?|canadian bacon|back bacon|ham steak|breakfast ham|breakfast potatoes?|breakfast sweet potatoes?|breakfast rice|breakfast quinoa|breakfast farro|breakfast barley|breakfast couscous)' 
    AND NOT (v_blob ~ '(^|[^a-z])(soup|zuppa|stew|chowder|bisque)([^a-z]|$)');
  
  -- Chicken (real pieces/forms only, ignore stock - includes compound dishes like butter chicken, buldak)
  -- Check both title and ingredients for chicken - handle multiple word combinations
  -- Only exclude if the match itself is a stock phrase, not if stock appears elsewhere
  has_chicken := (
    -- Title-based patterns (these are always real chicken, not stock)
    v_title ~ '(^|[^a-z])(whole\s+chicken|rotisserie\s+chicken|ground\s+chicken|chicken\s*(thighs?|breasts?|drumsticks?|wings?|tenders?|cutlets?|legs?|quarters?|pieces?|parts?|dish|recipe|dinner|meal|curry|stir\s+fry|teriyaki|alfredo|marsala|parmesan|piccata|francese|scarpariello|cacciatore|saltimbocca|korma|tikka|masala|vindaloo|biryani|tandoori|butter\s+chicken|garlic\s+butter\s+chicken|lemon\s+chicken|orange\s+chicken|general\s+tsos?\s+chicken|general\s+gaos?\s+chicken|sesame\s+chicken|sweet\s+and\s+sour\s+chicken|kung\s+pao\s+chicken|moo\s+goo\s+gai\s+pan|chicken\s+and\s+rice|chicken\s+and\s+dumplings?|chicken\s+and\s+waffles?|chicken\s+and\s+biscuits?|chicken\s+nuggets?|chicken\s+tenders?|chicken\s+wings?|fried\s+chicken|roast\s+chicken|grilled\s+chicken|baked\s+chicken|braised\s+chicken|poached\s+chicken|steamed\s+chicken|chicken\s+soup|chicken\s+stew|chicken\s+chili|chicken\s+salad|chicken\s+sandwich|chicken\s+burger|chicken\s+tacos?|chicken\s+quesadilla|chicken\s+enchiladas?|chicken\s+fajitas?|chicken\s+burrito|chicken\s+sliders?)|buldak|chicken\s+poblano|poblano\s+chicken)([^a-z]|$)' OR
    -- Ingredient patterns for actual chicken meat (not stock)
    v_blob ~ '(^|[^a-z])(boneless\s+skinless\s+chicken|skinless\s+chicken|boneless\s+chicken|chicken\s+breast|chicken\s+breasts|chicken\s+thigh|chicken\s+thighs|chicken\s+wing|chicken\s+wings|chicken\s+tender|chicken\s+tenders|chicken\s+cutlet|chicken\s+cutlets|chicken\s+drumstick|chicken\s+drumsticks|chicken\s+leg|chicken\s+legs|chicken\s+quarter|chicken\s+quarters|chicken\s+piece|chicken\s+pieces|chicken\s+part|chicken\s+parts|chicken\s+meat|ground\s+chicken)([^a-z]|$)' OR
    v_blob ~ '(^|[^a-z])(cooked\s+(shredded\s+)?chicken|shredded\s+(cooked\s+)?chicken|diced\s+chicken|chopped\s+chicken|sliced\s+chicken|minced\s+chicken|pulled\s+chicken|rotisserie\s+chicken)([^a-z]|$)' OR
    -- Generic "chicken" but exclude if it's clearly stock/broth
    (v_blob ~ '(^|[^a-z])chicken([^a-z]|$)' AND NOT (v_blob ~ '(^|[^a-z])chicken\s+(stock|broth|bouillon|base|consomm[eé])([^a-z]|$)' OR v_blob ~ '(^|[^a-z])(stock|broth|bouillon|base|consomm[eé])\s+chicken([^a-z]|$)'))
  );
  
  -- Beef (BIG list - from old code plus more, including carne asada)
  has_beef := (v_blob ~ '(^|[^a-z])(ground\s+beef|beef(\s+(steak|short\s*ribs?|brisket|sirloin|ribeye|rib\s*eye|tomahawk|chuck|oxtail|tenderloin|ribs?|tips|roast|stew|jerky|burger|burgers?|hamburger|hamburgers?|meatballs?|meatloaf|meat loaf))?|filet\s+mignon|tenderloin\s+steak|chateaubriand|flank\s+steak|skirt\s+steak|hanger\s+steak|tri[-\s]?tip(\s+steak)?|new\s+york\s+strip|n\.?y\.?\s*strip|ny\s*strip|strip\s+steak|strip\s+loin|sirloin\s+steak|porterhouse|t[-\s]?bone|prime\s+rib|tomahawk|denver\s+steak|flat\s*iron\s+steak|bavette(\s+steak)?|picanha|culotte(\s+steak)?|rump\s*cap|london\s+broil|chuck\s+roast|rump\s+roast|sirloin\s+tip\s+roast|top\s+round\s+roast|bottom\s+round\s+roast|eye\s+of\s+round\s+roast|tri[-\s]?tip\s+roast|tenderloin\s+roast|standing\s+rib\s+roast|rib\s+roast|pot\s+roast|beef\s+roast|corned\s+beef|pastrami|beef\s+stroganoff|beef\s+wellington|beef\s+bourguignon|beef\s+rendang|beef\s+curry|beef\s+stir\s+fry|beef\s+bulgogi|beef\s+teriyaki|beef\s+fajitas?|beef\s+tacos?|beef\s+enchiladas?|beef\s+quesadilla|beef\s+empanadas?|beef\s+sliders?|carne\s+asada)([^a-z]|$)') AND NOT (v_blob ~ ('beef.{0,20}' || re_stock));
  
  -- Pork (EXPANDED - more flexible matching for cured meats)
  has_pork := (v_blob ~ '(^|[^a-z])(pulled\s+pork|pork\s*(shoulder|butt|ribs?|loin|tenderloin|chops?|cutlets?|belly|roast|stew|carnitas?|adobada?|al\s+pastor|barbacoa|sliders?|tacos?|quesadilla|empanadas?)|bacon|ham|ham\s+steak|ham\s+hock|pork\s+hock|pancetta|guanciale|prosciutto|prosciutto\s+di\s+parma|serrano\s+ham|iberico\s+ham|jamón|jamón\s+ibérico|jamón\s+serrano|speck|capicola|coppa|sopressata|mortadella|salami|pepperoni|chorizo|andouille|kielbasa|bratwurst|bratwursts?|sausage|sausages?|pork\s+sausage|italian\s+sausage|breakfast\s+sausage|sausage\s+links?|sausage\s+patties?|pork\s+belly|pork\s+rinds?|chicharrones?|pork\s+skin|pork\s+cracklings?|pork\s+fat|lard|pork\s+meatballs?|pork\s+meatloaf|pork\s+loaf|pork\s+chop|pork\s+chops?|pork\s+loin|pork\s+tenderloin|pork\s+shoulder|pork\s+butt|pork\s+ribs?|country\s+ham|virginia\s+ham|black\s+forest\s+ham|honey\s+ham|spiral\s+ham|baked\s+ham|glazed\s+ham|smoked\s+ham|boiled\s+ham)([^a-z]|$)') AND NOT (v_blob ~ ('pork.{0,20}' || re_stock));
  
  -- Seafood (BIG list - from old code plus more)
  -- BUT exclude dessert "sushi" items (cotton candy sushi, strawberry shortcake sushi, etc.)
  has_seafood := (
    v_blob ~ '(^|[^a-z])(shrimp|prawn|prawns?|crab|crabs?|lobster|lobsters?|scallops?|scallop|clam|clams?|mussel|mussels?|oyster(?!\s*mushroom)|oysters?|conch|conchs?|cockles?|cockle|octopus|squid|calamari|cuttlefish|sea\s*urchin|uni|fish|salmon(\s+steaks?)?|tuna(\s+steaks?)?|cod|haddock|hake|pollock|tilapia|catfish|mahi[-\s]?mahi(\s+steaks?)?|swordfish(\s+steaks?)?|halibut(\s+steaks?)?|snapper|red\s*snapper|grouper|monkfish|flounder|sole|plaice|lingcod|walleye|perch|yellowtail|amberjack|sea\s*bass|branzino|mackerel|sardine|sardines?|anchov(?:y|ies)|trout|arctic\s+char|rainbow\s+trout|brook\s+trout|steelhead|bass|striped\s+bass|largemouth\s+bass|smallmouth\s+bass|pike|pickerel|whitefish|lake\s+trout|salmon\s+trout|caviar|roe|fish\s+roe|salmon\s+roe|tobiko|masago|ikura|unagi|eel|sea\s+urchin|sea\s+cucumber|sea\s+snail|whelk|abalone|geoduck|razor\s+clam|razor\s+clams?|langoustine|langoustines?|crayfish|crawfish|crawdads?|lobster\s+tail|lobster\s+tails?|crab\s+legs?|crab\s+meat|king\s+crab|snow\s+crab|dungeness\s+crab|blue\s+crab|soft\s+shell\s+crab|hard\s+shell\s+crab|stone\s+crab|jumbo\s+shrimp|colossal\s+shrimp|tiger\s+shrimp|white\s+shrimp|pink\s+shrimp|rock\s+shrimp|spot\s+shrimp|sashimi|poke|ceviche|crudo|tartare|seafood\s+tower|seafood\s+platter|seafood\s+boil|low\s+country\s+boil|crab\s+boil|shrimp\s+boil)([^a-z]|$)' OR
    (v_blob ~ '(^|[^a-z])sushi([^a-z]|$)' AND NOT (v_title ~ '(cotton\s+candy|strawberry|shortcake|dessert|sweet|chocolate|caramel|fruit|berry|cream|cheesecake|cake|pie|tart|treat|candy)'))
  ) AND NOT (v_blob ~ ('seafood.{0,20}' || re_stock));
  
  -- Pasta/noodles (EXCLUDES risotto, paella, jambalaya - those are rice dishes, not pasta)
  has_pasta := v_blob ~ '(^|[^a-z])(pasta|noodle(s)?|spaghetti|penne|fusilli|farfalle|mac(aroni)?|rigatoni|fettuccine|linguine|lasagna|lasagne|tortellini|ravioli|gnocchi|vermicelli|udon|ramen|soba|angel\s+hair|capellini|bucatini|pappardelle|tagliatelle|tagliolini|orecchiette|campanelle|cavatelli|gemelli|rotini|rotelle|radiatore|ruote|conchiglie|shells?|manicotti|cannelloni|ziti|penne\s+rigate|mostaccioli|casarecce|trofie|strozzapreti|pici|carbonara|alfredo|marinara|bolognese|pesto|arrabbiata|puttanesca|amatriciana|cacio\s+e\s+pepe|aglio\s+e\s+olio|primavera|vodka\s+sauce|pink\s+sauce|white\s+sauce|béchamel|pomodoro|tomato\s+sauce|meat\s+sauce|ragu|chow\s+mein|lo\s+mein|pad\s+thai|pad\s+see\s+ew|pho|somen|shirataki|konjac|glass\s+noodles?|rice\s+noodles?|bean\s+thread\s+noodles?|cellophane\s+noodles?)([^a-z]|$)';
  
  -- Salad (require salad/slaw focus in the title to avoid mislabeling tacos/wraps with slaw toppings)
  -- EXCLUDE tacos, taquitos, wraps, burritos, etc. unless explicitly "taco salad"
  has_salad := title_has_salad AND NOT title_has_wrap_keywords AND (
    v_blob ~ '(salad|slaw|caesar\s+salad|greek\s+salad|cobb\s+salad|waldorf\s+salad|coleslaw|potato\s+salad|pasta\s+salad|fruit\s+salad|green\s+salad|side\s+salad|house\s+salad|garden\s+salad|wedge\s+salad|nicoise|chef\s+salad|chef''s\s+salad|antipasto\s+salad|caprese\s+salad|insalata|caprese|panzanella|fattoush|tabbouleh|tabouleh|quinoa\s+salad|rice\s+salad|grain\s+salad|farro\s+salad|barley\s+salad|bulgur\s+salad|couscous\s+salad|bean\s+salad|chickpea\s+salad|lentil\s+salad|edamame\s+salad|tofu\s+salad|chicken\s+salad|tuna\s+salad|shrimp\s+salad|crab\s+salad|lobster\s+salad|egg\s+salad|ham\s+salad|macaroni\s+salad|german\s+potato\s+salad|american\s+potato\s+salad|mayonnaise\s+potato\s+salad|mustard\s+potato\s+salad|cabbage\s+slaw|broccoli\s+slaw|carrot\s+slaw|kohlrabi\s+slaw|apple\s+slaw|asian\s+slaw|thai\s+slaw|vietnamese\s+slaw|korean\s+slaw|japanese\s+slaw|chinese\s+slaw|ambrosia\s+salad|jello\s+salad|gelatin\s+salad|whip\s+salad|sunshine\s+salad|watergate\s+salad|pistachio\s+salad|strawberry\s+pretzel\s+salad|seven\s+layer\s+salad|layered\s+salad|taco\s+salad|mexican\s+salad|southwest\s+salad|southwestern\s+salad|mediterranean\s+salad|middle\s+eastern\s+salad|italian\s+salad|french\s+salad|spanish\s+salad|german\s+salad|russian\s+salad|olivier\s+salad|ensalada|ensaladas?)'
  );
  
  -- Soup (STRICT - require explicit soup keywords, exclude sauces, condiments, and meat dishes)
  -- First check if it's clearly NOT a soup (wraps, tacos, sauces, condiments, meat dishes, brines, etc.)
  IF title_has_wrap_keywords OR has_beef OR has_chicken OR has_pork OR has_seafood OR v_blob ~ '(^|[^a-z])(tacos?|taquitos?|burritos?|quesadillas?|enchiladas?|fajitas?|wraps?|sandwiches?|burgers?|pizza|flatbread|nachos?|sliders?|carne\s+asada|steak|sauce|sauces?|condiment|condiments?|chimichurri|pesto|marinara|bolognese|arrabbiata|puttanesca|amatriciana|vodka\s+sauce|pink\s+sauce|white\s+sauce|béchamel|pomodoro|ragu|dressing|vinaigrette|mayonnaise|aioli|remoulade|tartar\s+sauce|ranch|blue\s+cheese\s+dressing|caesar\s+dressing|italian\s+dressing|french\s+dressing|thousand\s+island|hollandaise|béarnaise|salsa|guacamole|hummus|tzatziki|raita|chutney|relish|mustard|ketchup|bbq\s+sauce|hot\s+sauce|sriracha|tabasco|worcestershire|soy\s+sauce|teriyaki|hoisin|oyster\s+sauce|fish\s+sauce|dip|dips?|spread|spreads?|brine|brines?|brining)([^a-z]|$)' THEN
    has_soup := false;
  ELSIF contains_soup_keywords OR v_blob ~ '(^|[^a-z])(soup|zuppa|stew|chowder|bisque|consomme|gumbo|gazpacho|minestrone|chili\s+(con\s+carne|verde|bowl|recipe|dish|mac)|potage|miso\s+soup|chicken\s+soup|beef\s+stew|vegetable\s+soup|tomato\s+soup|tomato\s+bisque|cream\s+of\s+tomato|butternut\s+squash\s+soup|squash\s+soup|pumpkin\s+soup|carrot\s+soup|carrot\s+ginger\s+soup|broccoli\s+soup|cream\s+of\s+broccoli|broccoli\s+cheddar\s+soup|cauliflower\s+soup|cream\s+of\s+cauliflower|mushroom\s+soup|cream\s+of\s+mushroom|onion\s+soup|french\s+onion\s+soup|potato\s+soup|cream\s+of\s+potato|potato\s+leek\s+soup|leek\s+soup|vichyssoise|zucchini\s+soup|corn\s+chowder|clam\s+chowder|manhattan\s+clam\s+chowder|new\s+england\s+clam\s+chowder|seafood\s+chowder|fish\s+chowder|lobster\s+bisque|crab\s+bisque|shrimp\s+bisque|she[-\s]crab[-\s]*soup|she-crab\s+soup|she\s+crab\s+soup|shecrab\s+soup|crab\s+soup|oyster\s+stew|seafood\s+stew|bouillabaisse|cioppino|gumbo\s+ya\s+ya|chicken\s+noodle\s+soup|chicken\s+and\s+rice\s+soup|chicken\s+and\s+dumplings?|matzo\s+ball\s+soup|matzah\s+ball\s+soup|matzoh\s+ball\s+soup|chicken\s+and\s+stars|alphabet\s+soup|beef\s+barley\s+soup|beef\s+and\s+vegetable\s+soup|irish\s+stew|beef\s+bourguignon|coq\s+au\s+vin|osso\s+buco|ratatouille|vegetable\s+stew|pasta\s+e\s+fagioli|pasta\s+fagioli|pasta\s+fazool|escarole\s+soup|escarole\s+and\s+beans?|lentil\s+soup|split\s+pea\s+soup|black\s+bean\s+soup|white\s+bean\s+soup|navy\s+bean\s+soup|chickpea\s+soup|garbanzo\s+bean\s+soup|white\s+chili|turkey\s+chili|vegetarian\s+chili|vegan\s+chili|black\s+bean\s+chili|three\s+bean\s+chili|chili\s+mac)([^a-z]|$)' THEN
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
  
  -- Drinks (SIMPLE - if title contains any drink-related word, it's a drink)
  -- BUT exclude if combined with proteins, food items, or cooking methods
  has_drinks := v_title ILIKE ANY(ARRAY[
    '%drink%', '%drinks%', '%beverage%', '%beverages%', '%cocktail%', '%cocktails%',
    '%smoothie%', '%smoothies%', '%juice%', '%juices%', '%shake%', '%shakes%', '%milkshake%',
    '%lemonade%', '%iced tea%', '%iced coffee%', '%coffee%', '%tea%', '%latte%', '%cappuccino%',
    '%espresso%', '%mocha%', '%frappe%', '%frappuccino%', '%macchiato%', '%americano%',
    '%margarita%', '%margaritas%', '%mojito%', '%mojitos%', '%sangria%', '%mimosa%', '%mimosas%',
    '%martini%', '%martinis%', '%daiquiri%', '%daiquiris%', '%pina colada%', '%cosmopolitan%',
    '%old fashioned%', '%whiskey sour%', '%manhattan%', '%negroni%', '%aperol spritz%',
    '%frozen drink%', '%frozen cocktail%', '%blended drink%', '%mudslide%', '%mudslides%', '%long island iced tea%',
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
  ]);
  -- Exclude if combined with proteins, food items, or cooking methods
  IF has_drinks AND (has_beef OR has_chicken OR has_pork OR has_seafood OR has_soup OR has_pasta OR has_salad OR v_title ~ '(^|[^a-z])(steak|steaks?|battered|glazed|marinated|donut|donuts?|doughnut|doughnuts?|roulade|roulades?|popper|poppers?|soup|stew|chowder|bisque|gumbo|gazpacho|chili|cod|salmon|tuna|fish|chicken|beef|pork|turkey|duck|lamb|veal|venison|bison|rabbit|quail|pheasant|sausage|bacon|ham|ribs?|brisket|short\s+ribs?|flank|tenderloin|sirloin|ribeye|filet|mignon|chuck|roast|burger|burgers?|meatball|meatballs?|meatloaf|pasta|noodle|noodles?|spaghetti|penne|fusilli|lasagna|ravioli|gnocchi|salad|slaw|taco|tacos?|burrito|burritos?|quesadilla|quesadillas?|enchilada|enchiladas?|fajita|fajitas?|wrap|wraps?|sandwich|sandwiches?|pizza|flatbread|nachos?|slider|sliders?|cake|cakes?|pie|pies?|cookie|cookies?|brownie|brownies?|muffin|muffins?|scone|scones?|biscuit|biscuits?|bread|roll|rolls?|bun|buns?|bagel|bagels?|pretzel|pretzels?|cracker|crackers?|chips?|fries?|fry|fried|roasted|baked|grilled|sauteed|braised|steamed|poached|seared|smoked|cured|pickled|fermented|sauce|sauces?|dressing|dressings?|marinade|marinades?|glaze|glazes?|rub|rubs?|seasoning|seasonings?|spice|spices?|herb|herbs?|lollipop|lollipops?|bar|bars?|crunch|crunchy|candy|candies?|caramel|chocolate|toffee)([^a-z]|$)') THEN
    has_drinks := false;
  END IF;
  
  -- Desserts (require dessert-centric wording in the title to avoid savory dishes w/ sweet ingredients)
  -- EXCLUDE stuffed dishes, sweet potatoes (unless explicitly dessert), and savory items
  IF (has_beef OR has_chicken OR has_pork OR has_seafood OR has_pasta OR has_soup OR has_salad OR has_drinks OR has_breakfast) THEN
    -- If it has savory categories, drinks, or breakfast, it's not a dessert
    has_desserts := false;
  ELSIF v_blob ~ '(^|[^a-z])(szechuan|sichuan|spicy\s+(beef|chicken|pork|sauce|dish)|savory|meat|fish|vegetable\s+(stir|sauce|dish)|noodle\s+(dish|soup|bowl|recipe)|pasta\s+(dish|dinner|recipe)|sauce\s+(for|with|recipe)|main\s+course|entree|dinner|lunch|stuffed\s+(sweet\s+)?potato|stuffed\s+(sweet\s+)?potatoes|stuffed\s+pepper|stuffed\s+peppers|stuffed\s+chicken|stuffed\s+beef|stuffed\s+pork|scrambled\s+eggs?|eggs?|cauliflower|roasted\s+cauliflower|parmesan\s+cauliflower|bbq\s+cauliflower)([^a-z]|$)' THEN
    has_desserts := false;
  ELSIF title_has_dessert THEN
    has_desserts := true;
  ELSE
    has_desserts := false;
  END IF;
  -- Ensure desserts and drinks are mutually exclusive
  IF has_desserts THEN
    has_drinks := false;
  END IF;
  IF has_drinks THEN
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
