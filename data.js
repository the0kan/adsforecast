/**
 * AdsForecast — mock data layer (client-side)
 * Replace with API responses later; keep shapes stable for dashboard.js + calculators.
 * @module data
 */

export const ADSFORECAST_DATA_VERSION = "1.0.0";

/** @typedef {'USD'|'EUR'|'GBP'} CurrencyCode */

/**
 * Workspace / tenant — future: maps to org row + billing.
 */
export const workspace = {
  id: "ws_nw_01",
  name: "Northwind Commerce",
  slug: "northwind-commerce",
  currency: /** @type {CurrencyCode} */ ("USD"),
  timezone: "America/Los_Angeles",
};

/**
 * Reporting window for headline KPIs (matches dashboard copy).
 */
export const reportingPeriod = {
  id: "rp_30d_rolling",
  label: "Last 30 days",
  start: "2026-03-21",
  end: "2026-04-20",
  sourceLabel: "Blended across connected sources",
};

/**
 * Portfolio-level metrics — numbers align with static dashboard.html.
 * Later: recomputed from campaigns + attribution rules; headline CPA may differ from simple spend/purchases.
 */
const campaignProfitSum =
  22640 + 15210 - 2180 - 4020 + 1240;

export const portfolioMetrics = {
  totalSpend: 48920,
  revenue: 214580,
  /** Blended ROAS = revenue / spend */
  roas: 214580 / 48920,
  /** Shown in UI as $31.40 — store for display; refine when attribution model is implemented */
  cpa: 31.4,
  /** Estimated after COGS, shipping, fees (workspace defaults applied) */
  estimatedProfit: 58140,
  /** profit / revenue */
  margin: 58140 / 214580,
  purchases: 1674,
  currency: workspace.currency,
  /** Sum of `campaigns[].estimatedProfit` — reconciles to headline via adjustments */
  campaignEstimatedProfitSum: campaignProfitSum,
  /** Fee true-ups, returns, and non-campaign-attributed revenue effects (mock) */
  profitAdjustments: 58140 - campaignProfitSum,
  profitAdjustmentsLabel: "Returns, payment fees & attribution true-ups",
};

/**
 * @typedef {'healthy'|'warn'|'risk'} StatusTone
 * Maps to status-pill--* in dashboard.css
 */

/**
 * @typedef {Object} CampaignRecord
 * @property {string} id
 * @property {string} externalId
 * @property {string} name
 * @property {number} spend
 * @property {number} purchases
 * @property {number} revenue
 * @property {{ product: number, shipping: number, fees: number }} costs Estimated attributable costs for profit
 * @property {number} estimatedProfit revenue - spend - product - shipping - fees
 * @property {number} roas revenue / spend
 * @property {number} cpa spend / purchases
 * @property {string} statusLabel e.g. Scaling, Active
 * @property {StatusTone} statusTone
 * @property {string[]} [tags] Search / filter tokens (demo)
 */

/** @type {CampaignRecord[]} */
export const campaigns = [
  {
    id: "cmp_prospecting_core",
    externalId: "2384xxxxxxxx",
    name: "Prospecting · Core SKUs",
    tags: ["prospecting", "scale", "sku"],
    spend: 18400,
    purchases: 612,
    revenue: 96200,
    costs: { product: 47360, shipping: 3840, fees: 3960 },
    estimatedProfit: 22640,
    roas: 96200 / 18400,
    cpa: 18400 / 612,
    clicks: 19840,
    impressions: 742100,
    conversionRate: 612 / 19840,
    aov: 96200 / 612,
    trend: "up",
    recommendation: "Scale carefully; this is the strongest profit driver in the current mix.",
    statusLabel: "Scaling",
    statusTone: "healthy",
  },
  {
    id: "cmp_rt_cart",
    externalId: "2384yyyyyyyy",
    name: "Retargeting · Cart abandoners",
    tags: ["retargeting", "cart", "active"],
    spend: 9120,
    purchases: 418,
    revenue: 54880,
    costs: { product: 26000, shipping: 2190, fees: 2360 },
    estimatedProfit: 15210,
    roas: 54880 / 9120,
    cpa: 9120 / 418,
    clicks: 11240,
    impressions: 318500,
    conversionRate: 418 / 11240,
    aov: 54880 / 418,
    trend: "up",
    recommendation: "Protect budget; retargeting is efficient and should stay funded.",
    statusLabel: "Active",
    statusTone: "healthy",
  },
  {
    id: "cmp_asc_broad",
    externalId: "2384zzzzzzzz",
    name: "ASC · Broad · Creative test",
    tags: ["asc", "broad", "creative", "review"],
    spend: 12050,
    purchases: 290,
    revenue: 38940,
    costs: { product: 25800, shipping: 2060, fees: 1210 },
    estimatedProfit: -2180,
    roas: 38940 / 12050,
    cpa: 12050 / 290,
    clicks: 16780,
    impressions: 621000,
    conversionRate: 290 / 16780,
    aov: 38940 / 290,
    trend: "down",
    recommendation: "Refresh creative and test a cleaner offer before raising budget.",
    statusLabel: "Review",
    statusTone: "risk",
  },
  {
    id: "cmp_holiday_lal",
    externalId: "2384aaaaaaaa",
    name: "Holiday push · Lookalike 1%",
    tags: ["holiday", "lookalike", "losing"],
    spend: 6780,
    purchases: 156,
    revenue: 17200,
    costs: { product: 12880, shipping: 820, fees: 740 },
    estimatedProfit: -4020,
    roas: 17200 / 6780,
    cpa: 6780 / 156,
    clicks: 9100,
    impressions: 268400,
    conversionRate: 156 / 9100,
    aov: 17200 / 156,
    trend: "down",
    recommendation: "Reduce spend until audience quality and offer alignment improve.",
    statusLabel: "Losing",
    statusTone: "risk",
  },
  {
    id: "cmp_brand_defense",
    externalId: "2384bbbbbbbb",
    name: "Brand defense · Search parity",
    tags: ["brand", "defense", "search", "watch"],
    spend: 2570,
    purchases: 198,
    revenue: 7360,
    costs: { product: 3070, shipping: 240, fees: 240 },
    estimatedProfit: 1240,
    roas: 7360 / 2570,
    cpa: 2570 / 198,
    clicks: 6400,
    impressions: 121500,
    conversionRate: 198 / 6400,
    aov: 7360 / 198,
    trend: "flat",
    recommendation: "Monitor attribution overlap; ROAS can look better than true margin here.",
    statusLabel: "Watch",
    statusTone: "warn",
  },
];

/**
 * Last 7 days snapshot (side panel) — matches dashboard copy.
 */
export const performanceLastSevenDays = {
  id: "perf_7d_current",
  label: "Last 7 days",
  revenue: 52400,
  spend: 11280,
  roas: 52400 / 11280,
  estimatedProfit: 14900,
  compareToLabel: "Compared to prior week",
  lastSyncedAt: "2026-04-20T14:48:00.000Z",
  lastSyncedRelative: "12 minutes ago",
};

/**
 * Placeholder series for future chart component (daily points).
 */
export const performanceSeries = {
  granularity: "day",
  points: [
    { date: "2026-04-14", spend: 1520, revenue: 6820 },
    { date: "2026-04-15", spend: 1640, revenue: 7100 },
    { date: "2026-04-16", spend: 1580, revenue: 6980 },
    { date: "2026-04-17", spend: 1720, revenue: 7420 },
    { date: "2026-04-18", spend: 1690, revenue: 7280 },
    { date: "2026-04-19", spend: 1610, revenue: 7050 },
    { date: "2026-04-20", spend: 1540, revenue: 6750 },
  ],
};

/**
 * @typedef {'critical'|'warning'|'info'} AlertSeverity
 * @typedef {'LOSING_CAMPAIGN'|'HIGH_CPA'|'WEAK_ROAS'|'PROFIT_TREND_DOWN'|'BUDGET_WASTE'} AlertType
 */

/**
 * Rule-based alerts — tie to campaign ids for future engine.
 * @type {Array<{ id: string, type: string, severity: AlertSeverity, title: string, campaignId?: string, campaignName?: string, body: string }>}
 */
export const alerts = [
  {
    id: "alt_001",
    type: "LOSING_CAMPAIGN",
    severity: "critical",
    title: "Losing campaign",
    campaignId: "cmp_holiday_lal",
    campaignName: "Holiday push · Lookalike 1%",
    body:
      "Estimated profit is negative for 10 consecutive days while spend holds steady. Consider pausing or tightening audience.",
  },
  {
    id: "alt_002",
    type: "HIGH_CPA",
    severity: "warning",
    title: "High CPA warning",
    campaignId: "cmp_asc_broad",
    campaignName: "ASC · Broad · Creative test",
    body:
      "CPA is 28% above your 30-day median with flat conversion rate. Creative fatigue or audience overlap is likely.",
  },
  {
    id: "alt_003",
    type: "WEAK_ROAS",
    severity: "warning",
    title: "Weak ROAS",
    campaignId: "cmp_brand_defense",
    campaignName: "Brand defense · Search parity",
    body:
      "ROAS looks acceptable but margin after fees is thin. Verify attribution overlap with organic brand traffic.",
  },
  {
    id: "alt_004",
    type: "PROFIT_TREND_DOWN",
    severity: "warning",
    title: "Profit dropping",
    campaignName: "Portfolio · Last 7 vs. prior 7",
    body:
      "Blended estimated profit is down 11% week over week despite stable revenue. Check returns and discount mix.",
  },
  {
    id: "alt_005",
    type: "BUDGET_WASTE",
    severity: "info",
    title: "Budget waste risk",
    campaignId: "cmp_prospecting_core",
    campaignName: "Prospecting · Core SKUs",
    body:
      "Spend increased 18% while incremental purchases rose only 4%. Cap daily budget until efficiency recovers.",
  },
];

/**
 * Insight cards — mix of strategic recommendations (future: scored / ranked).
 * @type {Array<{ id: string, title: string, body: string, relatedCampaignIds?: string[] }>}
 */
export const insights = [
  {
    id: "ins_001",
    title: "Shift budget from ASC test to retargeting",
    body:
      "Retargeting shows a 38% lower CPA with higher margin orders. Reallocate ~$2k/week until ASC creative refresh ships.",
    relatedCampaignIds: ["cmp_asc_broad", "cmp_rt_cart"],
  },
  {
    id: "ins_002",
    title: "Tighten the losing lookalike audience",
    body:
      "Exclude recent purchasers and narrow age/geo to match your top decile LTV. Model suggests CPA could improve within 5–7 days.",
    relatedCampaignIds: ["cmp_holiday_lal"],
  },
  {
    id: "ins_003",
    title: "Validate WooCommerce returns against ad windows",
    body:
      "Return rate spiked on SKUs promoted in prospecting. Sync returns nightly (enabled) to avoid overstating ROAS on those items.",
    relatedCampaignIds: ["cmp_prospecting_core"],
  },
  {
    id: "ins_004",
    title: "Promote your strongest creative angle",
    body:
      "UGC-style hooks are driving 22% higher purchase value in prospecting. Duplicate the top 2 ads into a dedicated ad set.",
    relatedCampaignIds: ["cmp_prospecting_core"],
  },
];

/**
 * @typedef {'connected'|'syncing'|'disconnected'} IntegrationState
 */

/**
 * @type {Array<{ id: string, provider: 'meta_ads'|'woocommerce'|'shopify', displayName: string, detail: string, state: IntegrationState, meta: string, externalRef?: string }>}
 */
export const integrations = [
  {
    id: "int_meta_01",
    provider: "meta_ads",
    displayName: "Meta Ads",
    detail: "Ad account · Northwind Commerce",
    state: "connected",
    meta: "Last sync · 12 minutes ago",
    externalRef: "act_1234567890",
  },
  {
    id: "int_woo_01",
    provider: "woocommerce",
    displayName: "WooCommerce",
    detail: "Store · shop.northwind.com",
    state: "syncing",
    meta: "Incremental orders · in progress",
    externalRef: "https://shop.northwind.com",
  },
  {
    id: "int_shopify_01",
    provider: "shopify",
    displayName: "Shopify",
    detail: "Not linked",
    state: "disconnected",
    meta: "Connect to include Shopify revenue in blended metrics",
  },
];

/**
 * Profitability snapshot blocks — derived highlights for UI.
 */
export const profitabilityOverview = {
  highestProfit: {
    label: "Highest profit campaign",
    campaignId: "cmp_prospecting_core",
    campaignName: "Prospecting · Core SKUs",
    valueLabel: "+$22,640 est.",
    estimatedProfit: 22640,
  },
  worst: {
    label: "Worst campaign",
    campaignId: "cmp_holiday_lal",
    campaignName: "Holiday push · Lookalike 1%",
    valueLabel: "−$4,020 est.",
    estimatedProfit: -4020,
  },
  strongestRoas: {
    label: "Strongest ROAS",
    campaignId: "cmp_rt_cart",
    campaignName: "Retargeting · Cart abandoners",
    valueLabel: "6.02",
    roas: 54880 / 9120,
  },
  biggestWaste: {
    label: "Biggest waste source",
    campaignId: "cmp_asc_broad",
    campaignName: "ASC · Broad · Creative test",
    valueLabel: "−$2,180 est. · high CPA",
    estimatedProfit: -2180,
  },
};

/**
 * UI shell — top bar copy (future: route-driven).
 */
export const dashboardShell = {
  pageTitle: "Overview",
  pageSubtitle: "Unified performance across Meta Ads and your connected stores.",
  searchPlaceholder: "Search campaigns, SKUs, or tags",
  user: {
    displayName: "Alex Morgan",
    id: "usr_alex_demo",
  },
};

/**
 * Dashboard copy — why profit-first beats ROAS-only (educational; not computed).
 */
export const profitExplainer = {
  title: "Why estimated profit beats ROAS alone",
  lead:
    "Meta’s conversion metrics are directional. True profitability ties ad spend to store revenue, costs, fees, and returns.",
  bullets: [
    "Platform ROAS uses attribution windows and modeled data; your P&L includes refunds, discounts, and off-platform sales.",
    "Estimated profit applies COGS, shipping, and payment fees from workspace defaults — adjust these when you connect real ledgers.",
    "A campaign can show strong ROAS while destroying margin if product mix, fees, or returns are worse than average.",
  ],
};

/**
 * Document metadata for cache busting / debugging.
 */
export const meta = {
  schemaVersion: ADSFORECAST_DATA_VERSION,
  generatedAt: "2026-04-20T12:00:00.000Z",
  environment: "mock",
};

const bundle = {
  meta,
  workspace,
  reportingPeriod,
  portfolioMetrics,
  campaigns,
  performanceLastSevenDays,
  performanceSeries,
  alerts,
  insights,
  integrations,
  profitabilityOverview,
  dashboardShell,
  profitExplainer,
};

export default bundle;

/**
 * Future API: GET /v1/workspaces/:id/dashboard
 * @returns {typeof bundle}
 */
export function getDashboardPayload() {
  return JSON.parse(JSON.stringify(bundle));
}
