const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const UserPlatform = require('../models/UserPlatform');
const Platform = require('../models/Platform');
const { scheduleUserScraper, removePlatformJob } = require('../services/queueService');
const { sanitizeKeyword } = require('../utils/keywordSanitizer');

// @route   POST /api/keywords/:platformId
// @desc    Add a keyword to a platform
// @access  Private
router.post('/:platformId', [
  auth,
  body('keyword').trim().notEmpty().withMessage('Keyword cannot be empty')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { platformId } = req.params;
    let keyword;
    try {
      keyword = sanitizeKeyword(req.body.keyword);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Find user platform
    const userPlatform = await UserPlatform.findOne({
      user: req.user._id,
      platform: platformId,
      isActive: true
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not enabled for this user' });
    }

    // Check max keywords limit
    const maxKeywords = userPlatform.platform.maxKeywords || 3;
    if (userPlatform.keywords.length >= maxKeywords) {
      return res.status(400).json({
        error: `Maximum ${maxKeywords} keywords allowed per platform`
      });
    }

    // Check for duplicate
    if (userPlatform.keywords.includes(keyword)) {
      return res.status(400).json({ error: 'Keyword already exists' });
    }

    // Check if this is the first keyword (going from 0 to 1)
    const wasEmpty = userPlatform.keywords.length === 0;

    // Add keyword
    userPlatform.keywords.push(keyword);
    await userPlatform.save();

    // Schedule job (especially important for first keyword)
    await scheduleUserScraper({
      userId: String(req.user._id),
      platformId: platformId,
      platformName: userPlatform.platform.name,
      intervalHours: userPlatform.platform.scraperIntervalHours
    });

    // FIX: scheduleUserScraper writes nextRunAt to DB but our in-memory
    // userPlatform is stale, so the dashboard kept showing "Not scheduled".
    // Re-fetch so the response carries the freshly written nextRunAt.
    const refreshed = await UserPlatform.findById(userPlatform._id).populate('platform');

    res.status(201).json({
      message: 'Keyword added successfully',
      userPlatform: refreshed
    });
  } catch (error) {
    console.error('Error adding keyword:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   DELETE /api/keywords/:platformId
// @desc    Remove a keyword from a platform
// @access  Private
router.delete('/:platformId', [
  auth,
  body('keyword').trim().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { platformId } = req.params;
    const { keyword } = req.body;

    const userPlatform = await UserPlatform.findOne({
      user: req.user._id,
      platform: platformId,
      isActive: true
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not enabled for this user' });
    }

    // Remove keyword
    const index = userPlatform.keywords.indexOf(keyword);
    if (index === -1) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    userPlatform.keywords.splice(index, 1);
    await userPlatform.save();

    // Update scheduled job or remove if no keywords left
    if (userPlatform.keywords.length === 0) {
      // Remove job when no keywords remain
      await removePlatformJob(String(req.user._id), platformId, userPlatform.platform.name);
    } else {
      // Reschedule with updated keywords
      await scheduleUserScraper({
        userId: String(req.user._id),
        platformId: platformId,
        platformName: userPlatform.platform.name,
        intervalHours: userPlatform.platform.scraperIntervalHours
      });
    }

    // FIX: same as POST — refresh from DB so the response carries the
    // freshly written nextRunAt instead of the stale in-memory copy.
    const refreshed = await UserPlatform.findById(userPlatform._id).populate('platform');

    res.json({
      message: 'Keyword removed successfully',
      userPlatform: refreshed
    });
  } catch (error) {
    console.error('Error removing keyword:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @route   GET /api/keywords/:platformId
// @desc    Get all keywords for a platform
// @access  Private
router.get('/:platformId', auth, async (req, res) => {
  try {
    const { platformId } = req.params;

    const userPlatform = await UserPlatform.findOne({
      user: req.user._id,
      platform: platformId,
      isActive: true
    }).populate('platform');

    if (!userPlatform) {
      return res.status(404).json({ error: 'Platform not enabled' });
    }

    res.json({
      keywords: userPlatform.keywords,
      lastRunAt: userPlatform.lastRunAt,
      nextRunAt: userPlatform.nextRunAt,
      maxKeywords: userPlatform.platform.maxKeywords
    });
  } catch (error) {
    console.error('Error fetching keywords:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
