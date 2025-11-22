# How the Learning System Works

## What It Does (Pattern Prioritization)

The system **learns which existing strategies work best** for which HTML patterns. It does NOT create new extraction methods.

### Example:

**Before Learning:**
```
Recipe-site with pattern "has-jsonld|mentions-ingredients"
  → Tries: server-html-jsonld (fails)
  → Tries: server-html-meta (fails)
  → Tries: server-html-sigi (succeeds!)
```

**After Learning:**
```
Recipe-site with pattern "has-jsonld|mentions-ingredients"
  → Tries: server-html-sigi FIRST (learned this works 100%)
  → If fails, tries: server-html-jsonld
  → If fails, tries: server-html-meta
```

## What It Learns

1. **Pattern → Strategy Mapping**
   - "has-jsonld|mentions-ingredients" → `server-html-sigi` works 100%
   - "has-microdata|mentions-steps" → `server-html-jsonld` works 80%
   - Generic pattern → `server-html-meta` works 50%

2. **Success Rates**
   - Tracks how often each strategy succeeds for each pattern
   - Prioritizes strategies with higher success rates

3. **Failure Patterns**
   - Learns which strategies DON'T work for certain patterns
   - Avoids trying them first (but still tries as fallback)

## What It Does NOT Do

❌ **Does NOT create new extraction methods**
- All strategies are hardcoded
- No AI-generated extraction logic
- No automatic code generation

❌ **Does NOT modify extraction code**
- Strategies are fixed functions
- Learning only changes the ORDER they're tried

❌ **Does NOT invent new strategies**
- You must manually add new strategies (like `server-html-sigi-v2`)
- Learning just helps prioritize existing ones

## How to Add New Extraction Methods

### Option 1: Create New Strategy (Manual)

1. **Add strategy to type**:
```typescript
// lib/parsers/versioning.ts
export type StrategyName = 
  | 'server-html-sigi'
  | 'server-html-meta'
  | 'your-new-strategy'  // ← Add here
```

2. **Implement the strategy**:
```typescript
// lib/parsers/strategy-selector.ts
async function executeStrategy(strategy: StrategyName, ...) {
  switch (strategy) {
    case 'your-new-strategy':
      return await extractWithNewMethod(html, url);
    // ...
  }
}
```

3. **Add to config**:
```typescript
'recipe-site': [{
  strategies: ['server-html-sigi', 'your-new-strategy', ...],
}]
```

4. **System will learn** which patterns it works for

### Option 2: Create v2 Parser (Based on Learnings)

After analyzing what works:

1. **Review learned patterns**:
```sql
SELECT html_pattern, extraction_method, success_rate
FROM recipe_extraction_patterns
WHERE success_rate < 50
ORDER BY sample_count DESC;
```

2. **Create improved v2 parser**:
```typescript
'recipe-site': [
  { version: 'v1', strategies: [...], enabled: true },
  { 
    version: 'v2', 
    strategies: ['improved-strategy-1', 'improved-strategy-2'],
    rolloutPercentage: 10,  // Start small
    enabled: true
  }
]
```

3. **Gradually rollout** as confidence grows

## Current Learning Process

```
1. User imports recipe
   ↓
2. System extracts HTML pattern
   ↓
3. System tries strategies in order (from config)
   ↓
4. When one succeeds:
   - Logs: "Pattern X + Strategy Y = Success"
   - Updates success rate for that combination
   ↓
5. Next time same pattern appears:
   - Checks learned patterns
   - Tries highest-success strategy FIRST
   ↓
6. Over time: System gets smarter about ordering
```

## Example: What Your Data Shows

From your analysis:
- Pattern "has-jsonld|mentions-ingredients" → `server-html-sigi` = 100% success (467 samples)
- Pattern "mentions-ingredients|mentions-steps" → `server-html-sigi` = 100% success (48 samples)

**What this means:**
- System learned: "When I see these patterns, try `server-html-sigi` first"
- It will automatically prioritize `server-html-sigi` for these patterns
- But it's still the SAME `server-html-sigi` strategy - just tried first now

## To Create NEW Extraction Methods

You need to manually:

1. **Analyze failures**:
   ```sql
   SELECT error_message, html_pattern
   FROM recipe_import_attempts
   WHERE success = false
   GROUP BY error_message, html_pattern;
   ```

2. **Identify patterns**:
   - "Many sites use custom JSON format"
   - "Some sites hide data in JavaScript variables"
   - "Instagram needs WebView approach"

3. **Write new extraction code**:
   - Create new strategy function
   - Add to strategy selector
   - Add to config

4. **Let system learn**:
   - System will automatically learn which patterns it works for
   - Will prioritize it when appropriate

## Summary

**Learning = Smart Prioritization**
- ✅ Learns which existing methods work best
- ✅ Prioritizes successful methods
- ✅ Avoids failing methods when possible

**Learning ≠ Creating New Methods**
- ❌ Does NOT create new extraction code
- ❌ Does NOT invent new strategies
- ❌ Does NOT modify existing extraction logic

**To improve further:**
- Use learnings to identify what's failing
- Manually create better extraction methods
- System will learn to use them effectively


