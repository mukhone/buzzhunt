/**
 * Detect competitor mentions in text (PROMPT-BASED PLATFORMS ONLY)
 *
 * This utility analyzes AI responses from prompt-based platforms
 * (Perplexity, ChatGPT, Google AI) to detect competitor mentions.
 *
 * @param {Object} scrapeResult - Result from scraper containing AI response
 * @param {Array} competitors - List of competitor objects {name, aliases}
 * @param {String} userBrand - User's brand name
 * @param {String} platform - Platform name (must be prompt-based)
 * @returns {Array} Array of competitor mention objects
 */
function detectCompetitors(scrapeResult, competitors, userBrand, platform) {
  // Only for prompt-based platforms
  const promptPlatforms = ['perplexity', 'chatgpt', 'googleai'];
  if (!promptPlatforms.includes(platform)) {
    return [];
  }

  if (!competitors || competitors.length === 0) {
    return [];
  }

  // Get AI response text from various possible field names (check both camelCase and snake_case)
  const aiResponse =
    scrapeResult.aiResponse ||
    scrapeResult.ai_response ||
    scrapeResult.snippet ||
    scrapeResult.response ||
    scrapeResult.text ||
    '';

  if (!aiResponse || typeof aiResponse !== 'string') {
    return [];
  }

  const mentions = [];
  const aiResponseLower = aiResponse.toLowerCase();

  // Check for user's brand
  const userBrandMentioned = userBrand && userBrand.trim() !== ''
    ? aiResponseLower.includes(userBrand.toLowerCase())
    : false;

  // Check each competitor
  for (const competitor of competitors) {
    if (!competitor.name) continue;

    const names = [competitor.name, ...(competitor.aliases || [])];

    for (const name of names) {
      if (!name || name.trim() === '') continue;

      const nameLower = name.toLowerCase();

      // Use word boundary regex for more accurate matching
      const regex = new RegExp(`\\b${escapeRegex(nameLower)}\\b`, 'gi');
      const matches = aiResponse.match(regex);

      if (matches && matches.length > 0) {
        // Extract context (100 chars before and after)
        const index = aiResponseLower.indexOf(nameLower);
        const contextStart = Math.max(0, index - 100);
        const contextEnd = Math.min(aiResponse.length, index + nameLower.length + 100);
        const context = aiResponse.substring(contextStart, contextEnd);

        mentions.push({
          competitorName: competitor.name,
          yourBrandMentioned: userBrandMentioned,
          context: contextStart > 0 ? `...${context}...` : `${context}...`,
          sentiment: detectSentiment(context, nameLower),
          keyword: scrapeResult.keyword || scrapeResult.prompt || '',
          url: scrapeResult.url || '',
          domain: extractDomainFromUrl(scrapeResult.url) || '',
          title: scrapeResult.title || '',
          aiResponseSnippet: aiResponse.substring(0, 500), // First 500 chars
          detectedAt: new Date()
        });

        // Only record once per competitor per result
        break;
      }
    }
  }

  return mentions;
}

/**
 * Simple sentiment detection based on context keywords
 * @param {String} context - Text context around competitor mention
 * @param {String} competitorName - Name of the competitor
 * @returns {String} 'positive', 'neutral', 'negative', or 'unknown'
 */
function detectSentiment(context, competitorName) {
  if (!context) return 'unknown';

  const contextLower = context.toLowerCase();

  const positive = [
    'best', 'great', 'excellent', 'top', 'leading', 'recommended',
    'love', 'amazing', 'outstanding', 'superior', 'premier',
    'fantastic', 'wonderful', 'exceptional', 'perfect', 'ideal',
    'better', 'preferred', 'favorite', 'popular'
  ];

  const negative = [
    'worst', 'bad', 'poor', 'avoid', 'terrible', 'disappointing',
    'lacking', 'limited', 'inferior', 'subpar', 'inadequate',
    'problematic', 'issues', 'concerns', 'drawbacks', 'worse',
    'mediocre', 'unreliable', 'expensive', 'overpriced'
  ];

  // Count positive and negative words
  const positiveScore = positive.filter(word => contextLower.includes(word)).length;
  const negativeScore = negative.filter(word => contextLower.includes(word)).length;

  // If scores are equal or both zero, return neutral
  if (positiveScore === negativeScore) {
    return positiveScore === 0 ? 'unknown' : 'neutral';
  }

  // Return dominant sentiment
  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';

  return 'neutral';
}

/**
 * Extract domain from URL
 * @param {String} urlString - Full URL
 * @returns {String} Domain name or empty string
 */
function extractDomainFromUrl(urlString) {
  if (!urlString) return '';

  try {
    const { URL } = require('url');
    const url = new URL(urlString);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Escape special regex characters in a string
 * @param {String} string - String to escape
 * @returns {String} Escaped string safe for regex
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Analyze competitor mentions to find patterns
 * @param {Array} mentions - Array of competitor mention objects
 * @returns {Object} Analysis summary
 */
function analyzeCompetitorMentions(mentions) {
  if (!mentions || mentions.length === 0) {
    return {
      totalMentions: 0,
      competitorBreakdown: [],
      sentimentBreakdown: {
        positive: 0,
        negative: 0,
        neutral: 0,
        unknown: 0
      },
      coMentionsWithBrand: 0
    };
  }

  // Count by competitor
  const competitorCounts = {};
  const sentimentCounts = {
    positive: 0,
    negative: 0,
    neutral: 0,
    unknown: 0
  };
  let coMentionsCount = 0;

  mentions.forEach(mention => {
    // Count by competitor
    if (!competitorCounts[mention.competitorName]) {
      competitorCounts[mention.competitorName] = 0;
    }
    competitorCounts[mention.competitorName]++;

    // Count sentiment
    sentimentCounts[mention.sentiment]++;

    // Count co-mentions
    if (mention.yourBrandMentioned) {
      coMentionsCount++;
    }
  });

  // Convert competitor counts to array
  const competitorBreakdown = Object.entries(competitorCounts)
    .map(([name, count]) => ({ competitorName: name, mentions: count }))
    .sort((a, b) => b.mentions - a.mentions);

  return {
    totalMentions: mentions.length,
    competitorBreakdown,
    sentimentBreakdown: sentimentCounts,
    coMentionsWithBrand: coMentionsCount
  };
}

module.exports = {
  detectCompetitors,
  analyzeCompetitorMentions
};
