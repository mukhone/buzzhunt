/**
 * Cleanup Migration: Remove Analytics for Keyword-Based Platforms
 *
 * This script removes CitationTrend and SourceAnalysis records for
 * keyword-based platforms (Reddit, Quora) since analytics should
 * ONLY exist for prompt-based platforms (Perplexity, ChatGPT, Google AI).
 *
 * Run with: node backend/migrations/cleanup-keyword-platform-analytics.js
 */

const mongoose = require('mongoose');
const UserPlatform = require('../models/UserPlatform');
const Platform = require('../models/Platform');
const CitationTrend = require('../models/CitationTrend');
const SourceAnalysis = require('../models/SourceAnalysis');
require('dotenv').config();

async function cleanupKeywordPlatformAnalytics() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log('');

    console.log('🧹 Cleanup: Remove Analytics for Keyword-Based Platforms');
    console.log('   Analytics should ONLY exist for prompt-based platforms');
    console.log('   (Perplexity AI, ChatGPT Search, Google AI)');
    console.log('');

    // Get all user platforms
    const allUserPlatforms = await UserPlatform.find({}).populate('platform');
    console.log(`🔗 Found ${allUserPlatforms.length} total user platforms`);

    // Separate prompt-based and keyword-based platforms
    const promptPlatforms = allUserPlatforms.filter(up =>
      up.platform && up.platform.inputType === 'prompts'
    );
    const keywordPlatforms = allUserPlatforms.filter(up =>
      up.platform && up.platform.inputType === 'keywords'
    );

    console.log(`✅ Prompt-based platforms (keep analytics): ${promptPlatforms.length}`);
    promptPlatforms.forEach(up => {
      console.log(`   - ${up.platform.displayName} (${up._id})`);
    });
    console.log('');

    console.log(`❌ Keyword-based platforms (remove analytics): ${keywordPlatforms.length}`);
    keywordPlatforms.forEach(up => {
      console.log(`   - ${up.platform.displayName} (${up._id})`);
    });
    console.log('');

    if (keywordPlatforms.length === 0) {
      console.log('✅ No keyword-based platforms found. Nothing to clean up.');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Get IDs of keyword-based platforms
    const keywordPlatformIds = keywordPlatforms.map(up => up._id);

    // Check existing analytics before cleanup
    const trendsBefore = await CitationTrend.countDocuments({
      userPlatform: { $in: keywordPlatformIds }
    });
    const sourcesBefore = await SourceAnalysis.countDocuments({
      userPlatform: { $in: keywordPlatformIds }
    });

    console.log('📊 Current State:');
    console.log(`   CitationTrend records for keyword platforms: ${trendsBefore}`);
    console.log(`   SourceAnalysis records for keyword platforms: ${sourcesBefore}`);
    console.log('');

    if (trendsBefore === 0 && sourcesBefore === 0) {
      console.log('✅ No analytics found for keyword platforms. Already clean!');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Perform cleanup
    console.log('🔄 Cleaning up analytics for keyword-based platforms...');
    console.log('');

    // Delete CitationTrend records
    console.log('   Deleting CitationTrend records...');
    const deletedTrends = await CitationTrend.deleteMany({
      userPlatform: { $in: keywordPlatformIds }
    });
    console.log(`   ✅ Deleted ${deletedTrends.deletedCount} CitationTrend records`);

    // Delete SourceAnalysis records
    console.log('   Deleting SourceAnalysis records...');
    const deletedSources = await SourceAnalysis.deleteMany({
      userPlatform: { $in: keywordPlatformIds }
    });
    console.log(`   ✅ Deleted ${deletedSources.deletedCount} SourceAnalysis records`);
    console.log('');

    // Verify cleanup
    const trendsAfter = await CitationTrend.countDocuments({
      userPlatform: { $in: keywordPlatformIds }
    });
    const sourcesAfter = await SourceAnalysis.countDocuments({
      userPlatform: { $in: keywordPlatformIds }
    });

    console.log('📊 After Cleanup:');
    console.log(`   CitationTrend records for keyword platforms: ${trendsAfter}`);
    console.log(`   SourceAnalysis records for keyword platforms: ${sourcesAfter}`);
    console.log('');

    // Show remaining analytics (prompt platforms only)
    const promptPlatformIds = promptPlatforms.map(up => up._id);
    const trendsRemaining = await CitationTrend.countDocuments({
      userPlatform: { $in: promptPlatformIds }
    });
    const sourcesRemaining = await SourceAnalysis.countDocuments({
      userPlatform: { $in: promptPlatformIds }
    });

    console.log('✅ Remaining Analytics (Prompt Platforms Only):');
    console.log(`   CitationTrend records: ${trendsRemaining}`);
    console.log(`   SourceAnalysis records: ${sourcesRemaining}`);
    console.log('');

    console.log('📊 Cleanup Complete!');
    console.log('   Analytics now exist ONLY for prompt-based platforms.');
    console.log('   Reddit and Quora analytics have been removed.');
    console.log('');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run cleanup
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  BuzzHunt Analytics Cleanup: Remove Keyword Platform Data');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

cleanupKeywordPlatformAnalytics();
