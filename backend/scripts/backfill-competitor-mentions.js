/**
 * Backfill Competitor Mentions
 *
 * This script analyzes existing ScraperHistory records and creates
 * CompetitorMention records for any competitor mentions found.
 *
 * Run this after configuring competitors to analyze past data.
 *
 * Usage: node backend/scripts/backfill-competitor-mentions.js
 */

const mongoose = require('mongoose');
const UserPlatform = require('../models/UserPlatform');
const ScraperHistory = require('../models/ScraperHistory');
const CompetitorMention = require('../models/CompetitorMention');
require('dotenv').config();

// Simple sentiment analysis (can be enhanced with NLP libraries)
function analyzeSentiment(text, competitorName) {
  const lowerText = text.toLowerCase();
  const competitorLower = competitorName.toLowerCase();

  // Find the context around the competitor mention
  const index = lowerText.indexOf(competitorLower);
  if (index === -1) return 'neutral';

  // Get 100 characters before and after the mention
  const start = Math.max(0, index - 100);
  const end = Math.min(lowerText.length, index + competitorLower.length + 100);
  const context = lowerText.substring(start, end);

  // Positive indicators
  const positiveWords = ['best', 'great', 'excellent', 'recommended', 'top', 'leading',
                         'innovative', 'powerful', 'effective', 'superior', 'outstanding',
                         'popular', 'loved', 'favorite', 'award-winning', 'trusted'];

  // Negative indicators
  const negativeWords = ['worst', 'bad', 'poor', 'slow', 'expensive', 'limited',
                         'difficult', 'confusing', 'lacking', 'missing', 'problem',
                         'issue', 'bug', 'disappointing', 'alternative to', 'instead of'];

  let positiveScore = 0;
  let negativeScore = 0;

  positiveWords.forEach(word => {
    if (context.includes(word)) positiveScore++;
  });

  negativeWords.forEach(word => {
    if (context.includes(word)) negativeScore++;
  });

  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';
  return 'neutral';
}

// Check if text mentions the competitor (by name or any alias)
function findCompetitorMention(text, competitor) {
  if (!text) return null;

  const lowerText = text.toLowerCase();

  // Check main name
  if (lowerText.includes(competitor.name.toLowerCase())) {
    return competitor.name;
  }

  // Check aliases
  for (const alias of competitor.aliases || []) {
    if (lowerText.includes(alias.toLowerCase())) {
      return competitor.name; // Return the main name, not the alias
    }
  }

  return null;
}

// Check if text mentions the user's brand
function checkYourBrandMention(text, brandName) {
  if (!text || !brandName) return false;
  return text.toLowerCase().includes(brandName.toLowerCase());
}

async function backfillCompetitorMentions() {
  try {
    console.log('🔄 Starting Competitor Mentions Backfill...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all UserPlatforms with competitor tracking enabled
    const userPlatforms = await UserPlatform.find({
      competitorTrackingEnabled: true
    }).populate('platform');

    if (userPlatforms.length === 0) {
      console.log('⚠️  No platforms have competitor tracking enabled.');
      console.log('   Please configure competitors in the Analytics page first.\n');
      await mongoose.disconnect();
      return;
    }

    console.log(`📊 Found ${userPlatforms.length} platform(s) with competitor tracking enabled:\n`);

    let totalMentionsCreated = 0;

    for (const userPlatform of userPlatforms) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Platform: ${userPlatform.platform.displayName}`);
      console.log(`Your Brand: ${userPlatform.yourBrandName || 'Not set'}`);
      console.log(`Competitors: ${userPlatform.competitors.length}`);
      console.log(`${'='.repeat(60)}\n`);

      // List competitors
      userPlatform.competitors.forEach((comp, i) => {
        console.log(`  ${i + 1}. ${comp.name}`);
        if (comp.aliases && comp.aliases.length > 0) {
          console.log(`     Aliases: ${comp.aliases.join(', ')}`);
        }
      });
      console.log('');

      // Get all ScraperHistory records for this platform
      const historyRecords = await ScraperHistory.find({
        userPlatform: userPlatform._id
      }).sort({ createdAt: -1 });

      console.log(`📚 Found ${historyRecords.length} historical records to analyze\n`);

      let platformMentions = 0;

      // Analyze each record
      for (const record of historyRecords) {
        const textToAnalyze = `${record.title || ''} ${record.snippet || ''}`;

        // Check each competitor
        for (const competitor of userPlatform.competitors) {
          const mentionedAs = findCompetitorMention(textToAnalyze, competitor);

          if (mentionedAs) {
            // Check if this mention already exists
            const existingMention = await CompetitorMention.findOne({
              userPlatform: userPlatform._id,
              keyword: record.keyword,
              competitorName: competitor.name,
              detectedAt: record.createdAt
            });

            if (existingMention) {
              // Skip if already exists
              continue;
            }

            // Create new CompetitorMention
            const sentiment = analyzeSentiment(textToAnalyze, competitor.name);
            const yourBrandMentioned = checkYourBrandMention(
              textToAnalyze,
              userPlatform.yourBrandName
            );

            await CompetitorMention.create({
              userPlatform: userPlatform._id,
              keyword: record.keyword,
              competitorName: competitor.name,
              sentiment: sentiment,
              yourBrandMentioned: yourBrandMentioned,
              detectedAt: record.createdAt,
              url: record.url,
              context: textToAnalyze.substring(0, 500) // Store first 500 chars as context
            });

            platformMentions++;
            totalMentionsCreated++;

            console.log(`  ✓ Found: ${competitor.name} in "${record.title?.substring(0, 50)}..."`);
            console.log(`    Sentiment: ${sentiment}, Co-mention: ${yourBrandMentioned ? 'Yes' : 'No'}`);
          }
        }
      }

      console.log(`\n✅ Created ${platformMentions} competitor mentions for ${userPlatform.platform.displayName}\n`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`🎉 Backfill Complete!`);
    console.log(`   Total competitor mentions created: ${totalMentionsCreated}`);
    console.log('='.repeat(60) + '\n');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');

  } catch (error) {
    console.error('❌ Error during backfill:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the backfill
backfillCompetitorMentions();
