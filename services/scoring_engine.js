const fs = require('fs');

class ScoringEngine {
  constructor(configPath) {
    this.configPath = configPath;
    this.reloadConfig();
  }

  reloadConfig() {
    const configData = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    this.weights = configData.scoring_weights;
  }

  // Calculate score 0-100 for a story
  scoreStory(story, adjustedWeights = null) {
    const weights = adjustedWeights || this.weights;

    // Helper to calculate components (0-100 scale)
    const titleLower = (story && story.title ? story.title.toLowerCase() : "");
    const searchVol = story.searchVolume || 0;
    const socialMentionsVal = story.socialMentions || 0;

    // 1. Global Impact (20%)
    let globalImpact = 50; // baseline
    if (story.category === "World Affairs" || story.category === "Business") globalImpact += 20;
    if (titleLower.includes("treaty") || titleLower.includes("un ") || titleLower.includes("global") || titleLower.includes("historic") || titleLower.includes("federal reserve") || titleLower.includes("elections")) globalImpact += 30;
    globalImpact = Math.min(100, globalImpact);

    // 2. Public Interest (15%)
    let publicInterest = 50;
    if (titleLower.includes("openai") || titleLower.includes("apple") || titleLower.includes("spacex") || titleLower.includes("marvel") || titleLower.includes("tiktok")) publicInterest += 30;
    if (searchVol > 200000) publicInterest += 20;
    publicInterest = Math.min(100, publicInterest);

    // 3. Virality Potential (15%)
    let viralityPotential = 40;
    if (story.category === "Viral Internet" || story.category === "Entertainment") viralityPotential += 30;
    if (titleLower.includes("meme") || titleLower.includes("viral") || titleLower.includes("shocking") || titleLower.includes("secret") || titleLower.includes("trend")) viralityPotential += 30;
    viralityPotential = Math.min(100, viralityPotential);

    // 4. Search Demand (10%)
    // Normalized to max of 500k volume
    const searchDemand = Math.min(100, Math.round((searchVol / 500000) * 100));

    // 5. Social Mentions (10%)
    // Normalized to max of 250k mentions
    const socialMentions = Math.min(100, Math.round((socialMentionsVal / 250000) * 100));

    // 6. Business Relevance (10%)
    let businessRelevance = 20;
    if (story.category === "Business") businessRelevance = 100;
    else if (titleLower.includes("valuation") || titleLower.includes("trillion") || titleLower.includes("billion") || titleLower.includes("acquire") || titleLower.includes("market")) businessRelevance = 80;

    // 7. Technology Relevance (5%)
    let techRelevance = 20;
    if (story.category === "Technology") techRelevance = 100;
    else if (titleLower.includes("ai") || titleLower.includes("gpt") || titleLower.includes("deepmind") || titleLower.includes("quantum") || titleLower.includes("robot")) techRelevance = 80;

    // 8. Creator Interest (5%)
    let creatorInterest = 20;
    if (story.category === "Viral Internet") creatorInterest = 100;
    else if (titleLower.includes("tiktok") || titleLower.includes("creator") || titleLower.includes("meme") || titleLower.includes("influencer")) creatorInterest = 80;

    // 9. Engagement Potential (10%)
    let engagementPotential = 50;
    if (titleLower.includes("surprise") || titleLower.includes("cut") || titleLower.includes("flawless") || titleLower.includes("shocking") || titleLower.includes("concluded")) engagementPotential += 30;
    engagementPotential = Math.min(100, engagementPotential);

    // Calculate final weighted score
    const finalScore = Math.round(
      (globalImpact * (weights.global_impact || 0.20)) +
      (publicInterest * (weights.public_interest || 0.15)) +
      (viralityPotential * (weights.virality_potential || 0.15)) +
      (searchDemand * (weights.search_demand || 0.10)) +
      (socialMentions * (weights.social_mentions || 0.10)) +
      (businessRelevance * (weights.business_relevance || 0.10)) +
      (techRelevance * (weights.technology_relevance || 0.05)) +
      (creatorInterest * (weights.creator_interest || 0.05)) +
      (engagementPotential * (weights.general_engagement || 0.10))
    );

    return {
      score: finalScore,
      breakdown: {
        globalImpact,
        publicInterest,
        viralityPotential,
        searchDemand,
        socialMentions,
        businessRelevance,
        techRelevance,
        creatorInterest,
        engagementPotential
      }
    };
  }

  // Score list of verified stories and sort by rank
  scoreAndRank(verifiedStories = [], adjustedWeights = null, logger = console.log) {
    logger("[Scoring Engine] Calculating viral score index...");
    const validStories = (verifiedStories || []).filter(s => s && s.title);
    const scoredList = validStories.map(story => {
      const { score, breakdown } = this.scoreStory(story, adjustedWeights);
      return {
        ...story,
        viralScore: score,
        scoreBreakdown: breakdown
      };
    });

    // Sort descending by viral score
    return scoredList.sort((a, b) => b.viralScore - a.viralScore);
  }

  // Select the Daily Top 10 based on required Category Mix:
  // 2 Tech, 2 Business, 2 World Affairs, 1 Science, 1 Entertainment, 1 Sports, 1 Viral Internet
  selectDailyTop10(scoredStories = [], logger = console.log) {
    logger("[Scoring Engine] Selecting Daily Top 10 stories based on content mix...");
    
    const targetMix = {
      "Technology": 2,
      "Business": 2,
      "World Affairs": 2,
      "Science": 1,
      "Entertainment": 1,
      "Sports": 1,
      "Viral Internet": 1
    };

    const selected = [];
    const counts = {
      "Technology": 0,
      "Business": 0,
      "World Affairs": 0,
      "Science": 0,
      "Entertainment": 0,
      "Sports": 0,
      "Viral Internet": 0
    };

    // First pass: fill as many categories as we can in rank order
    for (const story of scoredStories) {
      const cat = story.category;
      if (targetMix[cat] !== undefined && counts[cat] < targetMix[cat]) {
        selected.push(story);
        counts[cat]++;
      }
    }

    // Second pass: if some categories are missing or don't have enough verified stories,
    // fill in the remaining slots with the next highest-scoring available stories regardless of category
    let totalSelected = selected.length;
    if (totalSelected < 10) {
      logger(`[Scoring Engine] [Warning] Categories not fully satisfied. Selected ${totalSelected}/10. Filling remaining slots with top ranks...`);
      for (const story of scoredStories) {
        if (selected.some(s => s.id === story.id)) continue;
        selected.push(story);
        totalSelected++;
        if (totalSelected === 10) break;
      }
    }

    // Sort the final selected 10 by viral score
    const finalSelection = selected.slice(0, 10).sort((a, b) => b.viralScore - a.viralScore);
    logger(`[Scoring Engine] Top 10 selected. Highest score: ${finalSelection[0] ? finalSelection[0].viralScore : 0}.`);
    return finalSelection;
  }
}

module.exports = ScoringEngine;
