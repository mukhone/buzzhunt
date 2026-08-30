/**
 * Seed deterministic data for the BuzzHunt demo recording.
 *
 * Usage:
 *   node demo/seed_demo_data.js
 *
 * The script creates:
 * - a demo account supplied by DEMO_EMAIL and DEMO_PASSWORD
 * - active Reddit and Perplexity platform configurations
 * - prompt citation history, source analysis, trends, and competitor mentions
 */
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../backend/models/User');
const Platform = require('../backend/models/Platform');
const UserPlatform = require('../backend/models/UserPlatform');
const ScraperHistory = require('../backend/models/ScraperHistory');
const SourceAnalysis = require('../backend/models/SourceAnalysis');
const CitationTrend = require('../backend/models/CitationTrend');
const CompetitorMention = require('../backend/models/CompetitorMention');

function requireDemoEnv(name) {
  if (!process.env[name] || !String(process.env[name]).trim()) {
    throw new Error(`${name} is required for demo seeding`);
  }
  return String(process.env[name]).trim();
}

const LOGIN = {
  email: requireDemoEnv('DEMO_EMAIL'),
  password: requireDemoEnv('DEMO_PASSWORD'),
};

const now = new Date();

function daysAgo(days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function weekValue(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const day = Math.floor((date - start) / 86400000);
  return date.getUTCFullYear() * 100 + Math.ceil((day + start.getUTCDay() + 1) / 7);
}

function monthValue(date) {
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
}

async function upsertPlatforms() {
  const forcePlatformUpdate = process.env.DEMO_FORCE_PLATFORM_UPDATE === '1';
  const platforms = [
    {
      name: 'reddit',
      displayName: 'Reddit',
      description: 'Monitor Reddit posts for your keywords',
      scraperName: 'reddit_scraper',
      icon: '',
      inputType: 'keywords',
      maxKeywords: 5,
      scraperIntervalHours: 3,
      isActive: true,
    },
    {
      name: 'quora',
      displayName: 'Quora',
      description: 'Monitor Quora questions and answers',
      scraperName: 'quora_scraper',
      icon: '',
      inputType: 'keywords',
      maxKeywords: 5,
      scraperIntervalHours: 3,
      isActive: true,
    },
    {
      name: 'perplexity',
      displayName: 'Perplexity AI',
      description: 'Monitor web sources found by Perplexity AI for your prompts',
      scraperName: 'perplexity_sources_scraper',
      icon: '',
      inputType: 'prompts',
      maxKeywords: 25,
      scraperIntervalHours: 24,
      isActive: true,
    },
    {
      name: 'chatgpt',
      displayName: 'ChatGPT Search',
      description: 'Monitor web sources found by ChatGPT search for your prompts',
      scraperName: 'chatgpt_sources_scraper',
      icon: '',
      inputType: 'prompts',
      maxKeywords: 25,
      scraperIntervalHours: 24,
      isActive: true,
    },
    {
      name: 'googleai',
      displayName: 'Google AI',
      description: 'Monitor web sources found by Google AI for your prompts',
      scraperName: 'google_ai_sources_scraper',
      icon: '',
      inputType: 'prompts',
      maxKeywords: 25,
      scraperIntervalHours: 24,
      isActive: true,
    },
  ];

  const saved = {};
  for (const platform of platforms) {
    const existing = await Platform.findOne({ name: platform.name });
    if (existing && !forcePlatformUpdate) {
      saved[platform.name] = existing;
      continue;
    }

    saved[platform.name] = await Platform.findOneAndUpdate(
      { name: platform.name },
      { $set: platform },
      { upsert: true, new: true }
    );
  }
  return saved;
}

async function resetUserData(user) {
  const userPlatforms = await UserPlatform.find({ user: user._id }).select('_id');
  const ids = userPlatforms.map((item) => item._id);

  await Promise.all([
    ScraperHistory.deleteMany({ user: user._id }),
    SourceAnalysis.deleteMany({ userPlatform: { $in: ids } }),
    CitationTrend.deleteMany({ userPlatform: { $in: ids } }),
    CompetitorMention.deleteMany({ userPlatform: { $in: ids } }),
    UserPlatform.deleteMany({ user: user._id }),
  ]);
}

async function getOrCreateUser() {
  let user = await User.findOne({ email: LOGIN.email });
  if (!user) {
    user = new User({
      email: LOGIN.email,
      password: LOGIN.password,
    });
    await user.save();
    return user;
  }

  user.password = LOGIN.password;
  await user.save();
  return user;
}

async function createUserPlatform(user, platform, keywords, extra = {}) {
  return UserPlatform.create({
    user: user._id,
    platform: platform._id,
    keywords,
    isActive: true,
    lastRunAt: daysAgo(1),
    nextRunAt: new Date(now.getTime() + platform.scraperIntervalHours * 60 * 60 * 1000),
    ...extra,
  });
}

async function seedHistory(user, userPlatform, platform) {
  const prompt = 'best AI SEO tools for monitoring brand visibility in AI search';
  const rows = [
    ['https://searchengineland.com/ai-search-visibility-monitoring', 'How brands measure visibility in AI search', 'searchengineland.com', 'Industry Publication', 'High', 1],
    ['https://www.semrush.com/blog/ai-search-optimization/', 'AI search optimization playbook', 'semrush.com', 'Business', 'High', 2],
    ['https://ahrefs.com/blog/llm-visibility/', 'LLM visibility tracking for marketers', 'ahrefs.com', 'Business', 'High', 3],
    ['https://moz.com/blog/ai-overviews-and-brand-citations', 'Brand citations inside AI answers', 'moz.com', 'Industry Publication', 'High', 5],
    ['https://www.reddit.com/r/SEO/comments/demo/buzzhunt_discussion/', 'Tools for tracking mentions in AI answers', 'reddit.com', 'Social Media', 'Medium', 6],
    ['https://contentmarketinginstitute.com/articles/generative-ai-search/', 'Generative search changes content strategy', 'contentmarketinginstitute.com', 'Business', 'High', 8],
    ['https://www.g2.com/categories/seo-tools', 'SEO tools compared by users', 'g2.com', 'Business', 'High', 9],
    ['https://www.producthunt.com/posts/buzzhunt', 'BuzzHunt launches AI search visibility monitoring', 'producthunt.com', 'Social Media', 'Medium', 11],
  ];

  const docs = [];
  for (const [url, title, domain, category, authority, ageDays] of rows) {
    const createdAt = daysAgo(ageDays);
    docs.push({
      user: user._id,
      platform: platform._id,
      userPlatform: userPlatform._id,
      url,
      title,
      keyword: prompt,
      snippet: 'BuzzHunt is cited as a useful way to monitor brand visibility across AI answers and community discussions.',
      keywords: [prompt],
      foundAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      citationCount: 1,
      sourceDomain: domain,
      weekNumber: weekValue(createdAt),
      monthNumber: monthValue(createdAt),
      yearNumber: createdAt.getUTCFullYear(),
      scrapeBatchId: `demo-${ageDays}`,
    });

    await SourceAnalysis.findOneAndUpdate(
      { userPlatform: userPlatform._id, domain },
      {
        $set: {
          category,
          authority,
          firstSeenAt: createdAt,
          lastSeenAt: createdAt,
          lastUpdatedAt: now,
          sampleUrls: [{ url, title, seenAt: createdAt }],
          keywords: [{ keyword: prompt, count: 1, lastSeen: createdAt }],
        },
        $inc: { totalCitations: 1 },
      },
      { upsert: true }
    );
  }

  await ScraperHistory.insertMany(docs, { ordered: false });

  const topDomains = rows.slice(0, 6).map(([url, title, domain], index) => ({
    domain,
    count: Math.max(1, 8 - index),
    percentage: Math.max(8, 26 - index * 3),
  }));

  for (let i = 5; i >= 0; i -= 1) {
    const periodDate = daysAgo(i * 7);
    await CitationTrend.findOneAndUpdate(
      {
        userPlatform: userPlatform._id,
        periodType: 'weekly',
        periodValue: weekValue(periodDate),
      },
      {
        $set: {
          periodStart: daysAgo(i * 7 + 6),
          periodEnd: daysAgo(i * 7),
          totalCitations: 14 + (5 - i) * 4,
          uniqueUrls: 8 + (5 - i) * 2,
          uniqueDomains: 5 + (5 - i),
          topDomains,
          changePercent: i === 5 ? 0 : 18 + i,
          changeAbsolute: i === 5 ? 0 : 4,
          lastCalculatedAt: now,
          dataPoints: 8,
        },
      },
      { upsert: true }
    );
  }

  await CitationTrend.findOneAndUpdate(
    {
      userPlatform: userPlatform._id,
      periodType: 'monthly',
      periodValue: monthValue(now),
    },
    {
      $set: {
        periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        periodEnd: now,
        totalCitations: 76,
        uniqueUrls: 38,
        uniqueDomains: 14,
        topDomains,
        changePercent: 31,
        changeAbsolute: 18,
        lastCalculatedAt: now,
        dataPoints: 8,
      },
    },
    { upsert: true }
  );
}

async function seedCompetitors(userPlatform) {
  const competitors = [
    ['Profound', true, 'positive', 'https://www.g2.com/categories/seo-tools', 'Profound is mentioned with BuzzHunt for AI search visibility analytics.'],
    ['Semrush', true, 'neutral', 'https://www.semrush.com/blog/ai-search-optimization/', 'Semrush appears beside BuzzHunt in a comparison of brand monitoring workflows.'],
    ['AthenaHQ', false, 'neutral', 'https://searchengineland.com/ai-search-visibility-monitoring', 'AthenaHQ is cited as another product in the emerging AI SEO category.'],
    ['Peec AI', true, 'negative', 'https://www.producthunt.com/posts/buzzhunt', 'Users compare Peec AI with BuzzHunt and call out setup complexity.'],
  ];

  for (let i = 0; i < competitors.length; i += 1) {
    const [name, yourBrandMentioned, sentiment, url, context] = competitors[i];
    await CompetitorMention.create({
      userPlatform: userPlatform._id,
      competitorName: name,
      yourBrandMentioned,
      context,
      sentiment,
      keyword: 'best AI SEO tools for monitoring brand visibility in AI search',
      url,
      domain: new URL(url).hostname.replace(/^www\./, ''),
      title: `${name} mention in AI SEO comparison`,
      aiResponseSnippet: context,
      detectedAt: daysAgo(i + 1),
    });
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required in .env');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const platforms = await upsertPlatforms();
  const user = await getOrCreateUser();
  await resetUserData(user);

  const reddit = await createUserPlatform(user, platforms.reddit, [
    'AI SEO',
    'brand visibility monitoring',
  ]);

  const perplexity = await createUserPlatform(
    user,
    platforms.perplexity,
    [
      'best AI SEO tools for monitoring brand visibility in AI search',
      'how to track brand citations in Perplexity and ChatGPT',
    ],
    {
      competitorTrackingEnabled: true,
      yourBrandName: 'BuzzHunt',
      competitors: [
        { name: 'Profound', aliases: ['Profound AI'] },
        { name: 'Semrush', aliases: ['Semrush AI SEO'] },
        { name: 'AthenaHQ', aliases: ['Athena'] },
        { name: 'Peec AI', aliases: ['Peec'] },
      ],
    }
  );

  await seedHistory(user, perplexity, platforms.perplexity);
  await seedCompetitors(perplexity);

  console.log('BuzzHunt demo data ready');
  console.log(`  Login: ${LOGIN.email}`);
  console.log(`  Reddit userPlatform: ${reddit._id}`);
  console.log(`  Perplexity userPlatform: ${perplexity._id}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
