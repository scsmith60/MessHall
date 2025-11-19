# Search and Collect Recipe URLs Guide

## Overview

The `search-and-collect-urls.ts` script automatically searches Google or DuckDuckGo for recipe URLs based on search queries (like "chicken recipes") and collects all the recipe URLs from the results.

## Features

- ✅ **Automatic Search**: Searches Google/DuckDuckGo for recipe queries
- ✅ **Smart Filtering**: Only collects URLs from known recipe sites
- ✅ **No API Key Needed**: Uses DuckDuckGo by default (free)
- ✅ **Google Support**: Optional Google Custom Search API
- ✅ **Batch Collection**: Can search multiple queries at once
- ✅ **Auto-Save**: Saves to file or database automatically

## Quick Start

### Basic Usage (DuckDuckGo - Free, No API Key)

```bash
# Search for "chicken recipes" and save to database
npx tsx scripts/search-and-collect-urls.ts --query="chicken recipes" --insert-db

# Search multiple recipe types
npx tsx scripts/search-and-collect-urls.ts --queries="chicken recipes,pasta recipes,dessert recipes" --insert-db

# Search and save to file
npx tsx scripts/search-and-collect-urls.ts --query="chicken recipes" --save=chicken-recipes.txt
```

### With Google Custom Search API

```bash
# Requires Google API key and Search Engine ID
npx tsx scripts/search-and-collect-urls.ts --query="chicken recipes" --google --insert-db
```

## Examples

### Search for Specific Recipe Types

```bash
# Chicken recipes
npx tsx scripts/search-and-collect-urls.ts --query="chicken recipes" --max=200 --insert-db

# Pasta recipes
npx tsx scripts/search-and-collect-urls.ts --query="pasta recipes" --max=200 --insert-db

# Dessert recipes
npx tsx scripts/search-and-collect-urls.ts --query="dessert recipes" --max=200 --insert-db
```

### Search Multiple Types at Once

```bash
npx tsx scripts/search-and-collect-urls.ts \
  --queries="chicken recipes,pasta recipes,dessert recipes,breakfast recipes" \
  --max=100 \
  --insert-db
```

### Save to File Instead of Database

```bash
npx tsx scripts/search-and-collect-urls.ts \
  --query="chicken recipes" \
  --max=200 \
  --save=chicken-recipes.txt
```

## Command Line Options

| Option | Description | Example |
|--------|-------------|---------|
| `--query=` | Single search query | `--query="chicken recipes"` |
| `--queries=` | Multiple queries (comma-separated) | `--queries="chicken,pasta,dessert"` |
| `--max=` | Max results per query (default: 100) | `--max=200` |
| `--save=` | Save URLs to file (JSON/TXT) | `--save=urls.txt` |
| `--insert-db` | Insert URLs into database | `--insert-db` |
| `--google` | Use Google Custom Search API | `--google` |
| `--google-key=` | Google API key | `--google-key=YOUR_KEY` |
| `--google-cx=` | Google Search Engine ID | `--google-cx=YOUR_CX` |

## How It Works

1. **Search**: Queries Google/DuckDuckGo for recipe search terms
2. **Filter**: Only keeps URLs from known recipe sites
3. **Validate**: Checks if URLs look like recipe pages
4. **Deduplicate**: Removes duplicate URLs
5. **Save**: Saves to file or database

## Search Query Tips

### Basic Queries
```bash
--query="chicken recipes"
--query="pasta recipes"
--query="dessert recipes"
```

### Site-Specific Queries
```bash
--query="chicken recipes site:allrecipes.com"
--query="pasta recipes site:foodnetwork.com"
```

### Multiple Terms
```bash
--queries="chicken recipes,pasta recipes,dessert recipes,breakfast recipes,dinner recipes"
```

## Google Custom Search Setup (Optional)

If you want to use Google instead of DuckDuckGo:

1. **Get API Key**:
   - Go to https://console.cloud.google.com/
   - Create a project
   - Enable "Custom Search API"
   - Create API key

2. **Get Search Engine ID**:
   - Go to https://programmablesearchengine.google.com/
   - Create a new search engine
   - Add sites to search (or leave blank for web-wide)
   - Copy the Search Engine ID

3. **Set Environment Variables**:
   ```bash
   # In your .env file
   GOOGLE_API_KEY=your_api_key_here
   GOOGLE_SEARCH_ENGINE_ID=your_search_engine_id_here
   ```

4. **Use Google**:
   ```bash
   npx tsx scripts/search-and-collect-urls.ts --query="chicken recipes" --google --insert-db
   ```

**Note**: Google Custom Search API has a free tier of 100 queries/day, then paid.

## DuckDuckGo vs Google

| Feature | DuckDuckGo | Google |
|---------|------------|--------|
| **API Key** | Not needed | Required |
| **Cost** | Free | Free tier: 100/day, then paid |
| **Results** | Good | Excellent |
| **Rate Limits** | None (be respectful) | 100 queries/day free |
| **Setup** | None | Requires API key + Search Engine ID |

## Workflow

```bash
# Step 1: Search and collect URLs
npx tsx scripts/search-and-collect-urls.ts \
  --queries="chicken recipes,pasta recipes,dessert recipes" \
  --max=200 \
  --insert-db

# Step 2: Process URLs with backfill script
npx tsx scripts/backfill-parser-patterns.ts --limit=600
```

## Expected Results

- **Per Query**: 50-200 recipe URLs (depending on search engine and query)
- **Multiple Queries**: Can collect 500-2000+ URLs
- **Time**: 1-5 minutes depending on number of queries

## Troubleshooting

### "No URLs found"
- Try different search queries
- Check if recipe sites are in the allowed domains list
- Some sites may block search engine crawlers

### "Rate limited" (Google)
- You've hit the 100 queries/day free tier limit
- Wait 24 hours or upgrade to paid tier
- Use DuckDuckGo instead (no limits)

### "Invalid API key" (Google)
- Check your `GOOGLE_API_KEY` environment variable
- Verify the API key is enabled in Google Cloud Console
- Make sure Custom Search API is enabled

## Tips

1. **Start Small**: Test with `--max=50` first
2. **Use Specific Queries**: "chicken recipes" works better than just "chicken"
3. **Combine Queries**: Use `--queries=` to search multiple types at once
4. **Save to File First**: Use `--save=` to review URLs before inserting to database
5. **Be Respectful**: Don't run too many searches too quickly

