/**
 * Scraper Worker - Processes Bull queue jobs for scraping
 * Registers concurrent workers for each platform queue
 */

const { getOrCreatePlatformQueue, getAllPlatformQueues, onScrapeJobStart } = require('../services/queueService');
const UserPlatform = require('../models/UserPlatform');
const User = require('../models/User');
const Platform = require('../models/Platform');
const ScraperHistory = require('../models/ScraperHistory');
const CompetitorMention = require('../models/CompetitorMention');
const { sendAlertEmail } = require('../services/emailService');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// ANALYTICS IMPORTS
const { extractDomain, getTimePeriods } = require('../utils/domainAnalyzer');
const { detectCompetitors } = require('../utils/competitorDetector');
const { calculateAnalytics, recordZeroDataPoint } = require('../services/analyticsCalculator');

/**
 * Main job processor function
 * Called automatically by Bull when a job is ready to run
 */
async function processScraperJob(job) {
  const { userId, platformId } = job.data;
  const startTime = new Date().toISOString();

  console.log(`\n[Worker] ========================================`);
  console.log(`[Worker] Processing job ${job.id} at ${startTime} UTC`);
  console.log(`[Worker] User: ${userId}, Platform: ${platformId}`);
  console.log(`[Worker] ========================================\n`);

  try {
    // Update lastRunAt and nextRunAt in database
    await onScrapeJobStart({ userId, platformId });

    // Fetch user platform data
    const userPlatform = await UserPlatform.findOne({
      user: userId,
      platform: platformId,
      isActive: true
    }).populate('platform');

    if (!userPlatform) {
      console.warn(`[Worker] UserPlatform not found or inactive - skipping`);
      return { success: false, reason: 'UserPlatform not found' };
    }

    if (!userPlatform.keywords || userPlatform.keywords.length === 0) {
      console.warn(`[Worker] No keywords configured - skipping`);
      return { success: false, reason: 'No keywords' };
    }

    // Fetch user data
    const user = await User.findById(userId);
    if (!user) {
      console.warn(`[Worker] User not found - skipping`);
      return { success: false, reason: 'User not found' };
    }

    const platformName = userPlatform.platform.displayName;
    const platformSlug = userPlatform.platform.name; // For competitor detection (lowercase slug)
    const scraperName = userPlatform.platform.scraperName;
    const inputType = userPlatform.platform.inputType || 'keywords';
    const keywords = userPlatform.keywords;

    console.log(`[Worker] Running scraper for ${user.email} - ${platformName}`);
    console.log(`[Worker] ${inputType === 'prompts' ? 'Prompts' : 'Keywords'}: ${keywords.join(', ')}`);

    // Run the Python scraper
    const results = await callPythonScraper(scraperName, user.email, keywords, inputType);

    console.log(`[Worker] Found ${results.length} total results`);

    // Filter out already seen URLs
    const newResults = await filterNewResults(userId, platformId, results);

    console.log(`[Worker] ${newResults.length} new results after filtering`);

    // ANALYTICS: Generate batch ID for this scrape run
    const scrapeBatchId = uuidv4();
    console.log(`[Worker] Scrape batch ID: ${scrapeBatchId}`);

    if (newResults.length > 0) {
      // Save to history with analytics fields
      const savedResults = await saveToHistory(userId, platformId, userPlatform._id, newResults, scrapeBatchId, inputType);

      // ANALYTICS: Detect competitors (OPTIONAL - prompt platforms only)
      if (userPlatform.competitorTrackingEnabled &&
          inputType === 'prompts' &&
          userPlatform.competitors.length > 0) {
        console.log(`[Worker] Detecting competitors for ${userPlatform.competitors.length} competitors`);
        // Pass platformSlug (e.g. 'chatgpt') not displayName (e.g. 'ChatGPT Search')
        await detectAndSaveCompetitors(userPlatform, newResults, savedResults, platformSlug);
      }

      // ANALYTICS: Calculate analytics for this batch
      try {
        console.log(`[Worker] Calculating analytics for batch ${scrapeBatchId}`);
        await calculateAnalytics(userPlatform._id, scrapeBatchId);
        console.log(`[Worker] ✅ Analytics calculated successfully`);
      } catch (analyticsError) {
        console.error(`[Worker] ⚠️  Analytics calculation failed (non-fatal):`, analyticsError.message);
        // Don't fail the job if analytics fails
      }

      // Send email alert
      const emailSent = await sendAlertEmail(user.email, platformName, keywords, newResults);

      // BUGFIX: Only mark emails as sent if they were actually delivered
      if (emailSent) {
        const urls = newResults.map(r => r.url);
        await ScraperHistory.updateMany(
          { user: userId, platform: platformId, url: { $in: urls } },
          { $set: { emailSent: true } }
        );
        console.log(`[Worker] ✅ Email sent to ${user.email} with ${newResults.length} new posts`);
      } else {
        console.warn(`[Worker] ⚠️  Email NOT sent (SMTP not configured or failed) - emailSent flag remains false`);
      }
    } else {
      console.log(`[Worker] No new results - no email sent`);

      // FIX: Without this, quiet periods never get a zero datapoint and the
      // dashboard keeps serving the last non-zero period as the "latest".
      try {
        await recordZeroDataPoint(userPlatform._id);
        console.log(`[Worker] ✅ Recorded zero datapoint for current periods`);
      } catch (zeroErr) {
        console.error(`[Worker] ⚠️  recordZeroDataPoint failed (non-fatal):`, zeroErr.message);
      }
    }

    const endTime = new Date().toISOString();
    console.log(`[Worker] ✅ Job ${job.id} completed successfully at ${endTime} UTC\n`);

    return {
      success: true,
      totalFound: results.length,
      newResults: newResults.length
    };

  } catch (error) {
    console.error(`[Worker] ❌ Job ${job.id} failed:`, error);
    throw error; // Let Bull handle retry logic
  }
}

/**
 * Run AI prompt scrapers sequentially (one prompt per run)
 * This ensures proper attribution and prevents argparse from dropping prompts
 */
async function runPromptsSequentially(scriptPath, prompts) {
  // Use Map to deduplicate URLs and aggregate metadata
  const urlMap = new Map();

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    console.log(`[Worker] Running prompt ${i + 1}/${prompts.length}: "${prompt}"`);

    try {
      const result = await runSinglePrompt(scriptPath, prompt);
      console.log(`[Worker] Prompt ${i + 1}/${prompts.length} completed: ${result.length} sources found`);

      // BUGFIX: Merge duplicate URLs across prompts
      for (const source of result) {
        const url = source.url;

        if (urlMap.has(url)) {
          // URL already seen - merge metadata
          const existing = urlMap.get(url);

          // Aggregate keywords/prompts (avoid duplicates)
          const existingKeywords = existing.keywords || [];
          const newKeywords = source.keywords || [source.keyword || source.prompt];
          const mergedKeywords = [...new Set([...existingKeywords, ...newKeywords])];

          // Concatenate AI responses from different prompts
          const existingResponse = existing.aiResponse || existing.snippet || '';
          const newResponse = source.aiResponse || source.snippet || '';
          const mergedResponse = existingResponse && newResponse && existingResponse !== newResponse
            ? `${existingResponse}\n---\n${newResponse}`
            : existingResponse || newResponse;

          // Update with merged metadata
          existing.keywords = mergedKeywords;
          existing.keyword = mergedKeywords[0] || existing.keyword;
          existing.aiResponse = mergedResponse;
          existing.snippet = mergedResponse;
          existing.response = mergedResponse;

          console.log(`[Worker] Merged duplicate URL: ${url} (now has ${mergedKeywords.length} prompts)`);
        } else {
          // New URL - add to map
          urlMap.set(url, source);
        }
      }
    } catch (error) {
      console.error(`[Worker] Prompt ${i + 1}/${prompts.length} failed:`, error.message);
      // Continue with next prompt instead of failing entire job
    }
  }

  const allResults = Array.from(urlMap.values());
  console.log(`[Worker] All prompts completed: ${allResults.length} unique sources (deduplicated)`);
  return allResults;
}

/**
 * Run a single AI prompt scraper
 */
async function runSinglePrompt(scriptPath, prompt) {
  const { spawn } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  // Generate unique filename with timestamp
  const timestamp = Date.now();
  const outputFile = `prompt_${timestamp}_${Math.random().toString(36).substring(2, 11)}.json`;
  const outputPath = path.join(path.dirname(scriptPath), 'json_output_scrapper', outputFile);

  const args = ['--question', prompt, '--max-sources', '50', '--timeout', '90', '--output-file', outputFile];

  // Capture pythonProcess outside so timeout can access it
  let pythonProcess;
  let timeoutHandle;

  const spawnPromise = new Promise((resolve, reject) => {
    pythonProcess = spawn('python', [scriptPath, ...args], {
      cwd: path.dirname(scriptPath),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    });

    let stderrData = '';

    // Drain stdout to prevent pipe buffer from filling up and blocking the process
    // (ChromeDriver and Selenium may write warnings/banners to stdout)
    pythonProcess.stdout.on('data', () => {});

    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrData += text;
      console.log(`[Worker] [Python] ${text.trim()}`);
    });

    pythonProcess.on('close', (code) => {
      // Clear timeout on successful completion
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (code !== 0) {
        reject(new Error(`Scraper exited with code ${code}: ${stderrData.substring(0, 200)}`));
        return;
      }

      try {
        // Read JSON from file instead of stdout
        if (!fs.existsSync(outputPath)) {
          reject(new Error('Output file was not created by scraper'));
          return;
        }

        // Validate file age (max 3 minutes old)
        const fileStats = fs.statSync(outputPath);
        const fileAge = Date.now() - fileStats.mtimeMs;
        const maxAge = 3 * 60 * 1000; // 3 minutes in milliseconds

        if (fileAge > maxAge) {
          fs.unlinkSync(outputPath); // Cleanup old file
          reject(new Error(`Output file is too old (${Math.round(fileAge/1000)}s > 180s)`));
          return;
        }

        // Read and parse JSON from file
        const fileContent = fs.readFileSync(outputPath, 'utf-8');
        const result = JSON.parse(fileContent);

        // Cleanup file after successful read
        fs.unlinkSync(outputPath);
        console.log(`[Worker] File read and cleaned up: ${outputFile}`);

        // Transform result to match expected format
        if (result.sources && Array.isArray(result.sources)) {
          const results = result.sources.map(source => {
            if (typeof source === 'string') {
              return {
                url: source,
                title: '',
                age: '',
                prompt: result.question || result.prompt || prompt,
                keyword: result.question || result.keyword || prompt,
                keywords: result.keywords || [prompt],
                snippet: result.response || result.aiResponse || result.ai_response || '',
                aiResponse: result.response || result.aiResponse || result.ai_response || '',
                response: result.response || ''
              };
            } else {
              return {
                ...source,
                url: source.url || source,
                prompt: source.prompt || result.question || prompt,
                keyword: source.keyword || result.question || prompt,
                snippet: source.snippet || result.response || '',
                aiResponse: source.aiResponse || result.response || '',
              };
            }
          });
          resolve(results);
        } else if (Array.isArray(result)) {
          resolve(result);
        } else {
          resolve([]);
        }
      } catch (error) {
        // Attempt cleanup on error
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch {}
        reject(new Error(`Failed to read output file: ${error.message}`));
      }
    });
  });

  // Timeout wrapper: Python timeout (90s) + buffer (30s) = 120s
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      if (pythonProcess && !pythonProcess.killed) {
        console.error(`[Worker] ⚠️ Scraper timeout: process did not exit within 120s, killing...`);

        // Try graceful kill first
        pythonProcess.kill('SIGTERM');

        // Force kill after 5s if still running
        setTimeout(() => {
          if (pythonProcess && !pythonProcess.killed) {
            console.error(`[Worker] ⚠️ Force killing stuck scraper process`);
            pythonProcess.kill('SIGKILL');
          }
        }, 5000);

        // Cleanup output file if it exists
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch {}

        reject(new Error('Scraper timeout: process did not exit within 120s'));
      }
    }, 120000); // 120 seconds
  });

  // Race the spawn Promise against the timeout
  return Promise.race([spawnPromise, timeoutPromise]);
}

/**
 * Call Python scraper directly via subprocess
 * No HTTP service needed - runs scrapers directly with proper Chrome profiles
 */
const { sanitizeKeyword, sanitizeEmail } = require('../utils/keywordSanitizer');

async function callPythonScraper(scraperName, userEmail, keywords, inputType = 'keywords') {
  const { spawn } = require('child_process');
  const path = require('path');
  const fs = require('fs');

  const safeEmail = sanitizeEmail(userEmail);
  const safeKeywords = (Array.isArray(keywords) ? keywords : []).map(sanitizeKeyword);
  if (!safeKeywords.length) {
    throw new Error('No valid keywords/prompts supplied');
  }
  // Replace caller's references with sanitized values from here on
  userEmail = safeEmail;
  keywords = safeKeywords;

  console.log(`[Worker] Running Python scraper directly: ${scraperName}`);
  console.log(`[Worker] User: ${userEmail}, Keywords: ${keywords.join(', ')}`);

  // Map scraper names to Python files
  const scraperFileMap = {
    'reddit_scraper': 'reddit_scraper.py',
    'quora_scraper': 'quora_scraper.py',
    'perplexity_sources_scraper': 'perplexity_sources_scraper.py',
    'chatgpt_sources_scraper': 'chatgpt_sources_scraper.py',
    'google_ai_sources_scraper': 'google_ai_sources_scraper.py',
    'linkedin_scraper': 'linkedin_scraper.py',
    'medium_scraper': 'medium_scraper.py',
    'youtube_scraper': 'youtube_scraper.py'
  };

  const scraperFile = scraperFileMap[scraperName];
  if (!scraperFile) {
    throw new Error(`Unknown scraper: ${scraperName}`);
  }

  const scriptPath = path.join(__dirname, '../../scrapers', scraperFile);

  // Build command-line arguments
  const args = [];

  // BUGFIX: For prompt-based scrapers, run once per prompt for proper attribution
  // Previously multiple --question flags were passed, but argparse only kept the last one
  if (inputType === 'prompts') {
    console.log(`[Worker] Running ${keywords.length} prompts sequentially`);

    return runPromptsSequentially(scriptPath, keywords);
  }

  // Generate unique filename for file-based output
  const timestamp = Date.now();
  const outputFile = `keyword_${timestamp}_${Math.random().toString(36).substring(2, 11)}.json`;
  const outputPath = path.join(__dirname, '../../scrapers/json_output_scrapper', outputFile);

  // Keyword scrapers (Reddit, Quora) can handle multiple keywords in one run
  args.push('--email', userEmail);
  args.push('--keywords', keywords.join(','));
  args.push('--output-file', outputFile);

  console.log(`[Worker] Command: python ${scraperFile} ${args.join(' ')}`);

  // Capture pythonProcess outside so timeout can access it
  let pythonProcess;
  let timeoutHandle;

  const spawnPromise = new Promise((resolve, reject) => {
    pythonProcess = spawn('python', [scriptPath, ...args], {
      cwd: path.join(__dirname, '../../scrapers'),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',  // Disable Python output buffering
        PYTHONIOENCODING: 'utf-8'  // Ensure UTF-8 encoding
      }
    });

    let stderrData = '';

    // Drain stdout to prevent pipe buffer from filling up and blocking the process
    // (ChromeDriver and Selenium may write warnings/banners to stdout)
    pythonProcess.stdout.on('data', () => {});

    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrData += text;
      // Log stderr in real-time for debugging
      console.log(`[Worker] [Python stderr] ${text.trim()}`);
    });

    pythonProcess.on('close', (code) => {
      // Clear timeout on successful completion
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (code !== 0) {
        console.error(`[Worker] Python scraper exited with code ${code}`);
        console.error(`[Worker] stderr: ${stderrData}`);
        reject(new Error(`Scraper failed with exit code ${code}: ${stderrData.substring(0, 500)}`));
        return;
      }

      try {
        // Read JSON from file instead of stdout
        if (!fs.existsSync(outputPath)) {
          reject(new Error('Output file was not created by scraper'));
          return;
        }

        // Validate file age (max 3 minutes old)
        const fileStats = fs.statSync(outputPath);
        const fileAge = Date.now() - fileStats.mtimeMs;
        const maxAge = 3 * 60 * 1000; // 3 minutes in milliseconds

        if (fileAge > maxAge) {
          fs.unlinkSync(outputPath); // Cleanup old file
          reject(new Error(`Output file is too old (${Math.round(fileAge/1000)}s > 180s)`));
          return;
        }

        // Read and parse JSON from file
        const fileContent = fs.readFileSync(outputPath, 'utf-8');
        const result = JSON.parse(fileContent);

        // Cleanup file after successful read
        fs.unlinkSync(outputPath);
        console.log(`[Worker] File read and cleaned up: ${outputFile}`);

        // Extract results array based on scraper output format
        let results = [];
        if (result.sources && Array.isArray(result.sources)) {
          // AI scrapers format - sources are plain URL strings
          // Metadata (question, response) is in the parent result object
          // We need to attach this metadata to each source URL for analytics/competitor detection
          results = result.sources.map(source => {
            if (typeof source === 'string') {
              // Plain URL string - convert to object and attach metadata from parent
              return {
                url: source,
                title: '',
                age: '',
                // Copy prompt/question metadata
                prompt: result.question || result.prompt || '',
                keyword: result.question || result.keyword || '',
                keywords: result.keywords || [],
                // Copy AI response metadata for competitor detection
                snippet: result.response || result.aiResponse || result.ai_response || '',
                aiResponse: result.response || result.aiResponse || result.ai_response || '',
                response: result.response || ''
              };
            } else {
              // Already an object - preserve all existing fields
              return {
                ...source,  // Keep all existing metadata
                url: source.url || source
              };
            }
          });
        } else if (Array.isArray(result)) {
          results = result; // Direct array format
        } else if (result.results && Array.isArray(result.results)) {
          results = result.results; // Generic results format
        }

        console.log(`[Worker] Scraper returned ${results.length} results`);
        resolve(results);

      } catch (error) {
        // Attempt cleanup on error
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch {}
        console.error(`[Worker] Failed to read output file:`, error.message);
        reject(new Error(`Failed to read output file: ${error.message}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error(`[Worker] Failed to start Python process:`, error);
      reject(new Error(`Failed to start Python scraper: ${error.message}`));
    });
  });

  // Timeout wrapper: Use 10 minutes for keyword scrapers (Reddit, Quora)
  // as they can handle multiple keywords in one run
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      if (pythonProcess && !pythonProcess.killed) {
        console.error(`[Worker] ⚠️ Scraper timeout: process did not exit within 10 minutes, killing...`);

        // Try graceful kill first
        pythonProcess.kill('SIGTERM');

        // Force kill after 5s if still running
        setTimeout(() => {
          if (pythonProcess && !pythonProcess.killed) {
            console.error(`[Worker] ⚠️ Force killing stuck scraper process`);
            pythonProcess.kill('SIGKILL');
          }
        }, 5000);

        // Cleanup output file if it exists
        try {
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch {}

        reject(new Error('Scraper timeout: process did not exit within 10 minutes'));
      }
    }, 10 * 60 * 1000); // 10 minutes for keyword scrapers
  });

  // Race the spawn Promise against the timeout
  return Promise.race([spawnPromise, timeoutPromise]);
}

/**
 * Filter out URLs that have already been seen
 */
async function filterNewResults(userId, platformId, results) {
  if (!results.length) return [];

  const urls = results.map((r) => r.url).filter(Boolean);
  const existing = await ScraperHistory.find({
    user: userId,
    platform: platformId,
    url: { $in: urls }
  }).select('url').lean();

  const seen = new Set(existing.map((e) => e.url));
  return results.filter((r) => r.url && !seen.has(r.url));
}

/**
 * Save results to history with analytics fields
 * @returns {Map} Map of URL -> saved ScraperHistory document (for correct competitor mention linkage)
 */
async function saveToHistory(userId, platformId, userPlatformId, results, scrapeBatchId, inputType = 'keywords') {
  const savedDocsMap = new Map();  // URL -> document mapping to avoid indexing issues

  for (const result of results) {
    // Extract domain for analytics
    const domain = extractDomain(result.url);

    // Get time periods for analytics
    const timePeriods = getTimePeriods(new Date());

    // Determine keyword - for prompts, use prompt; for keywords, use the first keyword or result.keyword
    const keyword = result.keyword || result.prompt || (result.keywords && result.keywords[0]) || '';

    // Get snippet/AI response (check both camelCase and snake_case variants)
    const snippet = result.snippet || result.aiResponse || result.ai_response || result.response || '';

    const historyDoc = {
      user: userId,
      platform: platformId,
      userPlatform: userPlatformId,  // ANALYTICS: Reference to UserPlatform
      url: result.url,
      title: result.title,
      keyword: keyword,              // ANALYTICS: Single keyword/prompt
      snippet: snippet,              // ANALYTICS: AI response text
      age: result.age || null,
      keywords: result.keywords || [],  // Keep for backward compatibility
      emailSent: false,

      // ANALYTICS FIELDS
      sourceDomain: domain,
      weekNumber: timePeriods.weekNumber,
      monthNumber: timePeriods.monthNumber,
      yearNumber: timePeriods.yearNumber,
      scrapeBatchId: scrapeBatchId,
      citationCount: 1
    };

    try {
      const saved = await ScraperHistory.create(historyDoc);
      savedDocsMap.set(result.url, saved);  // Map URL to saved document
    } catch (error) {
      // Ignore duplicate key errors (URL already exists)
      if (error.code !== 11000) {
        console.error(`[Worker] Error saving result ${result.url}:`, error.message);
      }
      // Note: On duplicate, we don't add to map - competitor detection will skip this URL
    }
  }

  console.log(`[Worker] Saved ${savedDocsMap.size}/${results.length} results to history`);
  return savedDocsMap;
}

/**
 * Detect and save competitor mentions (PROMPT PLATFORMS ONLY)
 * @param {Object} userPlatform - User's platform configuration
 * @param {Array} rawResults - Raw results from scraper
 * @param {Map} savedResultsMap - Map of URL -> saved ScraperHistory document
 * @param {String} platformName - Platform name for logging
 */
async function detectAndSaveCompetitors(userPlatform, rawResults, savedResultsMap, platformName) {
  try {
    let totalMentions = 0;

    for (const rawResult of rawResults) {
      // Look up saved document by URL to avoid indexing misalignment
      const savedResult = savedResultsMap.get(rawResult.url);

      if (!savedResult) {
        // Document wasn't saved (likely duplicate) - skip competitor detection for this URL
        continue;
      }

      // Detect competitors in this result
      const mentions = detectCompetitors(
        rawResult,
        userPlatform.competitors,
        userPlatform.yourBrandName,
        platformName
      );

      // Save competitor mentions
      for (const mention of mentions) {
        try {
          await CompetitorMention.create({
            ...mention,
            userPlatform: userPlatform._id,
            scraperHistory: savedResult._id  // Correctly linked via URL lookup
          });
          totalMentions++;
        } catch (error) {
          console.error(`[Worker] Error saving competitor mention:`, error.message);
        }
      }
    }

    if (totalMentions > 0) {
      console.log(`[Worker] ✅ Found ${totalMentions} competitor mentions`);
    }
  } catch (error) {
    console.error(`[Worker] ⚠️  Competitor detection failed (non-fatal):`, error.message);
  }
}

/**
 * Register workers for all active platforms
 * Each platform gets its own queue with configurable concurrency
 */
async function initializePlatformWorkers() {
  const Platform = require('../models/Platform');

  // Get all active platforms from database
  const platforms = await Platform.find({ isActive: true });

  if (platforms.length === 0) {
    console.warn('[Worker] ⚠️  No active platforms found in database');
    return;
  }

  console.log(`[Worker] Initializing workers for ${platforms.length} platform(s)...`);

  for (const platform of platforms) {
    const platformName = platform.name; // e.g., 'reddit', 'quora'
    const queueName = `scraper-${platformName}`.toLowerCase();

    // Get concurrency from env or use default of 2
    const concurrency = parseInt(process.env[`${platformName.toUpperCase()}_CONCURRENCY`])
      || parseInt(process.env.SCRAPER_CONCURRENCY)
      || 2;

    // Get or create the platform-specific queue
    const queue = getOrCreatePlatformQueue(platformName);

    // Register the worker with concurrency
    queue.process(concurrency, processScraperJob);

    console.log(`[Worker] ✅ Registered worker for ${queueName} (concurrency: ${concurrency})`);
  }

  console.log('[Worker] ✅ All platform workers initialized and ready');
}

// Initialize workers on module load
initializePlatformWorkers().catch(error => {
  console.error('[Worker] ❌ Failed to initialize platform workers:', error);
  process.exit(1);
});

module.exports = {
  processScraperJob,
  initializePlatformWorkers
};
