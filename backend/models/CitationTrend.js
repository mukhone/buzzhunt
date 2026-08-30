const mongoose = require('mongoose');

const citationTrendSchema = new mongoose.Schema({
  userPlatform: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserPlatform',
    required: true,
    index: true
  },

  // TIME PERIOD
  periodType: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    required: true,
    index: true
  },
  periodValue: {
    type: Number,
    required: true,
    index: true
    // daily: YYYYMMDD (20251103)
    // weekly: YYYYWW (202545)
    // monthly: YYYYMM (202511)
  },
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },

  // AGGREGATE METRICS
  totalCitations: {
    type: Number,
    default: 0
  },
  uniqueUrls: {
    type: Number,
    default: 0
  },
  uniqueDomains: {
    type: Number,
    default: 0
  },

  // TOP DOMAINS (Top 10)
  topDomains: [{
    domain: String,
    count: Number,
    percentage: Number,
    category: String,
    authority: String
  }],

  // CHANGE METRICS (vs previous period)
  changePercent: {
    type: Number,
    default: 0
  },
  changeAbsolute: {
    type: Number,
    default: 0
  },

  // METADATA
  lastCalculatedAt: {
    type: Date,
    default: Date.now
  },
  dataPoints: {
    type: Number,
    default: 0  // Number of ScraperHistory records included
  }
}, {
  timestamps: true
});

// COMPOUND INDEXES
citationTrendSchema.index({ userPlatform: 1, periodType: 1, periodValue: 1 }, { unique: true });
citationTrendSchema.index({ periodType: 1, periodValue: 1, createdAt: -1 });

module.exports = mongoose.model('CitationTrend', citationTrendSchema);
