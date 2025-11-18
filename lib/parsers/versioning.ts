// lib/parsers/versioning.ts
// Parser versioning system to prevent breaking changes

export type ParserVersion = 'v1' | 'v2' | 'v3';
export type SiteType = 'tiktok' | 'instagram' | 'facebook' | 'recipe-site' | 'generic';
export type StrategyName = 
  | 'server-html-sigi'
  | 'server-html-meta'
  | 'server-html-jsonld'
  | 'oembed-api'
  | 'webview-dom'
  | 'ocr-screenshot'
  | 'ocr-screenshot-v2'
  | 'attempt-started'
  | 'user-abandoned'
  | 'user-corrected'
  | 'timeout'
  | 'error';

export interface ParserConfig {
  version: ParserVersion;
  strategies: StrategyName[];
  rolloutPercentage: number; // 0-100
  enabled: boolean;
}

export interface ImportAttempt {
  url: string;
  siteType: SiteType;
  parserVersion: ParserVersion;
  strategyUsed: StrategyName;
  success: boolean;
  confidenceScore?: 'low' | 'medium' | 'high';
  ingredientsCount?: number;
  stepsCount?: number;
  rawHtmlSample?: string;
  errorMessage?: string;
}

// Default parser configurations per site
const DEFAULT_CONFIGS: Record<SiteType, ParserConfig[]> = {
  tiktok: [
    {
      version: 'v1',
      strategies: ['server-html-sigi', 'server-html-meta', 'oembed-api', 'webview-dom', 'ocr-screenshot'],
      rolloutPercentage: 100,
      enabled: true,
    },
    {
      version: 'v2',
      strategies: ['server-html-sigi', 'server-html-jsonld', 'oembed-api', 'ocr-screenshot-v2'],
      rolloutPercentage: 0, // Start at 0%, increase as confidence grows
      enabled: false,
    },
  ],
  instagram: [
    {
      version: 'v1',
      strategies: ['server-html-meta', 'server-html-jsonld', 'webview-dom', 'ocr-screenshot'],
      rolloutPercentage: 100,
      enabled: true,
    },
    {
      version: 'v2',
      strategies: ['server-html-meta', 'server-html-jsonld', 'webview-dom', 'ocr-screenshot-v2'],
      rolloutPercentage: 0,
      enabled: false,
    },
  ],
  'recipe-site': [
    {
      version: 'v1',
      strategies: ['server-html-jsonld', 'server-html-meta'],
      rolloutPercentage: 100,
      enabled: true,
    },
  ],
  generic: [
    {
      version: 'v1',
      strategies: ['server-html-jsonld', 'server-html-meta', 'ocr-screenshot'],
      rolloutPercentage: 100,
      enabled: true,
    },
  ],
  facebook: [
    {
      version: 'v1',
      strategies: ['server-html-meta', 'webview-dom', 'ocr-screenshot'],
      rolloutPercentage: 100,
      enabled: true,
    },
  ],
};

/**
 * Get parser configuration for a site type
 * Uses rollout percentage to determine which version to use
 */
export function getParserConfig(siteType: SiteType, userId?: string): ParserConfig {
  const configs = DEFAULT_CONFIGS[siteType] || DEFAULT_CONFIGS.generic;
  
  // Filter to enabled configs
  const enabledConfigs = configs.filter(c => c.enabled);
  if (enabledConfigs.length === 0) {
    // Fallback to v1 if nothing enabled
    return configs.find(c => c.version === 'v1') || configs[0];
  }
  
  // For now, return the config with highest rollout percentage
  // In future, can use userId hash for consistent A/B testing
  const selected = enabledConfigs.reduce((best, current) => {
    return current.rolloutPercentage > best.rolloutPercentage ? current : best;
  });
  
  return selected;
}

/**
 * Log an import attempt to the database
 * Returns the attempt ID if successful, null otherwise
 */
export async function logImportAttempt(attempt: ImportAttempt): Promise<string | null> {
  try {
    const { supabase } = await import('@/lib/supabase');
    
    const { data, error } = await supabase.rpc('log_recipe_import_attempt', {
      p_url: attempt.url,
      p_site_type: attempt.siteType,
      p_parser_version: attempt.parserVersion,
      p_strategy_used: attempt.strategyUsed,
      p_success: attempt.success,
      p_confidence_score: attempt.confidenceScore || null,
      p_ingredients_count: attempt.ingredientsCount || null,
      p_steps_count: attempt.stepsCount || null,
      p_raw_html_sample: attempt.rawHtmlSample || null,
      p_error_message: attempt.errorMessage || null,
    });
    
    if (error) {
      console.warn('[logImportAttempt] Failed to log:', error.message);
      return null;
    }
    
    return data || null;
  } catch (err) {
    // Silently fail - logging shouldn't break the import flow
    console.warn('[logImportAttempt] Error:', err);
    return null;
  }
}

/**
 * Mark an import attempt as user-corrected
 */
export async function markImportCorrected(attemptId: string): Promise<void> {
  try {
    const { supabase } = await import('@/lib/supabase');
    
    const { error } = await supabase.rpc('mark_import_corrected', {
      p_attempt_id: attemptId,
    });
    
    if (error) {
      console.warn('[markImportCorrected] Failed:', error.message);
    }
  } catch (err) {
    console.warn('[markImportCorrected] Error:', err);
  }
}

/**
 * Extract a simple pattern identifier from HTML
 * Used for pattern matching and learning
 */
export function extractHtmlPattern(html: string, siteType: SiteType): string {
  if (!html || html.length < 100) return 'too-short';
  
  // Extract key identifiers that indicate page structure
  const patterns: string[] = [];
  
  // Check for structured data
  if (html.includes('application/ld+json')) patterns.push('has-jsonld');
  if (html.includes('itemscope')) patterns.push('has-microdata');
  
  // Site-specific patterns
  if (siteType === 'tiktok') {
    if (html.includes('SIGI_STATE')) patterns.push('has-sigi');
    if (html.includes('ItemModule')) patterns.push('has-item-module');
  }
  
  if (siteType === 'instagram') {
    if (html.includes('_sharedData')) patterns.push('has-shared-data');
    if (html.includes('edge_media_to_caption')) patterns.push('has-edge-media');
  }
  
  // Check for recipe-specific content
  if (/\bingredients?\b/i.test(html)) patterns.push('mentions-ingredients');
  if (/\bsteps?\b|\bdirections?\b/i.test(html)) patterns.push('mentions-steps');
  
  // Check for common recipe site patterns
  if (html.includes('recipe')) patterns.push('has-recipe-keyword');
  
  return patterns.length > 0 ? patterns.join('|') : 'generic';
}

/**
 * Update extraction pattern success rate
 */
export async function updateExtractionPattern(
  siteType: SiteType,
  htmlPattern: string,
  extractionMethod: StrategyName,
  parserVersion: ParserVersion,
  success: boolean
): Promise<void> {
  try {
    const { supabase } = await import('@/lib/supabase');
    
    const { error } = await supabase.rpc('update_extraction_pattern', {
      p_site_type: siteType,
      p_html_pattern: htmlPattern,
      p_extraction_method: extractionMethod,
      p_parser_version: parserVersion,
      p_success: success,
    });
    
    if (error) {
      console.warn('[updateExtractionPattern] Failed:', error.message);
    }
  } catch (err) {
    console.warn('[updateExtractionPattern] Error:', err);
  }
}

/**
 * Get best extraction method for a pattern
 */
export async function getBestExtractionMethod(
  siteType: SiteType,
  htmlPattern: string
): Promise<StrategyName | null> {
  try {
    const { supabase } = await import('@/lib/supabase');
    
    const { data, error } = await supabase
      .from('recipe_extraction_patterns')
      .select('extraction_method, success_rate')
      .eq('site_type', siteType)
      .eq('html_pattern', htmlPattern)
      .order('success_rate', { ascending: false })
      .limit(1)
      .single();
    
    if (error || !data) return null;
    
    // Only return if success rate is above threshold
    if (data.success_rate >= 50.0) {
      return data.extraction_method as StrategyName;
    }
    
    return null;
  } catch (err) {
    console.warn('[getBestExtractionMethod] Error:', err);
    return null;
  }
}

