// lib/parsers/integration-helper.ts
// Helper to integrate versioned parser system into existing capture flow

import { detectSiteType } from '@/lib/recipeSiteHelpers';
import { getParserConfig, logImportAttempt, type ImportAttempt } from './versioning';
import { executeExtractionStrategies, type ExtractionResult } from './strategy-selector';

/**
 * Enhanced import function that uses versioned parsers
 * This wraps the existing import logic with versioning and learning
 */
export async function importRecipeWithVersioning(
  url: string,
  html?: string
): Promise<{
  success: boolean;
  title?: string;
  ingredients?: string[];
  steps?: string[];
  image?: string;
  confidence?: 'low' | 'medium' | 'high';
  parserVersion?: string;
  strategyUsed?: string;
  error?: string;
}> {
  try {
    // Detect site type
    const siteType = await detectSiteType(url);
    
    // Get parser config for this site
    const config = getParserConfig(siteType);
    
    // If HTML not provided, fetch it
    if (!html) {
      const { fetchHtmlDesktop } = await import('@/lib/fetch_meta');
      html = await fetchHtmlDesktop(url);
    }
    
    // Execute extraction strategies
    const result = await executeExtractionStrategies(url, siteType, html, config);
    
    // Return result in format compatible with existing code
    return {
      success: result.success,
      title: result.title,
      ingredients: result.ingredients,
      steps: result.steps,
      image: result.image,
      confidence: result.confidence,
      parserVersion: config.version,
      strategyUsed: result.strategyUsed,
      error: result.error,
    };
  } catch (error: any) {
    // Log the error
    try {
      const siteType = await detectSiteType(url);
      const config = getParserConfig(siteType);
      
      await logImportAttempt({
        url,
        siteType,
        parserVersion: config.version,
        strategyUsed: 'unknown',
        success: false,
        errorMessage: error.message || 'Unknown error',
      });
    } catch (logError) {
      // Silently fail logging
    }
    
    return {
      success: false,
      error: error.message || 'Import failed',
      confidence: 'low',
    };
  }
}

/**
 * Track when a user manually corrects an imported recipe
 * Call this when user edits a recipe after import
 */
export async function trackUserCorrection(
  url: string,
  originalIngredients: string[],
  correctedIngredients: string[],
  originalSteps: string[],
  correctedSteps: string[]
): Promise<void> {
  try {
    const siteType = await detectSiteType(url);
    const config = getParserConfig(siteType);
    
    // Check if this looks like a significant correction
    const ingredientsChanged = 
      originalIngredients.length !== correctedIngredients.length ||
      originalIngredients.some((ing, i) => ing !== correctedIngredients[i]);
    
    const stepsChanged = 
      originalSteps.length !== correctedSteps.length ||
      originalSteps.some((step, i) => step !== correctedSteps[i]);
    
    if (ingredientsChanged || stepsChanged) {
      // In a real implementation, you'd look up the import attempt ID
      // For now, we'll just log that a correction occurred
      console.log('[trackUserCorrection] User corrected import:', {
        url,
        siteType,
        parserVersion: config.version,
        ingredientsChanged,
        stepsChanged,
      });
      
      // TODO: Look up the import attempt and mark it as corrected
      // This would require storing the attempt ID when importing
    }
  } catch (error) {
    // Silently fail
    console.warn('[trackUserCorrection] Error:', error);
  }
}

/**
 * Get success rate statistics for a parser version
 * Useful for monitoring and A/B testing
 */
export async function getParserStats(
  siteType: string,
  parserVersion: string,
  days: number = 7
): Promise<{
  totalAttempts: number;
  successfulAttempts: number;
  successRate: number;
  averageConfidence: string;
  userCorrectionRate: number;
}> {
  try {
    const { supabase } = await import('@/lib/supabase');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const { data, error } = await supabase
      .from('recipe_import_attempts')
      .select('success, confidence_score, user_corrected')
      .eq('site_type', siteType)
      .eq('parser_version', parserVersion)
      .gte('created_at', cutoffDate.toISOString());
    
    if (error || !data) {
      return {
        totalAttempts: 0,
        successfulAttempts: 0,
        successRate: 0,
        averageConfidence: 'low',
        userCorrectionRate: 0,
      };
    }
    
    const totalAttempts = data.length;
    const successfulAttempts = data.filter(a => a.success).length;
    const correctedAttempts = data.filter(a => a.user_corrected).length;
    
    // Calculate average confidence
    const confidenceScores = data
      .filter(a => a.confidence_score)
      .map(a => {
        if (a.confidence_score === 'high') return 3;
        if (a.confidence_score === 'medium') return 2;
        return 1;
      });
    
    const avgConfidence = confidenceScores.length > 0
      ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
      : 1;
    
    const avgConfidenceStr = avgConfidence >= 2.5 ? 'high' : avgConfidence >= 1.5 ? 'medium' : 'low';
    
    return {
      totalAttempts,
      successfulAttempts,
      successRate: totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0,
      averageConfidence: avgConfidenceStr,
      userCorrectionRate: totalAttempts > 0 ? (correctedAttempts / totalAttempts) * 100 : 0,
    };
  } catch (error) {
    console.warn('[getParserStats] Error:', error);
    return {
      totalAttempts: 0,
      successfulAttempts: 0,
      successRate: 0,
      averageConfidence: 'low',
      userCorrectionRate: 0,
    };
  }
}

