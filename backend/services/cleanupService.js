/**
 * Cleanup Service - Manual cleanup utilities for old data
 *
 * MongoDB TTL index handles automatic cleanup, but this service provides:
 * - Manual cleanup trigger for admin use
 * - Cleanup statistics
 * - Force cleanup without waiting for TTL
 */

const ScraperHistory = require('../models/ScraperHistory');

/**
 * Manually clean up old ScraperHistory records
 * @param {number} daysOld - Delete records older than this many days (default: from env or 30)
 * @returns {Object} Cleanup statistics
 */
async function cleanupOldHistory(daysOld = null, userId = null) {
  const retentionDays = daysOld || parseInt(process.env.HISTORY_RETENTION_DAYS) || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const scopeMessage = userId
    ? `for user ${userId}`
    : 'for ALL USERS (admin cleanup)';

  console.log(`[Cleanup] Starting manual cleanup of ScraperHistory older than ${retentionDays} days ${scopeMessage}`);
  console.log(`[Cleanup] Cutoff date: ${cutoffDate.toISOString()} UTC`);

  try {
    // Build query
    const query = { foundAt: { $lt: cutoffDate } };

    // SECURITY: If userId provided, only delete that user's records
    if (userId) {
      query.user = userId;
    }

    // Count records to be deleted
    const countToDelete = await ScraperHistory.countDocuments(query);

    if (countToDelete === 0) {
      console.log('[Cleanup] No old records to delete');
      return {
        success: true,
        deletedCount: 0,
        retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        message: 'No records older than retention period'
      };
    }

    // Delete old records
    const result = await ScraperHistory.deleteMany(query);

    console.log(`[Cleanup] ✅ Deleted ${result.deletedCount} old ScraperHistory records ${scopeMessage}`);

    return {
      success: true,
      deletedCount: result.deletedCount,
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
      message: `Deleted ${result.deletedCount} records older than ${retentionDays} days`
    };
  } catch (error) {
    console.error('[Cleanup] ❌ Error during cleanup:', error);
    throw error;
  }
}

/**
 * Get cleanup statistics
 * @returns {Object} Statistics about ScraperHistory
 */
async function getCleanupStats() {
  const retentionDays = parseInt(process.env.HISTORY_RETENTION_DAYS) || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  try {
    const [total, oldRecords, recentRecords] = await Promise.all([
      ScraperHistory.countDocuments(),
      ScraperHistory.countDocuments({ foundAt: { $lt: cutoffDate } }),
      ScraperHistory.countDocuments({ foundAt: { $gte: cutoffDate } })
    ]);

    // Get oldest record
    const oldest = await ScraperHistory.findOne().sort({ foundAt: 1 }).select('foundAt');

    // Get newest record
    const newest = await ScraperHistory.findOne().sort({ foundAt: -1 }).select('foundAt');

    return {
      total,
      recentRecords,
      oldRecords,
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
      oldestRecord: oldest ? oldest.foundAt.toISOString() : null,
      newestRecord: newest ? newest.foundAt.toISOString() : null
    };
  } catch (error) {
    console.error('[Cleanup] Error getting stats:', error);
    throw error;
  }
}

module.exports = {
  cleanupOldHistory,
  getCleanupStats
};
