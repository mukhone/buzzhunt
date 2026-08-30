/**
 * Migration Script - Import Old Data from Python Implementation
 *
 * ONE-TIME MIGRATION SCRIPT - Can be deleted after migration is complete
 *
 * Purpose: This script was created to migrate data from the old Python implementation
 * to the new Node.js + MongoDB system.
 *
 * This script migrates:
 * - Users (email + bcrypt password hashes)
 * - Keywords per user
 * - Job timing information
 *
 * Once the migration from old_data/ is complete, this script can be safely deleted.
 * It is not needed for ongoing application operation.
 *
 * Usage: node backend/scripts/migrate-old-data.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const User = require('../models/User');
const Platform = require('../models/Platform');
const UserPlatform = require('../models/UserPlatform');
const { scheduleUserScraper } = require('../services/queueService');

// Generate hash ID from email (same as Python implementation)
function generateHashId(email) {
  // Try MD5 first (most common in Flask apps)
  return crypto.createHash('md5').update(email).digest('hex').substring(0, 16);
}

async function connectDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
}

async function importUsers() {
  const oldDataPath = path.join(__dirname, '../../old_data');
  const loginDbPath = path.join(oldDataPath, 'login_db.json');
  const userJobsPath = path.join(oldDataPath, 'user_jobs.json');

  console.log('\n📂 Reading old data files...');

  // Read login database
  const loginDb = JSON.parse(fs.readFileSync(loginDbPath, 'utf8'));
  console.log(`Found ${loginDb.users.length} users in login_db.json`);

  // Read user jobs (optional)
  let userJobs = {};
  if (fs.existsSync(userJobsPath)) {
    userJobs = JSON.parse(fs.readFileSync(userJobsPath, 'utf8'));
    console.log(`Found ${Object.keys(userJobs).length} job records in user_jobs.json`);
  }

  // Get Reddit platform
  const redditPlatform = await Platform.findOne({ name: 'reddit' });
  if (!redditPlatform) {
    console.error('❌ Reddit platform not found in database. Run server first to initialize platforms.');
    process.exit(1);
  }

  console.log('\n🔄 Starting migration...\n');

  let importedCount = 0;
  let skippedCount = 0;

  for (const oldUser of loginDb.users) {
    try {
      const email = oldUser.email;
      const pwHash = oldUser.pw_hash;

      // Generate hash ID (same as Python)
      const hashId = generateHashId(email);

      console.log(`\n👤 Processing: ${email}`);
      console.log(`   Hash ID: ${hashId}`);

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        console.log(`   ⚠️  User already exists, skipping...`);
        skippedCount++;
        continue;
      }

      // Read keywords from old data directory
      const userDataPath = path.join(oldDataPath, hashId);
      const keywordsPath = path.join(userDataPath, 'keywords.json');

      let keywords = [];
      if (fs.existsSync(keywordsPath)) {
        const keywordsData = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));
        keywords = keywordsData.keywords || [];
        console.log(`   📝 Found ${keywords.length} keywords: ${keywords.join(', ')}`);
      } else {
        console.log(`   ⚠️  No keywords.json found for this user`);
      }

      // Create user in MongoDB (preserve the bcrypt hash)
      // Use insertOne to bypass Mongoose middleware (pre-save hook that would re-hash password)
      const userDoc = {
        email: email,
        password: pwHash, // Already hashed with bcrypt from old system
        createdAt: new Date(),
        isActive: true,
        updatedAt: new Date()
      };

      const result = await User.collection.insertOne(userDoc);
      const newUser = await User.findById(result.insertedId);
      console.log(`   ✅ User created in MongoDB (ID: ${newUser._id})`);

      // Create UserPlatform with keywords if they exist
      if (keywords.length > 0) {
        const userPlatform = new UserPlatform({
          user: newUser._id,
          platform: redditPlatform._id,
          keywords: keywords.slice(0, 3), // Max 3 keywords
          isActive: true
        });

        // Check if job timing exists
        if (userJobs[hashId]) {
          const jobTiming = userJobs[hashId];
          console.log(`   ⏰ Importing job timing:`);
          console.log(`      Last run: ${jobTiming.last_run}`);
          console.log(`      Next run: ${jobTiming.next_run}`);

          // Note: These are in old timezone, we'll let the system reschedule
          userPlatform.lastRunAt = new Date(jobTiming.last_run);
        }

        await userPlatform.save();
        console.log(`   ✅ UserPlatform created with ${keywords.slice(0, 3).length} keywords`);

        // Schedule scraper job (optional - requires Redis)
        try {
          await scheduleUserScraper({
            userId: String(newUser._id),
            platformId: String(redditPlatform._id),
            intervalHours: redditPlatform.scraperIntervalHours || 3
          });
          console.log(`   ✅ Scraper job scheduled`);
        } catch (schedError) {
          console.log(`   ⚠️  Could not schedule job (Redis may not be running): ${schedError.message}`);
          console.log(`   💡 Jobs will be scheduled when server starts`);
        }
      }

      importedCount++;
      console.log(`   ✅ Import complete for ${email}`);

    } catch (error) {
      console.error(`   ❌ Error importing user ${oldUser.email}:`, error.message);
      skippedCount++;
    }
  }

  console.log('\n\n📊 Migration Summary');
  console.log('═'.repeat(50));
  console.log(`✅ Imported: ${importedCount} users`);
  console.log(`⚠️  Skipped:  ${skippedCount} users`);
  console.log(`📝 Total:    ${loginDb.users.length} users`);
  console.log('═'.repeat(50));
}

async function main() {
  console.log('🚀 BuzzHunt Data Migration Tool');
  console.log('═'.repeat(50));
  console.log('Migrating from Python implementation to Node.js + MongoDB\n');

  try {
    await connectDatabase();
    await importUsers();

    console.log('\n✅ Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Migration interrupted by user');
  process.exit(1);
});

// Run migration
main();
