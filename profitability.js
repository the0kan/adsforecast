import { buildPageData, normalizeLiveCampaignRows } from "./app-data.js?v=7";
import { getMetaCampaignContext } from "./app-meta.js?v=8";
import { formatCurrency, formatPercent, formatRatio, initAppPage, setTopbarIdentity, wireCommonShell } from "./app-shell.js?v=10";
import { aggregateCampaignRollup } from "./metrics.js";
import { DEFAULT_PREFERENCES, readPreferences, updatePreferences } from "./app-preferences.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function signedCurrency(value, currency) {
  const n = Number(value) || 0;
  const abs = formatCurrency(Math.abs(n), currency);
  return n >= 0 ? `+${abs}` : `−${abs}`;
}

function classifyProfit(value) {
  const n = Number(value) || 0;
  if (n > 0) return "profit-list__amount profit-list__amount--positive";
  if (n < 0) return "profit-list__amount profit-list__amount--negative";
  return "profit-list__amount";
}

function renderKpis(page, profitable, losing) {
  const kpis = document.getElementById("profit-kpis");
  if (!kpis) return;
  const c = page.metrics.currency || "USD";
  const totalSpend = Number(page.metrics.totalSpend) || 0;
  const waste = losing.reduce((sum, row) => sum + Math.abs(Math.min(Number(row.estimatedProfit) || 0, 0)), 0);
  const efficiency = totalSpend > 0 ? Math.max(0, Number(page.metrics.estimatedProfit) || 0) / totalSpend : 0;
  const cards = [
    ["Estimated profit", signedCurrency(page.metrics.estimatedProfit, c), "Contribution after modelled costs", "metric-card--profit"],
    ["Margin estimate", formatPercent(page.metrics.margin), "Profit / revenue", "metric-card--margin"],
    ["Profit / spend", formatRatio(efficiency), "Efficiency of ad budget", ""],
    ["Budget leakage", signedCurrency(-waste, c), `${losing.length} campaigns need attention`, "metric-card--risk"],
    ["Profitable", String(profitable.length), "Positive estimated contribution", ""],
    ["Losing", String(losing.length), "Negative or break-even contribution", ""],
  ];
  kpis.innerHTML = cards
    .map(
      ([label, value, hint, tone]) => `
      <article class="metric-card metric-card--premium ${tone}">
        <h3 class="metric-card__label">${escapeHtml(label)}</h3>
        <p class="metric-card__value">${escapeHtml(value)}</p>
        <p class="metric-card__hint">${escapeHtml(hint)}</p>
      </article>`
    )
    .join("");
}

function renderProfitList(id, rows, currency, emptyText) {
  const mount = document.getElementById(id);
  if (!mount) return;
  if (!rows.length) {
    mount.innerHTML = `<li class="profit-list__empty">${escapeHtml(emptyText)}</li>`;
    return;
  }
  mount.innerHTML = rows
    .slice(0, 8)
    .map((c, idx) => {
      const roas = formatRatio(c.roas || 0);
      const purchases = new Intl.NumberFormat("en-US").format(Number(c.purchases) || 0);
      return `<li class="profit-list__item">
        <span class="profit-list__rank">${idx + 1}</span>
        <span class="profit-list__body">
          <strong>${escapeHtml(c.name)}</strong>
          <small>ROAS ${escapeHtml(roas)} · ${escapeHtml(purchases)} purchases</small>
        </span>
        <span class="${classifyProfit(c.estimatedProfit)}">${escapeHtml(signedCurrency(c.estimatedProfit, currency))}</span>
      </li>`;
    })
    .join("");
}

function renderDrivers(profitable, losing, currency) {
  const top = [...profitable].sort((a, b) => (Number(b.estimatedProfit) || 0) - (Number(a.estimatedProfit) || 0))[0];
  const risk = [...losing].sort((a, b) => (Number(a.estimatedProfit) || 0) - (Number(b.estimatedProfit) || 0))[0];
  const topTitle = document.getElementById("profit-top-title");
  const topCopy = document.getElementById("profit-top-copy");
  const riskTitle = document.getElementById("profit-risk-title");
  const riskCopy = document.getElementById("profit-risk-copy");

  if (topTitle) topTitle.textContent = top?.name || "No profit driver yet";
  if (topCopy) {
    topCopy.textContent = top
      ? `${signedCurrency(top.estimatedProfit, currency)} estimated contribution. Keep scaling gradually while monitoring CPA and margin.`
      : "Connect live campaign data or wait for more conversions to identify a reliable winner.";
  }

  if (riskTitle) riskTitle.textContent = risk?.name || "No major loss source";
  if (riskCopy) {
    riskCopy.textContent = risk
      ? `${signedCurrency(risk.estimatedProfit, currency)} estimated contribution. Reduce spend, refresh creative, or verify tracking before scaling.`
      : "No campaign is materially negative in the current dataset.";
  }
}

function renderVisual(metrics, profitable, losing) {
  const profit = document.getElementById("profit-visual-profit");
  const margin = document.getElementById("profit-visual-margin");
  const winners = document.getElementById("profit-visual-winners");
  const losers = document.getElementById("profit-visual-losers");
  const c = metrics.currency || "USD";
  if (profit) profit.textContent = signedCurrency(metrics.estimatedProfit, c);
  if (margin) margin.textContent = formatPercent(metrics.margin);
  if (winners) winners.textContent = String(profitable.length);
  if (losers) losers.textContent = String(losing.length);
}

function normalizeModel(model) {
  return {
    cogs: Math.max(0, Number(model?.cogs) || 0),
    fulfillment: Math.max(0, Number(model?.fulfillment) || 0),
    fees: Math.max(0, Number(model?.fees) || 0),
  };
}

function modelRate(model) {
  const m = normalizeModel(model);
  return (m.cogs + m.fulfillment + m.fees) / 100;
}

function applyProfitModel(page, model) {
  const rate = modelRate(model);
  const campaigns = page.campaigns.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const spend = Number(row.spend) || 0;
    const variableCosts = revenue * rate;
    const estimatedProfit = revenue - spend - variableCosts;
    return {
      ...row,
      costs: { other: variableCosts },
      variableCosts,
      estimatedProfit,
      margin: revenue > 0 ? estimatedProfit / revenue : 0,
    };
  });
  const rollup = aggregateCampaignRollup(campaigns);
  return {
    ...page,
    campaigns,
    metrics: {
      ...page.metrics,
      estimatedProfit: rollup.estimatedNetProfit || 0,
      variableCosts: rollup.totalVariableCosts || 0,
      margin: rollup.margin || 0,
    },
  };
}

function renderWaterfall(metrics) {
  const mount = document.getElementById("profit-waterfall");
  if (!mount) return;
  const currency = metrics.currency || "USD";
  const revenue = Number(metrics.revenue) || 0;
  const spend = Number(metrics.totalSpend) || 0;
  const costs = Number(metrics.variableCosts) || 0;
  const profit = Number(metrics.estimatedProfit) || 0;
  const base = Math.max(revenue, spend, costs, Math.abs(profit), 1);
  const rows = [
    { label: "Purchase value", value: revenue, tone: "revenue" },
    { label: "Ad spend", value: -spend, tone: "spend" },
    { label: "Modelled variable costs", value: -costs, tone: "cost" },
    { label: "Estimated profit", value: profit, tone: profit >= 0 ? "profit" : "loss" },
  ];
  mount.innerHTML = rows.map((row) => `<div class="profit-waterfall__row"><div><span>${row.label}</span><strong>${signedCurrency(row.value, currency)}</strong></div><div class="profit-waterfall__track"><span class="profit-waterfall__bar profit-waterfall__bar--${row.tone}" style="width:${Math.max(3, Math.min(100, Math.abs(row.value) / base * 100))}%"></span></div></div>`).join("");
}

function renderModelCopy(model) {
  const rate = modelRate(model);
  const retained = Math.max(0, 1 - rate);
  const formula = document.getElementById("profit-formula-copy");
  const total = document.getElementById("profit-model-total");
  if (formula) formula.textContent = `Purchase value × ${(retained * 100).toFixed(1).replace(/\.0$/, "")}% − ad spend`;
  if (total) total.textContent = `${(rate * 100).toFixed(1).replace(/\.0$/, "")}% variable cost`;
}

function hydrateModelForm(model) {
  const normalized = normalizeModel(model);
  const fields = { cogs: "profit-model-cogs", fulfillment: "profit-model-fulfillment", fees: "profit-model-fees" };
  Object.entries(fields).forEach(([key, id]) => {
    const input = document.getElementById(id);
    if (input instanceof HTMLInputElement) input.value = String(normalized[key]);
  });
}

function readModelForm() {
  const value = (id) => Number(document.getElementById(id)?.value);
  return normalizeModel({ cogs: value("profit-model-cogs"), fulfillment: value("profit-model-fulfillment"), fees: value("profit-model-fees") });
}

function setModelFeedback(message, error = false) {
  const feedback = document.getElementById("profit-model-feedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `account-feedback${error ? " account-feedback--error" : ""}`;
}

async function init() {
  wireCommonShell("profitability");
  const auth = await initAppPage("profitability.html");
  if (!auth.ok) return;

  const liveCtx = auth.demo
    ? { connection: null, campaigns: [], live: false, message: "Demo workspace · sample campaign data" }
    : await getMetaCampaignContext();
  const page = buildPageData({
    liveCampaigns: normalizeLiveCampaignRows(liveCtx.campaigns),
    liveAccountId: liveCtx.connection?.accountId || "",
    liveCurrency: liveCtx.connection?.currency || "",
    liveSource: liveCtx.live,
    liveUnavailableMessage: liveCtx.message,
    useDemoFallback: auth.demo,
  });
  setTopbarIdentity(auth.profile, page.live, liveCtx.message, page.demo ? "demo" : "offline");
  let currentModel = readPreferences(Boolean(auth.demo)).profitModel;
  const renderPage = () => {
    const modelledPage = applyProfitModel(page, currentModel);
    const currency = modelledPage.metrics.currency || "USD";
    const profitable = modelledPage.campaigns.filter((c) => (Number(c.estimatedProfit) || 0) > 0).sort((a, b) => (Number(b.estimatedProfit) || 0) - (Number(a.estimatedProfit) || 0));
    const losing = modelledPage.campaigns.filter((c) => (Number(c.estimatedProfit) || 0) <= 0).sort((a, b) => (Number(a.estimatedProfit) || 0) - (Number(b.estimatedProfit) || 0));
    renderKpis(modelledPage, profitable, losing);
    renderProfitList("profit-losing-list", losing, currency, "No losing campaigns in the current dataset.");
    renderProfitList("profit-winning-list", profitable, currency, "No profitable campaigns in the current dataset yet.");
    renderDrivers(profitable, losing, currency);
    renderVisual(modelledPage.metrics, profitable, losing);
    renderWaterfall(modelledPage.metrics);
    renderModelCopy(currentModel);
  };
  hydrateModelForm(currentModel);
  renderPage();

  document.getElementById("profit-model-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = readModelForm();
    const total = (next.cogs + next.fulfillment + next.fees);
    if (total > 95) {
      setModelFeedback("Keep total variable costs at or below 95% so the model remains meaningful.", true);
      return;
    }
    currentModel = next;
    const saved = updatePreferences({ profitModel: next }, Boolean(auth.demo));
    setModelFeedback(saved ? "Profit model applied and saved in this browser." : "Model applied, but this browser could not save it.", !saved);
    renderPage();
  });
  document.getElementById("profit-model-reset")?.addEventListener("click", () => {
    currentModel = { ...DEFAULT_PREFERENCES.profitModel };
    hydrateModelForm(currentModel);
    updatePreferences({ profitModel: currentModel }, Boolean(auth.demo));
    setModelFeedback("Default 65% variable-cost model restored.");
    renderPage();
  });

  const msg = document.getElementById("profitability-live-msg");
  if (msg) {
    msg.textContent = page.live
      ? `Live Meta profitability model · ${liveCtx.connection?.accountId || "connected account"}`
      : page.demo
        ? "Demo workspace · sample profitability model"
        : liveCtx.message || "Live profitability data is unavailable. No sample campaigns are being used.";
  }

  const refresh = document.getElementById("profitability-refresh-btn");
  if (refresh instanceof HTMLButtonElement) refresh.addEventListener("click", () => window.location.reload());
}

init();
