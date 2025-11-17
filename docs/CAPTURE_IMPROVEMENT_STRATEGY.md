# Recipe Capture Improvement Strategy

## Problem Statement
- Current success rate: ~60%
- Target success rate: 90%+
- Issue: Fixing one capture method (TikTok, Instagram, etc.) breaks others
- Need: Cost-effective solution that learns and improves over time

## Core Strategy: Versioned Parser Architecture

### 1. Parser Versioning System
Instead of modifying parsers in-place, create **versioned parser strategies**:

```
lib/parsers/
  ├── v1/              # Current stable parsers (never modify)
  ├── v2/              # New experimental parsers
  ├── strategies/       # Site-specific strategy selectors
  └── unified/         # Shared utilities
```

**Benefits:**
- Old parsers remain stable
- New parsers can be tested on subset of users
- Easy rollback if issues occur
- Can A/B test different approaches

### 2. Multi-Strategy Fallback Chain
Each site should have multiple extraction strategies tried in order:

```
TikTok Example:
1. Server-side HTML extraction (SIGI_STATE) - v1
2. Server-side HTML extraction (SIGI_STATE) - v2 (improved)
3. oEmbed API fallback - v1
4. WebView DOM scraper - v1
5. OCR from screenshot - v1
6. OCR from screenshot - v2 (improved)
```

**Key:** Each strategy is independent and doesn't affect others.

### 3. Feedback Loop System

#### Database Schema Addition
```sql
CREATE TABLE recipe_import_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  site_type TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  strategy_used TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  confidence_score TEXT, -- 'low' | 'medium' | 'high'
  ingredients_count INT,
  steps_count INT,
  raw_html_sample TEXT, -- First 5000 chars for analysis
  error_message TEXT,
  user_corrected BOOLEAN DEFAULT FALSE, -- Did user manually fix?
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_import_attempts_site_version ON recipe_import_attempts(site_type, parser_version);
CREATE INDEX idx_import_attempts_success ON recipe_import_attempts(success, created_at);
```

#### User Feedback Collection
When users manually edit a recipe after import:
- Log which parser version was used
- Mark as "needed correction"
- Store the corrected version for training

### 4. Lightweight AI Integration (Cost-Effective)

**Option A: Hybrid Rule-Based + Small LLM**
- Use existing rule-based parsers for 80% of cases
- Only call AI for edge cases (low confidence, unusual formats)
- Use smaller/cheaper models (Claude Haiku, GPT-3.5-turbo) instead of GPT-4

**Option B: Self-Hosted Embedding Model**
- Use sentence-transformers (free, runs on CPU)
- Create embeddings of successful recipe patterns
- Match new imports to similar successful patterns
- No API costs, runs locally or on cheap VPS

**Option C: Fine-Tuned Small Model**
- Fine-tune a small model (e.g., Mistral 7B) on your successful recipes
- Host on RunPod/Vast.ai ($0.10-0.30/hour)
- Only run inference, not training
- Much cheaper than per-request API calls

**Recommended: Option A + B Hybrid**
- Rule-based for common patterns (fast, free)
- Embedding matching for similar recipes (cheap, self-hosted)
- Small LLM API calls only for truly novel cases (rare, controlled cost)

### 5. Pattern Learning System

#### Success Pattern Database
Store successful extraction patterns:

```sql
CREATE TABLE recipe_extraction_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_type TEXT NOT NULL,
  html_pattern TEXT, -- Regex or pattern identifier
  extraction_method TEXT NOT NULL,
  success_rate DECIMAL(5,2),
  sample_count INT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**How it works:**
1. When a parser succeeds, extract the HTML pattern that worked
2. Store pattern → method mapping
3. For new imports, check if HTML matches known successful patterns
4. Use the proven method first

### 6. Implementation Phases

#### Phase 1: Foundation (Week 1-2)
- [ ] Create parser versioning system
- [ ] Add import attempt logging
- [ ] Set up feedback collection on user edits
- [ ] Create strategy selector system

#### Phase 2: Pattern Learning (Week 3-4)
- [ ] Implement pattern extraction from successful imports
- [ ] Build pattern matching system
- [ ] Create pattern database
- [ ] Add pattern-based strategy selection

#### Phase 3: Lightweight AI (Week 5-6)
- [ ] Set up embedding model (sentence-transformers)
- [ ] Create similarity matching system
- [ ] Integrate small LLM for edge cases only
- [ ] Add confidence-based routing

#### Phase 4: Continuous Improvement (Ongoing)
- [ ] Monitor success rates by parser version
- [ ] Automatically promote successful parsers
- [ ] Generate new parser versions from successful patterns
- [ ] A/B test new strategies

### 7. Cost Analysis

**Current (if using ChatGPT for all):**
- 1M recipes × $0.01/request = $10,000/month

**Proposed Hybrid:**
- Rule-based: 800K recipes × $0 = $0
- Embedding matching: 150K recipes × $0.0001 = $15/month
- LLM API (edge cases): 50K recipes × $0.002 = $100/month
- **Total: ~$115/month** (99% cost reduction)

**Self-Hosted Option:**
- VPS for embedding model: $20/month
- GPU instance for fine-tuned model: $50/month (only if needed)
- **Total: ~$70/month** (99.3% cost reduction)

### 8. Testing Strategy

#### Canary Deployments
- Deploy new parser versions to 5% of users
- Monitor success rates vs. baseline
- Gradually increase if successful

#### A/B Testing Framework
```typescript
interface ParserConfig {
  version: string;
  strategies: Strategy[];
  rolloutPercentage: number; // 0-100
}

// Example: Test v2 parser on 10% of TikTok imports
const config: ParserConfig = {
  version: 'v2',
  strategies: [/* ... */],
  rolloutPercentage: 10
};
```

### 9. Monitoring & Alerts

**Key Metrics:**
- Success rate by site type and parser version
- Average confidence score
- User correction rate (indicates parser quality)
- Time to extract (performance)

**Alerts:**
- Success rate drops below threshold
- New parser version performs worse than baseline
- Unusual error patterns

### 10. Quick Wins (Can Implement Now)

1. **Better Error Logging**
   - Log full HTML samples for failed imports
   - Identify common failure patterns
   - Create targeted fixes

2. **Confidence-Based Retry**
   - If first attempt has low confidence, try alternative strategy
   - Don't give up after first failure

3. **Site-Specific Tuning**
   - TikTok: Try mobile UA first (often better)
   - Instagram: Try meta tags before DOM scraping
   - Recipe sites: Try JSON-LD before HTML parsing

4. **User Feedback Integration**
   - Add "Was this import correct?" button
   - Use feedback to improve pattern matching

## Next Steps

1. **Immediate:** Set up import attempt logging
2. **Week 1:** Implement parser versioning
3. **Week 2:** Add user feedback collection
4. **Week 3:** Build pattern learning system
5. **Week 4+:** Integrate lightweight AI for edge cases

## Success Criteria

- Success rate increases from 60% → 90%+
- No regressions in existing capture methods
- Cost per import < $0.0001 (vs. current $0.01+)
- New patterns automatically learned and applied

