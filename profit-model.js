import { aggregateCampaignRollup } from "./metrics.js";
import { DEFAULT_PREFERENCES } from "./app-preferences.js";

export function normalizeProfitModel(model) {
  const source = model && typeof model === "object" ? model : DEFAULT_PREFERENCES.profitModel;
  return {
    cogs: Math.max(0, Number(source.cogs) || 0),
    fulfillment: Math.max(0, Number(source.fulfillment) || 0),
    fees: Math.max(0, Number(source.fees) || 0),
  };
}

export function getProfitModelRate(model) {
  const normalized = normalizeProfitModel(model);
  return Math.min(0.95, (normalized.cogs + normalized.fulfillment + normalized.fees) / 100);
}

export function getBreakEvenRoas(model) {
  const retainedRevenueRate = 1 - getProfitModelRate(model);
  return retainedRevenueRate > 0 ? 1 / retainedRevenueRate : Number.POSITIVE_INFINITY;
}

export function getCampaignDecision(row, model) {
  const spend = Number(row?.spend) || 0;
  const purchases = Number(row?.purchases) || 0;
  const roas = Number(row?.roas) || 0;
  const profit = Number(row?.estimatedProfit) || 0;
  const breakEven = getBreakEvenRoas(model);

  if (spend > 0 && purchases === 0) {
    return {
      key: "stop",
      label: "Stop-loss",
      tone: "risk",
      recommendation: "Stop incremental spend and verify purchase attribution, offer clarity, landing flow, and audience quality before resuming.",
    };
  }
  if (profit < 0 || (spend > 0 && roas < breakEven)) {
    return {
      key: "repair",
      label: "Repair",
      tone: "warn",
      recommendation: `Hold budget growth. Improve creative or conversion economics until ROAS clears the ${breakEven.toFixed(2)} break-even threshold.`,
    };
  }
  if (purchases > 0 && profit > 0 && roas >= breakEven * 1.1) {
    return {
      key: "scale",
      label: "Scale",
      tone: "healthy",
      recommendation: "Increase budget in controlled steps while protecting marginal CPA, contribution margin, and learning stability.",
    };
  }
  return {
    key: "hold",
    label: "Hold",
    tone: "neutral",
    recommendation: "Keep the current budget stable and collect more purchase evidence before making a material change.",
  };
}

export function applyProfitModelToCampaigns(campaigns, model) {
  const rate = getProfitModelRate(model);
  return (Array.isArray(campaigns) ? campaigns : []).map((row) => {
    const revenue = Number(row?.revenue) || 0;
    const spend = Number(row?.spend) || 0;
    const variableCosts = revenue * rate;
    const estimatedProfit = revenue - spend - variableCosts;
    const roas = spend > 0 ? revenue / spend : 0;
    const modeled = {
      ...row,
      costs: { other: variableCosts },
      variableCosts,
      estimatedProfit,
      roas,
      margin: revenue > 0 ? estimatedProfit / revenue : 0,
    };
    return { ...modeled, decision: getCampaignDecision(modeled, model) };
  });
}

function median(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

export function summarizePortfolio(campaigns, model, currency = "USD") {
  const rows = applyProfitModelToCampaigns(campaigns, model);
  const rollup = aggregateCampaignRollup(rows);
  const spending = rows.filter((row) => (Number(row.spend) || 0) > 0);
  const attributed = spending.filter((row) => (Number(row.purchases) || 0) > 0);
  const riskRows = rows.filter((row) => row.decision?.key === "repair" || row.decision?.key === "stop");
  const topThreeSpend = [...rows]
    .sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0))
    .slice(0, 3)
    .reduce((sum, row) => sum + (Number(row.spend) || 0), 0);

  return {
    rows,
    currency,
    campaignCount: rows.length,
    spend: rollup.totalSpend || 0,
    revenue: rollup.totalRevenue || 0,
    purchases: rollup.totalPurchases || 0,
    profit: rollup.estimatedNetProfit || 0,
    variableCosts: rollup.totalVariableCosts || 0,
    margin: rollup.margin || 0,
    roas: rollup.blendedRoas || 0,
    cpa: rollup.blendedCpa,
    breakEvenRoas: getBreakEvenRoas(model),
    riskSpend: riskRows.reduce((sum, row) => sum + (Number(row.spend) || 0), 0),
    attributionCoverage: spending.length ? attributed.length / spending.length : 0,
    topThreeSpendShare: rollup.totalSpend > 0 ? topThreeSpend / rollup.totalSpend : 0,
    medianCtr: median(rows.map((row) => row.ctr).filter((value) => value != null)),
    medianCpc: median(rows.map((row) => row.cpc).filter((value) => value != null)),
    decisions: rows.reduce((acc, row) => {
      const key = row.decision?.key || "hold";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, { scale: 0, hold: 0, repair: 0, stop: 0 }),
  };
}

export function applyProfitModelToPage(page, model) {
  const portfolio = summarizePortfolio(page?.campaigns || [], model, page?.metrics?.currency || "USD");
  return {
    ...page,
    campaigns: portfolio.rows,
    metrics: {
      ...page.metrics,
      totalSpend: portfolio.spend,
      revenue: portfolio.revenue,
      purchases: portfolio.purchases,
      roas: portfolio.roas,
      cpa: portfolio.cpa || 0,
      estimatedProfit: portfolio.profit,
      variableCosts: portfolio.variableCosts,
      margin: portfolio.margin,
      currency: portfolio.currency,
    },
    portfolio,
  };
}
