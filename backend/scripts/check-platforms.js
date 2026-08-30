/**
 * Check Platforms - Verify which platforms exist in MongoDB
 *
 * Usage: node backend/scripts/check-platforms.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Platform = require('../models/Platform');

async function checkPlatforms() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    // Get all platforms (including inactive)
    const allPlatforms = await Platform.find({});

    console.log('📊 All Platforms in Database:\n');
    console.log('='.repeat(60));

    if (allPlatforms.length === 0) {
      console.log('❌ NO PLATFORMS FOUND IN DATABASE!');
      console.log('\n💡 Run this to seed platforms:');
      console.log('   node backend/scripts/seed-platforms.js\n');
    } else {
      allPlatforms.forEach((p, i) => {
        console.log(`\n${i + 1}. ${p.icon || '❓'} ${p.displayName} (${p.name})`);
        console.log(`   ID: ${p._id}`);
        console.log(`   Scraper: ${p.scraperName}`);
        console.log(`   Interval: ${p.scraperIntervalHours} hours`);
        console.log(`   Max Keywords: ${p.maxKeywords}`);
        console.log(`   Status: ${p.isActive ? '🟢 Active' : '🔴 Inactive'}`);
        console.log(`   Description: ${p.description}`);
      });
    }

    // Get only active platforms (what frontend sees)
    const activePlatforms = await Platform.find({ isActive: true });
    console.log('\n' + '='.repeat(60));
    console.log(`\n🌐 Active Platforms (Frontend will see ${activePlatforms.length}):\n`);

    activePlatforms.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.icon} ${p.displayName}`);
    });

    console.log('\n' + '='.repeat(60));

    await mongoose.connection.close();
    console.log('\n✅ Connection closed');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

checkPlatforms();
