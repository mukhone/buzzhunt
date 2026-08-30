/**
 * Activate Quora Platform - Force set isActive to true
 *
 * LEGACY SCRIPT - Can be deleted if not needed
 *
 * Purpose: This was a temporary workaround script created when database.js was
 * resetting Quora to inactive on every server restart. The root cause has been
 * fixed in database.js (now properly sets isActive: true for Quora).
 *
 * This script is no longer needed and can be safely deleted.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Platform = require('../models/Platform');

async function activateQuora() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    // Get current state
    const before = await Platform.findOne({ name: 'quora' });
    console.log('BEFORE:');
    console.log(`   isActive: ${before.isActive}`);
    console.log(`   description: ${before.description}\n`);

    // Update with direct field assignment
    const result = await Platform.updateOne(
      { name: 'quora' },
      {
        $set: {
          isActive: true,
          description: 'Monitor Quora questions and answers',
          features: [
            'Question monitoring',
            'Answer tracking',
            'Search by keywords',
            'Email alerts for new results'
          ]
        }
      }
    );

    console.log('Update Result:');
    console.log(`   Matched: ${result.matchedCount}`);
    console.log(`   Modified: ${result.modifiedCount}\n`);

    // Verify update
    const after = await Platform.findOne({ name: 'quora' });
    console.log('AFTER:');
    console.log(`   isActive: ${after.isActive}`);
    console.log(`   description: ${after.description}`);
    console.log(`   features: ${JSON.stringify(after.features)}\n`);

    if (after.isActive) {
      console.log('✅ SUCCESS: Quora is now ACTIVE!');
    } else {
      console.log('❌ FAILED: Quora is still INACTIVE!');
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

activateQuora();
