require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const NewsCollector = require('./services/news_collector');
const FactVerifier = require('./services/fact_verifier');
const ScoringEngine = require('./services/scoring_engine');
const PostGenerator = require('./services/post_generator');
const Copywriter = require('./services/copywriter');
const Publisher = require('./services/publisher');
const AnalyticsTracker = require('./services/analytics_tracker');
const Optimizer = require('./services/optimizer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const configPath = path.join(__dirname, 'config.json');
const logsFile = path.join(__dirname, 'database/logs.json');

// Load Schedule Config dynamically from config.json
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const collectTime = config.pipeline_schedule?.news_collect_time || "06:00";
const publishTime = config.pipeline_schedule?.publish_time || "19:00";

const [collectHour, collectMinute] = collectTime.split(':').map(Number);
const [publishHour, publishMinute] = publishTime.split(':').map(Number);


// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state variables
let activePipelineRun = false;
let systemRecommendations = [];

// Custom real-time Logger
function logSystem(type, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    type: type.toLowerCase(), // "info" | "warning" | "success" | "error"
    message: message
  };

  // 1. Log to console
  const colors = {
    info: "\x1b[36m[INFO]\x1b[0m",
    success: "\x1b[32m[SUCCESS]\x1b[0m",
    warning: "\x1b[33m[WARN]\x1b[0m",
    error: "\x1b[31m[ERROR]\x1b[0m"
  };
  console.log(`${colors[logEntry.type] || "[INFO]"} ${message}`);

  // 2. Append to database/logs.json
  try {
    let logs = [];
    if (fs.existsSync(logsFile)) {
      logs = JSON.parse(fs.readFileSync(logsFile, 'utf8'));
    }
    logs.push(logEntry);
    if (logs.length > 300) logs.shift(); // limit logs
    fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2), 'utf8');
  } catch (e) {
    console.error("Failed to write to logs.json:", e.message);
  }

  // 3. Broadcast to all connected WebSocket clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(logEntry));
    }
  });
}

// Instantiate Services
const newsCollector = new NewsCollector(configPath);
const factVerifier = new FactVerifier(configPath);
const scoringEngine = new ScoringEngine(configPath);
const postGenerator = new PostGenerator(configPath);
const copywriter = new Copywriter(configPath);
const publisher = new Publisher(configPath);
const analyticsTracker = new AnalyticsTracker(configPath);
const optimizer = new Optimizer(configPath);

// WebSocket connection handler
wss.on('connection', (ws) => {
  logSystem("info", "New dashboard connection established.");
  
  // Stream last 50 logs immediately on connect
  if (fs.existsSync(logsFile)) {
    try {
      const logs = JSON.parse(fs.readFileSync(logsFile, 'utf8'));
      logs.slice(-50).forEach(log => ws.send(JSON.stringify(log)));
    } catch (e) {}
  }

  ws.on('close', () => {
    console.log("Dashboard connection closed.");
  });
});

// CORE PIPELINE WORKFLOW EXECUTION
async function runDailyPipeline() {
  if (activePipelineRun) {
    logSystem("warning", "Pipeline run is already in progress.");
    return;
  }
  activePipelineRun = true;
  logSystem("info", "=== Starting Global News Pipeline ===");
  const simulationMode = process.env.SIMULATION_MODE !== "false";

  try {
    // Phase 1: Ingestion (06:00 AM Task)
    logSystem("info", "Phase 1: Aggregating global news feeds...");
    const rawNews = await newsCollector.collectAll(simulationMode, (m) => logSystem("info", m));

    // Phase 2: Verification (06:30 AM Task)
    logSystem("info", "Phase 2: Fact-verifying source events...");
    const verifiedNews = factVerifier.verifyAll(rawNews, (m) => logSystem("info", m));

    // Phase 3: Scoring (06:45 AM Task)
    logSystem("info", "Phase 3: Running virality scoring engine...");
    
    // Check self-optimization adjustments first
    const optimization = optimizer.optimizeWeights((m) => logSystem("info", m));
    systemRecommendations = optimization.recommendations;
    const adjustedWeights = optimization.adjustedWeights;

    const scoredNews = scoringEngine.scoreAndRank(verifiedNews, adjustedWeights, (m) => logSystem("info", m));

    // Phase 4: Selection (07:00 AM Task)
    logSystem("info", "Phase 4: Selecting daily top 10 content mix...");
    const top10 = scoringEngine.selectDailyTop10(scoredNews, (m) => logSystem("info", m));

    if (top10.length === 0) {
      throw new Error("No news stories satisfied the selection criteria.");
    }

    // Phase 5: Copywriting & Visual Generation (07:15 AM - 08:30 AM Tasks)
    logSystem("info", "Phase 5: Generating visual posts and copywriting copy...");
    const finalPosts = [];

    for (let i = 0; i < top10.length; i++) {
      const story = top10[i];
      logSystem("info", `Processing story [${i+1}/10]: "${story.title}"`);

      // Write caption & hashtags
      const copy = await copywriter.generateCaptionAndHashtags(story, (m) => logSystem("info", m));
      const postWithCopy = {
        ...story,
        caption: copy.caption,
        hashtags: copy.hashtags,
        status: "scheduled"
      };

      // Render image post
      const assets = await postGenerator.createPost(postWithCopy);
      
      const completePost = {
        ...postWithCopy,
        svgPath: assets.svgPath,
        pngPath: assets.pngPath
      };

      finalPosts.push(completePost);

      // Save to generated posts database
      savePostToDb(completePost);

      // Add to scheduling queue (scheduled for configured publish time today)
      const todayPublishTime = new Date();
      todayPublishTime.setHours(publishHour, publishMinute, 0, 0);
      publisher.addToQueue(completePost, todayPublishTime.toISOString(), (m) => logSystem("info", m));
    }

    logSystem("success", `=== Pipeline Complete. Generated and queued ${finalPosts.length} posts. ===`);

  } catch (error) {
    logSystem("error", `Pipeline failed: ${error.message}`);
  } finally {
    activePipelineRun = false;
  }
}

// Database helper: Append/Update generated post
function savePostToDb(post) {
  const postsFile = path.join(__dirname, 'database/generated_posts.json');
  let posts = [];
  if (fs.existsSync(postsFile)) {
    posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
  }
  const index = posts.findIndex(p => p.id === post.id);
  if (index !== -1) {
    posts[index] = post;
  } else {
    posts.push(post);
  }
  fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2), 'utf8');
}

// AUTOMATED CRON SCHEDULER
// Ingestion & Generation pipeline scheduled daily
cron.schedule(`${collectMinute} ${collectHour} * * *`, () => {
  logSystem("info", `[Scheduler] Triggering daily news harvest (${collectTime})...`);
  runDailyPipeline();
});

// Publishing Queue processing scheduled daily
async function processPublishingQueue(specificPostId = null) {
  logSystem("info", `[Scheduler] Processing daily publishing queue (${publishTime})...`);
  const simulationMode = process.env.SIMULATION_MODE !== "false";
  
  const queue = publisher.loadQueue();
  const now = new Date();
  
  // Find scheduled items whose time has come (or manually triggered)
  let pendingItems = [];
  if (specificPostId) {
    pendingItems = queue.filter(item => item.id === specificPostId);
  } else {
    pendingItems = queue.filter(item => item.status === "scheduled" || item.status === "failed");
  }

  if (pendingItems.length === 0) {
    logSystem("info", "[Scheduler] No pending posts scheduled for publishing.");
    return;
  }

  logSystem("info", `[Scheduler] Found ${pendingItems.length} pending posts to publish.`);

  for (const item of pendingItems) {
    try {
      await publisher.publishItem(item, simulationMode, (m) => logSystem("info", m));
    } catch (e) {
      logSystem("error", `[Scheduler] Failed to publish post: ${e.message}`);
    }
  }

  // After publishing, trigger analytics refresh
  setTimeout(async () => {
    try {
      await analyticsTracker.updateAnalytics(simulationMode, (m) => logSystem("info", m));
    } catch (e) {
      logSystem("error", `[Scheduler] Analytics update failed: ${e.message}`);
    }
  }, 5000);
}

cron.schedule(`${publishMinute} ${publishHour} * * *`, () => {
  processPublishingQueue();
});

// REST API ENDPOINTS FOR DASHBOARD
// Get system status
app.get('/api/status', (req, res) => {
  const simulationMode = process.env.SIMULATION_MODE !== "false";
  const queue = publisher.loadQueue();
  const pendingCount = queue.filter(q => q.status === "scheduled").length;
  const publishedCount = queue.filter(q => q.status === "published").length;
  
  res.json({
    status: "active",
    simulationMode,
    activePipelineRun,
    pendingQueueCount: pendingCount,
    publishedCount: publishedCount,
    nextPublishTime: `${publishTime} Daily`,
    envValid: !!(process.env.INSTAGRAM_ACCOUNT_ID && process.env.INSTAGRAM_ACCESS_TOKEN)
  });
});

// Get raw news feed cache
app.get('/api/news', (req, res) => {
  const newsCacheFile = path.join(__dirname, 'database/news_cache.json');
  if (fs.existsSync(newsCacheFile)) {
    return res.json(JSON.parse(fs.readFileSync(newsCacheFile, 'utf8')));
  }
  res.json([]);
});

// Get daily generated posts list
app.get('/api/posts', (req, res) => {
  const postsFile = path.join(__dirname, 'database/generated_posts.json');
  if (fs.existsSync(postsFile)) {
    return res.json(JSON.parse(fs.readFileSync(postsFile, 'utf8')));
  }
  res.json([]);
});

// Get publishing queue details
app.get('/api/queue', (req, res) => {
  res.json(publisher.loadQueue());
});

// Get analytics stats
app.get('/api/analytics', (req, res) => {
  res.json(analyticsTracker.loadAnalytics());
});

// Get optimizer recommendations
app.get('/api/recommendations', (req, res) => {
  // If recommendations list is empty, call optimize weights to generate them dynamically
  if (systemRecommendations.length === 0) {
    const optimization = optimizer.optimizeWeights(() => {});
    systemRecommendations = optimization.recommendations;
  }
  res.json(systemRecommendations);
});

// Get last system logs
app.get('/api/logs', (req, res) => {
  if (fs.existsSync(logsFile)) {
    return res.json(JSON.parse(fs.readFileSync(logsFile, 'utf8')));
  }
  res.json([]);
});

// Manually trigger the pipeline
app.post('/api/pipeline/run', (req, res) => {
  if (activePipelineRun) {
    return res.status(409).json({ error: "Pipeline is already running." });
  }
  // Run asynchronously
  runDailyPipeline();
  res.json({ message: "News Ingestion and Generation pipeline manually triggered." });
});

// Manually trigger publishing queue or single post
app.post('/api/pipeline/publish', async (req, res) => {
  const { postId } = req.body || {};
  
  if (postId) {
    try {
      await processPublishingQueue(postId);
      res.json({ message: `Post publishing process manually triggered for post: ${postId}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  } else {
    processPublishingQueue();
    res.json({ message: "Queue publishing process manually triggered." });
  }
});

// Manually trigger analytics updates
app.post('/api/pipeline/analytics', async (req, res) => {
  const simulationMode = process.env.SIMULATION_MODE !== "false";
  try {
    const stats = await analyticsTracker.updateAnalytics(simulationMode, (m) => logSystem("info", m));
    res.json({ message: "Analytics updated successfully.", stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Edit a generated post (title, description, caption, hashtags)
app.post('/api/posts/edit', async (req, res) => {
  const { id, title, description, caption, hashtags } = req.body;

  // Input Security Validation
  if (!id || typeof id !== 'string' || id.trim() === '') {
    return res.status(400).json({ error: "Invalid or missing post ID." });
  }
  if (title && typeof title !== 'string') {
    return res.status(400).json({ error: "Title must be a valid string." });
  }
  if (description && typeof description !== 'string') {
    return res.status(400).json({ error: "Description must be a valid string." });
  }
  if (caption && typeof caption !== 'string') {
    return res.status(400).json({ error: "Caption must be a valid string." });
  }
  if (hashtags && typeof hashtags !== 'string') {
    return res.status(400).json({ error: "Hashtags must be a valid string." });
  }

  const postsFile = path.join(__dirname, 'database/generated_posts.json');
  
  if (!fs.existsSync(postsFile)) {
    return res.status(404).json({ error: "Posts database not found." });
  }

  const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
  const idx = posts.findIndex(p => p.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: "Post not found." });
  }

  // Update text
  posts[idx].title = title || posts[idx].title;
  posts[idx].description = description || posts[idx].description;
  posts[idx].caption = caption || posts[idx].caption;
  posts[idx].hashtags = hashtags || posts[idx].hashtags;

  // Re-generate SVG and PNG image assets because title/desc changed
  try {
    const assets = await postGenerator.createPost(posts[idx]);
    posts[idx].svgPath = assets.svgPath;
    posts[idx].pngPath = assets.pngPath;
    
    // Write back to DB
    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2), 'utf8');

    // Also update queue if post is scheduled
    const queue = publisher.loadQueue();
    const qIdx = queue.findIndex(q => q.id === id);
    if (qIdx !== -1) {
      queue[qIdx].title = posts[idx].title;
      queue[qIdx].caption = posts[idx].caption;
      queue[qIdx].hashtags = posts[idx].hashtags;
      queue[qIdx].pngPath = posts[idx].pngPath;
      publisher.saveQueue(queue);
    }

    logSystem("success", `Post "${posts[idx].title}" edited manually. Visual assets re-rendered.`);
    res.json({ message: "Post edited and visual assets updated successfully.", post: posts[idx] });
  } catch (e) {
    logSystem("error", `Failed to re-render post assets: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Serve frontend assets
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// START SERVER
server.listen(PORT, () => {
  logSystem("success", `=== Global News Media Automation Server Running on Port ${PORT} ===`);
  logSystem("info", `Simulation mode active: ${process.env.SIMULATION_MODE !== "false"}`);
  
  // Proactively run pipeline on initial startup if generated posts are empty
  const postsFile = path.join(__dirname, 'database/generated_posts.json');
  if (fs.existsSync(postsFile)) {
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    if (posts.length === 0) {
      logSystem("info", "[Startup] Empty database detected. Bootstrapping news pipeline...");
      runDailyPipeline();
    }
  }
});
