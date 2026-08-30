const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Platform = require('../models/Platform');
const UserPlatform = require('../models/UserPlatform');
const { scheduleUserScraper, removePlatformJob, getOrCreatePlatformQueue } = require('../services/queueService');

// @route   GET /api/platforms
// @desc    Get all available platforms
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const platforms = await Platform.find({ isActive: true });
    res.json(platforms);
  } catch (error) {
    console.error('Error fetching platforms:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/platforms/user
// @desc    Get user's enabled platforms
// @access  Private
router.get('/user', auth, async (req, res) => {
  try {
    const userPlatforms = await UserPlatform.find({
      user: req.user._id,
      isActive: true
    }).populate('platform');

    res.json(userPlatforms);
  } catch (error) {
    console.error('Error fetching user platforms:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/platforms/:platformId/enable
// @desc    Enable a platform for the user
// @access  Private
router.post('/:platformId/enable', auth, async (req, res) => {
  try {
    const { platformId } = req.params;

    // Check if platform exists
    const platform = await Platform.findById(platformId);
    if (!platform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    if (!platform.isActive) {
      return res.status(400).json({ error: 'Platform is not available yet' });
    }

    // Check if already enabled
    let userPlatform = await UserPlatform.findOne({
      user: req.user._id,
      platform: platformId
    });

    if (userPlatform) {
      if (userPlatform.isActive) {
        return res.status(400).json({ error: 'Platform already enabled' });
      }
      // Reactivate
      userPlatform.isActive = true;
      await userPlatform.save();

      // BUGFIX: Restart queue if platform has keywords
      if (userPlatform.keywords && userPlatform.keywords.length > 0) {
        await userPlatform.populate('platform');
        await scheduleUserScraper({
          userId: String(req.user._id),
          platformId: platformId,
          platformName: userPlatform.platform.name,
          intervalHours: userPlatform.platform.scraperIntervalHours
        });
        console.log(`[Platform] Reactivated and rescheduled job for ${userPlatform.platform.name}`);
      }
    } else {
      // Create new
      userPlatform = new UserPlatform({
        user: req.user._id,
        platform: platformId,
        keywords: []
      });
      await userPlatform.save();
    }

    if (!userPlatform.populated('platform')) {
      await userPlatform.populate('platform');
    }

    res.status(201).json({
      message: 'Platform enabled successfully',
      userPlatform
    });
  } catch (error) {
    console.error('Error enabling platform:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/platforms/:platformId/disable
// @desc    Disable a platform for the user
// @access  Private
router.post('/:platformId/disable', auth, async (req, res) => {
  try {
    const { platformId } = req.params;

    const userPlatform = await UserPlatform.findOne({
      user: req.user._id,
      platform: platformId
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not enabled' });
    }

    // Remove scheduled job
    await removePlatformJob(String(req.user._id), platformId, userPlatform.platform.name);

    userPlatform.isActive = false;
    userPlatform.jobId = null;
    userPlatform.nextRunAt = null;
    await userPlatform.save();

    res.json({ message: 'Platform disabled successfully' });
  } catch (error) {
    console.error('Error disabling platform:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   POST /api/platforms/:platformId/scrape-now
// @desc    Manually trigger immediate scrape for a platform
// @access  Private
router.post('/:platformId/scrape-now', auth, async (req, res) => {
  try {
    const { platformId } = req.params;
    const userId = String(req.user._id);

    // Find user platform
    const userPlatform = await UserPlatform.findOne({
      user: req.user._id,
      platform: platformId
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not enabled' });
    }

    if (!userPlatform.isActive) {
      return res.status(400).json({ error: 'Platform is not active' });
    }

    if (!userPlatform.keywords || userPlatform.keywords.length === 0) {
      return res.status(400).json({ error: 'No keywords/prompts configured for this platform' });
    }

    const platformName = userPlatform.platform.name;

    // Get or create the platform's queue
    const queue = getOrCreatePlatformQueue(platformName);

    // Create unique job ID for manual scrape
    const jobId = `manual-${Date.now()}-${userId}-${platformId}`;

    // Add job to queue with high priority (no job name, just like scheduled jobs)
    await queue.add({
      userId,
      platformId,
      platformName
    }, {
      jobId,
      priority: -1, // Bull: lower number = higher priority. Runs ahead of scheduled jobs (default priority 0).
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: { age: 7 * 24 * 3600 }
    });

    console.log(`[Manual Scrape] Triggered for ${platformName} by user ${userId}`);

    res.json({
      message: 'Scrape job started successfully',
      platformName: userPlatform.platform.displayName,
      jobId,
      estimatedTime: '30-60 seconds'
    });
  } catch (error) {
    console.error('Error triggering manual scrape:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
