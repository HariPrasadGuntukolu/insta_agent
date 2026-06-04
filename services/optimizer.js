const fs = require('fs');
const path = require('path');

class Optimizer {
  constructor(configPath) {
    this.configPath = configPath;
    this.analyticsFile = path.join(__dirname, '../database/analytics.json');
  }

  // Optimize scoring weights based on performance data
  optimizeWeights(logger = console.log) {
    logger("[Optimizer] Running reinforcement self-optimization engine...");
    
    if (!fs.existsSync(this.analyticsFile)) {
      logger("[Optimizer] No analytics data found. Skipping optimization.");
      return { adjustedWeights: null, recommendations: [] };
    }

    const analytics = JSON.parse(fs.readFileSync(this.analyticsFile, 'utf8'));
    const configData = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    
    const baseWeights = { ...configData.scoring_weights };
    const categoryPerf = analytics.category_performance || {};
    const recommendations = [];

    // Calculate baseline average engagement rate
    let totalER = 0;
    let categoryCount = 0;
    Object.keys(categoryPerf).forEach(cat => {
      totalER += categoryPerf[cat].engagement_rate;
      categoryCount++;
    });

    const averageER = categoryCount > 0 ? (totalER / categoryCount) : 5.4;
    logger(`[Optimizer] Baseline Average Engagement Rate: ${averageER.toFixed(2)}%`);

    // We will adjust the weights:
    // If a category performs better than the average, we increase its weight.
    // If it performs worse, we decrease it.
    // The weights adjusted will be:
    // 'technology_relevance', 'business_relevance', 'creator_interest', 'global_impact', 'virality_potential'
    
    const adjustedWeights = { ...baseWeights };

    Object.keys(categoryPerf).forEach(category => {
      const perf = categoryPerf[category];
      const differencePercent = ((perf.engagement_rate - averageER) / averageER) * 100;

      if (differencePercent > 10) {
        // Outperforming by more than 10% -> Boost weight!
        const boostVal = parseFloat((differencePercent / 1000).toFixed(3)); // e.g. +0.015
        
        if (category === "Technology") {
          adjustedWeights.technology_relevance = parseFloat((adjustedWeights.technology_relevance + boostVal).toFixed(3));
          adjustedWeights.virality_potential = parseFloat((adjustedWeights.virality_potential + (boostVal / 2)).toFixed(3));
          recommendations.push({
            type: "BOOST",
            message: `Technology posts are outperforming the baseline by +${differencePercent.toFixed(1)}% ER. Boosting tech weight by +${boostVal} and virality index weight.`
          });
        } else if (category === "Business") {
          adjustedWeights.business_relevance = parseFloat((adjustedWeights.business_relevance + boostVal).toFixed(3));
          recommendations.push({
            type: "BOOST",
            message: `Business posts are outperforming by +${differencePercent.toFixed(1)}% ER. Boosting business index weight by +${boostVal}.`
          });
        } else if (category === "Viral Internet") {
          adjustedWeights.creator_interest = parseFloat((adjustedWeights.creator_interest + boostVal).toFixed(3));
          adjustedWeights.virality_potential = parseFloat((adjustedWeights.virality_potential + boostVal).toFixed(3));
          recommendations.push({
            type: "BOOST",
            message: `Viral Internet posts are driving extremely high engagement (+${differencePercent.toFixed(1)}%). Boosting virality scoring weight.`
          });
        }
      } else if (differencePercent < -15) {
        // Underperforming by more than 15% -> Reduce weight
        const reductionVal = parseFloat((Math.abs(differencePercent) / 2000).toFixed(3));
        
        if (category === "Sports") {
          adjustedWeights.general_engagement = parseFloat(Math.max(0.02, adjustedWeights.general_engagement - reductionVal).toFixed(3));
          recommendations.push({
            type: "REDUCE",
            message: `Sports posts are underperforming by ${differencePercent.toFixed(1)}% ER. Reducing general engagement scoring factor by -${reductionVal}.`
          });
        } else if (category === "Entertainment") {
          adjustedWeights.virality_potential = parseFloat(Math.max(0.05, adjustedWeights.virality_potential - reductionVal).toFixed(3));
          recommendations.push({
            type: "REDUCE",
            message: `Entertainment posts show lower relative engagement. Scaling back virality weight.`
          });
        }
      }
    });

    // Normalize weights to sum to exactly 1.0 (excluding general_engagement if needed, or normalized all)
    const sum = Object.values(adjustedWeights).reduce((a, b) => a + b, 0);
    logger(`[Optimizer] Raw adjusted weights sum: ${sum.toFixed(3)}. Normalizing...`);
    
    Object.keys(adjustedWeights).forEach(key => {
      adjustedWeights[key] = parseFloat((adjustedWeights[key] / sum).toFixed(3));
    });

    // Confirm normalization correction
    const normSum = Object.values(adjustedWeights).reduce((a, b) => a + b, 0);
    if (normSum !== 1) {
      // Minor rounding adjust
      const key = Object.keys(adjustedWeights)[0];
      adjustedWeights[key] = parseFloat((adjustedWeights[key] + (1.0 - normSum)).toFixed(3));
    }

    logger("[Optimizer] Reinforcement weights optimization complete.");
    
    // Add default general suggestions if recommendations list is empty
    if (recommendations.length === 0) {
      recommendations.push({
        type: "MAINTAIN",
        message: "Engagement weights are currently balanced. Current posting times and categories align with optimal reach."
      });
    }

    return {
      adjustedWeights,
      recommendations
    };
  }
}

module.exports = Optimizer;
