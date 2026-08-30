const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const UserPlatform = require('../models/UserPlatform');

/**
 * @route   GET /api/jobs/run-times/:platformId
 * @desc    Get job timing information for a specific platform
 * @access  Private
 * @returns {Object} { platformId, lastRun, nextRun, intervalHours }
 */
router.get('/run-times/:platformId', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { platformId } = req.params;

    // Find user platform
    const userPlatform = await UserPlatform.findOne({
      user: userId,
      platform: platformId
    }).populate('platform');

    if (!userPlatform) {
      return res.json({
        platformId,
        lastRun: null,
        nextRun: null,
        intervalHours: null,
        isActive: false,
        keywords: []
      });
    }

    res.json({
      platformId,
      lastRun: userPlatform.lastRunAt || null,
      nextRun: userPlatform.nextRunAt || null,
      intervalHours: userPlatform.platform?.scraperIntervalHours || null,
      isActive: userPlatform.isActive,
      keywords: userPlatform.keywords || [],
      jobId: userPlatform.jobId || null
    });
  } catch (error) {
    console.error('Error fetching job run times:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   GET /api/jobs/stats
 * @desc    Get overall queue statistics
 * @access  Private
 */
router.get('/stats', auth, async (req, res) => {
  try {
    const { getQueueStats } = require('../services/queueService');
    const stats = await getQueueStats();

    res.json(stats);
  } catch (error) {
    console.error('Error fetching queue stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   GET /api/jobs/cleanup/stats
 * @desc    Get cleanup statistics (how many records would be deleted)
 * @access  Private
 * @returns {Object} Cleanup statistics
 */
router.get('/cleanup/stats', auth, async (req, res) => {
  try {
    const { getCleanupStats } = require('../services/cleanupService');
    const stats = await getCleanupStats();

    res.json(stats);
  } catch (error) {
    console.error('Error fetching cleanup stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   POST /api/jobs/cleanup
 * @desc    Manually trigger cleanup of old ScraperHistory records for current user
 * @access  Private
 * @body    { daysOld?: number } - Optional: delete records older than this (default: from env)
 * @returns {Object} Cleanup results
 * @security Only deletes current user's records, not all users
 */
router.post('/cleanup', auth, async (req, res) => {
  try {
    const { cleanupOldHistory } = require('../services/cleanupService');
    const { daysOld } = req.body;

    // SECURITY: Pass userId to restrict cleanup to current user's records only
    const result = await cleanupOldHistory(daysOld, req.user.id);

    res.json(result);
  } catch (error) {
    console.error('Error during manual cleanup:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
