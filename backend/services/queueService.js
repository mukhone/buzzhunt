const Queue = require('bull');
const crypto = require('crypto');

/**
 * Platform-specific queues
 * Each platform (Reddit, Quora, etc.) gets its own Bull queue
 * This allows multiple platforms to execute concurrently
 */
const platformQueues = new Map(); // Map<platformName, Queue>

/**
 * Get or create a Bull queue for a specific platform
 * @param {string} platformName - Platform name (e.g., 'reddit', 'quora')
 * @returns {Queue} Bull queue instance
 */
function getOrCreatePlatformQueue(platformName) {
  const queueName = `scraper-${platformName}`.toLowerCase();

  if (!platformQueues.has(queueName)) {
    console.log(`[Queue] Creating new queue: ${queueName}`);

    const queue = new Queue(queueName, {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000 // 1 minute
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000
        },
        removeOnFail: {
          age: 7 * 24 * 3600 // Keep failed jobs for 7 days
        }
      }
    });

    // Event listeners for monitoring
    queue.on('completed', (job) => {
      console.log(`[Queue:${queueName}] Job ${job.id} completed`);
    });

    queue.on('failed', (job, err) => {
      console.error(`[Queue:${queueName}] Job ${job.id} failed: ${err.message}`);
    });

    queue.on('stalled', (job) => {
      console.warn(`[Queue:${queueName}] Job ${job.id} stalled`);
    });

    platformQueues.set(queueName, queue);
  }

  return platformQueues.get(queueName);
}

/**
 * Get all active platform queues
 * @returns {Map<string, Queue>} Map of queue name to Queue instance
 */
function getAllPlatformQueues() {
  return platformQueues;
}

/**
 * Generate a stable integer from a string using SHA-1 hash
 * @param {string} str - String to hash
 * @param {number} maxExclusive - Maximum value (exclusive)
 * @returns {number} Integer in range [0, maxExclusive)
 */
function stableInt(str, maxExclusive) {
  const hash = crypto.createHash('sha1').update(str).digest('hex');
  // Take first 8 hex chars => 32-bit int
  const num = parseInt(hash.slice(0, 8), 16);
  return num % maxExclusive;
}

/**
 * Compute deterministic jitter (0-300 seconds) per user+platform
 * Same user+platform always gets same jitter across restarts
 * @param {string} userId - User ID
 * @param {string} platformId - Platform ID
 * @returns {number} Jitter in seconds (0-300)
 */
function computeJitterSeconds(userId, platformId) {
  return stableInt(`${userId}:${platformId}`, 301); // 0..300 seconds (0-5 minutes)
}

/**
 * Schedule or ensure a repeatable scraper job exists
 * First run: now + 60s + jitter (or existingNextRunAt if provided and valid)
 * Then repeats every intervalHours with same jitter
 * @param {Object} params - Scheduling parameters
 * @param {string} params.userId - User ID
 * @param {string} params.platformId - Platform ID
 * @param {string} params.platformName - Platform name (e.g., 'reddit', 'quora')
 * @param {number} [params.intervalHours] - Interval in hours (default from env or 3)
 * @param {Date} [params.existingNextRunAt] - Use this nextRunAt if provided and in future (for server restarts)
 * @returns {Promise<Object>} Job metadata
 */
async function scheduleUserScraper({ userId, platformId, platformName, intervalHours, existingNextRunAt }) {
  const UserPlatform = require('../models/UserPlatform');

  // Get platform-specific queue
  const queue = getOrCreatePlatformQueue(platformName);
  const queueName = `scraper-${platformName}`.toLowerCase();

  if (!intervalHours) {
    throw new Error(`intervalHours is required for scheduling job on platform ${platformName}`);
  }

  const hours = intervalHours;
  const jitterSec = computeJitterSeconds(userId, platformId);
  const repeatEveryMs = hours * 3600 * 1000;

  const now = Date.now();
  const jobId = `scrape:${userId}:${platformId}`;

  // Determine first run time
  let startDate;
  let firstDelayMs;

  if (existingNextRunAt && existingNextRunAt > new Date()) {
    // Server restart: use existing nextRunAt from database if it's in the future
    startDate = new Date(existingNextRunAt);
    firstDelayMs = startDate.getTime() - now;
    console.log(`[Queue:${queueName}] Using existing nextRunAt from database: ${startDate.toISOString()} UTC`);
  } else {
    // New job or nextRunAt is in the past: schedule first run in 60s + jitter
    firstDelayMs = (60 + jitterSec) * 1000;
    startDate = new Date(now + firstDelayMs);
    console.log(`[Queue:${queueName}] Calculating new nextRunAt: ${startDate.toISOString()} UTC (60s + ${jitterSec}s jitter)`);
  }

  // Remove any existing jobs (both regular and repeatable)
  const existing = await queue.getRepeatableJobs();
  for (const r of existing) {
    if (r.id === jobId || r.key.includes(jobId)) {
      await queue.removeRepeatableByKey(r.key);
      console.log(`[Queue:${queueName}] Removed old repeatable job: ${r.key}`);
    }
  }

  // Remove any pending delayed jobs
  try {
    const existingDelayedJob = await queue.getJob(`${jobId}:first`);
    if (existingDelayedJob) {
      await existingDelayedJob.remove();
    }
  } catch (err) {
    // Job doesn't exist, that's fine
  }

  // APPROACH: Add immediate delayed job for first run + repeatable job
  // 1. First execution: delayed job
  await queue.add(
    { userId, platformId, platformName },
    {
      jobId: `${jobId}:first`,
      delay: firstDelayMs,
      removeOnComplete: true,
      removeOnFail: false
    }
  );

  // 2. Repeating executions: use Bull's repeat with every
  await queue.add(
    { userId, platformId, platformName },
    {
      jobId,
      removeOnComplete: true,
      removeOnFail: false,
      repeat: {
        every: repeatEveryMs,
        startDate: startDate  // Start repeating from the first run time, not now
      }
    }
  );

  // Update nextRunAt in database
  await UserPlatform.findOneAndUpdate(
    { user: userId, platform: platformId },
    { $set: { nextRunAt: startDate, jobId } },
    { upsert: false }
  );

  console.log(`[Queue:${queueName}] ✅ Scheduled job ${jobId}`);
  console.log(`[Queue:${queueName}]    First run (delayed): ${startDate.toISOString()} UTC (in ${Math.round(firstDelayMs/1000)}s)`);
  console.log(`[Queue:${queueName}]    Then repeats every: ${hours}h (${repeatEveryMs}ms, jitter: ${jitterSec}s)`);
  console.log(`[Queue:${queueName}]    Job IDs: ${jobId}:first (one-time), ${jobId} (repeating)`);

  return { jobId, nextRunAt: startDate, intervalHours: hours };
}

/**
 * Called when a scraper job actually starts running
 * Updates lastRunAt and calculates nextRunAt
 * @param {Object} params - Job parameters
 * @param {string} params.userId - User ID
 * @param {string} params.platformId - Platform ID
 */
async function onScrapeJobStart({ userId, platformId }) {
  const UserPlatform = require('../models/UserPlatform');

  // Fetch the userPlatform with platform data to get the correct interval
  const userPlatform = await UserPlatform.findOne({
    user: userId,
    platform: platformId
  }).populate('platform');

  if (!userPlatform) {
    console.warn(`[Queue] UserPlatform not found for user ${userId}, platform ${platformId}`);
    return;
  }

  const now = new Date();
  // Use the platform's specific interval, not the generic env variable
  const intervalHours = userPlatform.platform.scraperIntervalHours || 3;
  const intervalMs = intervalHours * 3600 * 1000;
  const jitterMs = computeJitterSeconds(userId, platformId) * 1000;

  // BUGFIX: Don't add jitter here - Bull already includes it in the repeat schedule
  // Next run = now + interval (Bull's repeat is already anchored with jitter)
  const nextRunAt = new Date(now.getTime() + intervalMs);

  await UserPlatform.findOneAndUpdate(
    { user: userId, platform: platformId },
    {
      $set: {
        lastRunAt: now,
        nextRunAt: nextRunAt
      }
    },
    { upsert: false }
  );

  console.log(`[Queue] Job started for user ${userId}, platform ${platformId}`);
  console.log(`[Queue] Last run: ${now.toISOString()} UTC`);
  console.log(`[Queue] Next run: ${nextRunAt.toISOString()} UTC (interval: ${intervalHours}h)`);
}

/**
 * Restore all active jobs on server restart
 * Uses same deterministic jitter so schedules are consistent
 */
async function restoreAllJobs() {
  const UserPlatform = require('../models/UserPlatform');

  console.log('[Queue] Restoring scheduled jobs...');

  // Clear all existing repeatable jobs from all platform queues
  for (const [queueName, queue] of platformQueues.entries()) {
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      await queue.removeRepeatableByKey(job.key);
    }
    console.log(`[Queue:${queueName}] Cleared ${repeatableJobs.length} existing repeatable jobs`);
  }

  // Get all active user platforms with keywords
  const userPlatforms = await UserPlatform.find({
    isActive: true,
    keywords: { $exists: true, $ne: [] }
  }).populate('platform');

  let restoredCount = 0;

  for (const up of userPlatforms) {
    try {
      if (up.platform && up.platform.isActive) {
        await scheduleUserScraper({
          userId: String(up.user),
          platformId: String(up.platform._id),
          platformName: up.platform.name, // Pass platform name for queue selection
          intervalHours: up.platform.scraperIntervalHours || 3,
          existingNextRunAt: up.nextRunAt // Pass existing nextRunAt from database
        });
        restoredCount++;
      }
    } catch (error) {
      console.error(`[Queue] Error restoring job for user platform ${up._id}:`, error);
    }
  }

  console.log(`[Queue] ✅ Restored ${restoredCount} jobs across ${platformQueues.size} platform queues`);
}

/**
 * Remove a platform job completely
 * @param {string} userId - User ID
 * @param {string} platformId - Platform ID
 * @param {string} platformName - Platform name for queue selection
 */
async function removePlatformJob(userId, platformId, platformName) {
  const UserPlatform = require('../models/UserPlatform');

  const jobId = `scrape:${userId}:${platformId}`;
  const queue = getOrCreatePlatformQueue(platformName);
  const queueName = `scraper-${platformName}`.toLowerCase();

  try {
    // Remove delayed first-run job
    const firstJob = await queue.getJob(`${jobId}:first`);
    if (firstJob) {
      await firstJob.remove();
      console.log(`[Queue:${queueName}] Removed delayed job ${jobId}:first`);
    }

    // Remove regular job
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`[Queue:${queueName}] Removed job ${jobId}`);
    }

    // Remove repeatable jobs
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const repeatJob of repeatableJobs) {
      if (repeatJob.id === jobId || repeatJob.key.includes(jobId)) {
        await queue.removeRepeatableByKey(repeatJob.key);
        console.log(`[Queue:${queueName}] Removed repeatable job ${repeatJob.key}`);
      }
    }

    // Clear database fields
    await UserPlatform.findOneAndUpdate(
      { user: userId, platform: platformId },
      { $set: { jobId: null, nextRunAt: null } },
      { upsert: false }
    );
  } catch (error) {
    console.error(`[Queue:${queueName}] Error removing job ${jobId}:`, error);
  }
}

/**
 * Get queue statistics (aggregated across all platform queues)
 */
async function getQueueStats() {
  let totalWaiting = 0;
  let totalActive = 0;
  let totalCompleted = 0;
  let totalFailed = 0;
  let totalDelayed = 0;

  const queueStats = [];

  for (const [queueName, queue] of platformQueues.entries()) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);

    totalWaiting += waiting;
    totalActive += active;
    totalCompleted += completed;
    totalFailed += failed;
    totalDelayed += delayed;

    queueStats.push({
      queue: queueName,
      waiting,
      active,
      completed,
      failed,
      delayed
    });
  }

  return {
    total: {
      waiting: totalWaiting,
      active: totalActive,
      completed: totalCompleted,
      failed: totalFailed,
      delayed: totalDelayed
    },
    perQueue: queueStats
  };
}

module.exports = {
  getOrCreatePlatformQueue,
  getAllPlatformQueues,
  scheduleUserScraper,
  onScrapeJobStart,
  removePlatformJob,
  restoreAllJobs,
  getQueueStats
};
