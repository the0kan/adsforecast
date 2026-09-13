import { getDashboardPayload } from "./data.js";
import { runInsightsEngine, DEMO_SIGNALS } from "./insights-engine.js";
import {
  aggregateCampaignRollup,
  classifyCampaign,
  deriveCampaignMetrics,
  estimateVariableCostsFromRevenue,
  toNumber,
} from "./metrics.js";

function normalizeCtr(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1 && n <= 100 ? n / 100 : n;
}

function normalizeMoney(raw) {
  return Number.isFinite(Number(raw)) ? Number(raw) : 0;
}

export function normalizeLiveCampaignRows(campaigns) {
  return (Array.isArray(campaigns) ? campaigns : []).map((c, idx) => {
    const spend = normalizeMoney(c?.spend);
    const purchases = normalizeMoney(c?.purchases);
    const revenue = normalizeMoney(c?.purchaseValue ?? c?.revenue);
    const clicks = normalizeMoney(c?.clicks ?? c?.inlineLinkClicks);
    const impressions = normalizeMoney(c?.impressions);
    const costs = c?.costs || { other: estimateVariableCostsFromRevenue(revenue) };
    const derived = deriveCampaignMetrics({ spend, purchases, revenue, clicks, impressions, costs });
    // Keep every surface mathematically consistent: displayed ROAS is always
    // the displayed purchase value divided by displayed spend.
    const roas = spend > 0 ? revenue / spend : 0;
    const estimatedProfit = Number.isFinite(Number(c?.estimatedProfit))
      ? Number(c.estimatedProfit)
      : derived.profit || 0;
    const classified = classifyCampaign({ spend, purchases, roas, profit: estimatedProfit });

    return {
      id: String(c?.campaignId || c?.id || `live_${idx + 1}`),
      externalId: String(c?.campaignId || c?.externalId || ""),
      name: String(c?.campaignName || c?.name || `Campaign ${idx + 1}`),
      spend,
      purchases,
      revenue,
      clicks,
      impressions,
      costs,
      roas,
      cpa: derived.cpa,
      cpc: Number.isFinite(Number(c?.cpc)) ? Number(c.cpc) : derived.cpc,
      ctr: normalizeCtr(c?.ctr) ?? derived.ctr,
      conversionRate: derived.conversionRate,
      aov: derived.aov,
      estimatedProfit,
      margin: derived.margin,
      variableCosts: derived.variableCosts,
      currency: c?.currency || "USD",
      source: "live",
      ...classified,
    };
  });
}

export function enrichCampaign(c, source = "demo") {
  const spend = toNumber(c?.spend, 0);
  const purchases = toNumber(c?.purchases, 0);
  const revenue = toNumber(c?.revenue, 0);
  const clicks = toNumber(c?.clicks, purchases * 34);
  const impressions = toNumber(c?.impressions, clicks * 38);
  const costs = c?.costs || { other: estimateVariableCostsFromRevenue(revenue) };
  const derived = deriveCampaignMetrics({ spend, purchases, revenue, clicks, impressions, costs });
  const roas = toNumber(c?.roas, derived.roas || 0);
  const estimatedProfit = Number.isFinite(Number(c?.estimatedProfit)) ? Number(c.estimatedProfit) : derived.profit || 0;
  const classified = classifyCampaign({ spend, purchases, roas, profit: estimatedProfit });

  return {
    ...c,
    spend,
    purchases,
    revenue,
    clicks,
    impressions,
    costs,
    roas,
    cpa: c?.cpa ?? derived.cpa,
    cpc: c?.cpc ?? derived.cpc,
    ctr: c?.ctr ?? derived.ctr,
    conversionRate: c?.conversionRate ?? derived.conversionRate,
    aov: c?.aov ?? derived.aov,
    estimatedProfit,
    margin: derived.margin,
    variableCosts: derived.variableCosts,
    source,
    statusLabel: c?.statusLabel || classified.statusLabel,
    statusTone: c?.statusTone || classified.statusTone,
    recommendation: c?.recommendation || classified.recommendation,
  };
}

export function getTopAndWorstCampaigns(campaigns) {
  const rows = Array.isArray(campaigns) ? campaigns : [];
  const byProfit = [...rows].sort((a, b) => (Number(b.estimatedProfit) || 0) - (Number(a.estimatedProfit) || 0));
  const byRoas = [...rows].sort((a, b) => (Number(b.roas) || 0) - (Number(a.roas) || 0));
  return {
    topProfit: byProfit[0] || null,
    biggestLoss: byProfit[byProfit.length - 1] || null,
    strongestRoas: byRoas[0] || null,
    needsAttention: rows.find((c) => c.statusTone === "risk") || rows.find((c) => c.statusTone === "warn") || null,
  };
}

export function buildPageData({
  liveCampaigns = [],
  liveAccountId = "",
  liveCurrency = "",
  liveSource = false,
  liveUnavailableMessage = "",
  useDemoFallback = true,
} = {}) {
  const base = getDashboardPayload();
  const liveRows = Array.isArray(liveCampaigns) ? liveCampaigns.filter(Boolean) : [];
  const hasLiveRows = liveRows.length > 0;
  const campaigns = hasLiveRows
    ? liveRows.map((c) => enrichCampaign(c, "live"))
    : useDemoFallback
      ? (base.campaigns || []).map((c) => enrichCampaign(c, "demo"))
      : [];
  const rollup = aggregateCampaignRollup(campaigns);
  const { alerts, insights } = runInsightsEngine(
    { ...base, campaigns },
    { signals: useDemoFallback ? DEMO_SIGNALS : undefined }
  );
  const highlights = getTopAndWorstCampaigns(campaigns);
  const currency = campaigns[0]?.currency || liveCurrency || base.workspace?.currency || "USD";

  return {
    campaigns,
    alerts,
    insights,
    highlights,
    live: Boolean(liveSource) && !useDemoFallback,
    demo: Boolean(useDemoFallback),
    liveAccountId: liveAccountId || "",
    liveUnavailableMessage: liveUnavailableMessage || (useDemoFallback
      ? "Demo workspace · sample campaign data"
      : "Live Meta data is unavailable. No sample data is being shown."),
    metrics: {
      totalSpend: rollup.totalSpend,
      revenue: rollup.totalRevenue,
      purchases: rollup.totalPurchases,
      clicks: rollup.totalClicks,
      impressions: rollup.totalImpressions,
      roas: rollup.blendedRoas || 0,
      cpa: rollup.blendedCpa || 0,
      cpc: rollup.blendedCpc || 0,
      ctr: rollup.blendedCtr || 0,
      conversionRate: rollup.conversionRate || 0,
      aov: rollup.blendedAov || 0,
      estimatedProfit: rollup.estimatedNetProfit || 0,
      variableCosts: rollup.totalVariableCosts,
      margin: rollup.margin || 0,
      currency,
    },
    // Meta's current campaign endpoint returns an aggregate reporting window,
    // not a trustworthy daily time series. Never mix sample chart points into
    // a live workspace: the chart must show an honest empty state instead.
    snapshot: useDemoFallback ? base.performanceLastSevenDays : null,
    series: useDemoFallback ? base.performanceSeries : { points: [] },
    workspace: base.workspace,
    reportingPeriod: base.reportingPeriod,
    profitabilityOverview: base.profitabilityOverview,
    profitExplainer: base.profitExplainer,
  };
}
