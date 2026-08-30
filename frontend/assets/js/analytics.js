// Analytics Dashboard - BuzzHunt
// Connects to Phase 1 Analytics API endpoints

const API_URL = '/api';
let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user') || '{}');

// Check authentication
if (!token) {
  window.location.href = '/';
}

// State
let currentPeriod = 'weekly';
let currentPlatformFilter = 'all';
let trendsChart = null;
let domainsChart = null;
const EMPTY_OVERVIEW = Object.freeze({
  totalCitations: 0,
  totalUniqueDomains: 0,
  platforms: [],
  topDomains: [],
  recentMentions: []
});
let overviewData = { ...EMPTY_OVERVIEW };
let platformsData = [];

// Store current analytics state for competitor tracking
let currentAnalyticsState = {
  selectedPlatform: null,
  platforms: []
};

// ── XSS-safe rendering helpers ───────────────────────────────────────────
// Escape any string before interpolating into innerHTML.
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Validate URL for use in href. Allows only http(s); rejects javascript:,
// data:, vbscript:, file:, etc. Returns escaped safe URL or '' if rejected.
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  // Quick reject for any non-http(s) scheme
  if (!/^https?:\/\//i.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return escapeHtml(parsed.toString());
  } catch {
    return '';
  }
}

// API Helper
async function apiCall(endpoint, options = {}) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });

  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
    return;
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// Initialize dashboard
async function initAnalytics() {
  document.getElementById('userEmail').textContent = user.email;

  // Setup event listeners
  setupEventListeners();

  // Load initial data
  await loadAnalytics();
}

// Load all analytics data
async function loadAnalytics() {
  showLoading();

  try {
    // Load overview data
    const fetched = await apiCall(`/analytics/overview?period=${currentPeriod}`);
    overviewData = {
      ...EMPTY_OVERVIEW,
      ...(fetched || {}),
      platforms: Array.isArray(fetched?.platforms) ? fetched.platforms : [],
      topDomains: Array.isArray(fetched?.topDomains) ? fetched.topDomains : [],
      recentMentions: Array.isArray(fetched?.recentMentions) ? fetched.recentMentions : []
    };

    // Update UI
    updateOverviewStats();
    renderPlatformFilters();
    renderTrendsChart();
    renderDomainsChart();
    renderRecentMentions();

    // Load filtered platform data
    if (currentPlatformFilter !== 'all') {
      await loadPlatformDetails(currentPlatformFilter);
    } else {
      // Show aggregated sources
      await loadAggregatedSources();
    }

    // Load history
    await loadHistory();

    hideLoading();
  } catch (error) {
    console.error('Error loading analytics:', error);
    hideLoading();
    showError('Failed to load analytics data. Please try again.');
  }
}

// Update overview stats
function updateOverviewStats() {
  document.getElementById('totalCitations').textContent = overviewData.totalCitations.toLocaleString();
  document.getElementById('uniqueDomains').textContent = overviewData.totalUniqueDomains.toLocaleString();
  document.getElementById('activePlatforms').textContent = overviewData.platforms.length;

  if (overviewData.topDomains.length > 0) {
    document.getElementById('topSourceName').textContent = overviewData.topDomains[0].domain;
  } else {
    document.getElementById('topSourceName').textContent = '-';
  }
}

// Render platform filters
function renderPlatformFilters() {
  const container = document.getElementById('platformFilters');

  // BUGFIX: Apply active class based on currentPlatformFilter, not hardcoded
  const platformHTML = overviewData.platforms.map(p => `
    <button class="filter-btn${currentPlatformFilter === p.userPlatformId ? ' active' : ''}" data-platform="${p.userPlatformId}">
      <span>${p.platformName}</span>
      <span class="filter-count">${p.totalCitations}</span>
    </button>
  `).join('');

  container.innerHTML = `
    <button class="filter-btn${currentPlatformFilter === 'all' ? ' active' : ''}" data-platform="all">
      <span>All Platforms</span>
      <span class="filter-count">${overviewData.totalCitations}</span>
    </button>
    ${platformHTML}
  `;

  // Add click handlers
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => handlePlatformFilter(btn.dataset.platform));
  });
}

// Handle platform filter
async function handlePlatformFilter(platformId) {
  currentPlatformFilter = platformId;

  // Update active state
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.platform === platformId);
  });

  // Reload data
  if (platformId === 'all') {
    // Reset analytics state when viewing all platforms
    currentAnalyticsState.selectedPlatform = null;
    currentAnalyticsState.platforms = [];
    // Hide competitor section for "all platforms" view
    document.getElementById('competitorSection').style.display = 'none';
    await loadAnalytics();
  } else {
    await loadPlatformDetails(platformId);
  }
}

// Load platform-specific details
async function loadPlatformDetails(userPlatformId) {
  try {
    console.log('[Platform] Loading details for platform ID:', userPlatformId);

    // Store platform info for competitor tracking
    const platform = overviewData.platforms.find(p => p.userPlatformId === userPlatformId);
    if (platform) {
      console.log('[Platform] Found platform:', platform.platformName);
      currentAnalyticsState.selectedPlatform = userPlatformId;
      currentAnalyticsState.platforms = overviewData.platforms;
    } else {
      console.warn('[Platform] Platform not found in overviewData');
    }

    // Load trends
    const trendsData = await apiCall(`/analytics/trends/${userPlatformId}?period=${currentPeriod}&limit=12`);

    // Load sources with filters
    const category = document.getElementById('categoryFilter')?.value || '';
    const authority = document.getElementById('authorityFilter')?.value || '';
    let sourcesUrl = `/analytics/sources/${userPlatformId}?limit=50`;
    if (category) sourcesUrl += `&category=${encodeURIComponent(category)}`;
    if (authority) sourcesUrl += `&authority=${encodeURIComponent(authority)}`;
    const sourcesData = await apiCall(sourcesUrl);

    // Load history
    const historyData = await apiCall(`/analytics/history/${userPlatformId}?page=1&limit=20`);

    // Load competitor data (for prompt-based platforms only)
    console.log('[Platform] Calling loadCompetitorData...');
    await loadCompetitorData(userPlatformId);

    // Update charts with platform data
    updateTrendsChart(trendsData.trends);
    updateDomainsChart(sourcesData.sources);
    renderSourcesTable(sourcesData.sources);
    renderHistoryTable(historyData.history, historyData.pagination);

    // BUGFIX: Update overviewData.recentMentions with platform-specific data
    // This ensures Recent Citations table shows this platform's own entries
    overviewData.recentMentions = historyData.history;

    // Update recent mentions to show only this platform's citations
    renderRecentMentions();

  } catch (error) {
    console.error('[Platform] Error loading platform details:', error);
    showError('Failed to load platform details');
  }
}

// Load aggregated sources (all platforms)
async function loadAggregatedSources() {
  // For "All Platforms" view, show top domains from overview
  renderDomainsFromOverview();
}

// Render trends chart
function renderTrendsChart() {
  const ctx = document.getElementById('trendsChart').getContext('2d');

  // Extract data for chart
  const labels = [];
  const data = [];

  // For overview mode, show aggregated trend
  if (currentPlatformFilter === 'all' && overviewData.platforms.length > 0) {
    // This is simplified - in production you'd aggregate trend data properly
    overviewData.platforms.forEach(p => {
      labels.push(p.platformName);
      data.push(p.totalCitations);
    });
  }

  if (trendsChart) {
    trendsChart.destroy();
  }

  trendsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length > 0 ? labels : ['No Data'],
      datasets: [{
        label: 'Citations',
        data: data.length > 0 ? data : [0],
        borderColor: '#5e17eb',
        backgroundColor: 'rgba(94, 23, 235, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0
          }
        }
      }
    }
  });
}

// Update trends chart with new data
function updateTrendsChart(trends) {
  if (!trendsChart) return;

  const labels = trends.map(t => {
    const date = new Date(t.periodStart);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const data = trends.map(t => t.totalCitations);

  trendsChart.data.labels = labels;
  trendsChart.data.datasets[0].data = data;
  trendsChart.update();
}

// Render domains chart
function renderDomainsChart() {
  const ctx = document.getElementById('domainsChart').getContext('2d');

  const topDomains = overviewData.topDomains.slice(0, 10);
  const labels = topDomains.map(d => d.domain);
  const data = topDomains.map(d => d.count);

  if (domainsChart) {
    domainsChart.destroy();
  }

  domainsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.length > 0 ? labels : ['No Data'],
      datasets: [{
        label: 'Citations',
        data: data.length > 0 ? data : [0],
        backgroundColor: '#ff6100',
        borderColor: '#cf0067',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `Citations: ${context.parsed.x}`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            precision: 0
          }
        }
      }
    }
  });
}

// Update domains chart with new data
function updateDomainsChart(sources) {
  if (!domainsChart) return;

  const topSources = sources.slice(0, 10);
  const labels = topSources.map(s => s.domain);
  const data = topSources.map(s => s.totalCitations);

  domainsChart.data.labels = labels;
  domainsChart.data.datasets[0].data = data;
  domainsChart.update();
}

// Render domains from overview (for "All Platforms" view)
function renderDomainsFromOverview() {
  const tbody = document.getElementById('sourcesTableBody');

  if (overviewData.topDomains.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No sources found</td></tr>';
    return;
  }

  const html = overviewData.topDomains.map(domain => {
    const authority = domain.authority || 'Medium';
    const category = domain.category || 'Other';
    return `
    <tr>
      <td><strong>${escapeHtml(domain.domain)}</strong></td>
      <td><span class="badge badge-${getCategoryColor(category)}">${escapeHtml(category)}</span></td>
      <td><span class="badge badge-authority-${escapeHtml(authority.toLowerCase())}">${escapeHtml(authority)}</span></td>
      <td><strong>${domain.count || 0}</strong></td>
      <td>-</td>
      <td>-</td>
    </tr>
  `;
  }).join('');

  tbody.innerHTML = html;
}

// Render sources table
function renderSourcesTable(sources) {
  const tbody = document.getElementById('sourcesTableBody');

  if (sources.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No sources found</td></tr>';
    return;
  }

  const html = sources.map(source => {
    // FIX: Older SourceAnalysis rows / partial backfills can omit `authority`,
    // which used to throw `TypeError: Cannot read property 'toLowerCase' of
    // undefined` and break the whole analytics view. Mirror the safe defaults
    // used in renderDomainsFromOverview() above.
    const authority = source.authority || 'Medium';
    const category = source.category || 'Other';
    return `
    <tr>
      <td><strong>${escapeHtml(source.domain)}</strong></td>
      <td><span class="badge badge-${getCategoryColor(category)}">${escapeHtml(category)}</span></td>
      <td><span class="badge badge-authority-${escapeHtml(authority.toLowerCase())}">${escapeHtml(authority)}</span></td>
      <td><strong>${source.totalCitations || 0}</strong></td>
      <td>${escapeHtml(formatDate(source.firstSeenAt))}</td>
      <td>${escapeHtml(formatDate(source.lastSeenAt))}</td>
    </tr>
  `;
  }).join('');

  tbody.innerHTML = html;
}

// Render recent mentions
function renderRecentMentions() {
  const tbody = document.getElementById('recentMentionsBody');

  if (!overviewData.recentMentions || overviewData.recentMentions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No recent mentions</td></tr>';
    return;
  }

  // Filter mentions by selected platform
  let mentions = overviewData.recentMentions;
  if (currentPlatformFilter !== 'all') {
    // BUGFIX: Only filter if userPlatform field is populated (from overview endpoint)
    // If userPlatform is missing, data is already platform-specific (from history endpoint)
    if (mentions.length > 0 && mentions[0].userPlatform) {
      mentions = mentions.filter(mention =>
        mention.userPlatform && mention.userPlatform._id === currentPlatformFilter
      );
    }
    // Otherwise data is already filtered by loadPlatformDetails, no need to filter again
  }

  // Filter mentions by prompt text
  const promptFilter = document.getElementById('promptFilter');
  if (promptFilter && promptFilter.value.trim()) {
    const searchTerm = promptFilter.value.trim().toLowerCase();
    mentions = mentions.filter(mention =>
      mention.keyword && mention.keyword.toLowerCase().includes(searchTerm)
    );
  }

  // Check if we have any mentions after filtering
  if (mentions.length === 0) {
    const message = promptFilter && promptFilter.value.trim()
      ? 'No mentions found for this prompt'
      : 'No recent mentions for this platform';
    tbody.innerHTML = `<tr><td colspan="6" class="text-center">${message}</td></tr>`;
    return;
  }

  const html = mentions.slice(0, 10).map(mention => {
    // BUGFIX: When userPlatform is missing (platform-specific data from history endpoint),
    // look up the platform name from overviewData using currentPlatformFilter
    let platformName = mention.userPlatform?.platform?.displayName;
    if (!platformName && currentPlatformFilter !== 'all') {
      const platform = overviewData.platforms.find(p => p.userPlatformId === currentPlatformFilter);
      platformName = platform?.platformName || 'Unknown';
    }
    if (!platformName) platformName = 'Unknown';

    const prompt = mention.keyword || '-';
    const promptDisplay = prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt;
    const safeUrl = sanitizeUrl(mention.url);
    return `
      <tr>
        <td class="title-cell">${escapeHtml(mention.title || 'Untitled')}</td>
        <td>${escapeHtml(mention.sourceDomain || '-')}</td>
        <td><span class="badge badge-platform">${escapeHtml(platformName)}</span></td>
        <td><span class="badge badge-keyword" title="${escapeHtml(prompt)}">${escapeHtml(promptDisplay)}</span></td>
        <td>${escapeHtml(formatDate(mention.createdAt))}</td>
        <td>${safeUrl
          ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="btn-link">View</a>`
          : '<span class="btn-link disabled">—</span>'}</td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = html;
}

// Load history with filters
async function loadHistory(page = 1) {
  try {
    let endpoint;
    const keyword = document.getElementById('keywordSearchFilter')?.value || '';
    const domain = document.getElementById('domainSearchFilter')?.value || '';

    if (currentPlatformFilter === 'all') {
      // For all platforms, show recent mentions from overview
      renderHistoryFromOverview(page);
      return;
    }

    // Build query params
    const params = new URLSearchParams({
      page: page,
      limit: 20
    });

    if (keyword) params.append('keyword', keyword);
    if (domain) params.append('domain', domain);

    const data = await apiCall(`/analytics/history/${currentPlatformFilter}?${params}`);
    renderHistoryTable(data.history, data.pagination);

  } catch (error) {
    console.error('Error loading history:', error);
  }
}

// Render history from overview
function renderHistoryFromOverview(page) {
  let mentions = overviewData.recentMentions || [];

  // BUGFIX: Apply client-side filtering for "All Platforms" view
  const keyword = document.getElementById('keywordSearchFilter')?.value || '';
  const domain = document.getElementById('domainSearchFilter')?.value || '';

  if (keyword.trim()) {
    const searchTerm = keyword.trim().toLowerCase();
    mentions = mentions.filter(m =>
      (m.keyword && m.keyword.toLowerCase().includes(searchTerm)) ||
      (m.title && m.title.toLowerCase().includes(searchTerm))
    );
  }

  if (domain.trim()) {
    const searchDomain = domain.trim().toLowerCase();
    mentions = mentions.filter(m =>
      m.sourceDomain && m.sourceDomain.toLowerCase().includes(searchDomain)
    );
  }

  const itemsPerPage = 20;
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedMentions = mentions.slice(startIndex, endIndex);

  const pagination = {
    page,
    limit: itemsPerPage,
    total: mentions.length,
    pages: Math.ceil(mentions.length / itemsPerPage)
  };

  renderHistoryTable(paginatedMentions, pagination);
}

// Render history table
function renderHistoryTable(history, pagination) {
  const tbody = document.getElementById('historyTableBody');

  if (history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">No history found</td></tr>';
    return;
  }

  const html = history.map(item => {
    const safeUrl = sanitizeUrl(item.url);
    return `
    <tr>
      <td class="title-cell">${escapeHtml(item.title || 'Untitled')}</td>
      <td>${escapeHtml(item.sourceDomain || '-')}</td>
      <td><span class="badge badge-keyword">${escapeHtml(item.keyword || '-')}</span></td>
      <td>${escapeHtml(formatDate(item.createdAt))}</td>
      <td>${safeUrl
        ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="btn-link">View</a>`
        : '<span class="btn-link disabled">—</span>'}</td>
    </tr>
  `;
  }).join('');

  tbody.innerHTML = html;

  // Render pagination
  renderPagination(pagination);
}

// Render pagination
function renderPagination(pagination) {
  const container = document.getElementById('historyPagination');

  if (pagination.pages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '<div class="pagination-controls">';

  // Previous button
  if (pagination.page > 1) {
    html += `<button class="btn-pagination" onclick="loadHistory(${pagination.page - 1})">Previous</button>`;
  }

  // Page info
  html += `<span class="page-info">Page ${pagination.page} of ${pagination.pages}</span>`;

  // Next button
  if (pagination.page < pagination.pages) {
    html += `<button class="btn-pagination" onclick="loadHistory(${pagination.page + 1})">Next</button>`;
  }

  html += '</div>';
  container.innerHTML = html;
}

// Setup event listeners
function setupEventListeners() {
  // Logout
  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
  });

  // Period selector
  document.getElementById('periodSelect').addEventListener('change', async (e) => {
    currentPeriod = e.target.value;
    await loadAnalytics();
  });

  // History filters
  document.getElementById('applyHistoryFilters')?.addEventListener('click', () => {
    loadHistory(1);
  });

  // Category filter
  document.getElementById('categoryFilter')?.addEventListener('change', () => {
    // Reload sources with filter
    if (currentPlatformFilter !== 'all') {
      loadPlatformDetails(currentPlatformFilter);
    }
  });

  // Authority filter
  document.getElementById('authorityFilter')?.addEventListener('change', () => {
    // Reload sources with filter
    if (currentPlatformFilter !== 'all') {
      loadPlatformDetails(currentPlatformFilter);
    }
  });
}

// Helper functions
function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function getCategoryColor(category) {
  const colors = {
    'News': 'blue',
    'Tech News': 'purple',
    'Business': 'green',
    'Industry Publication': 'orange',
    'Blog/Community': 'yellow',
    'Social Media': 'pink',
    'Academic': 'indigo',
    'Government': 'red',
    'Other': 'gray'
  };
  return colors[category] || 'gray';
}

function showLoading() {
  document.getElementById('loadingState').style.display = 'flex';
  document.getElementById('analyticsContent').style.display = 'none';
}

function hideLoading() {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('analyticsContent').style.display = 'block';
}

function showError(message) {
  alert(message);
}

// Make loadHistory global for pagination
window.loadHistory = loadHistory;

// ========================================
// Competitor Tracking Functionality
// ========================================

let currentCompetitorPlatform = null;

// Load competitor data for currently selected platform
async function loadCompetitorData(userPlatformId) {
  try {
    console.log('[Competitor] Loading data for platform:', userPlatformId);
    const response = await fetch(`${API_URL}/analytics/competitors/${userPlatformId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('[Competitor] API response status:', response.status);

    if (!response.ok) {
      console.warn('[Competitor] API returned non-OK status, hiding section');
      // Hide section if API fails
      document.getElementById('competitorSection').style.display = 'none';
      return;
    }

    const data = await response.json();
    console.log('[Competitor] API response data:', data);

    // Always show the competitor section for prompt-based platforms
    console.log('[Competitor] Showing competitor section');
    document.getElementById('competitorSection').style.display = 'block';

    if (data.enabled) {
      // Display competitor insights
      console.log('[Competitor] Tracking enabled, displaying insights');
      displayCompetitorInsights(data);
    } else {
      // Show setup message when tracking is not enabled
      console.log('[Competitor] Tracking not enabled, showing setup message');
      displayCompetitorSetupMessage();
    }
  } catch (error) {
    console.error('[Competitor] Error loading competitor data:', error);
    document.getElementById('competitorSection').style.display = 'none';
  }
}

// Display competitor insights
function displayCompetitorInsights(data) {
  // Update stats
  document.getElementById('totalCompetitorMentions').textContent = data.mentions ? data.mentions.length : 0;

  let coMentionCount = 0;
  let positiveMentions = 0;
  let negativeMentions = 0;

  if (data.mentions) {
    coMentionCount = data.mentions.filter(m => m.yourBrandMentioned).length;
    positiveMentions = data.mentions.filter(m => m.sentiment === 'positive').length;
    negativeMentions = data.mentions.filter(m => m.sentiment === 'negative').length;
  }

  document.getElementById('coMentionCount').textContent = coMentionCount;
  document.getElementById('positiveMentions').textContent = positiveMentions;
  document.getElementById('negativeMentions').textContent = negativeMentions;

  // Display competitor breakdown table
  const tableBody = document.getElementById('competitorTableBody');

  if (!data.competitorBreakdown || data.competitorBreakdown.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No competitor mentions found yet</td></tr>';
    return;
  }

  tableBody.innerHTML = data.competitorBreakdown.map(comp => {
    const latestMention = data.mentions.find(m => m.competitorName === comp._id);
    const sentimentIcon = comp.positiveMentions > comp.negativeMentions ? '👍' :
                         comp.negativeMentions > comp.positiveMentions ? '👎' : '➖';

    // BUGFIX: Guard against division by zero
    const coMentionPercent = comp.totalMentions > 0
      ? Math.round((comp.coMentionsWithYou / comp.totalMentions) * 100)
      : 0;

    return `
      <tr>
        <td><strong>${escapeHtml(comp._id)}</strong></td>
        <td>${comp.totalMentions}</td>
        <td>${comp.coMentionsWithYou} (${coMentionPercent}%)</td>
        <td>${sentimentIcon} ${comp.positiveMentions}+ / ${comp.negativeMentions}-</td>
        <td>${latestMention ? escapeHtml(latestMention.keyword) : '-'}</td>
        <td>${latestMention ? formatDate(latestMention.detectedAt) : '-'}</td>
      </tr>
    `;
  }).join('');
}

// Display setup message when competitor tracking is not enabled
function displayCompetitorSetupMessage() {
  // Reset stats to show zero
  document.getElementById('totalCompetitorMentions').textContent = '0';
  document.getElementById('coMentionCount').textContent = '0';
  document.getElementById('positiveMentions').textContent = '0';
  document.getElementById('negativeMentions').textContent = '0';

  // Show setup message in table
  const tableBody = document.getElementById('competitorTableBody');
  tableBody.innerHTML = `
    <tr>
      <td colspan="6" class="text-center" style="padding: 2rem;">
        <div style="max-width: 500px; margin: 0 auto;">
          <p style="font-size: 1.1rem; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">Competitor Tracking Not Configured</p>
          <p style="color: #6b7280; margin-bottom: 1.5rem;">
            Track competitor mentions in AI responses to understand your competitive landscape.
          </p>
          <p style="color: #6b7280; font-size: 0.95rem;">
            Click the "Configure Tracking" button above to set up your competitors list and start tracking.
          </p>
        </div>
      </td>
    </tr>
  `;
}

// Open competitor configuration modal
function openCompetitorModal(platformName, userPlatformId) {
  currentCompetitorPlatform = { platformName, userPlatformId };

  // Load existing settings
  fetch(`${API_URL}/analytics/competitors/${userPlatformId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(r => r.json())
    .then(data => {
      // Always set checkbox state to match backend
      document.getElementById('enableTracking').checked = data.enabled || false;
      document.getElementById('yourBrandName').value = data.yourBrand || '';

      // Format competitors text
      if (data.competitors && data.competitors.length > 0) {
        const competitorsText = data.competitors.map(c =>
          `${c.name}${c.aliases && c.aliases.length > 0 ? ' | ' + c.aliases.join(', ') : ''}`
        ).join('\n');
        document.getElementById('competitorsText').value = competitorsText;
      }
    })
    .catch(err => console.error('Error loading settings:', err));

  document.getElementById('competitorModal').style.display = 'block';
}

// Close competitor modal
function closeCompetitorModal() {
  document.getElementById('competitorModal').style.display = 'none';
  currentCompetitorPlatform = null;
}

// Save competitor settings
async function saveCompetitorSettings() {
  if (!currentCompetitorPlatform) {
    console.error('[Competitor] currentCompetitorPlatform is null');
    alert('Error: Platform information not found. Please try again.');
    return;
  }

  // Store userPlatformId before closing modal (which sets currentCompetitorPlatform to null)
  const userPlatformId = currentCompetitorPlatform.userPlatformId;

  const yourBrandName = document.getElementById('yourBrandName').value.trim();
  const competitorsText = document.getElementById('competitorsText').value.trim();
  const enabled = document.getElementById('enableTracking').checked;

  // Parse competitors from text
  const competitors = competitorsText.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split('|').map(p => p.trim());
      const name = parts[0];
      const aliases = parts[1] ? parts[1].split(',').map(a => a.trim()).filter(a => a) : [];
      return { name, aliases };
    });

  try {
    console.log('[Competitor] Saving settings for platform:', userPlatformId);
    const response = await fetch(`${API_URL}/analytics/competitors/${userPlatformId}/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        yourBrandName,
        competitors,
        enabled
      })
    });

    if (!response.ok) throw new Error('Failed to save settings');

    alert('Competitor tracking settings saved successfully!');
    closeCompetitorModal();

    // BUGFIX: Reload or clear competitor data based on enabled state
    if (enabled) {
      await loadCompetitorData(userPlatformId);
    } else {
      // Clear stale competitor data when tracking is disabled
      displayCompetitorSetupMessage();
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Failed to save settings. Please try again.');
  }
}

// Make functions global
window.openCompetitorModal = openCompetitorModal;
window.closeCompetitorModal = closeCompetitorModal;
window.saveCompetitorSettings = saveCompetitorSettings;

// Add event listener for configure button
document.addEventListener('DOMContentLoaded', () => {
  const configureBtn = document.getElementById('configureCompetitorsBtn');
  if (configureBtn) {
    configureBtn.addEventListener('click', () => {
      if (currentAnalyticsState.selectedPlatform && currentAnalyticsState.selectedPlatform !== 'all') {
        const userPlatformId = currentAnalyticsState.selectedPlatform;
        const platform = currentAnalyticsState.platforms.find(p => p.userPlatformId === userPlatformId);
        if (platform) {
          openCompetitorModal(platform.platformName, userPlatformId);
        }
      } else {
        alert('Please select a specific platform to configure competitor tracking');
      }
    });
  }

  // Add event listener for prompt filter
  const promptFilter = document.getElementById('promptFilter');
  if (promptFilter) {
    promptFilter.addEventListener('input', () => {
      renderRecentMentions();
    });
  }
});

// Initialize on page load
initAnalytics();
