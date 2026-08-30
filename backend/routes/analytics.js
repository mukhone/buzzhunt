const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const CitationTrend = require('../models/CitationTrend');
const SourceAnalysis = require('../models/SourceAnalysis');
const CompetitorMention = require('../models/CompetitorMention');
const ScraperHistory = require('../models/ScraperHistory');
const UserPlatform = require('../models/UserPlatform');
const Platform = require('../models/Platform');
const mongoose = require('mongoose');

/**
 * GET /api/analytics/overview
 * Get overall analytics summary across all platforms
 */
router.get('/overview', auth, async (req, res) => {
  try {
    const { period = 'weekly' } = req.query;

    // Get user's active platforms (ONLY prompt-based platforms)
    const allUserPlatforms = await UserPlatform.find({
      user: req.user._id,
      isActive: true
    }).populate('platform');

    // Filter for prompt-based platforms only (Perplexity, ChatGPT, Google AI)
    const userPlatforms = allUserPlatforms.filter(up =>
      up.platform && up.platform.inputType === 'prompts'
    );

    if (userPlatforms.length === 0) {
      return res.json({
        period,
        platforms: [],
        totalCitations: 0,
        totalUniqueDomains: 0,
        topDomains: [],
        recentMentions: []
      });
    }

    const overview = {
      period,
      platforms: [],
      totalCitations: 0,
      totalUniqueDomains: 0,
      topDomains: [],
      recentMentions: []
    };

    // Collect userPlatform IDs for querying
    const userPlatformIds = userPlatforms.map(up => up._id);

    // Get latest trend for each platform
    for (const up of userPlatforms) {
      const latestTrend = await CitationTrend.findOne({
        userPlatform: up._id,
        periodType: period
      }).sort({ periodValue: -1 });

      if (latestTrend) {
        overview.platforms.push({
          userPlatformId: up._id,
          platformName: up.platform.displayName,
          platformType: up.platform.inputType,
          totalCitations: latestTrend.totalCitations,
          uniqueDomains: latestTrend.uniqueDomains,
          changePercent: latestTrend.changePercent,
          topDomain: latestTrend.topDomains[0] || null
        });

        overview.totalCitations += latestTrend.totalCitations;

        // Aggregate top domains (for display in top domains list)
        latestTrend.topDomains.forEach(d => {
          const existing = overview.topDomains.find(td => td.domain === d.domain);
          if (existing) {
            existing.count += d.count;
          } else {
            // Convert Mongoose subdocument to plain object
            overview.topDomains.push({
              domain: d.domain,
              count: d.count,
              percentage: d.percentage
            });
          }
        });
      }
    }

    // BUGFIX: Get accurate unique domain count for CURRENT PERIOD (not lifetime)
    // Iterate per-platform to handle platforms on different periods correctly
    const allDomainsSet = new Set();
    let foundAnyTrends = false;

    for (const up of userPlatforms) {
      // Find the most recent period trend for THIS platform
      const latestTrend = await CitationTrend.findOne({
        userPlatform: up._id,
        periodType: period
      }).sort({ periodValue: -1 });

      if (latestTrend && latestTrend.periodStart && latestTrend.periodEnd) {
        foundAnyTrends = true;
        // Query distinct domains for this platform's current period
        const platformDomains = await ScraperHistory.distinct('sourceDomain', {
          userPlatform: up._id,
          createdAt: {
            $gte: latestTrend.periodStart,
            $lte: latestTrend.periodEnd
          }
        });
        // Merge into global set
        platformDomains.filter(Boolean).forEach(d => allDomainsSet.add(d));
      }
    }

    // BUGFIX: Only fall back to all history if NO trends exist (not just empty set)
    // If trends exist but domains is 0, that's a legitimate zero period
    if (!foundAnyTrends) {
      const uniqueDomains = await ScraperHistory.distinct('sourceDomain', {
        userPlatform: { $in: userPlatformIds }
      });
      uniqueDomains.filter(Boolean).forEach(d => allDomainsSet.add(d));
    }

    overview.totalUniqueDomains = allDomainsSet.size;

    // Sort and limit top domains
    overview.topDomains = overview.topDomains
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Recalculate percentages after aggregation
    const totalCount = overview.topDomains.reduce((sum, d) => sum + d.count, 0);
    overview.topDomains.forEach(d => {
      d.percentage = totalCount > 0 ? parseFloat((d.count / totalCount * 100).toFixed(1)) : 0;
    });

    // Enrich top domains with SourceAnalysis data (category, authority)
    for (const domain of overview.topDomains) {
      const sourceAnalysis = await SourceAnalysis.findOne({
        userPlatform: { $in: userPlatforms.map(up => up._id) },
        domain: domain.domain
      }).select('category authority firstSeenAt lastSeenAt');

      if (sourceAnalysis) {
        domain.category = sourceAnalysis.category;
        domain.authority = sourceAnalysis.authority;
        domain.firstSeenAt = sourceAnalysis.firstSeenAt;
        domain.lastSeenAt = sourceAnalysis.lastSeenAt;
      } else {
        // Fallback if SourceAnalysis doesn't exist yet
        domain.category = 'Other';
        domain.authority = 'Medium';
        domain.firstSeenAt = null;
        domain.lastSeenAt = null;
      }
    }

    // Get recent mentions (last 20)
    overview.recentMentions = await ScraperHistory.find({
      userPlatform: { $in: userPlatforms.map(up => up._id) }
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('url title sourceDomain createdAt keyword userPlatform')
      .populate('userPlatform', 'platform')
      .populate({
        path: 'userPlatform',
        populate: { path: 'platform', select: 'displayName' }
      });

    res.json(overview);
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

/**
 * GET /api/analytics/trends/:userPlatformId
 * Get citation trends for a specific platform
 */
router.get('/trends/:userPlatformId', auth, async (req, res) => {
  try {
    const { userPlatformId } = req.params;
    const { period = 'weekly', limit = 12 } = req.query;

    // Verify ownership
    const userPlatform = await UserPlatform.findOne({
      _id: userPlatformId,
      user: req.user._id
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    // Get trends
    const trends = await CitationTrend.find({
      userPlatform: userPlatformId,
      periodType: period
    })
      .sort({ periodValue: -1 })
      .limit(parseInt(limit));

    res.json({
      userPlatformId,
      platformName: userPlatform.platform.displayName,
      period,
      trends: trends.reverse() // Oldest to newest for chart display
    });
  } catch (error) {
    console.error('Trends error:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

/**
 * GET /api/analytics/sources/:userPlatformId
 * Get source analysis for a platform
 */
router.get('/sources/:userPlatformId', auth, async (req, res) => {
  try {
    const { userPlatformId } = req.params;
    const { category, authority, sortBy = 'totalCitations', limit = 50 } = req.query;

    // Verify ownership
    const userPlatform = await UserPlatform.findOne({
      _id: userPlatformId,
      user: req.user._id
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    // Build query
    const query = { userPlatform: new mongoose.Types.ObjectId(userPlatformId) };
    if (category) query.category = category;
    if (authority) query.authority = authority;

    // Get sources
    const sortOrder = {};
    sortOrder[sortBy] = -1;

    const sources = await SourceAnalysis.find(query)
      .sort(sortOrder)
      .limit(parseInt(limit));

    // Get category breakdown
    const categoryBreakdown = await SourceAnalysis.aggregate([
      { $match: { userPlatform: new mongoose.Types.ObjectId(userPlatformId) } },
      { $group: {
        _id: '$category',
        count: { $sum: 1 },
        totalCitations: { $sum: '$totalCitations' }
      }},
      { $sort: { totalCitations: -1 } }
    ]);

    // Get authority breakdown
    const authorityBreakdown = await SourceAnalysis.aggregate([
      { $match: { userPlatform: new mongoose.Types.ObjectId(userPlatformId) } },
      { $group: {
        _id: '$authority',
        count: { $sum: 1 },
        totalCitations: { $sum: '$totalCitations' }
      }},
      { $sort: { totalCitations: -1 } }
    ]);

    res.json({
      userPlatformId,
      platformName: userPlatform.platform.displayName,
      sources,
      categoryBreakdown,
      authorityBreakdown
    });
  } catch (error) {
    console.error('Sources error:', error);
    res.status(500).json({ error: 'Failed to fetch sources' });
  }
});

/**
 * GET /api/analytics/history/:userPlatformId
 * Get full URL history for dashboard viewing
 */
router.get('/history/:userPlatformId', auth, async (req, res) => {
  try {
    const { userPlatformId } = req.params;
    const { page = 1, limit = 100, keyword, domain } = req.query;

    // Verify ownership
    const userPlatform = await UserPlatform.findOne({
      _id: userPlatformId,
      user: req.user._id
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    // Build query
    const query = { userPlatform: new mongoose.Types.ObjectId(userPlatformId) };

    // SECURITY: Escape regex special characters to prevent ReDoS/injection
    if (keyword) {
      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.keyword = new RegExp(escapedKeyword, 'i');
    }

    if (domain) query.sourceDomain = domain;

    // Get history with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const history = await ScraperHistory.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('url title sourceDomain keyword createdAt snippet');

    const total = await ScraperHistory.countDocuments(query);

    res.json({
      userPlatformId,
      platformName: userPlatform.platform.displayName,
      history,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * GET /api/analytics/competitors/:userPlatformId
 * Get competitor mentions (OPTIONAL - prompt platforms only)
 */
router.get('/competitors/:userPlatformId', auth, async (req, res) => {
  try {
    const { userPlatformId } = req.params;
    const { limit = 50 } = req.query;

    // Verify ownership and check if enabled
    const userPlatform = await UserPlatform.findOne({
      _id: userPlatformId,
      user: req.user._id
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    if (!userPlatform.competitorTrackingEnabled) {
      return res.json({
        enabled: false,
        message: 'Competitor tracking not enabled for this platform'
      });
    }

    // Get competitor mentions
    const mentions = await CompetitorMention.find({
      userPlatform: new mongoose.Types.ObjectId(userPlatformId)
    })
      .sort({ detectedAt: -1 })
      .limit(parseInt(limit));

    // Get breakdown by competitor
    const competitorBreakdown = await CompetitorMention.aggregate([
      { $match: { userPlatform: new mongoose.Types.ObjectId(userPlatformId) } },
      { $group: {
        _id: '$competitorName',
        totalMentions: { $sum: 1 },
        coMentionsWithYou: {
          $sum: { $cond: ['$yourBrandMentioned', 1, 0] }
        },
        positiveMentions: {
          $sum: { $cond: [{ $eq: ['$sentiment', 'positive'] }, 1, 0] }
        },
        negativeMentions: {
          $sum: { $cond: [{ $eq: ['$sentiment', 'negative'] }, 1, 0] }
        }
      }},
      { $sort: { totalMentions: -1 } }
    ]);

    res.json({
      enabled: true,
      userPlatformId,
      platformName: userPlatform.platform.displayName,
      yourBrand: userPlatform.yourBrandName,
      competitors: userPlatform.competitors,
      mentions,
      competitorBreakdown
    });
  } catch (error) {
    console.error('Competitors error:', error);
    res.status(500).json({ error: 'Failed to fetch competitor data' });
  }
});

/**
 * POST /api/analytics/competitors/:userPlatformId/enable
 * Enable competitor tracking and set competitors (OPTIONAL)
 */
router.post('/competitors/:userPlatformId/enable', auth, async (req, res) => {
  try {
    const { userPlatformId } = req.params;
    const { competitors, yourBrandName, enabled } = req.body;

    console.log('[Backend] Competitor settings save request:', {
      userPlatformId,
      yourBrandName,
      competitorCount: competitors?.length || 0,
      enabled
    });

    // Get user platform and verify ownership
    const userPlatform = await UserPlatform.findOne({
      _id: userPlatformId,
      user: req.user._id
    }).populate('platform');

    if (!userPlatform) {
      console.log('[Backend] UserPlatform not found or unauthorized:', userPlatformId);
      return res.status(404).json({ error: 'Platform not found or unauthorized' });
    }

    // Check if prompt-based
    if (userPlatform.platform.inputType !== 'prompts') {
      console.log('[Backend] Platform not prompt-based:', userPlatform.platform.displayName);
      return res.status(400).json({
        error: 'Competitor tracking only available for prompt-based platforms (Perplexity, ChatGPT, Google AI)'
      });
    }

    // Update competitor settings
    userPlatform.competitorTrackingEnabled = enabled !== false;
    userPlatform.yourBrandName = yourBrandName || '';
    userPlatform.competitors = (competitors || []).map(c => ({
      name: c.name,
      aliases: c.aliases || [],
      addedAt: new Date()
    }));

    // Store competitor names before saving (to detect deletions)
    const newCompetitorNames = (competitors || []).map(c => c.name);

    await userPlatform.save();

    console.log('[Backend] Competitor settings saved successfully:', {
      platformName: userPlatform.platform.displayName,
      enabled: userPlatform.competitorTrackingEnabled,
      competitorCount: userPlatform.competitors.length
    });

    // Clean up mentions for removed competitors
    // FIX: Previously, clearing the list while leaving tracking enabled left
    // stale CompetitorMention rows in place — the dashboard kept showing
    // competitors the user had already removed. Empty list (regardless of
    // enabled flag) now also wipes all mentions for this platform.
    const CompetitorMention = require('../models/CompetitorMention');

    if (newCompetitorNames.length === 0) {
      const deleteResult = await CompetitorMention.deleteMany({
        userPlatform: userPlatform._id
      });
      if (deleteResult.deletedCount > 0) {
        const reason = enabled ? 'list cleared' : 'tracking disabled';
        console.log(`[Backend] 🗑️  Cleaned up ${deleteResult.deletedCount} mentions (${reason})`);
      }
    } else {
      // Delete mentions for competitors that are no longer in the list
      const deleteResult = await CompetitorMention.deleteMany({
        userPlatform: userPlatform._id,
        competitorName: { $nin: newCompetitorNames } // Not in new list
      });
      if (deleteResult.deletedCount > 0) {
        console.log(`[Backend] 🗑️  Cleaned up ${deleteResult.deletedCount} mentions for removed competitors`);
      }
    }

    // Trigger backfill analysis on historical data (run in background)
    if (userPlatform.competitorTrackingEnabled && userPlatform.competitors.length > 0) {
      console.log('[Backend] Triggering competitor backfill analysis for last 90 days...');

      const { spawn } = require('child_process');
      const path = require('path');

      const backfillScriptPath = path.join(__dirname, '../scripts/backfill-competitor-mentions.js');

      // Spawn backfill process in background (don't wait for it)
      const backfillProcess = spawn('node', [backfillScriptPath], {
        detached: true,
        stdio: 'ignore'
      });

      backfillProcess.unref(); // Allow parent process to exit independently

      console.log('[Backend] ✅ Backfill process started in background');
    }

    res.json({
      message: 'Competitor tracking settings updated',
      competitorTrackingEnabled: userPlatform.competitorTrackingEnabled,
      competitors: userPlatform.competitors,
      yourBrandName: userPlatform.yourBrandName
    });
  } catch (error) {
    console.error('[Backend] Update competitors error:', error);
    res.status(500).json({ error: 'Failed to update competitor settings' });
  }
});

/**
 * GET /api/analytics/stats
 * Get quick stats for all platforms
 */
router.get('/stats', auth, async (req, res) => {
  try {
    // Get user's active platforms (ONLY prompt-based platforms)
    const allUserPlatforms = await UserPlatform.find({
      user: req.user._id,
      isActive: true
    }).populate('platform');

    // Filter for prompt-based platforms only (Perplexity, ChatGPT, Google AI)
    const userPlatforms = allUserPlatforms.filter(up =>
      up.platform && up.platform.inputType === 'prompts'
    );

    const stats = {
      totalPlatforms: userPlatforms.length,
      totalCitations: 0,
      totalDomains: 0,
      platforms: []
    };

    for (const up of userPlatforms) {
      const citationCount = await ScraperHistory.countDocuments({
        userPlatform: up._id
      });

      const domainCount = await ScraperHistory.distinct('sourceDomain', {
        userPlatform: up._id,
        sourceDomain: { $ne: null }
      });

      stats.totalCitations += citationCount;
      stats.totalDomains += domainCount.length;

      stats.platforms.push({
        userPlatformId: up._id,
        citations: citationCount,
        domains: domainCount.length
      });
    }

    res.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
