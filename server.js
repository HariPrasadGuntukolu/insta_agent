require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");

const NewsCollector = require("./services/news_collector");
const FactVerifier = require("./services/fact_verifier");
const ScoringEngine = require("./services/scoring_engine");
const PostGenerator = require("./services/post_generator");
const Copywriter = require("./services/copywriter");
const Publisher = require("./services/publisher");
const AnalyticsTracker = require("./services/analytics_tracker");
const Optimizer = require("./services/optimizer");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const configPath = path.join(__dirname, "config.json");
const logsFile = path.join(__dirname, "database/logs.json");
const schedulerStateFile = path.join(
  __dirname,
  "database/scheduler_state.json",
);

// ─── Load Schedule Config dynamically from config.json ───────────────────────
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const collectTime = config.pipeline_schedule?.news_collect_time || "18:00";
const publishTime = config.pipeline_schedule?.publish_time || "19:00";

const [collectHour, collectMinute] = collectTime.split(":").map(Number);
const [publishHour, publishMinute] = publishTime.split(":").map(Number);

// ─── Timezone & Date Utilities ────────────────────────────────────────────────
function getTodayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // "YYYY-MM-DD"
}

function getCurrentHourIST() {
  return parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );
}

function getCurrentMinuteIST() {
  return parseInt(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kolkata",
      minute: "2-digit",
    }),
    10,
  );
}

function getCurrentISTDateTime() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
}

function getTargetISTDateTime(timeStr) {
  const today = getTodayIST();
  return new Date(`${today}T${timeStr}:00.000+05:30`);
}

function getISTTimeString() {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
}

// ─── Persistent Scheduler State ──────────────────────────────────────────────
function loadSchedulerState() {
  try {
    if (fs.existsSync(schedulerStateFile)) {
      return JSON.parse(fs.readFileSync(schedulerStateFile, "utf8"));
    }
  } catch (e) {
    logSystem(
      "warning",
      `[Scheduler] Could not read scheduler state: ${e.message}`,
    );
  }
  return {
    lastHarvestDate: null,
    lastHarvestTimestamp: null,
    lastHarvestStatus: null,
    lastPublishDate: null,
    lastPublishTimestamp: null,
    lastPublishStatus: null,
  };
}

function saveSchedulerState(updates) {
  try {
    const current = loadSchedulerState();
    const updated = { ...current, ...updates };
    fs.writeFileSync(
      schedulerStateFile,
      JSON.stringify(updated, null, 2),
      "utf8",
    );
    return updated;
  } catch (e) {
    logSystem(
      "error",
      `[Scheduler] Failed to save scheduler state: ${e.message}`,
    );
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Global State ─────────────────────────────────────────────────────────────
let activePipelineRun = false;
let systemRecommendations = [];

// ─── Custom Real-Time Logger ──────────────────────────────────────────────────
function logSystem(type, message) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    istTime: getISTTimeString(),
    type: type.toLowerCase(), // "info" | "warning" | "success" | "error"
    message: message,
  };

  // 1. Log to console
  const colors = {
    info: "\x1b[36m[INFO]\x1b[0m",
    success: "\x1b[32m[SUCCESS]\x1b[0m",
    warning: "\x1b[33m[WARN]\x1b[0m",
    error: "\x1b[31m[ERROR]\x1b[0m",
  };
  console.log(
    `${colors[logEntry.type] || "[INFO]"} [IST: ${logEntry.istTime}] ${message}`,
  );

  // 2. Append to database/logs.json
  try {
    let logs = [];
    if (fs.existsSync(logsFile)) {
      logs = JSON.parse(fs.readFileSync(logsFile, "utf8"));
    }
    logs.push(logEntry);
    if (logs.length > 500) logs.shift(); // limit logs
    fs.writeFileSync(logsFile, JSON.stringify(logs, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to write to logs.json:", e.message);
  }

  // 3. Broadcast to all connected WebSocket clients
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(logEntry));
    }
  });
}

// ─── Instantiate Services ─────────────────────────────────────────────────────
const newsCollector = new NewsCollector(configPath);
const factVerifier = new FactVerifier(configPath);
const scoringEngine = new ScoringEngine(configPath);
const postGenerator = new PostGenerator(configPath);
const copywriter = new Copywriter(configPath);
const publisher = new Publisher(configPath);
const analyticsTracker = new AnalyticsTracker(configPath);
const optimizer = new Optimizer(configPath);

// ─── WebSocket Connection Handler ─────────────────────────────────────────────
wss.on("connection", (ws) => {
  logSystem("info", "New dashboard connection established.");

  // Stream last 50 logs immediately on connect
  if (fs.existsSync(logsFile)) {
    try {
      const logs = JSON.parse(fs.readFileSync(logsFile, "utf8"));
      logs.slice(-50).forEach((log) => ws.send(JSON.stringify(log)));
    } catch (e) {}
  }

  ws.on("close", () => {
    console.log("Dashboard connection closed.");
  });
});

// ─── Database Helper: Append/Update generated post with harvestDate ───────────
function savePostToDb(post) {
  const postsFile = path.join(__dirname, "database/generated_posts.json");
  let posts = [];
  if (fs.existsSync(postsFile)) {
    posts = JSON.parse(fs.readFileSync(postsFile, "utf8"));
  }

  // ── FIX: Check if a post with same ID already exists AND is from today ──
  const todayIST = getTodayIST();
  const index = posts.findIndex((p) => p.id === post.id);

  if (index !== -1) {
    // If it exists from a DIFFERENT day, it's a different day's run with a recycled ID
    // (shouldn't happen with date-seeded IDs, but guard anyway)
    if (posts[index].harvestDate && posts[index].harvestDate !== todayIST) {
      logSystem(
        "warning",
        `[DB] Post ID collision across days detected for "${post.title}". Overwriting with today's version.`,
      );
    }
    posts[index] = post;
  } else {
    posts.push(post);
  }

  fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2), "utf8");
}

// ─── Pipeline Retry Wrapper ───────────────────────────────────────────────────
async function runWithRetry(fn, label, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logSystem("info", `[Retry] ${label} — attempt ${attempt}/${maxAttempts}`);
      await fn();
      return true; // success
    } catch (err) {
      logSystem(
        "error",
        `[Retry] ${label} attempt ${attempt} failed: ${err.message}`,
      );
      if (attempt < maxAttempts) {
        const waitSec = 30 * attempt;
        logSystem("info", `[Retry] Waiting ${waitSec}s before next attempt...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
      }
    }
  }
  logSystem(
    "error",
    `[Retry] ${label} — all ${maxAttempts} attempts exhausted. Giving up.`,
  );
  return false;
}

// ─── CORE PIPELINE WORKFLOW EXECUTION ────────────────────────────────────────
async function runDailyPipeline() {
  if (activePipelineRun) {
    logSystem(
      "warning",
      "Pipeline run is already in progress. Skipping duplicate trigger.",
    );
    return;
  }

  activePipelineRun = true;
  const todayIST = getTodayIST();
  const simulationMode = process.env.SIMULATION_MODE !== "false";

  logSystem("info", `=== Starting Global News Pipeline ===`);
  logSystem("info", `[Pipeline] Date (IST): ${todayIST}`);
  logSystem("info", `[Pipeline] Server IST time: ${getISTTimeString()}`);
  logSystem("info", `[Pipeline] Simulation mode: ${simulationMode}`);

  try {
    // ── FIX: Expire yesterday's queue items before generating new ones ──
    logSystem(
      "info",
      "[Pipeline] Expiring stale queue items from previous days...",
    );
    publisher.expireStaleQueueItems((m) => logSystem("info", m));

    // Phase 1: Ingestion
    logSystem("info", "Phase 1: Aggregating global news feeds...");
    const rawNews = await newsCollector.collectAll(simulationMode, (m) =>
      logSystem("info", m),
    );
    logSystem("info", `[Pipeline] News fetched: ${rawNews.length} stories`);

    // Phase 2: Verification
    logSystem("info", "Phase 2: Fact-verifying source events...");
    const verifiedNews = factVerifier.verifyAll(rawNews, (m) =>
      logSystem("info", m),
    );
    logSystem("info", `[Pipeline] Verified stories: ${verifiedNews.length}`);

    // Phase 3: Scoring
    logSystem("info", "Phase 3: Running virality scoring engine...");
    const optimization = optimizer.optimizeWeights((m) => logSystem("info", m));
    systemRecommendations = optimization.recommendations;
    const adjustedWeights = optimization.adjustedWeights;
    const scoredNews = scoringEngine.scoreAndRank(
      verifiedNews,
      adjustedWeights,
      (m) => logSystem("info", m),
    );

    // Phase 4: Selection
    logSystem("info", "Phase 4: Selecting daily top 10 content mix...");
    const top10 = scoringEngine.selectDailyTop10(scoredNews, (m) =>
      logSystem("info", m),
    );

    if (top10.length === 0) {
      throw new Error("No news stories satisfied the selection criteria.");
    }
    logSystem(
      "info",
      `[Pipeline] Selected ${top10.length} top stories for today.`,
    );

    // Phase 5: Copywriting & Visual Generation
    logSystem("info", "Phase 5: Generating visual posts and copywriting...");
    const finalPosts = [];

    for (let i = 0; i < top10.length; i++) {
      const story = top10[i];

      // Introduce pacing delay (6 seconds) between stories to stay within Gemini RPM limits
      if (i > 0 && copywriter.aiEnabled) {
        logSystem("info", `[Pipeline] Pacing Gemini requests: waiting 6s...`);
        await new Promise((r) => setTimeout(r, 6000));
      }

      logSystem(
        "info",
        `[Pipeline] Processing story [${i + 1}/${top10.length}]: "${story.title}"`,
      );

      const copy = await copywriter.generateCaptionAndHashtags(story, (m) =>
        logSystem("info", m),
      );
      const validation = await copywriter.verifySummary(
        story,
        copy.summary,
        (m) => logSystem("info", m),
      );

      const postWithCopy = {
        ...story,
        description: validation.summary,
        caption: copy.caption,
        hashtags: copy.hashtags,
        harvestDate: todayIST, // ── FIX: Always stamp with today's IST date ──
        generatedAt: new Date().toISOString(),
        status: "scheduled",
      };

      // Render image post
      const assets = await postGenerator.createPost(postWithCopy);

      const completePost = {
        ...postWithCopy,
        svgPath: assets.svgPath,
        pngPath: assets.pngPath,
      };

      finalPosts.push(completePost);

      // Save to generated posts database
      savePostToDb(completePost);
      logSystem(
        "info",
        `[Pipeline] Post saved: "${completePost.title}" (harvestDate: ${todayIST})`,
      );

      // Add to scheduling queue for configured publish time today
      const todayPublishTime = new Date();
      todayPublishTime.setHours(publishHour, publishMinute, 0, 0);
      publisher.addToQueue(completePost, todayPublishTime.toISOString(), (m) =>
        logSystem("info", m),
      );
    }

    logSystem(
      "success",
      `=== Pipeline Complete. Generated and queued ${finalPosts.length} posts for ${todayIST}. ===`,
    );

    // ── FIX: Save successful harvest state ──
    saveSchedulerState({
      lastHarvestDate: todayIST,
      lastHarvestTimestamp: new Date().toISOString(),
      lastHarvestStatus: "success",
    });
  } catch (error) {
    logSystem("error", `[Pipeline] Pipeline failed: ${error.message}`);
    saveSchedulerState({
      lastHarvestDate: todayIST,
      lastHarvestTimestamp: new Date().toISOString(),
      lastHarvestStatus: `failed: ${error.message}`,
    });
  } finally {
    activePipelineRun = false;
  }
}

// ─── Publishing Queue Processor ───────────────────────────────────────────────
async function processPublishingQueue(specificPostId = null) {
  const todayIST = getTodayIST();
  logSystem(
    "info",
    `[Scheduler] Processing daily publishing queue for ${todayIST}...`,
  );
  const simulationMode = process.env.SIMULATION_MODE !== "false";

  const queue = publisher.loadQueue();

  // ── FIX: Only publish items with today's harvestDate ──
  let pendingItems = [];
  if (specificPostId) {
    pendingItems = queue.filter((item) => item.id === specificPostId);
  } else {
    pendingItems = queue.filter((item) => {
      const isScheduledOrFailed =
        item.status === "scheduled" || item.status === "failed";
      const isToday = !item.harvestDate || item.harvestDate === todayIST;
      return isScheduledOrFailed && isToday;
    });
  }

  if (pendingItems.length === 0) {
    logSystem(
      "info",
      `[Scheduler] No pending posts for today (${todayIST}) in publishing queue.`,
    );
    return;
  }

  logSystem(
    "info",
    `[Scheduler] Found ${pendingItems.length} pending post(s) to publish for ${todayIST}.`,
  );

  let publishedCount = 0;
  let failedCount = 0;

  for (const item of pendingItems) {
    try {
      const result = await publisher.publishItem(item, simulationMode, (m) =>
        logSystem("info", m),
      );
      if (result !== null) {
        publishedCount++;
        logSystem(
          "success",
          `[Scheduler] Published: "${item.title}" — Media ID: ${result}`,
        );
      }
    } catch (e) {
      failedCount++;
      logSystem(
        "error",
        `[Scheduler] Failed to publish post "${item.title}": ${e.message}`,
      );
    }
  }

  logSystem(
    "success",
    `[Scheduler] Publishing run complete. Published: ${publishedCount}, Failed: ${failedCount}.`,
  );

  // ── FIX: Save successful publish state ──
  saveSchedulerState({
    lastPublishDate: todayIST,
    lastPublishTimestamp: new Date().toISOString(),
    lastPublishStatus: `published:${publishedCount} failed:${failedCount}`,
  });

  // After publishing, trigger analytics refresh
  setTimeout(async () => {
    try {
      await analyticsTracker.updateAnalytics(simulationMode, (m) =>
        logSystem("info", m),
      );
    } catch (e) {
      logSystem("error", `[Scheduler] Analytics update failed: ${e.message}`);
    }
  }, 5000);
}

// ─── AUTOMATED CRON SCHEDULER ─────────────────────────────────────────────────
// ── FIX: Always pass explicit timezone to node-cron (not relying on process TZ) ──

// Harvest & Generation — daily at configured time in IST
cron.schedule(
  `${collectMinute} ${collectHour} * * *`,
  () => {
    const todayIST = getTodayIST();
    logSystem(
      "info",
      `[Cron] Harvest job triggered at ${getISTTimeString()} IST for date ${todayIST}.`,
    );
    runWithRetry(runDailyPipeline, "Daily News Harvest", 3);
  },
  {
    timezone: "Asia/Kolkata", // ── FIX: Explicit IST timezone ──
  },
);

// Publishing Queue — daily at configured time in IST
cron.schedule(
  `${publishMinute} ${publishHour} * * *`,
  () => {
    const todayIST = getTodayIST();
    logSystem(
      "info",
      `[Cron] Publishing job triggered at ${getISTTimeString()} IST for date ${todayIST}.`,
    );
    processPublishingQueue();
  },
  {
    timezone: "Asia/Kolkata", // ── FIX: Explicit IST timezone ──
  },
);

// ─── KEEP-ALIVE SELF-PING ─────────────────────────────────────────────────────
// Prevent Render Free Tier from sleeping by pinging /api/status every 14 minutes.
cron.schedule("*/14 * * * *", () => {
  const pingUrl = `http://localhost:${PORT}/api/status`;
  try {
    const httpClient = require("http");
    httpClient
      .get(pingUrl, (res) => {
        logSystem(
          "info",
          `[Keep-Alive] Self-ping successful. Status: ${res.statusCode}`,
        );
      })
      .on("error", (e) => {
        logSystem("warning", `[Keep-Alive] Self-ping failed: ${e.message}`);
      });
  } catch (e) {
    logSystem("warning", `[Keep-Alive] Self-ping error: ${e.message}`);
  }
});

// ─── REST API ENDPOINTS FOR DASHBOARD ────────────────────────────────────────
// Get system status
app.get("/api/status", (req, res) => {
  const simulationMode = process.env.SIMULATION_MODE !== "false";
  const queue = publisher.loadQueue();
  const todayIST = getTodayIST();
  const pendingCount = queue.filter(
    (q) =>
      q.status === "scheduled" &&
      (!q.harvestDate || q.harvestDate === todayIST),
  ).length;
  const publishedCount = queue.filter((q) => q.status === "published").length;
  const expiredCount = queue.filter((q) => q.status === "expired").length;
  const schedulerState = loadSchedulerState();

  res.json({
    status: "active",
    simulationMode,
    activePipelineRun,
    todayIST,
    istTime: getISTTimeString(),
    pendingQueueCount: pendingCount,
    publishedCount,
    expiredCount,
    nextHarvestTime: `${collectTime} IST Daily`,
    nextPublishTime: `${publishTime} IST Daily`,
    envValid: !!(
      process.env.INSTAGRAM_ACCOUNT_ID && process.env.INSTAGRAM_ACCESS_TOKEN
    ),
    schedulerState,
  });
});

// Get raw news feed cache
app.get("/api/news", (req, res) => {
  const newsCacheFile = path.join(__dirname, "database/news_cache.json");
  if (fs.existsSync(newsCacheFile)) {
    return res.json(JSON.parse(fs.readFileSync(newsCacheFile, "utf8")));
  }
  res.json([]);
});

// Get daily generated posts list (optionally filter by today only)
app.get("/api/posts", (req, res) => {
  const postsFile = path.join(__dirname, "database/generated_posts.json");
  if (fs.existsSync(postsFile)) {
    let posts = JSON.parse(fs.readFileSync(postsFile, "utf8"));
    if (req.query.today === "true") {
      const todayIST = getTodayIST();
      posts = posts.filter((p) => p.harvestDate === todayIST);
    }
    return res.json(posts);
  }
  res.json([]);
});

// Get publishing queue details
app.get("/api/queue", (req, res) => {
  res.json(publisher.loadQueue());
});

// Get analytics stats
app.get("/api/analytics", (req, res) => {
  res.json(analyticsTracker.loadAnalytics());
});

// Get optimizer recommendations
app.get("/api/recommendations", (req, res) => {
  if (systemRecommendations.length === 0) {
    const optimization = optimizer.optimizeWeights(() => {});
    systemRecommendations = optimization.recommendations;
  }
  res.json(systemRecommendations);
});

// Get last system logs
app.get("/api/logs", (req, res) => {
  if (fs.existsSync(logsFile)) {
    return res.json(JSON.parse(fs.readFileSync(logsFile, "utf8")));
  }
  res.json([]);
});

// Get scheduler state
app.get("/api/scheduler/state", (req, res) => {
  res.json(loadSchedulerState());
});

// Manually trigger the pipeline
app.post("/api/pipeline/run", (req, res) => {
  if (activePipelineRun) {
    return res.status(409).json({ error: "Pipeline is already running." });
  }
  runWithRetry(runDailyPipeline, "Manual Pipeline Trigger", 3);
  res.json({
    message: "News Ingestion and Generation pipeline manually triggered.",
  });
});

// Manually trigger publishing queue or single post
app.post("/api/pipeline/publish", async (req, res) => {
  const { postId } = req.body || {};

  if (postId) {
    try {
      await processPublishingQueue(postId);
      res.json({
        message: `Post publishing process manually triggered for post: ${postId}`,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  } else {
    processPublishingQueue();
    res.json({ message: "Queue publishing process manually triggered." });
  }
});

// Manually trigger analytics updates
app.post("/api/pipeline/analytics", async (req, res) => {
  const simulationMode = process.env.SIMULATION_MODE !== "false";
  try {
    const stats = await analyticsTracker.updateAnalytics(simulationMode, (m) =>
      logSystem("info", m),
    );
    res.json({ message: "Analytics updated successfully.", stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Edit a generated post (title, description, caption, hashtags)
app.post("/api/posts/edit", async (req, res) => {
  const { id, title, description, caption, hashtags } = req.body;

  // Input Security Validation
  if (!id || typeof id !== "string" || id.trim() === "") {
    return res.status(400).json({ error: "Invalid or missing post ID." });
  }
  if (title && typeof title !== "string") {
    return res.status(400).json({ error: "Title must be a valid string." });
  }
  if (description && typeof description !== "string") {
    return res
      .status(400)
      .json({ error: "Description must be a valid string." });
  }
  if (caption && typeof caption !== "string") {
    return res.status(400).json({ error: "Caption must be a valid string." });
  }
  if (hashtags && typeof hashtags !== "string") {
    return res.status(400).json({ error: "Hashtags must be a valid string." });
  }

  const postsFile = path.join(__dirname, "database/generated_posts.json");

  if (!fs.existsSync(postsFile)) {
    return res.status(404).json({ error: "Posts database not found." });
  }

  const posts = JSON.parse(fs.readFileSync(postsFile, "utf8"));
  const idx = posts.findIndex((p) => p.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: "Post not found." });
  }

  // Update text fields
  posts[idx].title = title || posts[idx].title;
  posts[idx].description = description || posts[idx].description;
  posts[idx].caption = caption || posts[idx].caption;
  posts[idx].hashtags = hashtags || posts[idx].hashtags;

  // Re-generate SVG and PNG image assets because title/desc changed
  try {
    if (description) {
      const validation = await copywriter.verifySummary(
        posts[idx],
        posts[idx].description,
        (m) => logSystem("info", m),
      );
      posts[idx].description = validation.summary;
    }

    const assets = await postGenerator.createPost(posts[idx]);
    posts[idx].svgPath = assets.svgPath;
    posts[idx].pngPath = assets.pngPath;
    posts[idx].lastEditedAt = new Date().toISOString();

    // Write back to DB
    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2), "utf8");

    // Also update queue if post is scheduled
    const queue = publisher.loadQueue();
    const qIdx = queue.findIndex((q) => q.id === id);
    if (qIdx !== -1) {
      queue[qIdx].title = posts[idx].title;
      queue[qIdx].caption = posts[idx].caption;
      queue[qIdx].hashtags = posts[idx].hashtags;
      queue[qIdx].pngPath = posts[idx].pngPath;
      publisher.saveQueue(queue);
    }

    logSystem(
      "success",
      `Post "${posts[idx].title}" edited manually. Visual assets re-rendered.`,
    );
    res.json({
      message: "Post edited and visual assets updated successfully.",
      post: posts[idx],
    });
  } catch (e) {
    logSystem("error", `Failed to re-render post assets: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// Serve frontend assets
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  logSystem(
    "success",
    `=== Global News Media Automation Server Running on Port ${PORT} ===`,
  );
  logSystem("info", `[Startup] Timezone: Asia/Kolkata (IST)`);
  logSystem("info", `[Startup] Server IST time: ${getISTTimeString()}`);
  logSystem("info", `[Startup] Today (IST): ${getTodayIST()}`);
  logSystem(
    "info",
    `[Startup] Simulation mode: ${process.env.SIMULATION_MODE !== "false"}`,
  );
  logSystem(
    "info",
    `[Startup] Harvest cron: ${collectTime} IST daily (node-cron timezone: Asia/Kolkata)`,
  );
  logSystem(
    "info",
    `[Startup] Publish cron:  ${publishTime} IST daily (node-cron timezone: Asia/Kolkata)`,
  );
  logSystem("info", `[Startup] Keep-alive ping: every 14 minutes`);

  // ── Load and display scheduler state ──────────────────────────────────────
  const state = loadSchedulerState();
  logSystem(
    "info",
    `[Startup] Last harvest: ${state.lastHarvestDate || "Never"} — ${state.lastHarvestStatus || "N/A"}`,
  );
  logSystem(
    "info",
    `[Startup] Last publish: ${state.lastPublishDate || "Never"} — ${state.lastPublishStatus || "N/A"}`,
  );

  // ── FIX: Missed-Job Recovery Logic ──────────────────────────────────────
  const todayIST = getTodayIST();
  const currentISTDateTime = getCurrentISTDateTime();
  const targetHarvestDateTime = getTargetISTDateTime(collectTime);
  const targetPublishDateTime = getTargetISTDateTime(publishTime);

  const harvestMissed = state.lastHarvestDate !== todayIST;
  const publishMissed = state.lastPublishDate !== todayIST;

  if (harvestMissed && currentISTDateTime >= targetHarvestDateTime) {
    logSystem(
      "warning",
      `[Startup Recovery] Harvest was MISSED for today (${todayIST}). Last ran: ${state.lastHarvestDate || "Never"}. Triggering now...`,
    );
    setTimeout(() => {
      runWithRetry(runDailyPipeline, "Startup Recovery — Daily Harvest", 3);
    }, 5000);
  } else if (harvestMissed) {
    logSystem(
      "info",
      `[Startup Recovery] No harvest yet today (${todayIST}) — harvest window (${collectTime} IST) not reached yet. Cron is registered and will fire on time.`,
    );
  } else {
    logSystem(
      "success",
      `[Startup Recovery] Harvest already completed for today (${todayIST}). No recovery needed.`,
    );
  }

  if (publishMissed && currentISTDateTime >= targetPublishDateTime) {
    if (harvestMissed) {
      logSystem(
        "warning",
        `[Startup Recovery] Publish window was also missed for today (${todayIST}). Will process queue after harvest recovery completes.`,
      );
      setTimeout(() => {
        processPublishingQueue();
      }, 20000);
    } else {
      logSystem(
        "warning",
        `[Startup Recovery] Publish job was MISSED for today (${todayIST}). Triggering now...`,
      );
      setTimeout(() => {
        processPublishingQueue();
      }, 8000);
    }
  } else if (publishMissed) {
    logSystem(
      "info",
      `[Startup Recovery] Publish window (${publishTime} IST) not yet reached. Cron will fire on time.`,
    );
  } else {
    logSystem(
      "success",
      `[Startup Recovery] Publish already completed for today (${todayIST}). No recovery needed.`,
    );
  }
});
