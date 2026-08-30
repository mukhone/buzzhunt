/**
 * Seed Platforms - Add Reddit and Quora platforms to MongoDB
 *
 * Usage: node backend/scripts/seed-platforms.js
 *
 * This script ensures both Reddit and Quora platforms exist in the database
 * with proper configuration for the scraper system.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Platform = require('../models/Platform');

const platforms = [
  {
    name: 'reddit',
    displayName: 'Reddit',
    description: 'Monitor Reddit posts and discussions',
    scraperName: 'reddit_scraper',
    scraperIntervalHours: 3,
    maxKeywords: 3,
    isActive: true,
    icon: '🔴',    features: [
      'Real-time post monitoring',
      'Search by keywords',
      'Sort by new posts',
      'Email alerts for new results'
    ]
  },
  {
    name: 'quora',
    displayName: 'Quora',
    description: 'Monitor Quora questions and answers',
    scraperName: 'quora_scraper',
    scraperIntervalHours: 3,
    maxKeywords: 3,
    isActive: true,
    icon: '🔵',    features: [
      'Question monitoring',
      'Answer tracking',
      'Search by keywords',
      'Email alerts for new results'
    ]
  }
];

async function seedPlatforms() {
  try {
    console.log('🌱 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🔍 Checking existing platforms...');
    const existingPlatforms = await Platform.find({});
    console.log(`   Found ${existingPlatforms.length} existing platform(s)\n`);

    for (const platformData of platforms) {
      const existing = await Platform.findOne({ name: platformData.name });

      if (existing) {
        console.log(`📝 Updating platform: ${platformData.displayName}`);
        await Platform.updateOne(
          { name: platformData.name },
          { $set: platformData }
        );
        console.log(`   ✅ Updated ${platformData.displayName}`);
      } else {
        console.log(`➕ Creating platform: ${platformData.displayName}`);
        const platform = new Platform(platformData);
        await platform.save();
        console.log(`   ✅ Created ${platformData.displayName}`);
      }
    }

    console.log('\n✅ Platform seeding complete!');
    console.log('\n📊 Current Platforms:');

    const allPlatforms = await Platform.find({});
    allPlatforms.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.icon} ${p.displayName} (${p.name})`);
      console.log(`      - Scraper: ${p.scraperName}`);
      console.log(`      - Interval: ${p.scraperIntervalHours} hours`);
      console.log(`      - Max Keywords: ${p.maxKeywords}`);
      console.log(`      - Status: ${p.isActive ? '🟢 Active' : '🔴 Inactive'}`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error seeding platforms:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

seedPlatforms();
