# Complete Analysis of Recipe Misclassifications

## CATEGORY TAG ISSUES:

1. **Row 4**: "CREAMY CHICKEN POBLANO SOUP" - `["vegetarian"]` - HAS "2 cups cooked shredded chicken" - WRONG
2. **Row 7**: "CARAMEL APPLE VODKA LOLLIPOPS" - `["drinks"]` - Should not be drinks (lollipops are candy)
3. **Row 9**: "Cranberry Pistachio Shortbread Cookies" - `["appetizers","desserts"]` - Should not be appetizers
4. **Row 17**: "Homemade Mounds Bars Recipe" - `["appetizers","desserts"]` - Should not be appetizers
5. **Row 27**: "Thanksgiving Turkey Brine" - `["soup"]` - Should not be soup (it's a brine)
6. **Row 34**: "Refreshing Blueberry Mint Mojito Cocktail" - `["appetizers","drinks"]` - Should not be appetizers
7. **Row 38**: "Blueberry Cheesecake Bars" - `["appetizers","desserts"]` - Should not be appetizers
8. **Row 49**: "Cotton Candy Sushi" - `["appetizers","seafood"]` - Should not be seafood (it's a dessert)
9. **Row 50**: "Creative and Cute Strawberry Shortcake Sushi Roll Dessert Recipe" - `["seafood"]` - Should not be seafood (it's a dessert)
10. **Row 51**: "Strawberry Crunch Cheesecake Tacos" - `["appetizers","desserts"]` - Should not be appetizers
11. **Row 66**: "Marry Me Gnocchi" - `["pasta","soup","vegetarian"]` - Has "chicken or vegetable broth" option, so vegetarian might be wrong if chicken broth is used
12. **Row 78**: "Croatian Truffle Scrambled Eggs" - `["breakfast","desserts"]` - Should not be desserts
13. **Row 85**: "Roasted Pumpkin Seeds" - `[]` - No category tags (should probably be appetizers or snacks)
14. **Row 87**: "Copycat Cracker Barrel Fried Apples" - `["appetizers","desserts"]` - Should not be appetizers
15. **Row 94**: "Smoky Poblano Chicken and Black Bean Soup" - `["bbq","soup","vegetarian"]` - HAS "1 lb boneless, skinless chicken breasts" - WRONG
16. **Row 99**: "Caramel Chocolate Crunch Bars" - `["appetizers","drinks"]` - Should not be drinks OR appetizers
17. **Row 106**: "Salted Caramel Oatmeal Cookies" - `["breakfast","desserts"]` - Should not be breakfast (cookies are desserts)
18. **Row 115**: "Crispy Parmesan Roasted Cauliflower" - `["bbq","desserts"]` - Should not be desserts OR bbq
19. **Row 117**: "Remix: Crispy Air Fryer Apple Fries" - `["appetizers","desserts"]` - Should not be appetizers
20. **Row 124**: "Roasted Sweet Potato Rounds with Honey & Feta" - `["bbq","beef","pork"]` - Has NO meat, should be vegetarian
21. **Row 128**: "Creamy Garlic Butter Shrimp" - `[]` - No category tags (should be seafood)

## DIET TAG ISSUES (vegan/dairy_free when contains dairy):

1. **Row 3**: "Ranch dressing" - `["dairy_free","vegan"]` - Ingredients don't show dairy, but ranch typically has mayo/milk
2. **Row 9**: "Cranberry Pistachio Shortbread Cookies" - `["vegan"]` - Has "1 cup unsalted butter" and "1 cup white chocolate chips" - WRONG
3. **Row 10-11**: "Garlic Roasted Stacked Potatoes" - `["gluten_free","vegan"]` - Has "3 tbsp melted butter" and "¼ cup grated Parmesan" - WRONG
4. **Row 13**: "Broccoli Cheddar Soup" - `["vegan"]` - Has "8 ounces shredded cheddar cheese" and "4 tablespoons unsalted butter" - WRONG
5. **Row 14**: "Best Apple Recipes: Easy Apple Crisp" - `["vegan"]` - Has "½ cup cold unsalted butter" - WRONG
6. **Row 17**: "Homemade Mounds Bars Recipe" - `["gluten_free","vegan"]` - Has "½ cup sweetened condensed milk" - WRONG
7. **Row 31**: "Raspberry Swirl Christmas Roll" - `["vegan"]` - Has "cream cheese" - WRONG
8. **Row 33**: "Strawberry Santas" - `["gluten_free","vegan"]` - Has "4 oz cream cheese" and "2–3 tablespoons plain Greek yogurt" - WRONG
9. **Row 35**: "Oreo Frappe Recipe" - `["gluten_free","vegan"]` - Has "4 oz Full milk" and "1 oz Heavy Whipp" - WRONG
10. **Row 37**: "Berry Chantilly Cake" - `["gluten_free","vegan"]` - Has "mascarpone cheese", "cream cheese", "heavy whipping cream" - WRONG
11. **Row 51**: "Strawberry Crunch Cheesecake Tacos" - `["vegan"]` - Has "8 ounces (226g) cream cheese" and "1/4 cup (60ml) heavy cream" - WRONG
12. **Row 53**: "Gretel cheese steak recipe" - `["gluten_free"]` - Has "4 hoagie rolls" - WRONG
13. **Row 59**: "Blueberry Lemon Cheesecake" - `["gluten_free","vegan"]` - Has "250g cream cheese" and "200ml heavy cream" - WRONG
14. **Row 76**: "VANILLA-INFUSED PANNA COTTA" - `["gluten_free","vegan"]` - Has "2 cups (250 ml) heavy cream" and "½ cup (50 ml) whole milk" - WRONG
15. **Row 85**: "Roasted Pumpkin Seeds" - `["gluten_free","vegan"]` - Has "2 teaspoons butter, melted" - WRONG
16. **Row 87**: "Copycat Cracker Barrel Fried Apples" - `["vegan"]` - Has "6 Tablespoons butter" - WRONG
17. **Row 95**: "Cream Cheese Biscuits Recipe" - `["vegan"]` - Has "1/2 cup cold unsalted butter" and "4 ounce cold cream cheese" - WRONG
18. **Row 115**: "Crispy Parmesan Roasted Cauliflower" - `["gluten_free","vegan"]` - Has "1 /2 cup grated Parmesan cheese" - WRONG

## OTHER ISSUES:

- **Row 22**: "Grilled Beef Tenderloin Crostini" - `["gluten_free","dairy_free"]` - Has "1 baguette loaf" (gluten) and béarnaise sauce (typically has butter) - WRONG
- **Row 80**: "Beef Wellington" - `["gluten_free","dairy_free"]` - Has "500g puff pastry" (gluten) and "8 slices of Parma ham" - WRONG
- **Row 86**: "Creamy Steak Pasta" - `[]` - No category tags (should be pasta and beef)
- **Row 124**: "Roasted Sweet Potato Rounds" - Wrong ingredients listed (shows bacon/beef ingredients instead of sweet potato)

