const { URL } = require('url');

/**
 * Extract clean domain from URL
 * @param {String} urlString - Full URL
 * @returns {String|null} Clean domain name or null if invalid
 */
function extractDomain(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch (error) {
    console.error('[domainAnalyzer] Invalid URL:', urlString);
    return null;
  }
}

/**
 * Categorize domain based on patterns
 * @param {String} domain - Domain name
 * @returns {String} Category name
 */
function categorizeDomain(domain) {
  if (!domain) return 'Other';

  const domainLower = domain.toLowerCase();

  const categories = {
    'News': [
      'bbc.com', 'bbc.co.uk', 'cnn.com', 'nytimes.com', 'theguardian.com',
      'reuters.com', 'apnews.com', 'npr.org', 'washingtonpost.com',
      'ft.com', 'economist.com', 'nbcnews.com', 'cbsnews.com',
      'abcnews.go.com', 'usatoday.com', 'time.com', 'newsweek.com',
      'theatlantic.com', 'politico.com', 'axios.com'
    ],
    'Tech News': [
      'techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com',
      'engadget.com', 'zdnet.com', 'cnet.com', 'venturebeat.com',
      'techmeme.com', 'theinformation.com', '9to5mac.com', 'macrumors.com',
      'androidcentral.com', 'androidpolice.com', 'gizmodo.com', 'lifehacker.com'
    ],
    'Business': [
      'forbes.com', 'bloomberg.com', 'wsj.com', 'businessinsider.com',
      'fortune.com', 'inc.com', 'fastcompany.com', 'cnbc.com',
      'marketwatch.com', 'barrons.com', 'fool.com', 'seekingalpha.com',
      'investopedia.com'
    ],
    'Industry Publication': [
      'techradar.com', 'computerworld.com', 'infoworld.com',
      'itprotoday.com', 'networkworld.com', 'eweek.com',
      'informationweek.com', 'datacenterknowledge.com'
    ],
    'Blog/Community': [
      'medium.com', 'dev.to', 'hashnode.com', 'substack.com',
      'ghost.io', 'wordpress.com', 'blogger.com', 'tumblr.com',
      'hackernoon.com', 'smashingmagazine.com', 'css-tricks.com',
      'alistapart.com', 'sitepoint.com'
    ],
    'Social Media': [
      'reddit.com', 'quora.com', 'twitter.com', 'facebook.com',
      'linkedin.com', 'instagram.com', 'youtube.com', 'tiktok.com',
      'pinterest.com', 'snapchat.com'
    ],
    'Academic': [
      'arxiv.org', 'scholar.google.com', 'researchgate.net',
      'academia.edu', 'sciencedirect.com', 'springer.com',
      'ieee.org', 'acm.org', 'nature.com', 'science.org',
      'plos.org', 'frontiersin.org'
    ],
    'Government': [
      '.gov', '.mil', '.edu', 'europa.eu', 'un.org',
      'who.int', 'worldbank.org', 'imf.org'
    ]
  };

  // Check each category
  for (const [category, patterns] of Object.entries(categories)) {
    for (const pattern of patterns) {
      if (domainLower.includes(pattern) || domainLower.endsWith(pattern)) {
        return category;
      }
    }
  }

  return 'Other';
}

/**
 * Determine domain authority level
 * @param {String} domain - Domain name
 * @returns {String} 'High', 'Medium', or 'Low'
 */
function getDomainAuthority(domain) {
  if (!domain) return 'Low';

  const domainLower = domain.toLowerCase();

  const highAuthority = [
    // Major News
    'nytimes.com', 'wsj.com', 'bbc.com', 'bbc.co.uk', 'theguardian.com',
    'reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com',
    'washingtonpost.com', 'economist.com', 'theatlantic.com',

    // Tech News
    'techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com',

    // Business
    'forbes.com', 'fortune.com', 'businessinsider.com', 'cnbc.com',

    // Reference
    'wikipedia.org', 'britannica.com',

    // Academic
    'arxiv.org', 'scholar.google.com', 'ieee.org', 'acm.org',
    'nature.com', 'science.org',

    // Government & Education
    '.gov', '.edu', '.ac.uk'
  ];

  const mediumAuthority = [
    // Regional news
    'local', 'regional', 'news',

    // Industry blogs
    'medium.com', 'substack.com', 'dev.to', 'hashnode.com',

    // Tech news tier 2
    'cnet.com', 'zdnet.com', 'engadget.com', 'venturebeat.com',
    'gizmodo.com', 'lifehacker.com',

    // Business tier 2
    'inc.com', 'fastcompany.com', 'marketwatch.com',

    // Community
    'stackoverflow.com', 'github.com', 'gitlab.com'
  ];

  // Check high authority
  for (const pattern of highAuthority) {
    if (domainLower.includes(pattern) || domainLower.endsWith(pattern)) {
      return 'High';
    }
  }

  // Check medium authority
  for (const pattern of mediumAuthority) {
    if (domainLower.includes(pattern)) {
      return 'Medium';
    }
  }

  return 'Low';
}

/**
 * Get ISO 8601 week number and year
 * @param {Date} date - Date object
 * @returns {Object} Object with isoYear and isoWeek
 */
function getISOWeek(date) {
  // Copy date to avoid mutation
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  // Return ISO week year (which may differ from calendar year for week 1 and 52/53)
  return { isoYear: d.getUTCFullYear(), isoWeek: weekNo };
}

/**
 * Get time period numbers for analytics
 * @param {Date} date - Date to calculate periods for
 * @returns {Object} Object with yearNumber, monthNumber, weekNumber
 */
function getTimePeriods(date = new Date()) {
  // BUGFIX: Use UTC methods to avoid timezone-dependent date shifting
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 0-indexed, so add 1

  // BUGFIX: Use proper ISO 8601 week calculation
  const { isoYear, isoWeek } = getISOWeek(date);

  return {
    yearNumber: year,
    monthNumber: parseInt(`${year}${month.toString().padStart(2, '0')}`),  // 202511
    weekNumber: parseInt(`${isoYear}${isoWeek.toString().padStart(2, '0')}`)  // 202545 (ISO week)
  };
}

/**
 * Get date range for a specific period
 * @param {String} periodType - 'daily', 'weekly', or 'monthly'
 * @param {Number} periodValue - Period number (YYYYMMDD, YYYYWW, or YYYYMM)
 * @returns {Object} Object with periodStart and periodEnd dates
 */
function getPeriodDates(periodType, periodValue) {
  const valueStr = periodValue.toString();

  if (periodType === 'daily') {
    // Format: YYYYMMDD
    // BUGFIX: Use UTC to avoid timezone-dependent date shifting
    const year = parseInt(valueStr.substr(0, 4));
    const month = parseInt(valueStr.substr(4, 2)) - 1; // 0-indexed
    const day = parseInt(valueStr.substr(6, 2));
    const periodStart = new Date(Date.UTC(year, month, day, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
    return { periodStart, periodEnd };
  }

  if (periodType === 'weekly') {
    // Format: YYYYWW
    const year = parseInt(valueStr.substr(0, 4));
    const week = parseInt(valueStr.substr(4, 2));
    const periodStart = getDateOfISOWeek(week, year);
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 6);
    periodEnd.setHours(23, 59, 59, 999);
    return { periodStart, periodEnd };
  }

  if (periodType === 'monthly') {
    // Format: YYYYMM
    // BUGFIX: Use UTC to avoid timezone-dependent date shifting
    const year = parseInt(valueStr.substr(0, 4));
    const month = parseInt(valueStr.substr(4, 2)) - 1; // 0-indexed
    const periodStart = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)); // Last day of month
    return { periodStart, periodEnd };
  }

  throw new Error(`Invalid periodType: ${periodType}`);
}

/**
 * Get date of ISO week
 * @param {Number} week - Week number (1-53)
 * @param {Number} year - Year
 * @returns {Date} Start date of the week
 */
function getDateOfISOWeek(week, year) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  return ISOweekStart;
}

/**
 * Get previous period value
 * @param {String} periodType - 'daily', 'weekly', or 'monthly'
 * @param {Number} periodValue - Current period value
 * @returns {Number} Previous period value
 */
function getPreviousPeriod(periodType, periodValue) {
  const valueStr = periodValue.toString();

  if (periodType === 'daily') {
    // BUGFIX: Use UTC to avoid timezone-dependent date shifting
    const date = new Date(Date.UTC(
      parseInt(valueStr.substr(0, 4)),
      parseInt(valueStr.substr(4, 2)) - 1,
      parseInt(valueStr.substr(6, 2))
    ));
    date.setUTCDate(date.getUTCDate() - 1);
    return parseInt(`${date.getUTCFullYear()}${(date.getUTCMonth()+1).toString().padStart(2,'0')}${date.getUTCDate().toString().padStart(2,'0')}`);
  }

  if (periodType === 'weekly') {
    const year = parseInt(valueStr.substr(0, 4));
    const week = parseInt(valueStr.substr(4, 2));
    if (week === 1) {
      // BUGFIX: Calculate actual last week of previous year (52 or 53)
      const lastDayOfPrevYear = new Date(year - 1, 11, 31); // Dec 31 of previous year
      const { isoWeek } = getISOWeek(lastDayOfPrevYear);
      return parseInt(`${year-1}${isoWeek.toString().padStart(2,'0')}`);
    }
    return parseInt(`${year}${(week-1).toString().padStart(2,'0')}`);
  }

  if (periodType === 'monthly') {
    const year = parseInt(valueStr.substr(0, 4));
    const month = parseInt(valueStr.substr(4, 2));
    if (month === 1) {
      return parseInt(`${year-1}12`); // December of previous year
    }
    return parseInt(`${year}${(month-1).toString().padStart(2,'0')}`);
  }

  throw new Error(`Invalid periodType: ${periodType}`);
}

module.exports = {
  extractDomain,
  categorizeDomain,
  getDomainAuthority,
  getTimePeriods,
  getPeriodDates,
  getPreviousPeriod
};
