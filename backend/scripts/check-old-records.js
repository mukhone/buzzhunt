/**
 * Check Old Records Script
 *
 * Use this BEFORE implementing TTL index to see how many
 * old records exist and will be deleted on first TTL run.
 *
 * Usage: node backend/scripts/check-old-records.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ScraperHistory = require('../models/ScraperHistory');

async function checkOldRecords() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected\n');

    const retentionDays = parseInt(process.env.HISTORY_RETENTION_DAYS) || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    console.log('📊 ScraperHistory Analysis');
    console.log('═'.repeat(60));
    console.log(`Retention Period: ${retentionDays} days`);
    console.log(`Cutoff Date: ${cutoffDate.toISOString()} UTC`);
    console.log(`Current Date: ${new Date().toISOString()} UTC\n`);

    // Get counts
    const totalRecords = await ScraperHistory.countDocuments();
    const oldRecords = await ScraperHistory.countDocuments({
      foundAt: { $lt: cutoffDate }
    });
    const recentRecords = totalRecords - oldRecords;

    // Get oldest and newest records
    const oldest = await ScraperHistory.findOne().sort({ foundAt: 1 });
    const newest = await ScraperHistory.findOne().sort({ foundAt: -1 });

    // Calculate storage
    const avgRecordSize = 5; // KB (estimate)
    const oldStorageMB = (oldRecords * avgRecordSize) / 1024;
    const totalStorageMB = (totalRecords * avgRecordSize) / 1024;

    console.log('📈 Record Counts:');
    console.log(`   Total Records:  ${totalRecords.toLocaleString()}`);
    console.log(`   Recent Records: ${recentRecords.toLocaleString()} (will be kept)`);
    console.log(`   Old Records:    ${oldRecords.toLocaleString()} (will be deleted)\n`);

    console.log('📅 Date Range:');
    if (oldest) {
      const oldestAge = Math.floor((Date.now() - oldest.foundAt) / (1000 * 60 * 60 * 24));
      console.log(`   Oldest Record:  ${oldest.foundAt.toISOString()} (${oldestAge} days old)`);
    } else {
      console.log('   Oldest Record:  None');
    }
    if (newest) {
      const newestAge = Math.floor((Date.now() - newest.foundAt) / (1000 * 60 * 60 * 24));
      console.log(`   Newest Record:  ${newest.foundAt.toISOString()} (${newestAge} days old)\n`);
    } else {
      console.log('   Newest Record:  None\n');
    }

    console.log('💾 Storage Impact:');
    console.log(`   Current Storage: ~${totalStorageMB.toFixed(2)} MB`);
    console.log(`   After Cleanup:   ~${(totalStorageMB - oldStorageMB).toFixed(2)} MB`);
    console.log(`   Space Saved:     ~${oldStorageMB.toFixed(2)} MB\n`);

    console.log('⏱️  TTL Index Impact:');
    if (oldRecords === 0) {
      console.log('   ✅ No old records to delete');
      console.log('   ✅ TTL index will have minimal first-run impact');
    } else if (oldRecords < 1000) {
      console.log('   ✅ Small number of old records');
      console.log('   ✅ TTL cleanup will complete in seconds');
    } else if (oldRecords < 10000) {
      console.log('   ⚠️  Moderate number of old records');
      console.log('   ⚠️  TTL cleanup may take 1-2 minutes on first run');
      console.log('   💡 Consider manual cleanup before enabling TTL');
    } else {
      console.log('   ⚠️  Large number of old records');
      console.log('   ⚠️  TTL cleanup may take several minutes on first run');
      console.log('   💡 RECOMMENDED: Run manual cleanup first');
      console.log('\n   Manual cleanup command:');
      console.log('   node backend/scripts/manual-cleanup.js');
    }

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Analysis complete\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkOldRecords();
