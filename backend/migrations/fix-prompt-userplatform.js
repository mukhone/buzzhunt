/**
 * Fix missing userPlatform field for prompt-based platforms
 * This updates ScraperHistory records that have platform but no userPlatform
 */

const mongoose = require('mongoose');
const ScraperHistory = require('../models/ScraperHistory');
const UserPlatform = require('../models/UserPlatform');
const Platform = require('../models/Platform');
const { extractDomain, getTimePeriods } = require('../utils/domainAnalyzer');
const { calculateAnalytics } = require('../services/analyticsCalculator');
require('dotenv').config();

async function fixPromptUserPlatform() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const userId = '68f54761cc2465076633289b';

    // Get all prompt-based platforms
    const promptPlatforms = await Platform.find({ inputType: 'prompts' });
    console.log(`\nFound ${promptPlatforms.length} prompt platforms`);

    for (const platform of promptPlatforms) {
      console.log(`\n--- Processing ${platform.displayName} ---`);

      // Find the UserPlatform for this user and platform
      const userPlatform = await UserPlatform.findOne({
        user: userId,
        platform: platform._id
      });

      if (!userPlatform) {
        console.log(`❌ No UserPlatform found for ${platform.displayName}`);
        continue;
      }

      console.log(`✅ Found UserPlatform: ${userPlatform._id}`);

      // Find all ScraperHistory records with this platform but no userPlatform
      const records = await ScraperHistory.find({
        user: userId,
        platform: platform._id,
        $or: [
          { userPlatform: null },
          { userPlatform: { $exists: false } }
        ]
      });

      console.log(`Found ${records.length} records to update`);

      if (records.length === 0) {
        continue;
      }

      // Update each record
      let updated = 0;
      const scrapeBatchId = `backfill-${Date.now()}`;

      for (const record of records) {
        try {
          // Extract domain if missing
          const sourceDomain = record.sourceDomain || extractDomain(record.url);

          // Get time periods if missing
          const timePeriods = getTimePeriods(record.createdAt);

          // Update the record
          await ScraperHistory.updateOne(
            { _id: record._id },
            {
              $set: {
                userPlatform: userPlatform._id,
                sourceDomain: sourceDomain,
                weekNumber: record.weekNumber || timePeriods.weekNumber,
                monthNumber: record.monthNumber || timePeriods.monthNumber,
                yearNumber: record.yearNumber || timePeriods.yearNumber,
                scrapeBatchId: record.scrapeBatchId || scrapeBatchId,
                citationCount: record.citationCount || 1
              }
            }
          );

          updated++;
        } catch (error) {
          console.error(`Error updating record ${record._id}:`, error.message);
        }
      }

      console.log(`✅ Updated ${updated}/${records.length} records`);

      // Calculate analytics for this userPlatform
      if (updated > 0) {
        console.log(`Calculating analytics for ${platform.displayName}...`);
        try {
          await calculateAnalytics(userPlatform._id, scrapeBatchId);
          console.log(`✅ Analytics calculated`);
        } catch (analyticsError) {
          console.error(`⚠️  Analytics calculation failed:`, analyticsError.message);
        }
      }
    }

    console.log('\n✅ Migration completed!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

fixPromptUserPlatform();
