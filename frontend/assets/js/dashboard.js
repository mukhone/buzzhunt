// Dashboard functionality

const API_URL = '/api';
let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user') || '{}');
let userPlatforms = [];
let availablePlatforms = [];
let currentPlatform = null;

// Check authentication
if (!token) {
  window.location.href = '/';
}

// Security: Escape HTML to prevent XSS
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Date/Time Helper - Converts UTC to user's local timezone
function formatDateTime(utcDateString) {
  if (!utcDateString) return null;

  const date = new Date(utcDateString);

  // Format: "Dec 20, 2025, 3:45 PM" (user's local timezone)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// Platform Icon Helper - Returns SVG logo or emoji fallback
function getPlatformIcon(platform) {
  const platformName = platform.name || '';
  const iconMap = {
    'reddit': '/assets/images/reddit.svg',
    'quora': '/assets/images/quora.svg',
    'perplexity': '/assets/images/perplexity.svg',
    'chatgpt': '/assets/images/chatgpt.svg',
    'googleai': '/assets/images/googleai.svg'
  };

  const svgPath = iconMap[platformName.toLowerCase()];

  if (svgPath) {
    return `<img src="${svgPath}" alt="${platform.displayName}" class="platform-logo">`;
  }

  // Fallback to emoji if SVG not found
  return platform.icon || '🔵';
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
    // Token expired or invalid
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
async function initDashboard() {
  // Set user email
  document.getElementById('userEmail').textContent = user.email;

  // Load platforms
  await loadAvailablePlatforms();
  await loadUserPlatforms();

  // Setup event listeners
  setupEventListeners();
}

// Load available platforms
async function loadAvailablePlatforms() {
  try {
    availablePlatforms = await apiCall('/platforms');
    // Don't render here - will render after user platforms are loaded
  } catch (error) {
    console.error('Error loading available platforms:', error);
  }
}

// Load user's platforms
async function loadUserPlatforms() {
  try {
    userPlatforms = await apiCall('/platforms/user');
    renderUserPlatforms();
    // Render available platforms AFTER user platforms are loaded (for proper filtering)
    renderAvailablePlatforms();
  } catch (error) {
    console.error('Error loading user platforms:', error);
  }
}

// Render available platforms
function renderAvailablePlatforms() {
  const container = document.getElementById('availablePlatforms');

  const userPlatformIds = userPlatforms.map(up => up.platform._id);

  const html = availablePlatforms
    .filter(p => !userPlatformIds.includes(p._id))
    .map(platform => {
      const disabled = !platform.isActive ? 'disabled' : '';
      return `
        <div class="available-platform ${disabled}" data-platform-id="${platform._id}">
          <div class="platform-icon">${getPlatformIcon(platform)}</div>
          <h4>${platform.displayName}</h4>
          <p>${platform.description}</p>
          ${!platform.isActive ? '<span class="coming-soon">Coming Soon</span>' : ''}
          ${platform.isActive ? `<button class="btn btn-success" onclick="enablePlatform('${platform._id}')">Add Platform</button>` : ''}
        </div>
      `;
    })
    .join('');

  container.innerHTML = html || '<p class="text-center">All platforms are enabled!</p>';
}

// Render user platforms
function renderUserPlatforms() {
  const container = document.getElementById('platformsContainer');

  if (userPlatforms.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No platforms added yet</h3>
        <p>Add your first platform below to start monitoring!</p>
      </div>
    `;
    return;
  }

  const html = userPlatforms.map(up => {
    const platform = up.platform;
    const inputType = platform.inputType || 'keywords';
    const inputLabel = inputType === 'prompts' ? 'Prompt' : 'Keyword';
    const inputLabelPlural = inputType === 'prompts' ? 'Prompts' : 'Keywords';
    const inputLabelLower = inputLabel.toLowerCase();
    const inputLabelPluralLower = inputLabelPlural.toLowerCase();

    const keywordTags = up.keywords.length > 0
      ? up.keywords.map(kw => `<span class="keyword-tag">${escapeHtml(kw)}</span>`).join('')
      : `<span class="no-keywords">No ${inputLabelPluralLower} yet</span>`;

    const lastRun = up.lastRunAt ? formatDateTime(up.lastRunAt) : 'Never';
    const nextRun = up.nextRunAt ? formatDateTime(up.nextRunAt) : 'Not scheduled';

    return `
      <div class="platform-card">
        <div class="platform-header">
          <div class="platform-title">
            <span class="platform-icon">${getPlatformIcon(platform)}</span>
            <div>
              <h3>${platform.displayName}</h3>
              <span class="platform-badge ${up.isActive ? 'active' : 'inactive'}">
                ${up.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        <div class="keywords-display">
          <h4>${inputLabelPlural} (${up.keywords.length}/${platform.maxKeywords})</h4>
          <div class="keyword-tags">
            ${keywordTags}
          </div>
        </div>

        <div class="job-status">
          <p><strong>Last Run:</strong> ${lastRun}</p>
          <p><strong>Next Run:</strong> ${nextRun}</p>
        </div>

        <div class="platform-actions">
          <button class="btn btn-primary" onclick="openKeywordModal('${up._id}')">
            Manage ${inputLabelPlural}
          </button>
          <button class="btn btn-danger" onclick="disablePlatform('${up._id}', '${platform._id}')">
            Remove
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// Enable platform
async function enablePlatform(platformId) {
  try {
    await apiCall(`/platforms/${platformId}/enable`, {
      method: 'POST'
    });

    await loadUserPlatforms();
    await loadAvailablePlatforms();
  } catch (error) {
    alert('Error adding platform: ' + error.message);
  }
}

// Disable platform
async function disablePlatform(userPlatformId, platformId) {
  if (!confirm('Are you sure you want to remove this platform? All keywords and history will be preserved.')) {
    return;
  }

  try {
    await apiCall(`/platforms/${platformId}/disable`, {
      method: 'POST'
    });

    await loadUserPlatforms();
    await loadAvailablePlatforms();
  } catch (error) {
    alert('Error removing platform: ' + error.message);
  }
}

// Open keyword modal
async function openKeywordModal(userPlatformId) {
  currentPlatform = userPlatforms.find(up => up._id === userPlatformId);

  if (!currentPlatform) return;

  const inputType = currentPlatform.platform.inputType || 'keywords';
  const inputLabel = inputType === 'prompts' ? 'Prompt' : 'Keyword';
  const inputLabelPlural = inputType === 'prompts' ? 'Prompts' : 'Keywords';
  const inputLabelLower = inputLabel.toLowerCase();
  const inputLabelPluralLower = inputLabelPlural.toLowerCase();

  document.getElementById('modalTitle').textContent = `Manage ${currentPlatform.platform.displayName} ${inputLabelPlural}`;

  document.getElementById('modalPlatformInfo').innerHTML = `
    <div class="platform-icon">${getPlatformIcon(currentPlatform.platform)}</div>
    <p>${currentPlatform.platform.description}</p>
    <small>Max ${currentPlatform.platform.maxKeywords} ${inputLabelPluralLower}</small>
  `;

  // Update placeholder and button text
  document.getElementById('newKeyword').placeholder = `Enter ${inputLabelLower}`;
  document.getElementById('addKeywordBtn').textContent = `Add ${inputLabel}`;

  renderModalKeywords();
  updateJobInfo();

  document.getElementById('keywordModal').style.display = 'block';
}

// Render keywords in modal
function renderModalKeywords() {
  const container = document.getElementById('keywordsList');
  const inputType = currentPlatform.platform.inputType || 'keywords';
  const inputLabelLower = inputType === 'prompts' ? 'prompt' : 'keyword';

  if (currentPlatform.keywords.length === 0) {
    container.innerHTML = `<p class="no-keywords">No ${inputLabelLower}s added yet. Add your first ${inputLabelLower} below!</p>`;
    return;
  }

  const html = currentPlatform.keywords.map(kw => `
    <div class="keyword-tag">
      ${escapeHtml(kw)}
      <span class="remove-keyword" data-keyword="${escapeHtml(kw)}">&times;</span>
    </div>
  `).join('');

  container.innerHTML = `<div class="keyword-tags">${html}</div>`;

  // Add event listeners for remove buttons (safe from injection)
  container.querySelectorAll('.remove-keyword').forEach(btn => {
    btn.addEventListener('click', function() {
      removeKeyword(this.dataset.keyword);
    });
  });
}

// Update job info in modal
function updateJobInfo() {
  const lastRun = currentPlatform.lastRunAt
    ? formatDateTime(currentPlatform.lastRunAt)
    : 'Never';
  const nextRun = currentPlatform.nextRunAt
    ? formatDateTime(currentPlatform.nextRunAt)
    : 'Not scheduled';

  document.getElementById('lastRun').textContent = lastRun;
  document.getElementById('nextRun').textContent = nextRun;
}

// Add keyword
async function addKeyword() {
  const input = document.getElementById('newKeyword');
  const keyword = input.value.trim();
  const errorDiv = document.getElementById('keywordError');

  // Snapshot platform at handler entry; modal may close mid-await.
  const platformAtEntry = currentPlatform;
  if (!platformAtEntry) return;

  const inputType = platformAtEntry.platform.inputType || 'keywords';
  const inputLabelLower = inputType === 'prompts' ? 'prompt' : 'keyword';

  errorDiv.textContent = '';

  if (!keyword) {
    errorDiv.textContent = `Please enter a ${inputLabelLower}`;
    return;
  }

  try {
    const data = await apiCall(`/keywords/${platformAtEntry.platform._id}`, {
      method: 'POST',
      body: JSON.stringify({ keyword })
    });

    await loadUserPlatforms();

    // Modal may have been closed while requests were in flight.
    if (!currentPlatform) return;

    // Re-resolve currentPlatform against the refreshed array, then sync from API response.
    const refreshed = userPlatforms.find(up => up._id === platformAtEntry._id);
    if (refreshed) {
      refreshed.keywords = data.userPlatform.keywords;
      refreshed.lastRunAt = data.userPlatform.lastRunAt;
      refreshed.nextRunAt = data.userPlatform.nextRunAt;
      currentPlatform = refreshed;
    }

    renderModalKeywords();
    updateJobInfo();
    input.value = '';
  } catch (error) {
    if (currentPlatform) {
      errorDiv.textContent = error.message;
    }
  }
}

// Remove keyword
async function removeKeyword(keyword) {
  const platformAtEntry = currentPlatform;
  if (!platformAtEntry) return;

  try {
    const data = await apiCall(`/keywords/${platformAtEntry.platform._id}`, {
      method: 'DELETE',
      body: JSON.stringify({ keyword })
    });

    await loadUserPlatforms();

    if (!currentPlatform) return;

    const refreshed = userPlatforms.find(up => up._id === platformAtEntry._id);
    if (refreshed) {
      refreshed.keywords = data.userPlatform.keywords;
      refreshed.lastRunAt = data.userPlatform.lastRunAt;
      refreshed.nextRunAt = data.userPlatform.nextRunAt;
      currentPlatform = refreshed;
    }

    renderModalKeywords();
    updateJobInfo();
  } catch (error) {
    if (currentPlatform) {
      document.getElementById('keywordError').textContent = error.message;
    }
  }
}

// Setup event listeners
function setupEventListeners() {
  // Logout button
  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
  });

  // Modal close button
  document.querySelector('.close').addEventListener('click', () => {
    document.getElementById('keywordModal').style.display = 'none';
    currentPlatform = null;
  });

  // Close modal when clicking outside
  window.addEventListener('click', (e) => {
    const modal = document.getElementById('keywordModal');
    if (e.target === modal) {
      modal.style.display = 'none';
      currentPlatform = null;
    }
  });

  // Add keyword button
  document.getElementById('addKeywordBtn').addEventListener('click', addKeyword);

  // Add keyword on Enter key
  document.getElementById('newKeyword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  });
}

// Make functions global for onclick handlers
window.enablePlatform = enablePlatform;
window.disablePlatform = disablePlatform;
window.openKeywordModal = openKeywordModal;
window.removeKeyword = removeKeyword;

// Initialize on page load
initDashboard();
