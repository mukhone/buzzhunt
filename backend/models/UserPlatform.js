const mongoose = require('mongoose');

const userPlatformSchema = new mongoose.Schema({
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
  keywords: [{
    type: String,
    trim: true
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastRunAt: {
    type: Date,
    default: null
  },
  nextRunAt: {
    type: Date,
    default: null
  },
  jobId: {
    type: String,
    default: null // Bull queue job ID
  },

  // ========== COMPETITOR TRACKING (OPTIONAL - Prompt platforms only) ==========

  competitorTrackingEnabled: {
    type: Boolean,
    default: false  // User must explicitly enable
  },
  competitors: [{
    name: {
      type: String,
      required: true
    },
    aliases: [String],  // Alternative names/spellings
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  yourBrandName: {
    type: String,
    default: ''  // User's own brand name for co-mention tracking
  },

  // ========== ANALYTICS PREFERENCES ==========

  analyticsEnabled: {
    type: Boolean,
    default: true
  },
  dashboardHistoryLimit: {
    type: Number,
    default: 100  // How many URLs to show in dashboard history
  }
}, {
  timestamps: true
});

// Compound index to ensure a user can only have one instance of each platform
userPlatformSchema.index({ user: 1, platform: 1 }, { unique: true });

// VALIDATION: Only allow competitor tracking for prompt-based platforms
userPlatformSchema.pre('save', async function(next) {
  if (this.competitorTrackingEnabled && this.isModified('competitorTrackingEnabled')) {
    try {
      // Get platform info
      const Platform = mongoose.model('Platform');
      const platform = await Platform.findById(this.platform);

      if (!platform) {
        return next(new Error('Platform not found'));
      }

      // Only allow for prompt-based platforms
      if (platform.inputType !== 'prompts') {
        this.competitorTrackingEnabled = false;
        this.competitors = [];
        console.warn(`[UserPlatform] Competitor tracking disabled for ${platform.name} (not a prompt-based platform)`);
      }
    } catch (error) {
      return next(error);
    }
  }
  next();
});

module.exports = mongoose.model('UserPlatform', userPlatformSchema);
