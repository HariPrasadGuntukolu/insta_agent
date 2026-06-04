require('dotenv').config();
const path = require('path');
const fs = require('fs');

const NewsCollector = require('./services/news_collector');
const FactVerifier = require('./services/fact_verifier');
const ScoringEngine = require('./services/scoring_engine');
const PostGenerator = require('./services/post_generator');
const Copywriter = require('./services/copywriter');
const Publisher = require('./services/publisher');

const configPath = path.join(__dirname, 'config.json');

async function testPipeline() {
  console.log("==================================================");
  console.log("⚡ GLOBAL VIRAL NEWS SYSTEM - PIPELINE VERIFIER ⚡");
  console.log("==================================================");
  console.log(`[Test] Environment: node ${process.version}`);
  console.log(`[Test] Simulation Mode: ${process.env.SIMULATION_MODE !== "false"}`);
  console.log("--------------------------------------------------");

  try {
    const collector = new NewsCollector(configPath);
    const verifier = new FactVerifier(configPath);
    const scorer = new ScoringEngine(configPath);
    const generator = new PostGenerator(configPath);
    const copywriter = new Copywriter(configPath);
    const publisher = new Publisher(configPath);

    // 1. Ingestion
    console.log("[1/6] Ingesting news seeds...");
    const rawNews = await collector.collectAll(true);
    console.log(`[✓] Collected ${rawNews.length} news items.`);

    // 2. Verification
    console.log("[2/6] Running fact verification (95%+ confidence)...");
    const verifiedNews = verifier.verifyAll(rawNews);
    console.log(`[✓] Verified ${verifiedNews.length} news items.`);
    if (verifiedNews.length === 0) {
      throw new Error("No news stories passed the verification checks.");
    }

    // 3. Scoring & Selection
    console.log("[3/6] Scoring and ranking stories...");
    const scoredNews = scorer.scoreAndRank(verifiedNews);
    console.log("[4/6] Filtering Daily Top 10 mix...");
    const top10 = scorer.selectDailyTop10(scoredNews);
    console.log(`[✓] Selected ${top10.length} stories for publishing.`);

    // 4. Asset Generation & Scheduling
    console.log("[5/6] Generating captions, hashtags & rendering visual images...");
    const postsDbFile = path.join(__dirname, 'database/generated_posts.json');
    let posts = [];

    // Clear previous test run from generated posts database to start fresh
    fs.writeFileSync(postsDbFile, '[]', 'utf8');

    for (let i = 0; i < Math.min(top10.length, 3); i++) { // test with first 3 to speed up verification
      const story = top10[i];
      console.log(` -> Processing Story [${i+1}/3]: "${story.title}"`);
      
      const copy = await copywriter.generateCaptionAndHashtags(story);
      const postWithCopy = {
        ...story,
        caption: copy.caption,
        hashtags: copy.hashtags,
        status: "scheduled"
      };

      const assets = await generator.createPost(postWithCopy);
      const completePost = {
        ...postWithCopy,
        svgPath: assets.svgPath,
        pngPath: assets.pngPath
      };

      posts.push(completePost);

      // Verify that assets exist
      const fullSvgPath = path.join(__dirname, 'public', assets.svgPath);
      const fullPngPath = path.join(__dirname, 'public', assets.pngPath);
      
      if (fs.existsSync(fullSvgPath) && fs.existsSync(fullPngPath)) {
        console.log(`    [✓] Generated assets successfully.`);
        console.log(`        SVG: ${assets.svgPath} (${fs.statSync(fullSvgPath).size} bytes)`);
        console.log(`        PNG: ${assets.pngPath} (${fs.statSync(fullPngPath).size} bytes)`);
      } else {
        throw new Error(`Failed to find generated asset file for story ${story.id}`);
      }

      // Add to publisher queue
      const dummyTime = new Date();
      dummyTime.setHours(19, 0, 0, 0);
      publisher.addToQueue(completePost, dummyTime.toISOString());
    }

    // Write back posts database
    fs.writeFileSync(postsDbFile, JSON.stringify(posts, null, 2), 'utf8');

    // 5. Publishing simulation test
    console.log("[6/6] Testing Simulation publishing agent...");
    const queue = publisher.loadQueue();
    const testItem = queue[0];
    if (testItem) {
      console.log(` -> Attempting simulation publish of: "${testItem.title}"`);
      const mediaId = await publisher.publishItem(testItem, true);
      console.log(`    [✓] Sim publish confirmed. Meta Media ID: ${mediaId}`);
    }

    console.log("--------------------------------------------------");
    console.log("🎉 PIPELINE END-TO-END VERIFICATION SUCCESSFUL 🎉");
    console.log("==================================================");

  } catch (error) {
    console.error("--------------------------------------------------");
    console.error("❌ PIPELINE VERIFICATION FAILED ❌");
    console.error(`Reason: ${error.message}`);
    console.error("==================================================");
    process.exit(1);
  }
}

testPipeline();
