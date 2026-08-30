/**
 * Migration Script: Backfill Analytics Fields
 *
 * This script adds analytics fields to existing ScraperHistory records
 * and recalculates all analytics for existing user platforms.
 *
 * Run with: node backend/migrations/backfill-analytics-fields.js
 */

const mongoose = require('mongoose');
const ScraperHistory = require('../models/ScraperHistory');
const UserPlatform = require('../models/UserPlatform');
const Platform = require('../models/Platform');
const CitationTrend = require('../models/CitationTrend');
const SourceAnalysis = require('../models/SourceAnalysis');
const { extractDomain, getTimePeriods } = require('../utils/domainAnalyzer');
const { recalculateAllAnalytics } = require('../services/analyticsCalculator');
require('dotenv').config();

async function backfillAnalyticsFields() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log('');

    console.log('⚠️  RESUMING FROM STEP 3');
    console.log('   Steps 1 and 2 have been completed previously.');
    console.log('   This will only recalculate analytics for all user platforms.');
    console.log('');

    // Get all user platforms with platform reference
    const allUserPlatforms = await UserPlatform.find({}).populate('platform');
    console.log(`🔗 Found ${allUserPlatforms.length} total user platforms`);

    // Filter for ONLY prompt-based platforms (Perplexity, ChatGPT, Google AI)
    const userPlatforms = allUserPlatforms.filter(up =>
      up.platform && up.platform.inputType === 'prompts'
    );
    console.log(`📊 Analytics platforms (prompt-based only): ${userPlatforms.length}`);
    console.log('');

    // SKIPPED: Step 1 - Backfilling ScraperHistory analytics fields (ALREADY DONE)
    console.log('⏭️  Step 1/3: SKIPPED (ScraperHistory backfill already completed)');
    console.log('');

    // SKIPPED: Step 2 - Clear existing analytics (ALREADY DONE)
    console.log('⏭️  Step 2/3: SKIPPED (Analytics clearing already completed)');
    console.log('');

    // Step 3: Recalculate analytics ONLY for prompt-based platforms
    console.log('🔄 Step 3/3: Recalculating analytics for PROMPT-BASED platforms only...');
    console.log('   (Reddit and Quora excluded - keyword platforms don\'t use analytics)');

    for (let i = 0; i < userPlatforms.length; i++) {
      const up = userPlatforms[i];
      console.log(`   [${i + 1}/${userPlatforms.length}] Calculating for ${up.platform.displayName}...`);

      try {
        await recalculateAllAnalytics(up._id);
      } catch (error) {
        console.error(`   ⚠️  Error calculating analytics for ${up._id}:`, error.message);
      }
    }

    console.log('✅ Step 3 complete');
    console.log('');

    // Show final statistics
    const finalTrends = await CitationTrend.countDocuments();
    const finalSources = await SourceAnalysis.countDocuments();

    console.log('📊 Step 3 Migration Complete!');
    console.log('');
    console.log('   Results:');
    console.log(`   ✅ CitationTrend records in database: ${finalTrends}`);
    console.log(`   ✅ SourceAnalysis records in database: ${finalSources}`);
    console.log('');
    console.log('✅ All analytics have been recalculated for all user platforms.');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  }
}

// Run migration
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  BuzzHunt Analytics Migration: Resume from Step 3');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

backfillAnalyticsFields();
