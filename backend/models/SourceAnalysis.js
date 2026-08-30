const mongoose = require('mongoose');

const sourceAnalysisSchema = new mongoose.Schema({
  userPlatform: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserPlatform',
    required: true,
    index: true
  },

  // DOMAIN INFORMATION
  domain: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  category: {
    type: String,
    enum: [
      'News',
      'Tech News',
      'Business',
      'Industry Publication',
      'Blog/Community',
      'Social Media',
      'Academic',
      'Government',
      'Other'
    ],
    default: 'Other'
  },
  authority: {
    type: String,
    enum: ['High', 'Medium', 'Low'],
    default: 'Medium'
  },

  // CITATION STATISTICS
  totalCitations: {
    type: Number,
    default: 0
  },
  firstSeenAt: {
    type: Date,
    default: Date.now
  },
  lastSeenAt: {
    type: Date,
    default: Date.now
  },

  // KEYWORD/PROMPT TRACKING
  keywords: [{
    keyword: String,
    count: Number,
    lastSeen: Date
  }],

  // SAMPLE DATA (Keep latest 5 URLs)
  sampleUrls: [{
    url: String,
    title: String,
    seenAt: Date
  }],

  // TREND DATA
  citationsByPeriod: [{
    periodType: String,  // 'weekly' or 'monthly'
    periodValue: Number, // YYYYWW or YYYYMM
    count: Number
  }],

  // METADATA
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// COMPOUND INDEXES
sourceAnalysisSchema.index({ userPlatform: 1, domain: 1 }, { unique: true });
sourceAnalysisSchema.index({ userPlatform: 1, category: 1, totalCitations: -1 });
sourceAnalysisSchema.index({ userPlatform: 1, authority: 1, totalCitations: -1 });

module.exports = mongoose.model('SourceAnalysis', sourceAnalysisSchema);
