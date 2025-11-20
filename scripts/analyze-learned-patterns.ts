// scripts/analyze-learned-patterns.ts
// Analyzes what the system has learned from import attempts and patterns

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: {} },
  db: { schema: 'public' },
  storage: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve(null), removeItem: () => Promise.resolve(null) },
});

async function analyzeSystem() {
  console.log('📊 Analyzing System Learning Data...\n');
  console.log('=' .repeat(60));
  
  // 1. Overall Statistics
  console.log('\n## 1. Overall Import Statistics\n');
  
  const { data: overall } = await supabase
    .from('recipe_import_attempts')
    .select('success, site_type, strategy_used, user_corrected');
  
  if (!overall || overall.length === 0) {
    console.log('❌ No import attempts found. System hasn\'t learned anything yet.');
    console.log('\n💡 Next steps:');
    console.log('   1. Import some recipes in the app');
    console.log('   2. Or run backfill script: npx tsx scripts/backfill-parser-patterns.ts');
    return;
  }
  
  const total = overall.length;
  const successful = overall.filter(a => a.success).length;
  const failed = total - successful;
  const userCorrected = overall.filter(a => a.user_corrected).length;
  
  console.log(`Total Import Attempts: ${total}`);
  console.log(`✅ Successful: ${successful} (${((successful/total)*100).toFixed(1)}%)`);
  console.log(`❌ Failed: ${failed} (${((failed/total)*100).toFixed(1)}%)`);
  console.log(`✏️  User Corrected: ${userCorrected} (${((userCorrected/total)*100).toFixed(1)}%)`);
  
  // 2. Success Rate by Site Type
  console.log('\n## 2. Success Rate by Site Type\n');
  
  const siteStats = new Map<string, { attempts: number; successes: number; corrections: number }>();
  
  overall.forEach(attempt => {
    const stats = siteStats.get(attempt.site_type) || { attempts: 0, successes: 0, corrections: 0 };
    stats.attempts++;
    if (attempt.success) stats.successes++;
    if (attempt.user_corrected) stats.corrections++;
    siteStats.set(attempt.site_type, stats);
  });
  
  const siteArray = Array.from(siteStats.entries())
    .map(([site, stats]) => ({
      site,
      ...stats,
      successRate: (stats.successes / stats.attempts) * 100,
      correctionRate: (stats.corrections / stats.attempts) * 100,
    }))
    .sort((a, b) => b.attempts - a.attempts);
  
  console.log('Site Type          | Attempts | Success | Success % | Corrected');
  console.log('-'.repeat(70));
  siteArray.forEach(({ site, attempts, successes, successRate, corrections }) => {
    const siteName = site.padEnd(17);
    const successStr = `${successes}/${attempts}`.padEnd(8);
    const rateStr = `${successRate.toFixed(1)}%`.padEnd(10);
    const correctedStr = corrections > 0 ? `${corrections} (${((corrections/attempts)*100).toFixed(1)}%)` : '0';
    console.log(`${siteName} | ${attempts.toString().padStart(8)} | ${successStr} | ${rateStr} | ${correctedStr}`);
  });
  
  // 3. Strategy Performance
  console.log('\n## 3. Strategy Performance\n');
  
  const strategyStats = new Map<string, { attempts: number; successes: number }>();
  
  overall.forEach(attempt => {
    if (attempt.strategy_used === 'attempt-started' || attempt.strategy_used === 'user-corrected') return;
    
    const stats = strategyStats.get(attempt.strategy_used) || { attempts: 0, successes: 0 };
    stats.attempts++;
    if (attempt.success) stats.successes++;
    strategyStats.set(attempt.strategy_used, stats);
  });
  
  const strategyArray = Array.from(strategyStats.entries())
    .map(([strategy, stats]) => ({
      strategy,
      ...stats,
      successRate: (stats.successes / stats.attempts) * 100,
    }))
    .sort((a, b) => b.successRate - a.successRate);
  
  console.log('Strategy              | Attempts | Success | Success %');
  console.log('-'.repeat(55));
  strategyArray.forEach(({ strategy, attempts, successes, successRate }) => {
    const strategyName = strategy.padEnd(20);
    const successStr = `${successes}/${attempts}`.padEnd(8);
    const rateStr = `${successRate.toFixed(1)}%`;
    console.log(`${strategyName} | ${attempts.toString().padStart(8)} | ${successStr} | ${rateStr}`);
  });
  
  // 4. Learned Patterns
  console.log('\n## 4. Learned Patterns (Top 20)\n');
  
  const { data: patterns } = await supabase
    .from('recipe_extraction_patterns')
    .select('*')
    .order('sample_count', { ascending: false })
    .limit(20);
  
  if (patterns && patterns.length > 0) {
    console.log('Site Type    | Pattern (truncated)                    | Strategy          | Success % | Samples');
    console.log('-'.repeat(95));
    patterns.forEach(p => {
      const site = (p.site_type || '').padEnd(11);
      const pattern = (p.html_pattern || '').substring(0, 35).padEnd(36);
      const method = (p.extraction_method || '').padEnd(17);
      const rate = `${(p.success_rate || 0).toFixed(1)}%`.padEnd(10);
      const samples = (p.sample_count || 0).toString();
      console.log(`${site} | ${pattern} | ${method} | ${rate} | ${samples}`);
    });
  } else {
    console.log('⚠️  No patterns learned yet.');
    console.log('💡 Run backfill script to learn patterns: npx tsx scripts/backfill-parser-patterns.ts');
  }
  
  // 5. Failure Analysis
  console.log('\n## 5. Failure Analysis\n');
  
  const { data: failures } = await supabase
    .from('recipe_import_attempts')
    .select('site_type, strategy_used, error_message')
    .eq('success', false)
    .not('error_message', 'is', null)
    .limit(50);
  
  if (failures && failures.length > 0) {
    const errorCounts = new Map<string, number>();
    
    failures.forEach(f => {
      const key = `${f.site_type} - ${f.strategy_used}`;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    });
    
    console.log('Top Failure Patterns:');
    Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([pattern, count]) => {
        console.log(`  ${pattern}: ${count} failures`);
      });
    
    // Show sample error messages
    const uniqueErrors = new Set<string>();
    failures.forEach(f => {
      if (f.error_message && !f.error_message.includes('Import in progress')) {
        uniqueErrors.add(f.error_message.substring(0, 80));
      }
    });
    
    if (uniqueErrors.size > 0) {
      console.log('\nSample Error Messages:');
      Array.from(uniqueErrors).slice(0, 5).forEach(err => {
        console.log(`  - ${err}...`);
      });
    }
  } else {
    console.log('✅ No detailed failure data available.');
  }
  
  // 6. Recommendations
  console.log('\n## 6. Recommendations\n');
  
  const recommendations: string[] = [];
  
  // Check if we have enough data
  if (total < 50) {
    recommendations.push('⚠️  Low data volume: Need at least 50+ import attempts for meaningful insights');
    recommendations.push('💡 Import more recipes or run backfill script');
  }
  
  // Check site-specific issues
  siteArray.forEach(({ site, successRate, attempts }) => {
    if (attempts >= 10) {
      if (successRate < 30) {
        recommendations.push(`❌ ${site}: Critical issue - ${successRate.toFixed(1)}% success (${attempts} attempts)`);
        recommendations.push(`   → Investigate extraction strategies for ${site}`);
      } else if (successRate < 60) {
        recommendations.push(`⚠️  ${site}: Needs improvement - ${successRate.toFixed(1)}% success (${attempts} attempts)`);
      }
    }
  });
  
  // Check strategy issues
  strategyArray.forEach(({ strategy, successRate, attempts }) => {
    if (attempts >= 10 && successRate < 40) {
      recommendations.push(`⚠️  Strategy "${strategy}": Low success rate ${successRate.toFixed(1)}% (${attempts} attempts)`);
    }
  });
  
  // Check user corrections
  if (userCorrected > 0) {
    const correctionRate = (userCorrected / total) * 100;
    if (correctionRate > 10) {
      recommendations.push(`⚠️  High user correction rate: ${correctionRate.toFixed(1)}%`);
      recommendations.push('   → Many users need to fix imports - extraction quality needs improvement');
    }
  }
  
  // Check pattern learning
  if (!patterns || patterns.length === 0) {
    recommendations.push('💡 No patterns learned yet - run backfill script to build pattern database');
  } else {
    const highSuccessPatterns = patterns.filter(p => (p.success_rate || 0) >= 80);
    const lowSuccessPatterns = patterns.filter(p => (p.success_rate || 0) < 50 && (p.sample_count || 0) >= 5);
    
    if (highSuccessPatterns.length > 0) {
      recommendations.push(`✅ Found ${highSuccessPatterns.length} high-success patterns (80%+) - system is learning!`);
    }
    
    if (lowSuccessPatterns.length > 0) {
      recommendations.push(`⚠️  Found ${lowSuccessPatterns.length} low-success patterns (<50%) - consider improving extraction`);
    }
  }
  
  if (recommendations.length === 0) {
    recommendations.push('✅ System looks good! Continue monitoring and collecting data.');
  }
  
  recommendations.forEach(rec => console.log(rec));
  
  // 7. Data Quality Check
  console.log('\n## 7. Data Quality\n');
  
  const { data: recentAttempts } = await supabase
    .from('recipe_import_attempts')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (recentAttempts && recentAttempts.length > 0) {
    const lastAttempt = new Date(recentAttempts[0].created_at);
    const daysAgo = Math.floor((Date.now() - lastAttempt.getTime()) / (1000 * 60 * 60 * 24));
    console.log(`Last import attempt: ${daysAgo} day(s) ago`);
    
    if (daysAgo > 7) {
      console.log('⚠️  No recent activity - system may not be collecting new data');
    }
  }
  
  const { data: patternCount } = await supabase
    .from('recipe_extraction_patterns')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Learned patterns: ${patternCount || 0}`);
  
  if ((patternCount || 0) < 10 && total >= 50) {
    console.log('⚠️  Low pattern count despite many attempts - run backfill script');
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Analysis complete!\n');
}

async function main() {
  await analyzeSystem();
}

main().catch(console.error);

