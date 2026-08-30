const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // TLS is negotiated from the connection string: Atlas `mongodb+srv://` URIs
    // enable it automatically, while local/self-hosted MongoDB works without it.
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Initialize default platforms if they don't exist
    await initializePlatforms();

    return conn;
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

const initializePlatforms = async () => {
  const Platform = require('../models/Platform');

  // Get interval hours from environment variables with fallback defaults
  const keywordIntervalHours = parseInt(process.env.KEYWORD_SCRAPER_INTERVAL_HOURS) || 3;
  const promptIntervalHours = parseInt(process.env.PROMPT_SCRAPER_INTERVAL_HOURS) || 24;

  const defaultPlatforms = [
    {
      name: 'reddit',
      displayName: 'Reddit',
      description: 'Monitor Reddit posts for your keywords',
      scraperName: 'reddit_scraper',      icon: '🔴',
      inputType: 'keywords',
      maxKeywords: 5,
      scraperIntervalHours: keywordIntervalHours,
      isActive: true
    },
    {
      name: 'quora',
      displayName: 'Quora',
      description: 'Monitor Quora questions and answers',
      scraperName: 'quora_scraper',      icon: '🔵',
      inputType: 'keywords',
      maxKeywords: 5,
      scraperIntervalHours: keywordIntervalHours,
      isActive: true
    },
    {
      name: 'perplexity',
      displayName: 'Perplexity AI',
      description: 'Monitor web sources found by Perplexity AI for your prompts',
      scraperName: 'perplexity_sources_scraper',      icon: '🟣',
      inputType: 'prompts',
      maxKeywords: 25, // Max 25 prompts
      scraperIntervalHours: promptIntervalHours,
      isActive: true
    },
    {
      name: 'chatgpt',
      displayName: 'ChatGPT Search',
      description: 'Monitor web sources found by ChatGPT search for your prompts',
      scraperName: 'chatgpt_sources_scraper',      icon: '🟢',
      inputType: 'prompts',
      maxKeywords: 25, // Max 25 prompts
      scraperIntervalHours: promptIntervalHours,
      isActive: true
    },
    {
      name: 'googleai',
      displayName: 'Google AI',
      description: 'Monitor web sources found by Google AI for your prompts',
      scraperName: 'google_ai_sources_scraper',      icon: '🔵',
      inputType: 'prompts',
      maxKeywords: 25, // Max 25 prompts
      scraperIntervalHours: promptIntervalHours,
      isActive: true
    },
    {
      name: 'linkedin',
      displayName: 'LinkedIn',
      description: 'Monitor LinkedIn posts for your keywords',
      scraperName: 'linkedin_scraper',      icon: '🔷',
      inputType: 'keywords',
      maxKeywords: 5,
      scraperIntervalHours: keywordIntervalHours,
      isActive: true
    },
    {
      name: 'medium',
      displayName: 'Medium',
      description: 'Monitor Medium articles for your keywords',
      scraperName: 'medium_scraper',      icon: '✍️',
      inputType: 'keywords',
      maxKeywords: 5,
      scraperIntervalHours: keywordIntervalHours,
      isActive: true
    },
    {
      name: 'youtube',
      displayName: 'YouTube',
      description: 'Monitor YouTube videos for your keywords (uses YouTube Data API)',
      scraperName: 'youtube_scraper',      icon: '▶️',
      inputType: 'keywords',
      maxKeywords: 5,
      scraperIntervalHours: keywordIntervalHours,
      isActive: true
    }
  ];

  for (const platformData of defaultPlatforms) {
    try {
      await Platform.findOneAndUpdate(
        { name: platformData.name },
        platformData,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error initializing platform ${platformData.name}:`, error.message);
    }
  }

  console.log('✅ Platforms initialized');
  console.log(`   Keyword-based platforms interval: ${keywordIntervalHours} hours (Reddit, Quora)`);
  console.log(`   Prompt-based platforms interval: ${promptIntervalHours} hours (Perplexity, ChatGPT, Google AI)`);
};

module.exports = connectDB;
