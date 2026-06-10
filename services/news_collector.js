const Parser = require("rss-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const parser = new Parser();

// ─── Utility: Get today's date string in IST (YYYY-MM-DD) ───────────────────
function getTodayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // returns "YYYY-MM-DD"
}

// ─── Utility: Check if an ISO date string is within the last 48 hours ────────
function isRecentEnough(isoDateStr) {
  if (!isoDateStr) return true; // If no date, allow it through
  try {
    const articleDate = new Date(isoDateStr);
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    return articleDate >= cutoff;
  } catch (e) {
    return true;
  }
}

class NewsCollector {
  constructor(configPath) {
    const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
    this.feeds = configData.news_sources.rss_feeds;
    this.cacheFile = path.join(__dirname, "../database/news_cache.json");
  }

  // ── Fetch real-time news from RSS feeds only ────────────────────────────────
  async collectAll(simulationMode = true, logger = console.log) {
    const todayIST = getTodayIST();
    logger(
      `[News Ingestion] Starting news collection for date: ${todayIST} (IST)...`,
    );

    // ── FIX: Clear stale cache before harvesting ────────────────────────────
    if (fs.existsSync(this.cacheFile)) {
      try {
        fs.unlinkSync(this.cacheFile);
        logger(`[News Ingestion] Cleared stale news cache.`);
      } catch (e) {
        logger(
          `[News Ingestion] [Warning] Could not clear cache: ${e.message}`,
        );
      }
    }

    let collectedItems = [];

    // 1. Fetch RSS Feeds unconditionally (not limited by simulationMode)
    for (const feed of this.feeds) {
      try {
        logger(`[News Ingestion] Fetching feed: ${feed.name}...`);
        const parsed = await parser.parseURL(feed.url);
        let feedCount = 0;
        parsed.items.forEach((item) => {
          // ── FIX: Validate RSS article date — skip items older than 48 hours ──
          if (!isRecentEnough(item.isoDate)) {
            logger(
              `[News Ingestion] Skipping stale article (>48h): "${item.title}"`,
            );
            return;
          }
          const cat = this.inferCategory(
            item.title + " " + item.contentSnippet,
          );
          // ── FIX: Include harvestDate on every item ──
          collectedItems.push({
            id: crypto
              .createHash("md5")
              .update((item.title || "") + todayIST)
              .digest("hex"),
            title: item.title,
            description: item.contentSnippet || item.content || "",
            source: feed.name,
            category: cat,
            timestamp: item.isoDate || new Date().toISOString(),
            harvestDate: todayIST,
            url: item.link || "",
            // Boost simulated metrics for RSS items to make them competitive
            searchVolume: Math.floor(Math.random() * 150000) + 50000,
            socialMentions: Math.floor(Math.random() * 40000) + 10000,
            isTrending: false,
          });
          feedCount++;
        });
        logger(
          `[News Ingestion] Fetched ${feedCount} fresh articles from ${feed.name}.`,
        );
      } catch (error) {
        logger(
          `[News Ingestion] [Warning] Failed to fetch feed ${feed.name}: ${error.message}`,
        );
      }
    }

    // Deduplicate RSS stories by title first to accurately count them
    const seenRss = new Set();
    const uniqueItems = [];
    for (const item of collectedItems) {
      if (!item || !item.title) continue;
      const titleLower = item.title.toLowerCase().trim();
      if (!seenRss.has(titleLower)) {
        seenRss.add(titleLower);
        uniqueItems.push(item);
      }
    }

    // 2. Only using real-time RSS feed articles (no hardcoded mock trends)
    logger(
      `[News Ingestion] Using ${uniqueItems.length} real-time articles from RSS feeds. (No mock/hardcoded posts)`,
    );

    // Save fresh news to cache
    fs.writeFileSync(
      this.cacheFile,
      JSON.stringify(uniqueItems, null, 2),
      "utf8",
    );
    logger(
      `[News Ingestion] News collection completed. Cached ${uniqueItems.length} stories for ${todayIST}.`,
    );
    return uniqueItems;
  }

  // ── Simple heuristic category inference ─────────────────────────────────────
  inferCategory(text = "") {
    const lower = text.toLowerCase();
    if (
      lower.includes("ai") ||
      lower.includes("gpt") ||
      lower.includes("technology") ||
      lower.includes("chip") ||
      lower.includes("software") ||
      lower.includes("apple") ||
      lower.includes("google") ||
      lower.includes("robot") ||
      lower.includes("quantum")
    ) {
      return "Technology";
    }
    if (
      lower.includes("acquisition") ||
      lower.includes("ipo") ||
      lower.includes("billion") ||
      lower.includes("merger") ||
      lower.includes("valuation") ||
      lower.includes("stocks") ||
      lower.includes("interest rate") ||
      lower.includes("fed") ||
      lower.includes("finance")
    ) {
      return "Business";
    }
    if (
      lower.includes("election") ||
      lower.includes("parliament") ||
      lower.includes("treaty") ||
      lower.includes("climate") ||
      lower.includes("summit") ||
      lower.includes("president") ||
      lower.includes("prime minister") ||
      lower.includes("war") ||
      lower.includes("un ")
    ) {
      return "World Affairs";
    }
    if (
      lower.includes("battery") ||
      lower.includes("researchers") ||
      lower.includes("cell") ||
      lower.includes("dna") ||
      lower.includes("space") ||
      lower.includes("launch") ||
      lower.includes("nasa") ||
      lower.includes("orbit") ||
      lower.includes("discovery")
    ) {
      return "Science";
    }
    if (
      lower.includes("movie") ||
      lower.includes("hollywood") ||
      lower.includes("casting") ||
      lower.includes("marvel") ||
      lower.includes("actor") ||
      lower.includes("show") ||
      lower.includes("music") ||
      lower.includes("concert")
    ) {
      return "Entertainment";
    }
    if (
      lower.includes("f1") ||
      lower.includes("championship") ||
      lower.includes("grand prix") ||
      lower.includes("match") ||
      lower.includes("league") ||
      lower.includes("cup") ||
      lower.includes("sports") ||
      lower.includes("player")
    ) {
      return "Sports";
    }
    return "Viral Internet";
  }
}

module.exports = NewsCollector;
