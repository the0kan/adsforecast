import { fetchAiInsights } from "./app-ai.js?v=3";
import { buildPageData, normalizeLiveCampaignRows } from "./app-data.js?v=7";
import { getMetaCampaignContext } from "./app-meta.js?v=8";
import { readPreferences } from "./app-preferences.js";
import {
  formatCurrency,
  formatPercent,
  formatRatio,
  initAppPage,
  renderSidebarMetaConnection,
  setTopbarIdentity,
  wireCommonShell,
} from "./app-shell.js?v=10";
import { applyProfitModelToPage, getProfitModelRate } from "./profit-model.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function signedCurrency(amount, currency) {
  const value = Number(amount) || 0;
  return `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value), currency)}`;
}

function formatCompactAccountId(value) {
  const clean = String(value || "").replace(/^act_/, "");
  return clean.length > 8 ? `•••• ${clean.slice(-6)}` : clean || "Not selected";
}

function formatSyncTime(value, fallback = "Not synced yet") {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusFor(row) {
  const decision = row?.decision || { key: "hold", label: "Hold", tone: "neutral", recommendation: "Collect more evidence before changing budget." };
  const classNames = { scale: "campaigns-table__row--strong", repair: "campaigns-table__row--warn", stop: "campaigns-table__row--risk", hold: "" };
  return { ...decision, className: classNames[decision.key] || "", pillClass: `status-pill--${decision.tone}` };
}

let activeRangeLabel = "Last 30 days";

function renderScope(connection, live, demo) {
  const source = document.getElementById("campaign-scope-source");
  const account = document.getElementById("campaign-scope-account");
  const sync = document.getElementById("campaign-scope-sync");
  const windowLabel = document.getElementById("campaign-scope-window");
  if (source) source.textContent = demo ? "Sample Meta dataset" : live ? "Live Meta Ads" : connection ? "Meta connection · data unavailable" : "Setup required";
  if (account) account.textContent = demo ? "Demo workspace" : connection ? `${connection.accountName || "Meta Ads"} · ${formatCompactAccountId(connection.accountId)}` : "No connected account";
  if (sync) sync.textContent = demo ? "Sample · no live sync" : connection ? formatSyncTime(connection.lastSyncAt || connection.updatedAt) : "Never";
  if (windowLabel) windowLabel.textContent = activeRangeLabel;
}

function renderSummary(portfolio, live, demo) {
  const mount = document.getElementById("campaign-summary-grid");
  if (!mount) return;
  const sourceHint = live ? `Live Meta · ${activeRangeLabel.toLowerCase()}` : demo ? `Explicit sample workspace · ${activeRangeLabel.toLowerCase()}` : "No live campaign dataset";
  const cards = [
    ["Ad spend", formatCurrency(portfolio.spend, portfolio.currency), sourceHint, ""],
    ["Purchase value", formatCurrency(portfolio.revenue, portfolio.currency), `${portfolio.purchases.toLocaleString()} attributed purchases`, ""],
    ["Modeled profit", signedCurrency(portfolio.profit, portfolio.currency), `${formatPercent(portfolio.margin)} contribution margin`, portfolio.profit >= 0 ? "metric-card--profit" : "metric-card--risk"],
    ["Blended ROAS", formatRatio(portfolio.roas), `Break-even ${formatRatio(portfolio.breakEvenRoas)}`, portfolio.roas >= portfolio.breakEvenRoas ? "metric-card--profit" : "metric-card--risk"],
    ["Purchases", portfolio.purchases.toLocaleString(), `${formatPercent(portfolio.attributionCoverage)} campaign coverage`, ""],
    ["Risk spend", formatCurrency(portfolio.riskSpend, portfolio.currency), `${portfolio.decisions.repair + portfolio.decisions.stop} campaigns in repair / stop-loss`, portfolio.riskSpend > 0 ? "metric-card--risk" : ""],
  ];
  mount.innerHTML = cards.map(([label, value, hint, tone]) => `
    <article class="metric-card metric-card--premium ${tone}">
      <h3 class="metric-card__label">${escapeHtml(label)}</h3>
      <p class="metric-card__value">${escapeHtml(value)}</p>
      <p class="metric-card__hint">${escapeHtml(hint)}</p>
    </article>`).join("");
}

function renderDecisionRail(portfolio) {
  const mount = document.getElementById("campaign-decision-rail");
  if (!mount) return;
  const definitions = [
    ["scale", "Scale", "Protected profit and at least 10% above break-even."],
    ["hold", "Hold", "Near threshold or still collecting purchase evidence."],
    ["repair", "Repair", "Modeled loss or ROAS below the current break-even."],
    ["stop", "Stop-loss", "Spend recorded with no attributed purchases."],
  ];
  mount.innerHTML = definitions.map(([key, label, copy]) => {
    const spend = portfolio.rows.filter((row) => row.decision?.key === key).reduce((sum, row) => sum + (Number(row.spend) || 0), 0);
    const marker = key === "scale" ? "scale" : key === "hold" ? "neutral" : key === "repair" ? "warn" : "risk";
    return `<article><span class="campaign-decision-rail__marker campaign-decision-rail__marker--${marker}"></span><div><small>${label} lane</small><strong>${portfolio.decisions[key]} · ${formatCurrency(spend, portfolio.currency)}</strong><p>${copy}</p></div></article>`;
  }).join("");
}

function renderDiagnostics(portfolio) {
  const mount = document.getElementById("campaign-diagnostic-strip");
  if (!mount) return;
  const diagnostics = [
    ["Break-even ROAS", formatRatio(portfolio.breakEvenRoas), "From saved cost model"],
    ["Purchase coverage", formatPercent(portfolio.attributionCoverage), "Spending campaigns with purchases"],
    ["Top-3 concentration", formatPercent(portfolio.topThreeSpendShare), "Share of total spend"],
    ["Median CTR", portfolio.medianCtr == null ? "Not available" : formatPercent(portfolio.medianCtr), "Available campaign rows"],
  ];
  mount.innerHTML = diagnostics.map(([term, value, note]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd><small>${escapeHtml(note)}</small></div>`).join("");
}

function renderAllocation(portfolio) {
  const mount = document.getElementById("campaign-allocation-list");
  if (!mount) return;
  if (!portfolio.rows.length || portfolio.spend <= 0) {
    mount.innerHTML = '<div class="dashboard-empty">No live spend is available for an allocation view.</div>';
    return;
  }
  const rows = [...portfolio.rows].sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0)).slice(0, 6);
  mount.innerHTML = rows.map((row) => {
    const share = (Number(row.spend) || 0) / portfolio.spend;
    const status = statusFor(row);
    return `<div class="campaign-allocation-row">
      <div class="campaign-allocation-row__head"><strong title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</strong><span>${formatCurrency(row.spend, portfolio.currency)} · ${formatPercent(share)}</span></div>
      <div class="campaign-allocation-row__track" role="img" aria-label="${escapeHtml(row.name)} uses ${Math.round(share * 100)} percent of portfolio spend and is in the ${escapeHtml(status.label)} lane"><span class="campaign-allocation-row__fill campaign-allocation-row__fill--${status.key}" style="width:${Math.max(2, share * 100)}%"></span></div>
      <div class="campaign-allocation-row__meta"><span class="status-pill ${status.pillClass}">${escapeHtml(status.label)}</span><span>ROAS ${formatRatio(row.roas)} · Profit ${signedCurrency(row.estimatedProfit, portfolio.currency)}</span></div>
    </div>`;
  }).join("");
}

async function renderAiPreview(demo) {
  const list = document.getElementById("campaign-ai-list");
  const summary = document.getElementById("campaign-ai-summary");
  const provider = document.getElementById("campaign-ai-provider");
  if (!list || !summary || !provider) return;
  let payload;
  if (demo) {
    payload = {
      run: { provider: "rules", executive_summary: "Sample analysis highlights one controlled scaling opportunity and one creative repair priority." },
      recommendations: [
        { action: "scale", title: "Scale the efficient retargeting lane", confidence: 0.92 },
        { action: "review", title: "Repair the broad prospecting creative", confidence: 0.87 },
        { action: "hold", title: "Keep the core campaign stable", confidence: 0.78 },
      ],
    };
  } else {
    const result = await fetchAiInsights();
    if (!result.ok) {
      summary.textContent = result.data?.message || "The latest AI brief is temporarily unavailable.";
      provider.textContent = "Unavailable";
      list.innerHTML = '<li class="campaign-ai-list__empty">Open AI Analyst to retry the analysis.</li>';
      return;
    }
    payload = result.data;
  }
  if (!payload.run) {
    summary.textContent = "No completed analysis yet. Run AI Analyst after your Meta campaigns are loaded.";
    provider.textContent = "Awaiting run";
    list.innerHTML = '<li class="campaign-ai-list__empty">Your first completed analysis will appear here.</li>';
    return;
  }
  summary.textContent = payload.run.executive_summary || "Latest campaign analysis completed.";
  provider.textContent = demo ? "Sample analysis" : payload.run.provider === "gemini" ? "Gemini" : payload.run.provider === "openai" ? "OpenAI" : "Decision engine";
  list.innerHTML = (payload.recommendations || []).slice(0, 3).map((item) => `
    <li><span class="ai-action ai-action--${escapeHtml(item.action)}">${escapeHtml(item.action)}</span><div><strong>${escapeHtml(item.title)}</strong><small>${Math.round((Number(item.confidence) || 0) * 100)}% confidence</small></div></li>`).join("") || '<li class="campaign-ai-list__empty">No recommendations in the latest run.</li>';
}

function renderTable(rows, currency) {
  const tbody = document.getElementById("campaigns-body");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="data-table__empty">No campaigns match this view.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((row) => {
    const status = statusFor(row);
    const ctr = row.ctr == null ? null : Number(row.ctr) > 1 ? Number(row.ctr) / 100 : Number(row.ctr);
    const profit = Number(row.estimatedProfit) || 0;
    return `<tr class="${status.className}" data-campaign-id="${escapeHtml(row.id)}">
      <td class="data-table__primary campaign-name-cell" data-label="Campaign"><button class="campaign-detail-button" type="button" data-campaign-id="${escapeHtml(row.id)}">${escapeHtml(row.name)}</button><small>${escapeHtml(row.externalId ? `ID ${row.externalId}` : row.source === "demo" ? "Sample campaign" : "Meta campaign")}</small></td>
      <td data-label="Spend">${formatCurrency(row.spend, currency)}</td>
      <td data-label="Purchases">${(Number(row.purchases) || 0).toLocaleString()}</td>
      <td data-label="Purchase value">${formatCurrency(row.revenue, currency)}</td>
      <td data-label="ROAS"><strong>${formatRatio(row.roas)}</strong></td>
      <td data-label="Modeled profit" class="${profit >= 0 ? "data-table__positive" : "data-table__negative"}">${signedCurrency(profit, currency)}</td>
      <td data-label="CPA / CPC" class="data-table__stack"><span class="data-table__stack-main">${row.cpa != null ? formatCurrency(row.cpa, currency, 2) : "—"}</span><span class="data-table__stack-sub">${row.cpc != null ? `CPC ${formatCurrency(row.cpc, currency, 2)}` : "CPC unavailable"}</span></td>
      <td data-label="CTR">${ctr != null && Number.isFinite(ctr) ? formatPercent(ctr) : "—"}</td>
      <td data-label="Decision"><span class="status-pill ${status.pillClass}">${escapeHtml(status.label)}</span></td>
      <td data-label="Next move" class="data-table__rec">${escapeHtml(status.recommendation)}</td>
    </tr>`;
  }).join("");
}

function controlState() {
  const filter = document.getElementById("campaign-filter-select");
  const sort = document.getElementById("campaign-sort-select");
  const query = document.getElementById("campaign-search-input");
  return {
    filter: filter instanceof HTMLSelectElement ? filter.value : "all",
    sort: sort instanceof HTMLSelectElement ? sort.value : "spend_desc",
    query: query instanceof HTMLInputElement ? query.value.trim().toLowerCase() : "",
  };
}

function filteredRows(rows) {
  const state = controlState();
  const visible = rows.filter((row) => {
    const decision = statusFor(row);
    const haystack = `${row.name} ${decision.label} ${decision.recommendation}`.toLowerCase();
    if (state.query && !haystack.includes(state.query)) return false;
    if (state.filter === "profitable") return Number(row.estimatedProfit) > 0;
    if (state.filter === "losing") return decision.key === "repair" || decision.key === "stop";
    if (state.filter === "no_purchases") return Number(row.spend) > 0 && Number(row.purchases) === 0;
    if (state.filter === "strong") return decision.key === "scale";
    return true;
  });
  const sorters = {
    spend_desc: (a, b) => Number(b.spend) - Number(a.spend),
    profit_desc: (a, b) => Number(b.estimatedProfit) - Number(a.estimatedProfit),
    revenue_desc: (a, b) => Number(b.revenue) - Number(a.revenue),
    purchases_desc: (a, b) => Number(b.purchases) - Number(a.purchases),
    roas_desc: (a, b) => Number(b.roas) - Number(a.roas),
    cpa_asc: (a, b) => (Number(a.cpa) || Number.POSITIVE_INFINITY) - (Number(b.cpa) || Number.POSITIVE_INFINITY),
  };
  return visible.sort(sorters[state.sort] || sorters.spend_desc);
}

function exportCampaigns(rows, currency) {
  const headers = ["Campaign", "Spend", "Purchases", "Purchase value", "ROAS", "Modeled profit", "CPA", "CPC", "CTR", "Decision", "Recommendation", "Currency"];
  const csv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((row) => [row.name, row.spend, row.purchases, row.revenue, row.roas, row.estimatedProfit, row.cpa ?? "", row.cpc ?? "", row.ctr ?? "", statusFor(row).label, statusFor(row).recommendation, currency].map(csv).join(","));
  const blob = new Blob([[headers.map(csv).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `adsforecast-campaigns-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function wireControls(rows, currency) {
  const count = document.getElementById("campaign-result-count");
  const rerender = () => {
    const visible = filteredRows(rows);
    renderTable(visible, currency);
    if (count) count.textContent = `Showing ${visible.length} of ${rows.length} campaigns`;
  };
  ["campaign-search-input", "campaign-filter-select", "campaign-sort-select"].forEach((id) => {
    const control = document.getElementById(id);
    control?.addEventListener(control instanceof HTMLInputElement ? "input" : "change", rerender);
  });
  document.querySelectorAll("[data-chip-filter]").forEach((button) => button.addEventListener("click", () => {
    const filter = document.getElementById("campaign-filter-select");
    if (filter instanceof HTMLSelectElement) filter.value = button.getAttribute("data-chip-filter") || "all";
    document.querySelectorAll("[data-chip-filter]").forEach((item) => item.classList.toggle("campaign-chip--active", item === button));
    rerender();
  }));
  document.getElementById("campaign-clear-filters")?.addEventListener("click", () => {
    const input = document.getElementById("campaign-search-input");
    const filter = document.getElementById("campaign-filter-select");
    const sort = document.getElementById("campaign-sort-select");
    if (input instanceof HTMLInputElement) input.value = "";
    if (filter instanceof HTMLSelectElement) filter.value = "all";
    if (sort instanceof HTMLSelectElement) sort.value = "spend_desc";
    document.querySelectorAll("[data-chip-filter]").forEach((item) => item.classList.toggle("campaign-chip--active", item.getAttribute("data-chip-filter") === "all"));
    rerender();
  });
  document.getElementById("campaign-export-btn")?.addEventListener("click", () => exportCampaigns(filteredRows(rows), currency));
  rerender();
}

function wireDetails(portfolio, model) {
  const dialog = document.getElementById("campaign-detail-dialog");
  const content = document.getElementById("campaign-detail-content");
  if (!(dialog instanceof HTMLDialogElement) || !content) return;
  const byId = new Map(portfolio.rows.map((row) => [String(row.id), row]));
  document.getElementById("campaigns-body")?.addEventListener("click", (event) => {
    const button = event.target.closest(".campaign-detail-button");
    if (!(button instanceof HTMLButtonElement)) return;
    const row = byId.get(button.dataset.campaignId || "");
    if (!row) return;
    const status = statusFor(row);
    const gap = Number(row.roas) - portfolio.breakEvenRoas;
    const costRate = getProfitModelRate(model);
    const ctr = row.ctr == null ? null : Number(row.ctr) > 1 ? Number(row.ctr) / 100 : Number(row.ctr);
    content.innerHTML = `
      <div class="app-dialog__head"><div><span class="app-section-kicker">Campaign evidence record</span><h2 id="campaign-detail-title">${escapeHtml(row.name)}</h2><p>${escapeHtml(row.externalId ? `Meta campaign ${row.externalId}` : "Current reporting window")}</p></div><button class="app-dialog__close" type="button" data-dialog-close aria-label="Close campaign details"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
      <div class="campaign-detail-status"><span class="status-pill ${status.pillClass}">${escapeHtml(status.label)}</span><span>${gap >= 0 ? "+" : ""}${formatRatio(gap)} ROAS versus break-even</span></div>
      <dl class="campaign-detail-grid">
        <div><dt>Spend</dt><dd>${formatCurrency(row.spend, portfolio.currency)}</dd></div><div><dt>Purchase value</dt><dd>${formatCurrency(row.revenue, portfolio.currency)}</dd></div>
        <div><dt>Purchases</dt><dd>${(Number(row.purchases) || 0).toLocaleString()}</dd></div><div><dt>ROAS</dt><dd>${formatRatio(row.roas)}</dd></div>
        <div><dt>Break-even ROAS</dt><dd>${formatRatio(portfolio.breakEvenRoas)}</dd></div><div><dt>Modeled profit</dt><dd>${signedCurrency(row.estimatedProfit, portfolio.currency)}</dd></div>
        <div><dt>Contribution margin</dt><dd>${formatPercent(row.margin)}</dd></div><div><dt>Variable-cost rate</dt><dd>${formatPercent(costRate)}</dd></div>
        <div><dt>CPA</dt><dd>${row.cpa != null ? formatCurrency(row.cpa, portfolio.currency, 2) : "Unavailable"}</dd></div><div><dt>CPC</dt><dd>${row.cpc != null ? formatCurrency(row.cpc, portfolio.currency, 2) : "Unavailable"}</dd></div>
        <div><dt>CTR</dt><dd>${ctr != null && Number.isFinite(ctr) ? formatPercent(ctr) : "Unavailable"}</dd></div><div><dt>Evidence window</dt><dd>${escapeHtml(activeRangeLabel)}</dd></div>
      </dl>
      <div class="campaign-detail-recommendation"><span>Recommended next move</span><p>${escapeHtml(status.recommendation)}</p></div>
      <div class="campaign-detail-boundary"><strong>Evidence boundary</strong><p>Purchase value and delivery metrics come from Meta. Profit and break-even ROAS use your saved cost assumptions. No campaign was changed.</p></div>`;
    dialog.showModal();
    content.querySelector("[data-dialog-close]")?.addEventListener("click", () => dialog.close(), { once: true });
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}

function toIsoDate(date) { return date.toISOString().slice(0, 10); }

function selectedRange(defaultPeriod = "30d") {
  const params = new URLSearchParams(location.search); const period = params.get("period") || defaultPeriod; const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (period === "custom") { const since = params.get("since"); const until = params.get("until"); if (/^\d{4}-\d{2}-\d{2}$/.test(since || "") && /^\d{4}-\d{2}-\d{2}$/.test(until || "")) return { period, since, until, label: `${new Date(`${since}T00:00:00Z`).toLocaleDateString()} – ${new Date(`${until}T00:00:00Z`).toLocaleDateString()}` }; }
  const days = period === "today" ? 1 : period === "7d" ? 7 : period === "90d" ? 90 : 30; const start = new Date(today); start.setUTCDate(start.getUTCDate() - (days - 1)); return { period: days === 1 ? "today" : `${days}d`, since: toIsoDate(start), until: toIsoDate(today), label: days === 1 ? "Today" : `Last ${days} days` };
}

function wirePeriodControls(range) {
  activeRangeLabel = range.label; document.querySelectorAll("[data-campaign-period]").forEach((button) => { const active = button.dataset.campaignPeriod === range.period; button.setAttribute("aria-pressed", String(active)); button.addEventListener("click", () => { const url = new URL(location.href); url.search = ""; url.searchParams.set("period", button.dataset.campaignPeriod); if (new URLSearchParams(location.search).get("demo") === "1") url.searchParams.set("demo", "1"); location.assign(`${url.pathname.split("/").pop()}?${url.searchParams}`); }); });
  const since = document.getElementById("campaign-date-since"); const until = document.getElementById("campaign-date-until"); if (since) since.value = range.since; if (until) until.value = range.until;
  document.getElementById("campaign-custom-range")?.addEventListener("submit", (event) => { event.preventDefault(); const start = since?.value; const end = until?.value; const days = Math.floor((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86_400_000) + 1; const feedback = document.getElementById("campaign-period-feedback"); if (!start || !end || days < 1 || days > 180) { if (feedback) { feedback.textContent = "Choose a valid range between 1 and 180 days."; feedback.className = "launch-feedback launch-feedback--error"; } return; } const url = new URL(location.href); url.search = ""; url.searchParams.set("period", "custom"); url.searchParams.set("since", start); url.searchParams.set("until", end); if (new URLSearchParams(location.search).get("demo") === "1") url.searchParams.set("demo", "1"); location.assign(`${url.pathname.split("/").pop()}?${url.searchParams}`); });
}

async function init() {
  wireCommonShell("campaigns");
  const auth = await initAppPage("campaigns.html");
  if (!auth.ok) return;
  const preferences = readPreferences(Boolean(auth.demo));
  document.body.classList.toggle("app-density-compact", Boolean(preferences.compactMode));

  const range = selectedRange(auth.profile?.workspaceSettings?.default_period || "30d");
  wirePeriodControls(range);
  const liveContext = auth.demo
    ? { connection: null, campaigns: [], live: false, message: "Demo workspace · sample campaign data" }
    : await getMetaCampaignContext(null, range);
  const basePage = buildPageData({
    liveCampaigns: normalizeLiveCampaignRows(liveContext.campaigns),
    liveAccountId: liveContext.connection?.accountId || "",
    liveCurrency: liveContext.connection?.currency || "",
    liveSource: liveContext.live,
    liveUnavailableMessage: liveContext.message,
    useDemoFallback: auth.demo,
  });
  const page = applyProfitModelToPage(basePage, preferences.profitModel);
  const portfolio = page.portfolio;

  setTopbarIdentity(auth.profile, page.live, liveContext.message, page.demo ? "demo" : "offline");
  if (auth.demo) renderSidebarMetaConnection({ accountId: "demo", accountName: "Sample Meta account" }, "demo");
  else if (liveContext.connection) renderSidebarMetaConnection({ ...liveContext.connection, ...(liveContext.live ? { lastSyncAt: new Date().toISOString(), lastSyncStatus: "success" } : {}) }, "live");
  renderScope(liveContext.connection, page.live, page.demo);
  renderSummary(portfolio, page.live, page.demo);
  renderDecisionRail(portfolio);
  renderDiagnostics(portfolio);
  renderAllocation(portfolio);
  wireControls(portfolio.rows, portfolio.currency);
  wireDetails(portfolio, preferences.profitModel);
  void renderAiPreview(auth.demo);

  const message = document.getElementById("campaigns-live-msg");
  if (message) message.textContent = page.live
    ? `${portfolio.campaignCount} live campaigns · ${liveContext.connection?.accountName || formatCompactAccountId(liveContext.connection?.accountId)}`
    : page.demo ? "Sample workspace · clearly labeled demo campaign data" : liveContext.message || "Live campaigns are unavailable. No sample rows are being shown.";
  document.getElementById("campaigns-refresh-btn")?.addEventListener("click", () => window.location.reload());
}

init().catch((error) => {
  const main = document.getElementById("main-content");
  if (main) main.innerHTML = `<section class="dashboard-section"><h2 class="dashboard-section__title">Campaign workspace unavailable</h2><p class="dashboard-empty">${escapeHtml(error instanceof Error ? error.message : "Could not load campaign intelligence.")}</p></section>`;
});
