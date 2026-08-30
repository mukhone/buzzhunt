const CitationTrend = require('../models/CitationTrend');
const SourceAnalysis = require('../models/SourceAnalysis');
const ScraperHistory = require('../models/ScraperHistory');
const { getTimePeriods, categorizeDomain, getDomainAuthority, getPeriodDates, getPreviousPeriod } = require('../utils/domainAnalyzer');

/**
 * Calculate and update analytics after a scrape batch completes
 * @param {String} userPlatformId - UserPlatform ID
 * @param {String} scrapeBatchId - Scrape batch ID
 */
async function calculateAnalytics(userPlatformId, scrapeBatchId) {
  console.log(`[Analytics] Calculating for userPlatform ${userPlatformId}, batch ${scrapeBatchId}`);

  try {
    // Get all results from this batch
    const results = await ScraperHistory.find({
      userPlatform: userPlatformId,
      scrapeBatchId: scrapeBatchId
    });

    if (results.length === 0) {
      console.log('[Analytics] No results to process');
      return {
        success: true,
        resultsProcessed: 0,
        message: 'No results in batch'
      };
    }

    // Update source analysis
    await updateSourceAnalysis(userPlatformId, results);

    // Update citation trends (daily, weekly, monthly)
    await updateCitationTrends(userPlatformId, results);

    console.log(`[Analytics] ✅ Completed for ${results.length} results`);

    return {
      success: true,
      resultsProcessed: results.length,
      userPlatformId,
      scrapeBatchId
    };
  } catch (error) {
    console.error('[Analytics] ❌ Error:', error);
    throw error;
  }
}

/**
 * Update SourceAnalysis for each domain
 * @param {String} userPlatformId - UserPlatform ID
 * @param {Array} results - Array of ScraperHistory documents
 */
async function updateSourceAnalysis(userPlatformId, results) {
  console.log(`[Analytics] Updating source analysis for ${results.length} results`);

  for (const result of results) {
    if (!result.sourceDomain) {
      console.warn(`[Analytics] Skipping result with no sourceDomain: ${result._id}`);
      continue;
    }

    const keyword = result.keyword || result.url;

    try {
      // Find or create source analysis
      let sourceAnalysis = await SourceAnalysis.findOne({
        userPlatform: userPlatformId,
        domain: result.sourceDomain
      });

      if (!sourceAnalysis) {
        // Create new source analysis
        sourceAnalysis = new SourceAnalysis({
          userPlatform: userPlatformId,
          domain: result.sourceDomain,
          category: categorizeDomain(result.sourceDomain),
          authority: getDomainAuthority(result.sourceDomain),
          totalCitations: 0,
          keywords: [],
          sampleUrls: [],
          citationsByPeriod: [],
          firstSeenAt: new Date(),
          lastSeenAt: new Date()
        });
      }

      // Update statistics
      sourceAnalysis.totalCitations += 1;
      sourceAnalysis.lastSeenAt = new Date();
      sourceAnalysis.lastUpdatedAt = new Date();

      // Update keyword tracking
      if (keyword) {
        const keywordEntry = sourceAnalysis.keywords.find(k => k.keyword === keyword);
        if (keywordEntry) {
          keywordEntry.count += 1;
          keywordEntry.lastSeen = new Date();
        } else {
          sourceAnalysis.keywords.push({
            keyword: keyword,
            count: 1,
            lastSeen: new Date()
          });
        }

        // Keep only top 20 keywords
        if (sourceAnalysis.keywords.length > 20) {
          sourceAnalysis.keywords.sort((a, b) => b.count - a.count);
          sourceAnalysis.keywords = sourceAnalysis.keywords.slice(0, 20);
        }
      }

      // Update sample URLs (keep latest 5)
      sourceAnalysis.sampleUrls.unshift({
        url: result.url,
        title: result.title || '',
        seenAt: new Date()
      });
      sourceAnalysis.sampleUrls = sourceAnalysis.sampleUrls.slice(0, 5);

      // Update period citations
      const periods = getTimePeriods(result.createdAt || new Date());
      updatePeriodCitations(sourceAnalysis, periods.weekNumber, 'weekly');
      updatePeriodCitations(sourceAnalysis, periods.monthNumber, 'monthly');

      await sourceAnalysis.save();
    } catch (error) {
      console.error(`[Analytics] Error updating source analysis for ${result.sourceDomain}:`, error.message);
      // Continue processing other results
    }
  }

  console.log(`[Analytics] ✅ Source analysis updated`);
}

/**
 * Helper to update period citations in SourceAnalysis
 * @param {Object} sourceAnalysis - SourceAnalysis document
 * @param {Number} periodValue - Period number
 * @param {String} periodType - 'weekly' or 'monthly'
 */
function updatePeriodCitations(sourceAnalysis, periodValue, periodType) {
  const existing = sourceAnalysis.citationsByPeriod.find(
    p => p.periodType === periodType && p.periodValue === periodValue
  );

  if (existing) {
    existing.count += 1;
  } else {
    sourceAnalysis.citationsByPeriod.push({
      periodType: periodType,
      periodValue: periodValue,
      count: 1
    });
  }

  // Keep only last 12 periods
  sourceAnalysis.citationsByPeriod = sourceAnalysis.citationsByPeriod
    .filter(p => p.periodType === periodType)
    .sort((a, b) => b.periodValue - a.periodValue)
    .slice(0, 12)
    .concat(sourceAnalysis.citationsByPeriod.filter(p => p.periodType !== periodType));
}

/**
 * Update CitationTrend aggregations
 * @param {String} userPlatformId - UserPlatform ID
 * @param {Array} results - Array of ScraperHistory documents
 */
async function updateCitationTrends(userPlatformId, results) {
  console.log(`[Analytics] Updating citation trends`);

  // Group by period type
  const periodTypes = ['daily', 'weekly', 'monthly'];

  for (const periodType of periodTypes) {
    // Get all unique periods in results
    const periods = new Set();

    results.forEach(r => {
      const date = r.createdAt || new Date();
      const timePeriods = getTimePeriods(date);

      if (periodType === 'daily') {
        // BUGFIX: Use UTC methods to avoid timezone-dependent date shifting
        const dailyValue = parseInt(
          `${date.getUTCFullYear()}${(date.getUTCMonth()+1).toString().padStart(2,'0')}${date.getUTCDate().toString().padStart(2,'0')}`
        );
        periods.add(dailyValue);
      } else if (periodType === 'weekly') {
        periods.add(timePeriods.weekNumber);
      } else if (periodType === 'monthly') {
        periods.add(timePeriods.monthNumber);
      }
    });

    // Calculate for each period
    for (const periodValue of periods) {
      try {
        await calculatePeriodTrend(userPlatformId, periodType, periodValue);
      } catch (error) {
        console.error(`[Analytics] Error calculating ${periodType} trend for period ${periodValue}:`, error.message);
        // Continue with other periods
      }
    }
  }

  console.log(`[Analytics] ✅ Citation trends updated`);
}

/**
 * Calculate trend for a specific period
 * @param {String} userPlatformId - UserPlatform ID
 * @param {String} periodType - 'daily', 'weekly', or 'monthly'
 * @param {Number} periodValue - Period number
 */
async function calculatePeriodTrend(userPlatformId, periodType, periodValue, options = {}) {
  // Get date range for period
  const { periodStart, periodEnd } = getPeriodDates(periodType, periodValue);

  // Get all results in this period
  const results = await ScraperHistory.find({
    userPlatform: userPlatformId,
    createdAt: { $gte: periodStart, $lte: periodEnd }
  });

  if (results.length === 0) {
    // FIX: Without zero rows, the dashboard keeps serving the last non-zero
    // period as the "latest". When `recordZeroes` is set we still upsert a
    // zero datapoint so quiet periods are reflected in the trend.
    if (!options.recordZeroes) {
      console.log(`[Analytics] No results for ${periodType} period ${periodValue}`);
      return;
    }

    const previousPeriodValue = getPreviousPeriod(periodType, periodValue);
    const previousTrend = await CitationTrend.findOne({
      userPlatform: userPlatformId,
      periodType,
      periodValue: previousPeriodValue
    });

    const changeAbsolute = previousTrend ? -previousTrend.totalCitations : 0;
    const changePercent = previousTrend && previousTrend.totalCitations > 0 ? -100 : 0;

    await CitationTrend.findOneAndUpdate(
      { userPlatform: userPlatformId, periodType, periodValue },
      {
        periodStart,
        periodEnd,
        totalCitations: 0,
        uniqueUrls: 0,
        uniqueDomains: 0,
        topDomains: [],
        changePercent,
        changeAbsolute,
        lastCalculatedAt: new Date(),
        dataPoints: 0
      },
      { upsert: true, new: true }
    );

    console.log(`[Analytics] ✅ Wrote zero datapoint for ${periodType} period ${periodValue}`);
    return;
  }

  // Calculate metrics
  const uniqueUrls = new Set(results.map(r => r.url)).size;
  const uniqueDomains = new Set(results.map(r => r.sourceDomain).filter(Boolean)).size;

  // Count by domain
  const domainCounts = {};
  results.forEach(r => {
    if (r.sourceDomain) {
      domainCounts[r.sourceDomain] = (domainCounts[r.sourceDomain] || 0) + 1;
    }
  });

  // Get top 10 domains
  const topDomains = Object.entries(domainCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([domain, count]) => ({
      domain,
      count,
      percentage: parseFloat((count / results.length * 100).toFixed(1)),
      category: categorizeDomain(domain),
      authority: getDomainAuthority(domain)
    }));

  // Get previous period for change calculation
  const previousPeriodValue = getPreviousPeriod(periodType, periodValue);
  const previousTrend = await CitationTrend.findOne({
    userPlatform: userPlatformId,
    periodType,
    periodValue: previousPeriodValue
  });

  const changeAbsolute = previousTrend ? results.length - previousTrend.totalCitations : 0;
  const changePercent = previousTrend && previousTrend.totalCitations > 0
    ? parseFloat(((changeAbsolute / previousTrend.totalCitations) * 100).toFixed(1))
    : 0;

  // Update or create trend
  await CitationTrend.findOneAndUpdate(
    {
      userPlatform: userPlatformId,
      periodType,
      periodValue
    },
    {
      periodStart,
      periodEnd,
      totalCitations: results.length,
      uniqueUrls,
      uniqueDomains,
      topDomains,
      changePercent,
      changeAbsolute,
      lastCalculatedAt: new Date(),
      dataPoints: results.length
    },
    {
      upsert: true,
      new: true
    }
  );

  console.log(`[Analytics] ✅ ${periodType} trend calculated for period ${periodValue}: ${results.length} citations`);
}

/**
 * Recalculate all analytics for a user platform (for migration/backfill)
 * @param {String} userPlatformId - UserPlatform ID
 */
async function recalculateAllAnalytics(userPlatformId) {
  console.log(`[Analytics] Recalculating all analytics for userPlatform ${userPlatformId}`);

  try {
    // Get all scraper history for this platform
    const allResults = await ScraperHistory.find({
      userPlatform: userPlatformId
    }).sort({ createdAt: 1 }); // Oldest first

    if (allResults.length === 0) {
      console.log('[Analytics] No historical data found');
      return {
        success: true,
        resultsProcessed: 0,
        message: 'No historical data'
      };
    }

    // Clear existing analytics
    await SourceAnalysis.deleteMany({ userPlatform: userPlatformId });
    await CitationTrend.deleteMany({ userPlatform: userPlatformId });

    console.log('[Analytics] Cleared existing analytics');

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < allResults.length; i += batchSize) {
      const batch = allResults.slice(i, i + batchSize);
      console.log(`[Analytics] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allResults.length / batchSize)}`);

      await updateSourceAnalysis(userPlatformId, batch);
      await updateCitationTrends(userPlatformId, batch);
    }

    console.log(`[Analytics] ✅ Recalculation complete: ${allResults.length} results processed`);

    return {
      success: true,
      resultsProcessed: allResults.length,
      userPlatformId
    };
  } catch (error) {
    console.error('[Analytics] ❌ Recalculation error:', error);
    throw error;
  }
}

/**
 * Record a zero-citation datapoint for the current daily/weekly/monthly buckets.
 * Called after a scrape run that produced no new results, so the trend chart
 * doesn't keep displaying the last non-zero value as the "current" period.
 */
async function recordZeroDataPoint(userPlatformId, atDate = new Date()) {
  try {
    const timePeriods = getTimePeriods(atDate);
    const dailyValue = parseInt(
      `${atDate.getUTCFullYear()}${(atDate.getUTCMonth() + 1).toString().padStart(2, '0')}${atDate.getUTCDate().toString().padStart(2, '0')}`
    );

    await calculatePeriodTrend(userPlatformId, 'daily', dailyValue, { recordZeroes: true });
    await calculatePeriodTrend(userPlatformId, 'weekly', timePeriods.weekNumber, { recordZeroes: true });
    await calculatePeriodTrend(userPlatformId, 'monthly', timePeriods.monthNumber, { recordZeroes: true });
  } catch (error) {
    console.error('[Analytics] ❌ recordZeroDataPoint failed:', error.message);
  }
}

module.exports = {
  calculateAnalytics,
  recalculateAllAnalytics,
  recordZeroDataPoint
};
