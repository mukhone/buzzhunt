const mongoose = require('mongoose');

const competitorMentionSchema = new mongoose.Schema({
  userPlatform: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserPlatform',
    required: true,
    index: true
  },

  // COMPETITOR INFO
  competitorName: {
    type: String,
    required: true,
    index: true
  },

  // MENTION CONTEXT
  yourBrandMentioned: {
    type: Boolean,
    default: false,
    index: true
  },
  context: {
    type: String,  // Surrounding text snippet
    required: true
  },
  sentiment: {
    type: String,
    enum: ['positive', 'neutral', 'negative', 'unknown'],
    default: 'unknown'
  },

  // SOURCE INFORMATION
  keyword: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  domain: {
    type: String,
    index: true
  },
  title: String,

  // AI RESPONSE DATA (for prompt-based platforms)
  aiResponseSnippet: String,  // Full AI response where competitor was mentioned

  // REFERENCE TO ORIGINAL SCRAPE
  scraperHistory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ScraperHistory'
  },

  // METADATA
  detectedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// COMPOUND INDEXES
competitorMentionSchema.index({ userPlatform: 1, competitorName: 1, detectedAt: -1 });
competitorMentionSchema.index({ userPlatform: 1, yourBrandMentioned: 1, detectedAt: -1 });

module.exports = mongoose.model('CompetitorMention', competitorMentionSchema);
