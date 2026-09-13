/**
 * AdsForecast — metric and profitability primitives.
 * Keep all math here so UI and data-normalization never invent formulas.
 *
 * @module metrics
 */

/** @param {unknown} n @returns {n is number} */
export function isFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** @param {unknown} value @param {number} [fallback=0] */
export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** @param {number} value @param {number} [decimals=2] */
export function roundTo(value, decimals = 2) {
  if (!isFiniteNumber(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** @param {{ product?: number, shipping?: number, fees?: number, other?: number } | null | undefined} costs */
export function sumVariableCosts(costs) {
  if (!costs) return 0;
  return [costs.product, costs.shipping, costs.fees, costs.other]
    .map((v) => (isFiniteNumber(v) ? v : 0))
    .reduce((a, b) => a + b, 0);
}

/** @param {number} revenue @param {number} spend */
export function computeRoas(revenue, spend) {
  if (!isFiniteNumber(revenue) || !isFiniteNumber(spend) || spend <= 0) return null;
  return revenue / spend;
}

/** @param {number} spend @param {number} purchases */
export function computeCpa(spend, purchases) {
  if (!isFiniteNumber(spend) || !isFiniteNumber(purchases) || purchases <= 0) return null;
  return spend / purchases;
}

/** @param {number} revenue @param {number} purchases */
export function computeAov(revenue, purchases) {
  if (!isFiniteNumber(revenue) || !isFiniteNumber(purchases) || purchases <= 0) return null;
  return revenue / purchases;
}

/** @param {number} purchases @param {number} clicks */
export function computeConversionRate(purchases, clicks) {
  if (!isFiniteNumber(purchases) || !isFiniteNumber(clicks) || clicks <= 0) return null;
  return purchases / clicks;
}

/** @param {number} spend @param {number} clicks */
export function computeCpc(spend, clicks) {
  if (!isFiniteNumber(spend) || !isFiniteNumber(clicks) || clicks <= 0) return null;
  return spend / clicks;
}

/** Net profit after ad spend and attributable variable costs. */
export function computeNetProfit(revenue, spend, variableCostsTotal) {
  if (!isFiniteNumber(revenue) || !isFiniteNumber(spend) || !isFiniteNumber(variableCostsTotal)) {
    return null;
  }
  return revenue - spend - variableCostsTotal;
}

/** @param {number} profit @param {number} revenue */
export function computeMargin(profit, revenue) {
  if (!isFiniteNumber(profit) || !isFiniteNumber(revenue) || revenue <= 0) return null;
  return profit / revenue;
}

/**
 * Conservative default model for live Meta rows until store COGS is connected.
 * If API rows arrive without COGS, assume 65% of purchase value is product/shipping/fees.
 */
export function estimateVariableCostsFromRevenue(revenue, ratio = 0.65) {
  const r = toNumber(revenue, 0);
  return r * ratio;
}

/**
 * @typedef {object} CampaignLike
 * @property {number} spend
 * @property {number} purchases
 * @property {number} revenue
 * @property {{ product?: number, shipping?: number, fees?: number, other?: number }} [costs]
 * @property {number} [clicks]
 * @property {number} [impressions]
 */

/** @param {CampaignLike} campaign */
export function deriveCampaignMetrics(campaign) {
  const revenue = toNumber(campaign.revenue, 0);
  const spend = toNumber(campaign.spend, 0);
  const purchases = toNumber(campaign.purchases, 0);
  const clicks = toNumber(campaign.clicks, 0);
  const impressions = toNumber(campaign.impressions, 0);
  const variableCosts = campaign.costs
    ? sumVariableCosts(campaign.costs)
    : estimateVariableCostsFromRevenue(revenue);
  const profit = computeNetProfit(revenue, spend, variableCosts);

  return {
    roas: computeRoas(revenue, spend),
    cpa: computeCpa(spend, purchases),
    cpc: computeCpc(spend, clicks),
    aov: computeAov(revenue, purchases),
    ctr: impressions > 0 && clicks > 0 ? clicks / impressions : null,
    conversionRate: computeConversionRate(purchases, clicks),
    profit,
    margin: profit == null ? null : computeMargin(profit, revenue),
    variableCosts,
  };
}

/** @param {CampaignLike[]} campaigns */
export function aggregateCampaignRollup(campaigns) {
  const rows = Array.isArray(campaigns) ? campaigns : [];
  const totals = rows.reduce(
    (acc, c) => {
      const d = deriveCampaignMetrics(c);
      acc.totalSpend += toNumber(c.spend, 0);
      acc.totalRevenue += toNumber(c.revenue, 0);
      acc.totalPurchases += toNumber(c.purchases, 0);
      acc.totalClicks += toNumber(c.clicks, 0);
      acc.totalImpressions += toNumber(c.impressions, 0);
      acc.totalVariableCosts += d.variableCosts || 0;
      acc.estimatedNetProfit += d.profit || 0;
      return acc;
    },
    {
      totalSpend: 0,
      totalRevenue: 0,
      totalPurchases: 0,
      totalClicks: 0,
      totalImpressions: 0,
      totalVariableCosts: 0,
      estimatedNetProfit: 0,
    }
  );

  return {
    ...totals,
    blendedRoas: computeRoas(totals.totalRevenue, totals.totalSpend),
    blendedCpa: computeCpa(totals.totalSpend, totals.totalPurchases),
    blendedCpc: computeCpc(totals.totalSpend, totals.totalClicks),
    blendedAov: computeAov(totals.totalRevenue, totals.totalPurchases),
    blendedCtr:
      totals.totalImpressions > 0 && totals.totalClicks > 0
        ? totals.totalClicks / totals.totalImpressions
        : null,
    conversionRate: computeConversionRate(totals.totalPurchases, totals.totalClicks),
    margin: computeMargin(totals.estimatedNetProfit, totals.totalRevenue),
  };
}

export function classifyCampaign({ spend, purchases, roas, profit }) {
  const s = toNumber(spend, 0);
  const p = toNumber(purchases, 0);
  const r = toNumber(roas, 0);
  const pr = toNumber(profit, 0);

  if (s > 0 && p === 0) {
    return {
      statusLabel: "No purchases",
      statusTone: "risk",
      recommendation: "Pause or debug tracking, offer clarity, and landing page before spending more.",
    };
  }
  if (pr < 0 || r < 1.5) {
    return {
      statusLabel: "Warning",
      statusTone: "warn",
      recommendation: "Refresh creatives, tighten targeting, and verify post-click conversion quality.",
    };
  }
  if (r >= 3 && pr > 0) {
    return {
      statusLabel: "Strong",
      statusTone: "healthy",
      recommendation: "Scale gradually while watching marginal CPA and frequency.",
    };
  }
  return {
    statusLabel: "Monitoring",
    statusTone: "neutral",
    recommendation: "Hold steady and monitor trend before changing budget.",
  };
}

/**
 * Compare stored campaign metrics to freshly derived values (QA / sync checks).
 * @param {CampaignLike & { estimatedProfit?: number, roas?: number, cpa?: number }} campaign
 * @param {{ epsilonMoney?: number, epsilonRatio?: number }} [opts]
 */
export function diffCampaignAgainstDerived(campaign, opts = {}) {
  const epsilonMoney = opts.epsilonMoney ?? 0.5;
  const epsilonRatio = opts.epsilonRatio ?? 0.005;
  const d = deriveCampaignMetrics(campaign);
  const out = { roas: null, cpa: null, profit: null };
  if (campaign.roas != null && d.roas != null) out.roas = Math.abs(campaign.roas - d.roas) > epsilonRatio;
  if (campaign.cpa != null && d.cpa != null) out.cpa = Math.abs(campaign.cpa - d.cpa) > epsilonRatio;
  if (campaign.estimatedProfit != null && d.profit != null) out.profit = Math.abs(campaign.estimatedProfit - d.profit) > epsilonMoney;
  return { derived: d, drift: out };
}
