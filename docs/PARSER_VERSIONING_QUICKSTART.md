# Parser Versioning System - Quick Start Guide

## Overview

The parser versioning system allows you to:
- Add new parsing strategies without breaking existing ones
- A/B test different parser versions
- Learn from successful/failed imports
- Gradually roll out improvements

## Key Concepts

### 1. Parser Versions
- **v1**: Current stable parsers (never modify)
- **v2, v3, etc.**: New experimental parsers (can be tested safely)

### 2. Strategies
Each parser version has multiple extraction strategies tried in order:
- `server-html-sigi`: Extract from TikTok SIGI_STATE
- `server-html-meta`: Extract from meta tags
- `server-html-jsonld`: Extract from JSON-LD structured data
- `oembed-api`: Use oEmbed API
- `webview-dom`: WebView DOM scraping
- `ocr-screenshot`: OCR from screenshot

### 3. Pattern Learning
The system learns which strategies work best for which HTML patterns and automatically prioritizes them.

## Integration Example

### Basic Usage

```typescript
import { importRecipeWithVersioning } from '@/lib/parsers/integration-helper';

// In your capture flow
const result = await importRecipeWithVersioning(url);

if (result.success) {
  setTitle(result.title);
  setIngredients(result.ingredients || []);
  setSteps(result.steps || []);
  setImage(result.image);
} else {
  // Fallback to existing methods
  // The system has already logged the failure for learning
}
```

### With Existing Code

You can integrate this gradually into `app/(tabs)/capture.tsx`:

```typescript
// Option 1: Try versioned parser first, fallback to existing
try {
  const versionedResult = await importRecipeWithVersioning(url);
  if (versionedResult.success && versionedResult.ingredients?.length >= 2) {
    // Use versioned result
    setIngredients(versionedResult.ingredients);
    setSteps(versionedResult.steps || []);
    return; // Success!
  }
} catch (error) {
  // Continue to existing code
}

// Option 2: Run in parallel with existing code
// Use whichever succeeds first
```

### Tracking User Corrections

When a user manually edits a recipe after import:

```typescript
import { trackUserCorrection } from '@/lib/parsers/integration-helper';

// After user saves edited recipe
await trackUserCorrection(
  url,
  originalIngredients,
  correctedIngredients,
  originalSteps,
  correctedSteps
);
```

## Configuration

### Adjusting Rollout Percentage

Edit `lib/parsers/versioning.ts`:

```typescript
tiktok: [
  {
    version: 'v2',
    strategies: [/* ... */],
    rolloutPercentage: 10, // Start with 10% of users
    enabled: true,
  },
]
```

### Adding New Strategies

1. Add strategy name to `StrategyName` type
2. Implement extraction in `strategy-selector.ts`
3. Add to parser config

## Monitoring

### Check Parser Performance

```typescript
import { getParserStats } from '@/lib/parsers/integration-helper';

const stats = await getParserStats('tiktok', 'v2', 7); // Last 7 days
console.log('Success rate:', stats.successRate);
console.log('User correction rate:', stats.userCorrectionRate);
```

### Database Queries

```sql
-- Success rate by parser version
SELECT 
  parser_version,
  COUNT(*) as total,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM recipe_import_attempts
WHERE site_type = 'tiktok'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY parser_version;

-- Best strategies for a pattern
SELECT 
  extraction_method,
  success_rate,
  sample_count
FROM recipe_extraction_patterns
WHERE site_type = 'tiktok'
  AND html_pattern = 'has-sigi|mentions-ingredients'
ORDER BY success_rate DESC;
```

## Best Practices

1. **Start Small**: Begin with 0% rollout, test manually, then gradually increase
2. **Monitor Closely**: Watch success rates for first few days after rollout
3. **Keep v1 Stable**: Never modify v1 parsers - always create new versions
4. **Log Everything**: The system automatically logs attempts for learning
5. **User Feedback**: Track when users correct imports to identify issues

## Migration Path

### Phase 1: Setup (Week 1)
- [x] Database migration created
- [x] Parser versioning system created
- [ ] Run migration: `supabase migration up`
- [ ] Test basic import with versioning

### Phase 2: Integration (Week 2)
- [ ] Add `importRecipeWithVersioning` to capture.tsx as optional path
- [ ] Add user correction tracking
- [ ] Monitor initial data collection

### Phase 3: Learning (Week 3-4)
- [ ] Review pattern learning data
- [ ] Create v2 parsers based on learnings
- [ ] Enable v2 with 5% rollout

### Phase 4: Optimization (Ongoing)
- [ ] Monitor success rates
- [ ] Gradually increase rollout
- [ ] Create new versions as needed

## Troubleshooting

### Parser not being used
- Check `enabled: true` in config
- Check `rolloutPercentage > 0`
- Verify site type detection

### Low success rate
- Check database for common failure patterns
- Review `recipe_import_attempts` table
- Look at `error_message` column

### Pattern learning not working
- Ensure `updateExtractionPattern` is being called
- Check `recipe_extraction_patterns` table has data
- Verify HTML pattern extraction is working

## Next Steps

1. Run the database migration
2. Test with a few imports
3. Review the logged data
4. Gradually integrate into capture flow
5. Create v2 parsers based on learnings

