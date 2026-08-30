const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');
const UserPlatform = require('../models/UserPlatform');
const ScraperHistory = require('../models/ScraperHistory');
const User = require('../models/User');
const { sendAlertEmail } = require('./emailService');

// Run scraper job
async function runScraperJob(jobData) {
  const { userPlatformId, userId, userEmail, platformId, platformName, scraperName, keywords } = jobData;

  console.log(`[Scraper] Starting job for ${userEmail} - ${platformName} with keywords: ${keywords.join(', ')}`);

  try {
    // Call Python scraper
    const results = await callPythonScraper(scraperName, userEmail, keywords);

    console.log(`[Scraper] Found ${results.length} results for ${userEmail}`);

    // Filter out already seen URLs
    const newResults = await filterNewResults(userId, platformId, results);

    console.log(`[Scraper] ${newResults.length} new results after filtering`);

    if (newResults.length > 0) {
      // Save to history
      await saveToHistory(userId, platformId, newResults);

      // Send email alert
      await sendAlertEmail(userEmail, platformName, keywords, newResults);

      console.log(`[Scraper] Email sent to ${userEmail} with ${newResults.length} new posts`);
    }

    // Update last run time
    await UserPlatform.findByIdAndUpdate(userPlatformId, {
      lastRunAt: new Date(),
      // nextRunAt will be updated by the queue when scheduling next job
    });

    return {
      success: true,
      totalFound: results.length,
      newResults: newResults.length
    };
  } catch (error) {
    console.error(`[Scraper] Error in job for ${userEmail}:`, error);
    throw error;
  }
}

// Call Python scraper
async function callPythonScraper(scraperName, userEmail, keywords) {
  const scraperServiceUrl = process.env.SCRAPER_SERVICE_URL;

  // Try HTTP service first if enabled
  if (process.env.SCRAPER_SERVICE_ENABLED === 'true' && scraperServiceUrl) {
    try {
      console.log(`[Scraper] Calling HTTP scraper service: ${scraperServiceUrl}`);
      const response = await axios.post(`${scraperServiceUrl}/scrape`, {
        scraper: scraperName,
        email: userEmail,
        keywords
      }, {
        timeout: 5 * 60 * 1000 // 5 minutes timeout
      });

      return response.data.results || [];
    } catch (error) {
      console.error('[Scraper] HTTP service failed, falling back to direct execution:', error.message);
    }
  }

  // Fallback: Execute Python script directly
  return await executePythonScraperDirect(scraperName, userEmail, keywords);
}

// Execute Python scraper directly
function executePythonScraperDirect(scraperName, userEmail, keywords) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '../../scrapers', `${scraperName}.py`);

    console.log(`[Scraper] Executing Python script: ${scriptPath}`);

    const pythonProcess = spawn('python', [
      scriptPath,
      '--email', userEmail,
      '--keywords', keywords.join(',')
    ]);

    let outputData = '';
    let errorData = '';

    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
      console.error(`[Scraper] Python stderr: ${data}`);
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python scraper exited with code ${code}: ${errorData}`));
        return;
      }

      try {
        // Parse JSON output from Python script
        const results = JSON.parse(outputData);
        resolve(results);
      } catch (error) {
        console.error('[Scraper] Failed to parse Python output:', outputData);
        reject(new Error('Failed to parse scraper output'));
      }
    });

    pythonProcess.on('error', (error) => {
      reject(new Error(`Failed to start Python scraper: ${error.message}`));
    });
  });
}

// Filter out URLs that have already been seen
async function filterNewResults(userId, platformId, results) {
  const newResults = [];

  for (const result of results) {
    // Check if URL already exists in history
    const existing = await ScraperHistory.findOne({
      user: userId,
      platform: platformId,
      url: result.url
    });

    if (!existing) {
      newResults.push(result);
    }
  }

  return newResults;
}

// Save results to history
async function saveToHistory(userId, platformId, results) {
  const historyDocs = results.map(result => ({
    user: userId,
    platform: platformId,
    url: result.url,
    title: result.title,
    age: result.age || null,
    keywords: result.keywords || [],
    emailSent: false // Will be updated after email is sent
  }));

  await ScraperHistory.insertMany(historyDocs, { ordered: false });
}

// Clean up old history (older than 7 days)
async function cleanupOldHistory() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);

  const result = await ScraperHistory.deleteMany({
    foundAt: { $lt: cutoffDate }
  });

  console.log(`[Scraper] Cleaned up ${result.deletedCount} old history records`);
}

module.exports = {
  runScraperJob,
  cleanupOldHistory
};
