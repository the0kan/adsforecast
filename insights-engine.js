/**
 * AdsForecast — rule-based alerts & recommendations (client; portable to server)
 * Inputs: campaign rows + optional trend/budget signals. Outputs match `data.js` shapes.
 *
 * @module insights-engine
 */

import {
  aggregateCampaignRollup,
  deriveCampaignMetrics,
} from "./metrics.js";

/**
 * @typedef {'critical'|'warning'|'info'} AlertSeverity
 */

/**
 * @typedef {object} EngineAlert
 * @property {string} id
 * @property {string} type
 * @property {AlertSeverity} severity
 * @property {string} title
 * @property {string} [campaignId]
 * @property {string} [campaignName]
 * @property {string} body
 */

/**
 * @typedef {object} EngineInsight
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {string[]} [relatedCampaignIds]
 */

/** Default gates — tune per workspace / vertical later. */
export const DEFAULT_THRESHOLDS = {
  /** Ignore tiny tests */
  minCampaignSpend: 400,
  minPurchasesForRule: 30,
  /** Below this ROAS is “weak” if spend is material */
  weakRoas: 3.0,
  /** “Strong” ROAS but thin margin → overlap / fee checks */
  strongRoas: 4.5,
  /** Net margin below this is “thin” after costs */
  weakNetMargin: 0.1,
  /** CPA above median × multiplier */
  highCpaVsMedianMultiplier: 1.22,
  /** Positive profit above this → scale candidate */
  minProfitForScale: 8000,
};

/**
 * Optional signals not derivable from a single static snapshot (fill from sync jobs later).
 * @typedef {object} ExternalSignals
 * @property {number} [portfolioProfitChangeWoW] e.g. -0.11 for −11%
 * @property {Array<{ campaignId: string, spendChangeWoW: number, purchasesChangeWoW: number }>} [budgetWaste]
 */

/**
 * Demo signals so the dashboard matches prior mock narratives until real trends exist.
 */
export const DEMO_SIGNALS = /** @type {ExternalSignals} */ ({
  portfolioProfitChangeWoW: -0.11,
  budgetWaste: [
    {
      campaignId: "cmp_prospecting_core",
      spendChangeWoW: 0.18,
      purchasesChangeWoW: 0.04,
    },
  ],
});

let _idSeq = 0;
function nextId(prefix) {
  _idSeq += 1;
  return `eng_${prefix}_${_idSeq}`;
}

/**
 * @param {number[]} values
 */
function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {object} campaign
 * @param {{ derived: ReturnType<typeof deriveCampaignMetrics> }} enriched
 */
function losingCampaignAlert(campaign, enriched) {
  const profit = enriched.derived.profit;
  if (profit == null || profit >= 0) return null;
  return /** @type {EngineAlert} */ ({
    id: nextId("losing"),
    type: "LOSING_CAMPAIGN",
    severity: "critical",
    title: "Losing campaign",
    campaignId: campaign.id,
    campaignName: campaign.name,
    body:
      "Estimated net profit is negative on this spend window. Pause, narrow the audience, or refresh creative before scaling spend further.",
  });
}

/**
 * @param {object} campaign
 * @param {{ derived: ReturnType<typeof deriveCampaignMetrics> }} enriched
 * @param {number|null} medianCpa
 * @param {typeof DEFAULT_THRESHOLDS} t
 */
function highCpaAlert(campaign, enriched, medianCpa, t) {
  const cpa = enriched.derived.cpa;
  if (
    cpa == null ||
    medianCpa == null ||
    campaign.purchases < t.minPurchasesForRule
  ) {
    return null;
  }
  if (cpa <= medianCpa * t.highCpaVsMedianMultiplier) return null;
  const pct = Math.round(((cpa / medianCpa) - 1) * 100);
  return /** @type {EngineAlert} */ ({
    id: nextId("cpa"),
    type: "HIGH_CPA",
    severity: "warning",
    title: "High CPA warning",
    campaignId: campaign.id,
    campaignName: campaign.name,
    body: `CPA is about ${pct}% above the active-set median. Check creative fatigue, audience overlap, or landing friction.`,
  });
}

/**
 * @param {object} campaign
 * @param {{ derived: ReturnType<typeof deriveCampaignMetrics> }} enriched
 * @param {typeof DEFAULT_THRESHOLDS} t
 */
function weakRoasAlert(campaign, enriched, t) {
  const roas = enriched.derived.roas;
  if (roas == null) return null;
  if (campaign.spend < t.minCampaignSpend) return null;
  if (roas >= t.weakRoas) return null;
  return /** @type {EngineAlert} */ ({
    id: nextId("roas"),
    type: "WEAK_ROAS",
    severity: "warning",
    title: "Weak ROAS",
    campaignId: campaign.id,
    campaignName: campaign.name,
    body:
      "ROAS sits below your efficiency floor on meaningful spend. Validate attribution, offers, and post-click experience before increasing budget.",
  });
}

/**
 * Good headline efficiency but thin net margin after costs.
 * @param {object} campaign
 * @param {{ derived: ReturnType<typeof deriveCampaignMetrics> }} enriched
 * @param {typeof DEFAULT_THRESHOLDS} t
 */
function goodRoasWeakMarginAlert(campaign, enriched, t) {
  const roas = enriched.derived.roas;
  const margin = enriched.derived.margin;
  if (roas == null || margin == null) return null;
  if (campaign.spend < t.minCampaignSpend) return null;
  if (roas < t.strongRoas) return null;
  if (margin >= t.weakNetMargin) return null;
  return /** @type {EngineAlert} */ ({
    id: nextId("margin"),
    type: "WEAK_MARGIN",
    severity: "warning",
    title: "Strong ROAS, thin margin",
    campaignId: campaign.id,
    campaignName: campaign.name,
    body:
      "ROAS looks healthy, but net margin after COGS and fees is thin. Rule out attribution overlap and discount-heavy mix.",
  });
}

/**
 * @param {ExternalSignals} [signals]
 */
function profitTrendAlert(signals) {
  const ch = signals?.portfolioProfitChangeWoW;
  if (ch == null || ch >= -0.05) return null;
  const pct = Math.round(Math.abs(ch) * 100);
  return /** @type {EngineAlert} */ ({
    id: nextId("profit_trend"),
    type: "PROFIT_TREND_DOWN",
    severity: "warning",
    title: "Profit dropping",
    campaignName: "Portfolio · recent vs. prior period",
    body: `Blended estimated profit is down about ${pct}% week over week. Review returns, discounts, and fee drift even if revenue looks stable.`,
  });
}

/**
 * @param {ExternalSignals} [signals]
 * @param {Map<string, object>} campaignById
 */
function budgetWasteAlerts(signals, campaignById) {
  const out = /** @type {EngineAlert[]} */ ([]);
  const rows = signals?.budgetWaste || [];
  for (const row of rows) {
    const c = campaignById.get(row.campaignId);
    if (!c) continue;
    const sPct = Math.round(row.spendChangeWoW * 100);
    const pPct = Math.round(row.purchasesChangeWoW * 100);
    out.push({
      id: nextId("budget"),
      type: "BUDGET_WASTE",
      severity: "info",
      title: "Budget waste risk",
      campaignId: c.id,
      campaignName: c.name,
      body: `Spend is up about ${sPct}% while purchases are up only ~${pPct}% — cap daily budget until efficiency stabilizes.`,
    });
  }
  return out;
}

/**
 * @param {Array<{ raw: object, derived: ReturnType<typeof deriveCampaignMetrics> }>} enriched
 * @param {ReturnType<typeof aggregateCampaignRollup>} rollup
 */
function buildInsights(enriched, rollup) {
  /** @type {EngineInsight[]} */
  const out = [];

  const sortedByProfit = [...enriched].sort(
    (a, b) => (b.derived.profit ?? -Infinity) - (a.derived.profit ?? -Infinity)
  );
  const best = sortedByProfit[0];
  const worst = sortedByProfit[sortedByProfit.length - 1];

  if (
    best &&
    best.derived.profit != null &&
    best.derived.profit >= DEFAULT_THRESHOLDS.minProfitForScale &&
    best.derived.roas != null &&
    best.derived.roas >= DEFAULT_THRESHOLDS.strongRoas
  ) {
    out.push({
      id: nextId("ins_scale"),
      title: "Scale what is already working",
      body: `${best.raw.name} is delivering strong net profit with efficient ROAS. Increase budget in controlled steps while monitoring CPA.`,
      relatedCampaignIds: [best.raw.id],
    });
  }

  if (
    worst &&
    best &&
    worst.raw.id !== best.raw.id &&
    (worst.derived.profit ?? 0) < 0 &&
    (best.derived.profit ?? 0) > 0
  ) {
    out.push({
      id: nextId("ins_shift"),
      title: "Shift budget from losers to winners",
      body: `Consider moving a portion of spend from ${worst.raw.name} toward ${best.raw.name} until the weaker program is rebuilt.`,
      relatedCampaignIds: [worst.raw.id, best.raw.id],
    });
  }

  if (rollup.blendedRoas != null && rollup.margin != null && rollup.margin < 0.12) {
    out.push({
      id: nextId("ins_mix"),
      title: "Review margin mix across channels",
      body:
        "Portfolio net margin is compressed. Pair ad efficiency with product margin data — promotions on low-margin SKUs can inflate ROAS while hurting profit.",
    });
  }

  const weak = enriched.find(
    (r) =>
      r.derived.roas != null &&
      r.derived.roas < DEFAULT_THRESHOLDS.weakRoas &&
      r.raw.spend >= DEFAULT_THRESHOLDS.minCampaignSpend
  );
  if (weak) {
    out.push({
      id: nextId("ins_creative"),
      title: "Refresh creative on the weakest efficient spender",
      body: `${weak.raw.name} is below ROAS targets with real spend. Test new hooks and landing alignment before structural audience changes.`,
      relatedCampaignIds: [weak.raw.id],
    });
  }

  return out.slice(0, 6);
}

/**
 * @param {{ campaigns?: object[] }} payload dashboard bundle (typically `getDashboardPayload()`)
 * @param {{ thresholds?: Partial<typeof DEFAULT_THRESHOLDS>, signals?: ExternalSignals }} [options]
 * @returns {{ alerts: EngineAlert[], insights: EngineInsight[], rollup: ReturnType<typeof aggregateCampaignRollup> }}
 */
export function runInsightsEngine(payload, options = {}) {
  _idSeq = 0;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const signals = options.signals;
  const campaigns = payload.campaigns || [];

  const enriched = campaigns.map((c) => ({
    raw: c,
    derived: deriveCampaignMetrics(c),
  }));

  const rollup = aggregateCampaignRollup(campaigns);

  const cpas = enriched
    .map((e) => e.derived.cpa)
    .filter((x) => x != null);
  const medianCpa = median(/** @type {number[]} */ (cpas));

  const campaignById = new Map(campaigns.map((c) => [c.id, c]));

  /** @type {EngineAlert[]} */
  const alerts = [];

  for (const row of enriched) {
    const c = row.raw;
    const wrap = { derived: row.derived };
    if (c.spend >= thresholds.minCampaignSpend) {
      const a1 = losingCampaignAlert(c, wrap);
      if (a1) alerts.push(a1);
      const a2 = highCpaAlert(c, wrap, medianCpa, thresholds);
      if (a2) alerts.push(a2);
      const a3 = weakRoasAlert(c, wrap, thresholds);
      if (a3) alerts.push(a3);
      const a4 = goodRoasWeakMarginAlert(c, wrap, thresholds);
      if (a4) alerts.push(a4);
    }
  }

  const pt = profitTrendAlert(signals);
  if (pt) alerts.push(pt);

  alerts.push(...budgetWasteAlerts(signals, campaignById));

  const insights = buildInsights(enriched, rollup);

  return { alerts, insights, rollup };
}
