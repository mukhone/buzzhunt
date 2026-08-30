/**
 * Debug Quora Platform - Check exact document in MongoDB
 *
 * LEGACY SCRIPT - Can be deleted if not needed
 *
 * Purpose: Simple debugging script created during Quora integration troubleshooting
 * to dump the Quora platform document from MongoDB. Used to diagnose why Quora
 * wasn't appearing in the frontend.
 *
 * This script served its purpose during development and can be safely deleted.
 * Use check-platforms.js for general platform status verification.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Platform = require('../models/Platform');

async function debugQuora() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const quora = await Platform.findOne({ name: 'quora' });

    if (!quora) {
      console.log('❌ Quora platform not found!');
    } else {
      console.log('📊 Quora Platform Document:\n');
      console.log(JSON.stringify(quora.toObject(), null, 2));
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

debugQuora();
