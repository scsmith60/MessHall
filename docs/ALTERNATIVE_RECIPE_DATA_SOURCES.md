# Alternative Recipe Data Sources

Since many recipe sites block automated access via robots.txt, here are alternative free ways to get recipe URLs for training:

## Option 1: Public Recipe Datasets (Recommended)

### Recipe1M+ Dataset
- **Source**: MIT/EPFL research dataset
- **Size**: ~1 million recipes
- **Format**: JSON with URLs
- **Access**: Free for research/educational use
- **URL**: Search "Recipe1M dataset" on GitHub or academic sites

### RecipeNLG Dataset
- **Source**: Hugging Face
- **Size**: ~2 million recipes
- **Format**: JSON/CSV
- **Access**: Free, open source
- **URL**: `huggingface.co/datasets/recipe_nlg`

### RecipeBox
- **Source**: Open source recipe database
- **Size**: ~10,000+ recipes
- **Format**: JSON
- **Access**: Free, GitHub repository
- **URL**: Search "RecipeBox" on GitHub

## Option 2: Recipe APIs (Free Tiers)

### Spoonacular API
- **Free Tier**: 150 requests/day
- **Cost**: Free (then paid)
- **What you get**: Recipe URLs, metadata
- **Setup**: Sign up at spoonacular.com

### Edamam Recipe API
- **Free Tier**: 5,000 requests/month
- **Cost**: Free (then paid)
- **What you get**: Recipe URLs, structured data
- **Setup**: Sign up at developer.edamam.com

## Option 3: Manual URL Collection

### RSS Feeds
Many recipe sites have RSS feeds that are public:
- AllRecipes RSS: `https://www.allrecipes.com/recipes/feed/`
- Food Network RSS: Various category feeds
- BBC Good Food RSS: `https://www.bbcgoodfood.com/feeds/recipes`

### Public Recipe Lists
- Reddit r/recipes (scrape public posts)
- Pinterest public recipe boards
- Food blog aggregators

## Option 4: Use Your Existing Data

If you already have recipes in your database:
```bash
# Extract URLs from existing recipes
npx tsx scripts/backfill-parser-patterns.ts --limit=1000
```

## Option 5: Modified Collection Script

Create a script that:
1. Reads recipe URLs from a CSV/JSON file you manually create
2. Inserts them into database
3. Runs backfill script

Example:
```typescript
// scripts/import-urls-from-file.ts
const urls = [
  'https://www.allrecipes.com/recipe/12345/...',
  'https://www.foodnetwork.com/recipes/...',
  // ... your manually collected URLs
];
```

## Recommended Approach

**Best for training**: Use RecipeNLG or Recipe1M dataset
1. Download dataset
2. Extract recipe URLs
3. Insert into database
4. Run backfill script

**Quick start**: Use Spoonacular API free tier
1. Sign up for API key
2. Fetch 150 recipe URLs/day
3. Insert into database
4. Run backfill script

## Script to Import from Dataset

I can create a script that:
- Reads recipe URLs from a JSON/CSV file
- Inserts them into your database
- Works with your existing backfill script

Would you like me to create this?

