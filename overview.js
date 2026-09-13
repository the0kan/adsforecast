import { buildPageData, normalizeLiveCampaignRows } from "./app-data.js?v=7";
import { getMetaCampaignContext } from "./app-meta.js?v=8";
import {
  formatCurrency,
  formatPercent,
  formatRatio,
  initAppPage,
  setTopbarIdentity,
  wireCommonShell,
} from "./app-shell.js?v=10";
import { renderSpendRevenueChart } from "./chart.js?v=2";
import { readPreferences } from "./app-preferences.js";
import { applyProfitModelToPage } from "./profit-model.js";

const numberFmt = new Intl.NumberFormat("en-US");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toneForValue(value, type) {
  if (type === "profit") return Number(value) >= 0 ? "positive" : "negative";
  if (type === "roas") return Number(value) >= 3 ? "positive" : Number(value) < 1.5 ? "negative" : "neutral";
  return "neutral";
}

function renderKpis(metrics) {
  const grid = document.getElementById("overview-kpis");
  if (!grid) return;
  const c = metrics.currency || "USD";
  const cards = [
    { label: "Total spend", value: formatCurrency(metrics.totalSpend, c), hint: "Ad spend across active campaigns", icon: "Spend", tone: "neutral" },
    { label: "Revenue", value: formatCurrency(metrics.revenue, c), hint: "Attributed purchase value", icon: "Rev", tone: "positive" },
    { label: "Purchases", value: numberFmt.format(metrics.purchases || 0), hint: "Orders in current window", icon: "Ord", tone: "neutral" },
    { label: "ROAS", value: formatRatio(metrics.roas), hint: "Revenue divided by spend", icon: "ROAS", tone: toneForValue(metrics.roas, "roas") },
    { label: "CPA", value: formatCurrency(metrics.cpa, c, 2), hint: "Spend divided by purchases", icon: "CPA", tone: "neutral" },
    { label: "Estimated profit", value: formatCurrency(metrics.estimatedProfit, c), hint: "Revenue − spend − estimated costs", icon: "Profit", tone: toneForValue(metrics.estimatedProfit, "profit") },
    { label: "Margin est.", value: formatPercent(metrics.margin), hint: "Estimated profit divided by revenue", icon: "Margin", tone: toneForValue(metrics.margin, "profit") },
  ];

  grid.innerHTML = cards
    .map(
      (card) => `
        <article class="metric-card metric-card--premium metric-card--${card.tone}">
          <div class="metric-card__topline">
            <span class="metric-card__label">${card.label}</span>
            <span class="metric-card__icon">${card.icon}</span>
          </div>
          <p class="metric-card__value">${card.value}</p>
          <p class="metric-card__hint">${card.hint}</p>
        </article>`
    )
    .join("");
}

function campaignLine(campaign, currency) {
  if (!campaign) return `<p class="dashboard-section__description">No campaign data yet.</p>`;
  const profit = Number(campaign.estimatedProfit) || 0;
  const signClass = profit >= 0 ? "data-table__positive" : "data-table__negative";
  return `
    <p class="dashboard-section__description overview-driver__name">${escapeHtml(campaign.name || "Unnamed campaign")}</p>
    <div class="overview-driver__metrics">
      <span class="${signClass}">${formatCurrency(profit, currency)}</span>
      <span>ROAS ${formatRatio(campaign.roas || 0)}</span>
      <span>${numberFmt.format(campaign.purchases || 0)} purchases</span>
    </div>
    <p class="overview-driver__recommendation">${escapeHtml(campaign.recommendation || "Monitor performance before making budget changes.")}</p>`;
}

function renderTopWorst(page) {
  const mount = document.getElementById("overview-topworst");
  if (!mount) return;
  const { highlights, metrics } = page;
  const currency = metrics.currency || "USD";
  mount.innerHTML = `
    <article class="dashboard-section overview-driver overview-driver--top">
      <div class="overview-driver__badge">Top Profit Driver</div>
      <h3 class="dashboard-section__title">Best campaign right now</h3>
      ${campaignLine(highlights.topProfit, currency)}
    </article>
    <article class="dashboard-section overview-driver overview-driver--risk">
      <div class="overview-driver__badge overview-driver__badge--risk">Biggest Loss Source</div>
      <h3 class="dashboard-section__title">Needs attention</h3>
      ${campaignLine(highlights.needsAttention || highlights.biggestLoss, currency)}
    </article>`;
}

function renderOperatingBrief(page, preferences) {
  const mount = document.getElementById("overview-command-grid");
  if (!mount) return;
  const rows = page.campaigns || [];
  const currency = page.metrics.currency || "USD";
  const scale = rows.filter((row) => Number(row.roas) >= 3 && Number(row.estimatedProfit) > 0);
  const risk = rows.filter((row) => Number(row.estimatedProfit) < 0 || (Number(row.spend) > 0 && Number(row.purchases) === 0));
  const noPurchases = rows.filter((row) => Number(row.spend) > 0 && Number(row.purchases) === 0);
  const scaleSpend = scale.reduce((sum, row) => sum + (Number(row.spend) || 0), 0);
  const riskSpend = risk.reduce((sum, row) => sum + (Number(row.spend) || 0), 0);
  const sortedRevenue = [...rows].sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0));
  const leader = sortedRevenue[0] || null;
  const leaderShare = page.metrics.revenue > 0 ? (Number(leader?.revenue) || 0) / page.metrics.revenue : 0;
  const model = preferences.profitModel || {};
  const modelRate = (Number(model.cogs) || 0) + (Number(model.fulfillment) || 0) + (Number(model.fees) || 0);
  const sourceLabel = page.live ? "Live Meta data" : page.demo ? "Demo sample data" : "No live dataset";
  const sourceTone = page.live ? "positive" : page.demo ? "neutral" : "warning";

  const actionRows = rows.length
    ? [
        { label: "Scale candidates", value: `${scale.length} · ${formatCurrency(scaleSpend, currency)}`, tone: "positive" },
        { label: "Spend needing review", value: `${risk.length} · ${formatCurrency(riskSpend, currency)}`, tone: risk.length ? "warning" : "positive" },
        { label: "Spend without purchases", value: `${noPurchases.length} campaign${noPurchases.length === 1 ? "" : "s"}`, tone: noPurchases.length ? "negative" : "positive" },
      ]
    : [{ label: "Decision queue", value: "Waiting for campaign data", tone: "neutral" }];

  mount.innerHTML = `
    <article class="dashboard-section overview-brief-card overview-brief-card--actions">
      <div class="overview-brief-card__head"><div><span class="app-section-kicker">Decision queue</span><h2 class="dashboard-section__title">What needs attention now</h2></div><a href="campaigns.html${page.demo ? "?demo=1" : ""}">Open campaigns</a></div>
      <ul class="overview-action-list">${actionRows.map((item) => `<li><span class="overview-signal overview-signal--${item.tone}" aria-hidden="true"></span><span>${item.label}</span><strong>${item.value}</strong></li>`).join("")}</ul>
    </article>
    <article class="dashboard-section overview-brief-card">
      <span class="app-section-kicker">Revenue concentration</span>
      <h2 class="dashboard-section__title">Purchase-value leader</h2>
      <p class="overview-brief-card__primary">${escapeHtml(leader ? leader.name : "No campaign data")}</p>
      <div class="overview-progress" role="progressbar" aria-label="Leader share of purchase value" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(leaderShare * 100)}"><span style="width:${Math.min(100, Math.max(0, leaderShare * 100))}%"></span></div>
      <p class="dashboard-section__description">${leader ? `${formatPercent(leaderShare)} of attributed purchase value · ${formatCurrency(leader.revenue, currency)}` : "Connect a live source to calculate concentration."}</p>
    </article>
    <article class="dashboard-section overview-brief-card">
      <span class="app-section-kicker">Data confidence</span>
      <h2 class="dashboard-section__title">Reporting boundary</h2>
      <div class="overview-source-row"><span class="overview-signal overview-signal--${sourceTone}" aria-hidden="true"></span><strong>${sourceLabel}</strong></div>
      <dl class="overview-boundary-list"><div><dt>Campaigns</dt><dd>${numberFmt.format(rows.length)}</dd></div><div><dt>Cost model</dt><dd>${modelRate}% of revenue</dd></div><div><dt>Window</dt><dd>Last 30 days</dd></div></dl>
    </article>`;
}

function renderSnapshot(page) {
  const hero = document.getElementById("overview-live-msg");
  if (!hero) return;
  if (page.live) {
    hero.textContent = `Live Meta data · ${page.liveAccountId || "connected account"} · ${page.campaigns.length} campaigns loaded`;
  } else if (!page.demo) {
    hero.textContent = page.liveUnavailableMessage || "Live campaign data is temporarily unavailable. No sample data is being shown.";
  } else {
    const rawMessage = page.liveUnavailableMessage || "";
    hero.textContent = /session token|session is missing|not authenticated/i.test(rawMessage)
      ? "Demo workspace · sample campaign data"
      : rawMessage || "Demo workspace · sample campaign data";
  }
}

function renderOverviewState(page) {
  const content = document.querySelector(".dashboard-content");
  if (!content) return;
  content.setAttribute("data-source", page.live ? "live" : page.demo ? "demo" : "offline");
}

async function init() {
  wireCommonShell("overview");
  const auth = await initAppPage("overview.html");
  if (!auth.ok) return;

  const liveCtx = auth.demo
    ? { connection: null, campaigns: [], live: false, message: "Demo workspace · sample campaign data" }
    : await getMetaCampaignContext();
  const liveRows = normalizeLiveCampaignRows(liveCtx.campaigns);
  const basePage = buildPageData({
    liveCampaigns: liveRows,
    liveAccountId: liveCtx.connection?.accountId || "",
    liveCurrency: liveCtx.connection?.currency || "",
    liveSource: liveCtx.live,
    liveUnavailableMessage: liveCtx.message,
    useDemoFallback: auth.demo,
  });
  const preferences = readPreferences(Boolean(auth.demo));
  const page = applyProfitModelToPage(basePage, preferences.profitModel);

  setTopbarIdentity(auth.profile, page.live, page.liveUnavailableMessage, page.demo ? "demo" : "offline");
  renderOverviewState(page);
  renderKpis(page.metrics);
  renderTopWorst(page);
  renderSnapshot(page);
  renderOperatingBrief(page, preferences);

  const chart = document.getElementById("overview-chart");
  if (chart) {
    renderSpendRevenueChart(chart, page.series || { points: [] }, {
      currency: page.metrics.currency,
      source: page.live ? "live" : "demo",
    });
  }
}

init().catch((error) => {
  const main = document.querySelector(".dashboard-content");
  if (main) {
    main.innerHTML = `
      <section class="dashboard-section">
        <h2 class="dashboard-section__title">Could not load overview</h2>
        <p class="dashboard-empty">${error instanceof Error ? error.message : "Unknown dashboard error."}</p>
      </section>`;
  }
});
