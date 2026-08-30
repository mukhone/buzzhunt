const mongoose = require('mongoose');

const scraperHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  platform: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Platform',
    required: true,
    index: true
  },
  // NEW: Reference to UserPlatform for analytics grouping
  userPlatform: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserPlatform',
    index: true
  },
  url: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  // NEW: Single keyword/prompt that found this result
  keyword: {
    type: String,
    index: true
  },
  // NEW: AI response or snippet text
  snippet: {
    type: String,
    default: ''
  },
  age: {
    type: String,
    default: null
  },
  // DEPRECATED: Use keyword field instead (kept for backward compatibility)
  keywords: [{
    type: String
  }],
  foundAt: {
    type: Date,
    default: Date.now
  },
  emailSent: {
    type: Boolean,
    default: false
  },

  // ========== ANALYTICS FIELDS ==========

  // Citation tracking
  citationCount: {
    type: Number,
    default: 1,
    index: true
  },

  // Domain extraction for source analysis
  sourceDomain: {
    type: String,
    index: true,
    trim: true
  },

  // Time period tracking for trend analysis
  weekNumber: {
    type: Number,
    index: true  // Format: YYYYWW (e.g., 202545)
  },
  monthNumber: {
    type: Number,
    index: true  // Format: YYYYMM (e.g., 202511)
  },
  yearNumber: {
    type: Number,
    index: true  // Format: YYYY (e.g., 2025)
  },

  // Batch tracking - groups results from same scrape run
  scrapeBatchId: {
    type: String,
    index: true
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate URL tracking per user/platform
scraperHistorySchema.index({ user: 1, platform: 1, url: 1 }, { unique: true });

// ANALYTICS COMPOUND INDEXES for fast queries
scraperHistorySchema.index({ userPlatform: 1, weekNumber: 1 });
scraperHistorySchema.index({ userPlatform: 1, monthNumber: 1 });
scraperHistorySchema.index({ userPlatform: 1, sourceDomain: 1 });
scraperHistorySchema.index({ scrapeBatchId: 1, createdAt: -1 });
scraperHistorySchema.index({ userPlatform: 1, keyword: 1, createdAt: -1 });
scraperHistorySchema.index({ userPlatform: 1, createdAt: -1 });

// TTL Index: Automatically delete old records after X days
// MongoDB will automatically clean up documents older than the retention period
// Default: 30 days (configurable via HISTORY_RETENTION_DAYS env variable)
const retentionDays = parseInt(process.env.HISTORY_RETENTION_DAYS) || 30;
const retentionSeconds = retentionDays * 24 * 60 * 60;
scraperHistorySchema.index({ foundAt: 1 }, { expireAfterSeconds: retentionSeconds });

console.log(`[ScraperHistory] TTL index set: Records will auto-delete after ${retentionDays} days`);

module.exports = mongoose.model('ScraperHistory', scraperHistorySchema);
