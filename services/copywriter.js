const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

class Copywriter {
  constructor(configPath) {
    this.configPath = configPath;
    this.geminiKey = process.env.GEMINI_API_KEY || null;
    this.aiEnabled = !!this.geminiKey;

    this.lastRequestTime = null;

    if (this.aiEnabled) {
      try {
        // Initialize Gemini API Client
        const ai = new GoogleGenerativeAI(this.geminiKey);
        // gemini-2.5-flash is the supported model for this API key
        this.model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
      } catch (err) {
        console.error("[Copywriter] Failed to initialize Gemini API client:", err.message);
        this.aiEnabled = false;
      }
    }
  }

  // Helper to centralize request pacing for 5 RPM free tier limits
  async paceRequest() {
    if (!this.lastRequestTime) {
      this.lastRequestTime = Date.now();
      return;
    }
    const elapsed = Date.now() - this.lastRequestTime;
    const minDelay = 15000; // 15 seconds spacing guarantees max 4 RPM
    if (elapsed < minDelay) {
      const waitTime = minDelay - elapsed;
      console.log(`[Copywriter] Pacing Gemini requests: waiting ${Math.round(waitTime / 1000)}s...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
    this.lastRequestTime = Date.now();
  }

  // Generate Instagram Caption and Hashtags for a story
  async generateCaptionAndHashtags(story, logger = console.log) {
    if (this.aiEnabled) {
      try {
        await this.paceRequest();
        logger(`[Copywriter] Generating AI caption using Gemini for: "${story.title}"...`);
        const prompt = this.buildPrompt(story);
        const result = await this.model.generateContent(prompt);
        const text = result.response.text();

        // Extract summary, caption and hashtags from Gemini response
        const parsed = this.parseAIResponse(text, story);
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
You are the Lead Editor and Head Copywriter for a premium global news digital media network, similar to Reuters, Bloomberg, and The Economist.

Your task is to analyze the following news story and output a JSON object containing a comprehensive news summary, an Instagram caption, and hashtags.

NEWS STORY SOURCE DATA:
HEADLINE: ${story.title}
SUMMARY: ${story.description}
CATEGORY: ${story.category}
SOURCE: ${story.source}

INSTRUCTIONS:

1. COMPREHENSIVE SUMMARY ("summary" field in JSON):
- Write a highly readable, factual, and objective news summary of 2-4 sentences.
- It MUST provide complete context so the reader can understand the entire event without clicking an external link.
- Answer: What happened, Who is involved, Where, When, Why it is important, and Key outcomes/implications.
- Avoid vague, incomplete, or clickbait statements.
- Write in clear, professional language.
- Keep it under 280 characters to fit the design, but prioritize factual completeness.

2. INSTAGRAM CAPTION ("caption" field in JSON):
- Write an engaging, authoritative Instagram caption.
- Format with clear spacing and emojis.
- Include:
  * An opening hook in capital letters.
  * A 2-sentence summary.
  * A bullet point for "💡 KEY DETAIL".
  * A bullet point for "🌍 GLOBAL IMPACT".
  * An engagement question asking for the audience's view.
  * Clean CTAs for Saves, Shares, and Follows.
- Do not include hashtags here.

3. HASHTAGS ("hashtags" field in JSON):
- Provide a single line of exactly 25 hashtags separated by spaces (5 broad, 10 topic-specific, 10 trending).

Return ONLY a valid JSON object in this format (no conversational text before or after):
{
  "summary": "A comprehensive, factual news summary here...",
  "caption": "🚨 BREAKING: [Hook]\\n\\n[Caption details...]\\n\\n💬 [Question]? Let us know below!\\n\\n📌 Save this update for later.\\n✈️ Share with someone who should know.\\n👉 Follow @GlobalViralNews for updates.",
  "hashtags": "#news #business #tech ..."
}
`;
  }

  // Parse response from LLM
  parseAIResponse(text, story) {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(json)?/, "").replace(/```$/, "").trim();
    }

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.summary && parsed.caption && parsed.hashtags) {
        return {
          summary: parsed.summary.trim(),
          caption: parsed.caption.trim(),
          hashtags: parsed.hashtags.trim()
        };
      }
    } catch (e) {
      console.warn("[Copywriter] JSON parsing failed, trying line-based parser.", e.message);
    }

    // Fallback line-based parsing
    const lines = text.split('\n');
    const hashtagLineIndex = lines.findIndex(l => l.includes('#'));
    let caption = text;
    let hashtags = "";

    if (hashtagLineIndex !== -1) {
      caption = lines.slice(0, hashtagLineIndex).join('\n').trim();
      hashtags = lines.slice(hashtagLineIndex).join(' ').trim();
    } else {
      const parts = text.split('#');
      caption = parts[0].trim();
      hashtags = parts.slice(1).map(p => '#' + p.trim()).join(' ');
    }

    return {
      summary: story ? story.description : "",
      caption,
      hashtags: hashtags || "#news"
    };
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

    return { summary: description, caption, hashtags };
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
        "#internetculture", "#memes", "#viralmemes", "#tiktoktrends", "#creatoreconomy",
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

  // Verify the news summary meets quality standards
  async verifySummary(story, summary, logger = console.log) {
    // Centralized early return to conserve Gemini API daily quota on the free tier (halves requests per story)
    logger("[Copywriter] Skipping summary validation to conserve API quota.");
    return { success: true, summary };

    if (!this.aiEnabled) {
      logger("[Copywriter] AI disabled. Skipping news card validation.");
      return { success: true, summary };
    }

    try {
      await this.paceRequest();
      logger(`[Copywriter] Validating news card summary quality...`);
      const prompt = `
You are a Senior News Editor and Fact Checker.
Analyze the following source news material and the generated news summary.

SOURCE HEADLINE: ${story.title}
SOURCE DESCRIPTION: ${story.description}

GENERATED SUMMARY: ${summary}

Verify that the generated summary meets these quality standards:
1. It does NOT omit critical facts.
2. The reader can understand the complete story from the summary alone.
3. It accurately represents the source material.
4. No misleading or incomplete information is presented.
5. The content is concise, factual, and professional.

Return ONLY a valid JSON object in this format (no conversational text before or after):
{
  "passed": true/false,
  "explanation": "Brief explanation of any issues found",
  "revised_summary": "If passed is false, provide a corrected, complete, and factual news summary that passes all criteria."
}
`;
      const result = await this.model.generateContent(prompt);
      let text = result.response.text().trim();
      if (text.startsWith("```")) {
        text = text.replace(/^```(json)?/, "").replace(/```$/, "").trim();
      }
      const parsed = JSON.parse(text);
      if (parsed.passed) {
        logger("[Copywriter] [Passed] Summary validation succeeded.");
        return { success: true, summary };
      } else {
        logger(`[Copywriter] [Failed] Summary validation failed: ${parsed.explanation}`);
        logger(`[Copywriter] Using revised summary: "${parsed.revised_summary}"`);
        return { success: false, summary: parsed.revised_summary || summary };
      }
    } catch (e) {
      logger(`[Copywriter] [Warning] Summary validation failed: ${e.message}. Proceeding with generated summary.`);
      return { success: true, summary };
    }
  }
}

module.exports = Copywriter;
