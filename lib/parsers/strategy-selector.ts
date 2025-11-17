// lib/parsers/strategy-selector.ts
// Selects the best extraction strategy based on patterns and config

import { 
  SiteType, 
  StrategyName, 
  ParserConfig, 
  getParserConfig,
  getBestExtractionMethod,
  extractHtmlPattern,
} from './versioning';

export interface ExtractionResult {
  success: boolean;
  title?: string;
  ingredients?: string[];
  steps?: string[];
  image?: string;
  confidence?: 'low' | 'medium' | 'high';
  strategyUsed: StrategyName;
  error?: string;
}

/**
 * Select and execute extraction strategies in order
 * Uses pattern learning to prioritize successful methods
 */
export async function executeExtractionStrategies(
  url: string,
  siteType: SiteType,
  html: string,
  config: ParserConfig
): Promise<ExtractionResult> {
  // Extract pattern from HTML
  const htmlPattern = extractHtmlPattern(html, siteType);
  
  // Try to get best method for this pattern
  const bestMethod = await getBestExtractionMethod(siteType, htmlPattern);
  
  // Reorder strategies: best method first, then rest in config order
  const strategies = bestMethod 
    ? [bestMethod, ...config.strategies.filter(s => s !== bestMethod)]
    : config.strategies;
  
  // Try each strategy in order
  for (const strategy of strategies) {
    try {
      const result = await executeStrategy(strategy, url, siteType, html);
      
      if (result.success) {
        // Log successful extraction
        await logSuccessfulExtraction(
          url,
          siteType,
          config.version,
          strategy,
          htmlPattern,
          result
        );
        
        return {
          ...result,
          strategyUsed: strategy,
        };
      }
    } catch (error: any) {
      // Log failure and continue to next strategy
      await logFailedExtraction(
        url,
        siteType,
        config.version,
        strategy,
        htmlPattern,
        error.message
      );
      
      // Continue to next strategy
      continue;
    }
  }
  
  // All strategies failed
  return {
    success: false,
    strategyUsed: strategies[strategies.length - 1] || 'server-html-meta',
    error: 'All extraction strategies failed',
    confidence: 'low',
  };
}

/**
 * Execute a specific extraction strategy
 */
async function executeStrategy(
  strategy: StrategyName,
  url: string,
  siteType: SiteType,
  html: string
): Promise<ExtractionResult> {
  switch (strategy) {
    case 'server-html-sigi':
      return await extractFromSigiState(html, url);
    
    case 'server-html-meta':
      return await extractFromMeta(html, url);
    
    case 'server-html-jsonld':
      return await extractFromJsonLd(html, url);
    
    case 'oembed-api':
      return await extractFromOEmbed(url);
    
    case 'webview-dom':
      // This would trigger WebView scraping (handled separately in capture.tsx)
      return { success: false, strategyUsed: strategy, error: 'WebView requires separate component' };
    
    case 'ocr-screenshot':
    case 'ocr-screenshot-v2':
      // This would trigger OCR (handled separately in capture.tsx)
      return { success: false, strategyUsed: strategy, error: 'OCR requires screenshot' };
    
    default:
      return { success: false, strategyUsed: strategy, error: 'Unknown strategy' };
  }
}

/**
 * Extract from TikTok SIGI_STATE
 */
async function extractFromSigiState(html: string, url: string): Promise<ExtractionResult> {
  try {
    const { fetchMeta } = await import('@/lib/fetch_meta');
    const meta = await fetchMeta(url);
    
    if (meta && (meta.ingredients?.length || 0) > 0) {
      return {
        success: true,
        title: meta.title,
        ingredients: meta.ingredients,
        steps: meta.steps,
        image: meta.image,
        confidence: 'high',
        strategyUsed: 'server-html-sigi',
      };
    }
    
    return { success: false, strategyUsed: 'server-html-sigi' };
  } catch (error: any) {
    return { success: false, strategyUsed: 'server-html-sigi', error: error.message };
  }
}

/**
 * Extract from meta tags
 */
async function extractFromMeta(html: string, url: string): Promise<ExtractionResult> {
  try {
    const { fetchMeta } = await import('@/lib/fetch_meta');
    const meta = await fetchMeta(url);
    
    if (meta && (meta.ingredients?.length || 0) > 0) {
      return {
        success: true,
        title: meta.title,
        ingredients: meta.ingredients,
        steps: meta.steps,
        image: meta.image,
        confidence: meta.ingredients.length >= 3 ? 'high' : 'medium',
        strategyUsed: 'server-html-meta',
      };
    }
    
    return { success: false, strategyUsed: 'server-html-meta' };
  } catch (error: any) {
    return { success: false, strategyUsed: 'server-html-meta', error: error.message };
  }
}

/**
 * Extract from JSON-LD
 */
async function extractFromJsonLd(html: string, url: string): Promise<ExtractionResult> {
  try {
    const { extractRecipeFromJsonLd } = await import('@/lib/recipeSiteHelpers');
    const recipe = extractRecipeFromJsonLd(html);
    
    if (recipe && (recipe.ingredients?.length || 0) > 0) {
      return {
        success: true,
        title: recipe.title,
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        image: recipe.image,
        confidence: 'high',
        strategyUsed: 'server-html-jsonld',
      };
    }
    
    return { success: false, strategyUsed: 'server-html-jsonld' };
  } catch (error: any) {
    return { success: false, strategyUsed: 'server-html-jsonld', error: error.message };
  }
}

/**
 * Extract from oEmbed API
 */
async function extractFromOEmbed(url: string): Promise<ExtractionResult> {
  try {
    // TikTok oEmbed
    if (url.includes('tiktok.com')) {
      const { tiktokOEmbedThumbnail } = await import('@/lib/tiktok');
      const thumbnail = await tiktokOEmbedThumbnail(url);
      
      // oEmbed only gives us thumbnail, not recipe data
      // This is more of a fallback for image extraction
      return {
        success: false,
        strategyUsed: 'oembed-api',
        error: 'oEmbed does not provide recipe data',
      };
    }
    
    return { success: false, strategyUsed: 'oembed-api' };
  } catch (error: any) {
    return { success: false, strategyUsed: 'oembed-api', error: error.message };
  }
}

/**
 * Log successful extraction for pattern learning
 */
async function logSuccessfulExtraction(
  url: string,
  siteType: SiteType,
  parserVersion: string,
  strategy: StrategyName,
  htmlPattern: string,
  result: ExtractionResult
): Promise<void> {
  try {
    const { logImportAttempt, updateExtractionPattern } = await import('./versioning');
    
    // Log the attempt
    await logImportAttempt({
      url,
      siteType,
      parserVersion: parserVersion as any,
      strategyUsed: strategy,
      success: true,
      confidenceScore: result.confidence,
      ingredientsCount: result.ingredients?.length,
      stepsCount: result.steps?.length,
    });
    
    // Update pattern success rate
    await updateExtractionPattern(
      siteType,
      htmlPattern,
      strategy,
      parserVersion as any,
      true
    );
  } catch (error) {
    // Silently fail - don't break extraction flow
    console.warn('[logSuccessfulExtraction] Error:', error);
  }
}

/**
 * Log failed extraction for pattern learning
 */
async function logFailedExtraction(
  url: string,
  siteType: SiteType,
  parserVersion: string,
  strategy: StrategyName,
  htmlPattern: string,
  errorMessage: string
): Promise<void> {
  try {
    const { logImportAttempt, updateExtractionPattern } = await import('./versioning');
    
    // Log the attempt
    await logImportAttempt({
      url,
      siteType,
      parserVersion: parserVersion as any,
      strategyUsed: strategy,
      success: false,
      errorMessage,
    });
    
    // Update pattern success rate
    await updateExtractionPattern(
      siteType,
      htmlPattern,
      strategy,
      parserVersion as any,
      false
    );
  } catch (error) {
    // Silently fail
    console.warn('[logFailedExtraction] Error:', error);
  }
}

