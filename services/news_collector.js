const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const parser = new Parser();

// High-fidelity trending topics bank to populate category-diverse mock stories
const MOCK_TRENDS = [
  {
    title: "OpenAI Unveils 'Orion' GPT-5 Model with Advanced Reasoning Capabilities",
    description: "OpenAI has officially launched its next-generation reasoning model, Orion, demonstrating human-level problem solving in mathematics and programming. The model is said to perform 10x faster than previous versions.",
    source: "TechCrunch",
    category: "Technology",
    searchVolume: 120000,
    socialMentions: 45000
  },
  {
    title: "Google DeepMind Announces AlphaFold 3 Open-Source Code Release",
    description: "In a major victory for scientific transparency, Google DeepMind has open-sourced AlphaFold 3, allowing researchers worldwide to model DNA, RNA, and chemical compounds with unprecedented structural accuracy.",
    source: "Nature News",
    category: "Technology",
    searchVolume: 85000,
    socialMentions: 18000
  },
  {
    title: "Apple Announces Apple Glass AR Wearable Starting at $1,499",
    description: "At its annual keynote, Apple surprised the tech world by launching Apple Glass, a lightweight, premium augmented reality eyewear accessory that connects directly to the iPhone.",
    source: "Bloomberg",
    category: "Technology",
    searchVolume: 250000,
    socialMentions: 98000
  },
  {
    title: "NVIDIA Valuation Crosses $4 Trillion Mark Following Record Blackwell Chip Sales",
    description: "NVIDIA has become the first company in history to cross a $4 trillion market capitalization, driven by insatiable global demand for its Blackwell architecture AI servers.",
    source: "CNBC",
    category: "Business",
    searchVolume: 150000,
    socialMentions: 32000
  },
  {
    title: "SpaceX Starship Completes Flawless Orbit and Double Booster Catch",
    description: "SpaceX successfully launched its fifth Starship test flight, placing the spacecraft in orbit and capturing both the Super Heavy booster and the ship back at Starbase using mechanical arms.",
    source: "Space.com",
    category: "Science",
    searchVolume: 320000,
    socialMentions: 110000
  },
  {
    title: "Federal Reserve Announces Surprise 50 Basis Point Interest Rate Cut",
    description: "In a bid to support the labor market and maintain economic momentum, the Fed cut interest rates by half a percentage point, sparking a stock market rally.",
    source: "Wall Street Journal",
    category: "Business",
    searchVolume: 95000,
    socialMentions: 15000
  },
  {
    title: "Global Treaty Signed to Eliminate Single-Use Plastics by 2035",
    description: "Delegates from over 160 countries gathered in Geneva to sign a legally binding United Nations treaty committing to eliminate single-use plastics globally by the year 2035.",
    source: "Reuters",
    category: "World Affairs",
    searchVolume: 75000,
    socialMentions: 24000
  },
  {
    title: "Historic Elections in EU Spark Major Shift in Parliament Seats",
    description: "European Union member states concluded parliamentary elections, resulting in a fractured majority and prompting coalitions that will redefine environmental and trade policies.",
    source: "Al Jazeera",
    category: "World Affairs",
    searchVolume: 110000,
    socialMentions: 29000
  },
  {
    title: "MIT Researchers Develop Ultra-Efficient Room-Temperature Solid State Battery",
    description: "Materials scientists at MIT have created a solid-state lithium battery that maintains conductivity at room temperature, potentially doubling the range of standard electric vehicles.",
    source: "Science Daily",
    category: "Science",
    searchVolume: 135000,
    socialMentions: 36000
  },
  {
    title: "Marvel Studios Announces 'Avengers: Secret Wars' Casting Shocking Returns",
    description: "At San Diego Comic-Con, Marvel Studios confirmed major past actors will return for Secret Wars, breaking social media platforms and driving massive search queries.",
    source: "Hollywood Reporter",
    category: "Entertainment",
    searchVolume: 420000,
    socialMentions: 180000
  },
  {
    title: "Formula 1 World Championship Decided in Dramatic Final Lap in Monaco",
    description: "In a rain-drenched Monaco Grand Prix, the F1 championship title was decided on the very final corner of the race, leading to viral moments online.",
    source: "ESPN",
    category: "Sports",
    searchVolume: 180000,
    socialMentions: 74000
  },
  {
    title: "The 'Chill Guy' Meme Becomes the Most Viral TikTok Trend of 2026",
    description: "A simple animated drawing representing ultimate calm under pressure has captured internet culture, appearing in corporate marketing campaigns and generating millions of shares.",
    source: "Know Your Meme",
    category: "Viral Internet",
    searchVolume: 350000,
    socialMentions: 220000
  },
  {
    title: "Stripe Acquires Stablecoin Platform Bridge for $1.1 Billion in Historic Crypto Deal",
    description: "Fintech giant Stripe has finalized the acquisition of Bridge, a stablecoin payments startup, in its largest acquisition to date, signaling a massive push into global crypto commerce.",
    source: "Financial Times",
    category: "Business",
    searchVolume: 64000,
    socialMentions: 11000
  },
  {
    title: "UN Climate Summit Reaches Consensus on $300B Climate Finance Fund",
    description: "After three days of overtime negotiations, COP31 delegates established a new financial framework of $300 billion annually to fund transition and mitigation in developing nations.",
    source: "BBC News",
    category: "World Affairs",
    searchVolume: 82000,
    socialMentions: 19000
  }
];

class NewsCollector {
  constructor(configPath) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.feeds = configData.news_sources.rss_feeds;
    this.cacheFile = path.join(__dirname, '../database/news_cache.json');
  }

  // Fetch news from RSS and combine with local mock trend data
  async collectAll(simulationMode = true, logger = console.log) {
    logger("[News Ingestion] Starting news collection...");
    let collectedItems = [];

    // 1. Fetch RSS Feeds if not in strict simulation mode (and as active data fallback)
    if (!simulationMode) {
      for (const feed of this.feeds) {
        try {
          logger(`[News Ingestion] Fetching feed: ${feed.name}...`);
          const parsed = await parser.parseURL(feed.url);
          parsed.items.forEach(item => {
            const cat = this.inferCategory(item.title + ' ' + item.contentSnippet);
            collectedItems.push({
              id: crypto.createHash('md5').update(item.title || '').digest('hex'),
              title: item.title,
              description: item.contentSnippet || item.content || "",
              source: feed.name,
              category: cat,
              timestamp: item.isoDate || new Date().toISOString(),
              url: item.link || "",
              searchVolume: Math.floor(Math.random() * 20000) + 5000, // RSS feeds don't have search data, so estimate
              socialMentions: Math.floor(Math.random() * 10000) + 1000,
              isTrending: false
            });
          });
        } catch (error) {
          logger(`[News Ingestion] [Warning] Failed to fetch feed ${feed.name}: ${error.message}`);
        }
      }
    }

    // 2. Add high-value mock trends to ensure we have excellent viral headlines
    logger("[News Ingestion] Injecting high-impact trending news database...");
    MOCK_TRENDS.forEach(mockItem => {
      collectedItems.push({
        id: crypto.createHash('md5').update(mockItem.title).digest('hex'),
        title: mockItem.title,
        description: mockItem.description,
        source: mockItem.source,
        category: mockItem.category,
        timestamp: new Date().toISOString(),
        url: "https://www.globalviralnews.com/news/" + encodeURIComponent(mockItem.title.toLowerCase().replace(/ /g, '-')),
        searchVolume: mockItem.searchVolume,
        socialMentions: mockItem.socialMentions,
        isTrending: true
      });
    });

    // Deduplicate stories by title
    const seen = new Set();
    const uniqueItems = [];
    for (const item of collectedItems) {
      if (!item || !item.title) continue;
      const titleLower = item.title.toLowerCase().trim();
      if (!seen.has(titleLower)) {
        seen.add(titleLower);
        uniqueItems.push(item);
      }
    }

    // Save to news_cache.json
    fs.writeFileSync(this.cacheFile, JSON.stringify(uniqueItems, null, 2), 'utf8');
    logger(`[News Ingestion] News collection completed. Cached ${uniqueItems.length} stories.`);
    return uniqueItems;
  }

  // Simple heuristic category inference
  inferCategory(text = "") {
    const lower = text.toLowerCase();
    if (lower.includes("ai") || lower.includes("gpt") || lower.includes("technology") || lower.includes("chip") || lower.includes("software") || lower.includes("apple") || lower.includes("google") || lower.includes("robot") || lower.includes("quantum")) {
      return "Technology";
    }
    if (lower.includes("acquisition") || lower.includes("ipo") || lower.includes("billion") || lower.includes("merger") || lower.includes("valuation") || lower.includes("stocks") || lower.includes("interest rate") || lower.includes("fed") || lower.includes("finance")) {
      return "Business";
    }
    if (lower.includes("election") || lower.includes("parliament") || lower.includes("treaty") || lower.includes("climate") || lower.includes("summit") || lower.includes("president") || lower.includes("prime minister") || lower.includes("war") || lower.includes("un ")) {
      return "World Affairs";
    }
    if (lower.includes("battery") || lower.includes("researchers") || lower.includes("cell") || lower.includes("dna") || lower.includes("space") || lower.includes("launch") || lower.includes("nasa") || lower.includes("orbit") || lower.includes("discovery")) {
      return "Science";
    }
    if (lower.includes("movie") || lower.includes("hollywood") || lower.includes("casting") || lower.includes("marvel") || lower.includes("actor") || lower.includes("show") || lower.includes("music") || lower.includes("concert")) {
      return "Entertainment";
    }
    if (lower.includes("f1") || lower.includes("championship") || lower.includes("grand prix") || lower.includes("match") || lower.includes("league") || lower.includes("cup") || lower.includes("sports") || lower.includes("player")) {
      return "Sports";
    }
    return "Viral Internet";
  }
}

module.exports = NewsCollector;
