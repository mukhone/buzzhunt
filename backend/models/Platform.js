const mongoose = require('mongoose');

const platformSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  displayName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  scraperName: {
    type: String,
    required: true,
    // e.g., 'reddit_scraper', 'quora_scraper'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  icon: {
    type: String,
    default: null
  },
  inputType: {
    type: String,
    enum: ['keywords', 'prompts'],
    default: 'keywords',
    // 'keywords' for Reddit/Quora (search terms), 'prompts' for ChatGPT/Perplexity (questions)
  },
  maxKeywords: {
    type: Number,
    default: 3,
    // Max number of keywords/prompts (depending on inputType)
  },
  scraperIntervalHours: {
    type: Number,
    default: 3
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Platform', platformSchema);
