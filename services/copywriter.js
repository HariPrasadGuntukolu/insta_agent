const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

class Copywriter {
  constructor(configPath) {
    this.configPath = configPath;
    this.geminiKey = process.env.GEMINI_API_KEY || null;
    this.aiEnabled = !!this.geminiKey;

    if (this.aiEnabled) {
      try {
        // Initialize Gemini API Client
        const ai = new GoogleGenerativeAI(this.geminiKey);
        // The standard model is gemini-2.5-flash
        this.model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
      } catch (err) {
        console.error("[Copywriter] Failed to initialize Gemini API client:", err.message);
        this.aiEnabled = false;
      }
    }
  }

  // Generate Instagram Caption and Hashtags for a story
  async generateCaptionAndHashtags(story, logger = console.log) {
    if (this.aiEnabled) {
      try {
        logger(`[Copywriter] Generating AI caption using Gemini for: "${story.title}"...`);
        const prompt = this.buildPrompt(story);
        const result = await this.model.generateContent(prompt);
        const text = result.response.text();

        // Extract caption and hashtags from Gemini response
        // Usually, the response contains both. We will sanitize it.
        const parsed = this.parseAIResponse(text);
        if (parsed.caption && parsed.hashtags) {
          logger("[Copywriter] AI Caption generation successful.");
          return parsed;
        }
      } catch (error) {
        logger(`[Copywriter] [Warning] Gemini generation failed: ${error.message}. Falling back to templates.`);
      }
    }

    // Template-based copywriting fallback
    logger(`[Copywriter] Generating template-based caption for: "${story.title}"...`);
    return this.generateTemplateCaption(story);
  }

  // Create prompt instruction for Gemini
  buildPrompt(story) {
    return `
You are the Lead Editor and Head Copywriter for a premium global news digital media network, similar to Reuters, Bloomberg, Morning Brew, and Visual Capitalist.
Your task is to write a high-engagement, authoritative, and viral Instagram caption for the following news story:

HEADLINE: ${story.title}
SUMMARY: ${story.description}
CATEGORY: ${story.category}
SOURCE: ${story.source}
ENGAGEMENT INDEX: ${story.viralScore}/100

You must format your output EXACTLY as follows, using clear sections, formatting with emojis, and clean spacing. Do not include markdown headers like '### Hook' in the output itself, just output the clean text:

1. [OPENING HOOK] — A short, high-impact headline hook in capital letters with an alert emoji.
2. [STORY SUMMARY] — 2-3 engaging, concise sentences summarizing the news and the facts.
3. [KEY INSIGHT] — 1 bullet point starting with 💡 explaining a critical data point or detail.
4. [WHY IT MATTERS] — 1 bullet point starting with 🌍 explaining the broader global, market, or industry impact.
5. [DISCUSSION PROMPT] — An open-ended, engagement-optimized question asking for the audience's opinion.
6. [CALL TO ACTIONS] — Clean CTAs encouraging Saves, Shares, and Follows:
   - "📌 Save this update for later."
   - "✈️ Share with someone who should know."
   - "👉 Follow @GlobalViralNews for real-time autonomous updates."
7. [HASHTAGS] — An aligned list of 25 hashtags separated by spaces (exactly 5 broad hashtags, 10 niche hashtags related to the topic/category, and 10 trending hashtags).

Example Output Format:
🚨 BREAKING: [Hook]
[Summary text...]

💡 KEY INSIGHT: [Insight...]
🌍 WHY IT MATTERS: [Impact...]

💬 [Question]? Let us know below!

📌 Save this update for later.
✈️ Share with someone who should know.
👉 Follow @GlobalViralNews for real-time autonomous updates.

#news #business #tech ... [exactly 25 hashtags]
`;
  }

  // Parse response from LLM
  parseAIResponse(text) {
    const lines = text.split('\n');
    const hashtagLineIndex = lines.findIndex(l => l.includes('#'));
    
    let caption = "";
    let hashtags = "";

    if (hashtagLineIndex !== -1) {
      caption = lines.slice(0, hashtagLineIndex).join('\n').trim();
      hashtags = lines.slice(hashtagLineIndex).join(' ').trim();
    } else {
      // If no hashtags line found, try splitting by '#'
      const parts = text.split('#');
      caption = parts[0].trim();
      hashtags = parts.slice(1).map(p => '#' + p.trim()).join(' ');
    }

    return { caption, hashtags };
  }

  // Template-based generator
  generateTemplateCaption(story) {
    const { title, description, category, source, viralScore } = story;
    
    // Hooks based on category
    let hook = "🚨 BREAKING NEWS";
    if (category === "Technology") hook = "💻 TECH UPDATE";
    else if (category === "Business") hook = "📈 MARKET ALERT";
    else if (category === "World Affairs") hook = "🌍 GLOBAL REPORT";
    else if (category === "Science") hook = "🧬 SCIENCE BREAKTHROUGH";
    else if (category === "Entertainment") hook = "🎬 ENTERTAINMENT NEWS";
    else if (category === "Sports") hook = "🏆 SPORTS FLASH";
    else if (category === "Viral Internet") hook = "🔥 VIRAL TRENDING";

    // Dynamic discussion questions based on category
    let question = "What are your thoughts on this development?";
    if (category === "Technology") question = "Will this technology change your daily workflow?";
    else if (category === "Business") question = "How do you expect this will impact the markets and industries?";
    else if (category === "World Affairs") question = "How will this policy decision affect global relations?";
    else if (category === "Science") question = "Does this discovery pave the way for a better future?";
    else if (category === "Sports") question = "Is this one of the greatest moments of the season?";
    else if (category === "Viral Internet") question = "Are you participating in this trend? Why do you think it went viral?";

    // Category Specific Insights
    let insight = `This development is attracting significant public interest and global search momentum.`;
    let impact = `Industry leaders are closely monitoring how this announcement will reshape competitive dynamics.`;

    if (category === "Technology") {
      insight = `Artificial intelligence and hardware integrations are accelerating, driving massive valuation climbs.`;
      impact = `This shifts developer and corporate ecosystems toward edge computing and advanced model tooling.`;
    } else if (category === "Business") {
      insight = `Market capitalization rates reflect historic consolidation, marking a major milestone for investors.`;
      impact = `Macroeconomic factors and Fed interest shifts continue to influence liquidity allocations worldwide.`;
    } else if (category === "World Affairs") {
      insight = `Multiple sovereign countries have entered formal negotiations to outline environmental and trade protocols.`;
      impact = `Regulatory frameworks are expected to tighten, affecting multinational supply chains.`;
    }

    // Formulate Caption
    const caption = `${hook}: ${title}

${description}

💡 KEY INSIGHT: ${insight}
🌍 WHY IT MATTERS: ${impact}

💬 ${question} Let us know in the comments below!

📌 Save this update for later.
✈️ Share with someone who should know.
👉 Follow @GlobalViralNews for real-time autonomous updates.`;

    // Formulate Hashtags
    const hashtags = this.getCategoryHashtags(category);

    return { caption, hashtags };
  }

  // Get pre-defined optimal hashtags for each category
  getCategoryHashtags(category) {
    const broad = ["#news", "#trending", "#viral", "#globalevents", "#instagramnews"];
    
    const categorySpecific = {
      "Technology": [
        "#technology", "#techupdates", "#artificialintelligence", "#futuretech", "#siliconvalley",
        "#deeplearning", "#hardware", "#softwaredev", "#gadgets", "#robotics",
        "#opennews", "#innovation", "#engineering", "#computation", "#datacenter"
      ],
      "Business": [
        "#business", "#finance", "#financeupdates", "#stockmarket", "#investment",
        "#mergers", "#unicornstartup", "#ceolife", "#wealthcreation", "#corporate",
        "#venturecapital", "#economy", "#wallstreet", "#banking", "#fintech"
      ],
      "World Affairs": [
        "#worldnews", "#geopolitics", "#worldaffairs", "#elections", "#democracy",
        "#globalrelations", "#unitednations", "#government", "#legislation", "#foreignpolicy",
        "#climatesummit", "#international", "#globalcrisis", "#sovereignty", "#diplomacy"
      ],
      "Science": [
        "#science", "#sciencediscovery", "#research", "#spacex", "#nasa",
        "#astrophysics", "#solidstate", "#energytransition", "#climateaction", "#medicalscience",
        "#biotechnology", "#evolution", "#quantumphysics", "#scientificresearch", "#exploration"
      ],
      "Entertainment": [
        "#entertainment", "#hollywood", "#celebritynews", "#popculture", "#streaming",
        "#marvelstudios", "#boxoffice", "#movietrends", "#musicindustry", "#influencer",
        "#sdcc", "#avengers", "#cinemanews", "#awardsseason", "#popnews"
      ],
      "Sports": [
        "#sports", "#sportsnews", "#formula1", "#monacogp", "#worldchampionship",
        "#champions", "#athletelife", "#viralsports", "#grandprix", "#racing",
        "#f1news", "#espn", "#athleticrecords", "#matchday", "#victory"
      ],
      "Viral Internet": [
        "#internet culture", "#memes", "#viralmemes", "#tiktoktrends", "#creatoreconomy",
        "#socialmedia", "#onlinecommunities", "#consumertrends", "#chillguy", "#trendingmemes",
        "#viralvideo", "#internetculture", "#digitaltrends", "#contentcreator", "#webculture"
      ]
    };

    const specific = categorySpecific[category] || categorySpecific["Viral Internet"];
    
    // Combine (5 broad, 10 specific, 10 general trending)
    const trending = [
      "#breaking", "#todaynews", "#instadaily", "#explorepage", "#viralpost",
      "#newsupdates", "#globalalert", "#viralindex", "#trendingnow", "#factchecked"
    ];

    // Combine them and ensure a clean string
    return [...broad, ...specific.slice(0, 10), ...trending].join(' ');
  }
}

module.exports = Copywriter;
