// Global Dashboard State
let activePostId = null;
let allPosts = [];
let analyticsChart = null;
let currentPreviewMode = "svg"; // "svg" | "png"

// Initialize WebSocket Connection for System Logs
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  const ws = new WebSocket(wsUrl);

  const stateBadge = document.getElementById('ws-state');
  const logViewer = document.getElementById('terminal-log-viewer');

  ws.onopen = () => {
    stateBadge.textContent = "CONNECTED";
    stateBadge.className = "status-value connect-badge";
    console.log("WebSocket connected.");
  };

  ws.onclose = () => {
    stateBadge.textContent = "DISCONNECTED";
    stateBadge.className = "status-value badge-failed";
    console.log("WebSocket disconnected. Retrying in 5s...");
    setTimeout(initWebSocket, 5000);
  };

  ws.onmessage = (event) => {
    try {
      const logEntry = JSON.parse(event.data);
      appendTerminalLog(logEntry);
    } catch (e) {
      console.error("Error parsing WebSocket log message:", e);
    }
  };
}

// Append log entry to terminal viewer
function appendTerminalLog(log) {
  const logViewer = document.getElementById('terminal-log-viewer');
  const line = document.createElement('div');
  line.className = `terminal-line ${log.type}-line`;
  
  // Format: [17:15:30] [INFO] Message text
  const date = new Date(log.timestamp);
  const timeStr = date.toTimeString().split(' ')[0];
  
  line.textContent = `[${timeStr}] [${log.type.toUpperCase()}] ${log.message}`;
  logViewer.appendChild(line);

  // Auto scroll to bottom
  logViewer.scrollTop = logViewer.scrollHeight;
}

// Fetch all system updates
async function updateDashboardData() {
  await Promise.all([
    fetchSystemStatus(),
    fetchNewsFeed(),
    fetchQueue(),
    fetchAnalytics(),
    fetchRecommendations()
  ]);
}

// Fetch general system state
async function fetchSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const status = await res.json();
    
    // Update top bar
    const modeBadge = document.querySelector('#status-mode .status-value');
    modeBadge.textContent = status.simulationMode ? "SIMULATION" : "LIVE MODE";
    modeBadge.className = status.simulationMode ? "status-value sim-badge" : "status-value active-badge";

    const stateBadge = document.getElementById('pipeline-state');
    stateBadge.textContent = status.activePipelineRun ? "RUNNING" : "IDLE";
    stateBadge.className = status.activePipelineRun ? "status-value active-badge fa-spin" : "status-value connect-badge";
  } catch (e) {
    console.error("Failed to fetch system status:", e);
  }
}

// HTML Escape helper to prevent client-side XSS vulnerabilities
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, function(m) {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
    }
  });
}

// Fetch news and generated posts
async function fetchNewsFeed() {
  try {
    const res = await fetch('/api/posts');
    allPosts = await res.json();
    
    const countBadge = document.getElementById('news-count');
    countBadge.textContent = `${allPosts.length} posts generated`;

    const newsList = document.getElementById('news-list');
    
    if (allPosts.length === 0) {
      newsList.innerHTML = `
        <div class="loading-placeholder">
          <i class="fa-solid fa-circle-exclamation"></i> No stories active. Run pipeline.
        </div>
      `;
      return;
    }

    const selectedCategory = document.querySelector('.filter-tab.active').dataset.category;
    let html = "";

    const filtered = allPosts.filter(post => {
      if (selectedCategory === "all") return true;
      return post.category === selectedCategory;
    });

    filtered.forEach(post => {
      const activeClass = post.id === activePostId ? "active" : "";
      
      let scoreColorClass = "score-low";
      if (post.viralScore >= 80) scoreColorClass = "score-high";
      else if (post.viralScore >= 50) scoreColorClass = "score-medium";

      let catBadgeClass = "cat-tech";
      if (post.category === "Business") catBadgeClass = "cat-biz";
      else if (post.category === "World Affairs") catBadgeClass = "cat-world";
      else if (post.category === "Science") catBadgeClass = "cat-sci";
      else if (post.category === "Entertainment") catBadgeClass = "cat-ent";
      else if (post.category === "Sports") catBadgeClass = "cat-sports";

      const verifiedText = post.confidence >= 95 ? `<i class="fa-solid fa-circle-check text-success"></i>` : "";

      const escCategory = escapeHTML(post.category);
      const escTitle = escapeHTML(post.title);
      const escSource = escapeHTML(post.source);

      html += `
        <div class="news-card ${activeClass}" onclick="selectPost('${post.id}')">
          <div class="news-card-header">
            <span class="news-cat-badge ${catBadgeClass}">${escCategory.toUpperCase()}</span>
            <span class="news-viral-score ${scoreColorClass}">V:${post.viralScore}</span>
          </div>
          <div class="news-card-title">${escTitle}</div>
          <div class="news-card-footer">
            <span class="news-source">${verifiedText} ${escSource}</span>
            <span>${post.confidence}% confidence</span>
          </div>
        </div>
      `;
    });

    newsList.innerHTML = html || `<div class="loading-placeholder">No stories in this category.</div>`;
  } catch (e) {
    console.error("Failed to fetch news feed:", e);
  }
}

// Select a post and open in Middle Editor
async function selectPost(id) {
  activePostId = id;
  
  // Update left feed cards active status
  document.querySelectorAll('.news-card').forEach(card => card.classList.remove('active'));
  
  const post = allPosts.find(p => p.id === id);
  if (!post) return;

  // Show editor workspace
  document.getElementById('editor-empty-state').style.display = "none";
  document.getElementById('post-editor-workspace').style.display = "flex";

  // Fill form inputs
  document.getElementById('edit-headline').value = post.title;
  document.getElementById('edit-description').value = post.description;
  document.getElementById('edit-caption').value = post.caption;
  document.getElementById('edit-hashtags').value = post.hashtags;

  // Refresh visual previews
  renderPreview(post);
  
  // Refresh feed UI selection highlight
  fetchNewsFeed();
}

// Fetch SVG asset text and dump inline, or display PNG image
async function renderPreview(post) {
  const svgFrame = document.getElementById('svg-preview-frame');
  const pngFrame = document.getElementById('png-preview-frame');

  if (currentPreviewMode === "svg") {
    svgFrame.style.display = "block";
    pngFrame.style.display = "none";
    
    try {
      // Fetch SVG content dynamically to render inline (responsive & sharp vectors!)
      const res = await fetch(post.svgPath);
      const svgText = await res.text();
      svgFrame.innerHTML = svgText;
    } catch (e) {
      svgFrame.innerHTML = `<div class="loading-placeholder">Failed to render SVG vector preview.</div>`;
    }
  } else {
    svgFrame.style.display = "none";
    pngFrame.style.display = "block";
    pngFrame.src = `${post.pngPath}?t=${Date.now()}`; // break browser cache on re-renders
  }
}

// Fetch scheduling queue
async function fetchQueue() {
  try {
    const res = await fetch('/api/queue');
    const queue = await res.json();
    const queueContainer = document.getElementById('queue-container');

    if (queue.length === 0) {
      queueContainer.innerHTML = `<div class="loading-placeholder">Queue empty. Ingest news first.</div>`;
      return;
    }

    let html = "";
    queue.slice(-5).forEach(item => {
      const pubDate = new Date(item.scheduledTime);
      const timeStr = pubDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      let badgeClass = "badge-scheduled";
      if (item.status === "publishing") badgeClass = "badge-publishing";
      else if (item.status === "published") badgeClass = "badge-published";
      else if (item.status === "failed") badgeClass = "badge-failed";

      const showButton = item.status !== "published" && item.status !== "publishing";
      const actionBtn = showButton 
        ? `<button class="btn btn-sm btn-outline-primary" onclick="publishPostDirectly('${item.id}')">PUBLISH NOW</button>`
        : `<span class="queue-time">${item.status === "published" ? "PUBLISHED" : "IN PROGRESS"}</span>`;

      const escStatus = escapeHTML(item.status);
      const escTitle = escapeHTML(item.title);

      html += `
        <div class="queue-item">
          <div class="queue-info">
            <span class="queue-badge ${badgeClass}">${escStatus}</span>
            <span class="queue-title" title="${escTitle}">${escTitle}</span>
          </div>
          <div class="queue-actions">
            <span class="queue-time">${timeStr}</span>
            ${actionBtn}
          </div>
        </div>
      `;
    });

    queueContainer.innerHTML = html;
  } catch (e) {
    console.error("Failed to fetch queue:", e);
  }
}

// Trigger manual post publishing from the queue
async function publishPostDirectly(id) {
  try {
    appendTerminalLog({ timestamp: new Date(), type: "info", message: `Manual publish override triggered for: ${id}` });
    const queue = await (await fetch('/api/queue')).json();
    const queueItem = queue.find(q => q.id === id);
    if (!queueItem) return;

    // Send publish trigger
    const res = await fetch('/api/pipeline/publish', { method: 'POST' });
    const data = await res.json();
    
    appendTerminalLog({ timestamp: new Date(), type: "info", message: data.message });
    
    // Refresh queue shortly
    setTimeout(updateDashboardData, 1000);
  } catch (e) {
    console.error("Failed to publish queue item:", e);
  }
}

// Fetch and render analytics Chart.js and summary metrics
async function fetchAnalytics() {
  try {
    const res = await fetch('/api/analytics');
    const data = await res.json();

    // Update Summary metric cards
    document.getElementById('metric-reach').textContent = Number(data.summary.total_reach).toLocaleString();
    document.getElementById('metric-er').textContent = `${data.summary.average_engagement_rate}%`;
    document.getElementById('metric-saves').textContent = Number(data.summary.total_saves).toLocaleString();
    document.getElementById('metric-shares').textContent = Number(data.summary.total_shares).toLocaleString();

    // Redraw Trend Chart
    const dates = data.historical.map(h => h.date);
    const reachData = data.historical.map(h => h.reach);
    const erData = data.historical.map(h => h.engagement_rate);

    const ctx = document.getElementById('analytics-chart').getContext('2d');
    
    if (analyticsChart) {
      analyticsChart.destroy();
    }

    analyticsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [
          {
            label: 'Reach (Daily)',
            data: reachData,
            borderColor: '#00f0ff',
            backgroundColor: 'rgba(0, 240, 255, 0.05)',
            borderWidth: 2,
            tension: 0.3,
            fill: true,
            yAxisID: 'y'
          },
          {
            label: 'ER % (Daily)',
            data: erData,
            borderColor: '#9b5de5',
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: '#8e9bb2',
              font: { size: 9, weight: 'bold' }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.02)' },
            ticks: { color: '#8e9bb2', font: { size: 8 } }
          },
          y: {
            position: 'left',
            grid: { color: 'rgba(255, 255, 255, 0.02)' },
            ticks: { color: '#00f0ff', font: { size: 8 } }
          },
          y1: {
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#9b5de5', font: { size: 8 } }
          }
        }
      }
    });

  } catch (e) {
    console.error("Failed to fetch analytics:", e);
  }
}

// Fetch Optimizer Recommendations
async function fetchRecommendations() {
  try {
    const res = await fetch('/api/recommendations');
    const recs = await res.json();
    const container = document.getElementById('recommendations-container');
    
    let html = "";
    recs.forEach(rec => {
      const icon = rec.type === "BOOST" 
        ? `<i class="fa-solid fa-circle-arrow-up text-success"></i>` 
        : (rec.type === "REDUCE" ? `<i class="fa-solid fa-circle-arrow-down text-info"></i>` : `<i class="fa-solid fa-check-circle text-success"></i>`);
      
      const escMessage = escapeHTML(rec.message);

      html += `
        <div class="rec-item">
          ${icon}
          <span>${escMessage}</span>
        </div>
      `;
    });

    container.innerHTML = html || `<div class="rec-item">No active recommendations.</div>`;
  } catch (e) {
    console.error("Failed to fetch recommendations:", e);
  }
}

// Save edited details on the post
async function savePostEdits() {
  if (!activePostId) return;

  const title = document.getElementById('edit-headline').value;
  const description = document.getElementById('edit-description').value;
  const caption = document.getElementById('edit-caption').value;
  const hashtags = document.getElementById('edit-hashtags').value;

  const saveBtn = document.getElementById('btn-save-post');
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> RE-RENDERING...`;

  try {
    const res = await fetch('/api/posts/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activePostId,
        title,
        description,
        caption,
        hashtags
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Refresh display
    const post = allPosts.find(p => p.id === activePostId);
    if (post) {
      post.title = title;
      post.description = description;
      post.caption = caption;
      post.hashtags = hashtags;
      renderPreview(post);
    }
    
    appendTerminalLog({ timestamp: new Date(), type: "success", message: `Edits saved for "${title}" successfully.` });

  } catch (e) {
    appendTerminalLog({ timestamp: new Date(), type: "error", message: `Failed to save edits: ${e.message}` });
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> SAVE & RE-RENDER GRAPHICS`;
    updateDashboardData();
  }
}

// Trigger complete News Discovery pipeline run
async function triggerPipelineRun() {
  const runBtn = document.getElementById('btn-run-pipeline');
  runBtn.disabled = true;
  runBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> PIPELINE ACTIVE`;

  try {
    appendTerminalLog({ timestamp: new Date(), type: "info", message: "Manual pipeline run request dispatched..." });
    const res = await fetch('/api/pipeline/run', { method: 'POST' });
    const data = await res.json();
    
    appendTerminalLog({ timestamp: new Date(), type: "info", message: data.message });

    // Poll status updates
    setTimeout(updateDashboardData, 1500);

  } catch (e) {
    appendTerminalLog({ timestamp: new Date(), type: "error", message: `Pipeline failed: ${e.message}` });
  } finally {
    setTimeout(() => {
      runBtn.disabled = false;
      runBtn.innerHTML = `<i class="fa-solid fa-play"></i> RUN NEWS PIPELINE`;
    }, 4000);
  }
}

// Trigger Manual Analytics refresh
async function triggerAnalyticsRefresh() {
  const statsBtn = document.getElementById('btn-refresh-analytics');
  statsBtn.disabled = true;
  
  try {
    appendTerminalLog({ timestamp: new Date(), type: "info", message: "Refreshing performance stats..." });
    const res = await fetch('/api/pipeline/analytics', { method: 'POST' });
    const data = await res.json();
    
    appendTerminalLog({ timestamp: new Date(), type: "success", message: data.message });
    updateDashboardData();
  } catch (e) {
    appendTerminalLog({ timestamp: new Date(), type: "error", message: `Stats refresh failed: ${e.message}` });
  } finally {
    statsBtn.disabled = false;
  }
}

// Initialize listeners and setup
document.addEventListener("DOMContentLoaded", () => {
  // Setup Socket connection
  initWebSocket();

  // Load first load updates
  updateDashboardData();
  
  // Refresh stats periodically
  setInterval(updateDashboardData, 10000);

  // Category filter click bindings
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      fetchNewsFeed();
    });
  });

  // Preview vector vs image tabs
  document.getElementById('view-svg-tab').addEventListener('click', (e) => {
    document.querySelectorAll('.preview-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentPreviewMode = "svg";
    const post = allPosts.find(p => p.id === activePostId);
    if (post) renderPreview(post);
  });

  document.getElementById('view-png-tab').addEventListener('click', (e) => {
    document.querySelectorAll('.preview-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentPreviewMode = "png";
    const post = allPosts.find(p => p.id === activePostId);
    if (post) renderPreview(post);
  });

  // Buttons Bindings
  document.getElementById('btn-run-pipeline').addEventListener('click', triggerPipelineRun);
  document.getElementById('btn-refresh-analytics').addEventListener('click', triggerAnalyticsRefresh);
  document.getElementById('btn-save-post').addEventListener('click', savePostEdits);
  
  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    document.getElementById('terminal-log-viewer').innerHTML = "";
    appendTerminalLog({ timestamp: new Date(), type: "system", message: "Terminal logs cleared locally." });
  });

  // Manual publish queue
  document.getElementById('btn-publish-queue').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/pipeline/publish', { method: 'POST' });
      const data = await res.json();
      appendTerminalLog({ timestamp: new Date(), type: "info", message: data.message });
      setTimeout(updateDashboardData, 1000);
    } catch (e) {}
  });
});
