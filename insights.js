import { fetchAiInsights, runAiAnalysis } from "./app-ai.js?v=3";
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

let currentRun = null;
let currentRecommendations = [];
let currentHistory = [];
let currentPortfolio = null;
let currentLayers = [];
let currentScenarios = [];
let activeLayerKey = "posture";

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function signedCurrency(value, currency) {
  const amount = Number(value) || 0;
  return `${amount >= 0 ? "+" : "−"}${formatCurrency(Math.abs(amount), currency)}`;
}

function providerLabel(run) {
  if (!run) return "Awaiting analysis";
  if (run.provider === "gemini") return `Gemini · ${run.model || "model"}`;
  if (run.provider === "openai") return `OpenAI · ${run.model || "model"}`;
  return "AdsForecast decision engine";
}

function actionTone(action) {
  if (action === "scale") return "scale";
  if (action === "pause" || action === "review") return "risk";
  return "neutral";
}

function evidenceLabel(key) {
  return String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

function evidenceValue(key, value) {
  if (typeof value !== "number") return String(value);
  if (/ctr|rate|margin|share/i.test(key)) return value <= 1 ? formatPercent(value) : `${value.toFixed(1)}%`;
  if (/roas/i.test(key)) return formatRatio(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function analysisRange(period = "30d") {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0); const days = period === "today" ? 1 : period === "7d" ? 7 : period === "90d" ? 90 : 30; const start = new Date(today); start.setUTCDate(start.getUTCDate() - (days - 1)); return { since: start.toISOString().slice(0, 10), until: today.toISOString().slice(0, 10) };
}

function renderLayerDetail() {
  const mount = document.getElementById("ai-layer-detail"); const layer = currentLayers.find((item) => item.key === activeLayerKey) || currentLayers[0]; if (!mount) return;
  if (!layer) { mount.innerHTML = '<p class="dashboard-empty">Run a new analysis to generate this decision layer.</p>'; return; }
  activeLayerKey = layer.key;
  mount.innerHTML = `<div class="ai-layer-detail__summary"><span>${escapeHtml(layer.title)}</span><h3>${escapeHtml(layer.summary)}</h3></div><div class="ai-layer-signal-grid">${(layer.signals || []).map((signal) => `<article class="ai-layer-signal ai-layer-signal--${escapeHtml(signal.tone || "neutral")}"><div><span>${escapeHtml(signal.label)}</span><strong>${escapeHtml(signal.value)}</strong></div><p>${escapeHtml(signal.interpretation)}</p></article>`).join("") || '<p class="dashboard-empty">No layer signals returned.</p>'}</div><div class="ai-layer-actions"><span>Operator checklist</span><ol>${(layer.actions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join("") || "<li>Review the campaign-level evidence before acting.</li>"}</ol></div>`;
  document.querySelectorAll("[data-ai-layer]").forEach((button) => { const active = button.dataset.aiLayer === activeLayerKey; button.setAttribute("aria-selected", String(active)); button.tabIndex = active ? 0 : -1; });
}

function renderDecisionSystem(payload) {
  const analysisPayload = payload?.run?.analysis_payload || payload?.analysisPayload || {};
  currentLayers = Array.isArray(analysisPayload.layers) ? analysisPayload.layers : []; currentScenarios = Array.isArray(analysisPayload.scenarios) ? analysisPayload.scenarios : [];
  const tabs = document.getElementById("ai-layer-tabs"); if (tabs) tabs.innerHTML = currentLayers.map((layer, index) => `<button type="button" role="tab" data-ai-layer="${escapeHtml(layer.key)}" aria-selected="${layer.key === activeLayerKey}" tabindex="${layer.key === activeLayerKey ? 0 : -1}"><span>0${index + 1}</span>${escapeHtml(layer.title)}</button>`).join("") || '<p class="dashboard-empty">No structured layers in the latest run. Run a new analysis to upgrade the brief.</p>';
  tabs?.querySelectorAll("[data-ai-layer]").forEach((button, index, buttons) => { button.addEventListener("click", () => { activeLayerKey = button.dataset.aiLayer; renderLayerDetail(); }); button.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowRight" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length; buttons[next].click(); buttons[next].focus(); }); });
  if (!currentLayers.some((layer) => layer.key === activeLayerKey)) activeLayerKey = currentLayers[0]?.key || "posture"; renderLayerDetail();
  const scenarios = document.getElementById("ai-scenario-grid"); if (scenarios) scenarios.innerHTML = currentScenarios.map((scenario, index) => `<article><span>Scenario 0${index + 1}</span><h3>${escapeHtml(scenario.name)}</h3><dl><div><dt>Change</dt><dd>${escapeHtml(scenario.change)}</dd></div><div><dt>Expected effect</dt><dd>${escapeHtml(scenario.expected)}</dd></div><div><dt>Guardrail</dt><dd>${escapeHtml(scenario.guardrail)}</dd></div></dl></article>`).join("") || '<p class="dashboard-empty">Run a new analysis to generate bounded scenarios.</p>';
}

function renderRecommendationSummary(items) {
  document.getElementById("insights-count").textContent = String(items.length);
  document.getElementById("insights-scale-count").textContent = String(items.filter((item) => item.action === "scale").length);
  document.getElementById("insights-risk-count").textContent = String(items.filter((item) => item.action === "pause" || item.action === "review").length);
  const confidence = items.length ? items.reduce((sum, item) => sum + (Number(item.confidence) || 0), 0) / items.length : 0;
  document.getElementById("insights-confidence").textContent = items.length ? `${Math.round(confidence * 100)}%` : "—";
}

function renderRecommendations(items) {
  const mount = document.getElementById("insights-list");
  if (!mount) return;
  if (!items.length) {
    mount.innerHTML = `<li class="insight-grid__empty-wrap"><div class="insight-empty"><p class="insight-empty__title">No recommendations in this view</p><p class="insight-empty__text">Reset the filters or run a new analysis after live Meta campaigns are available. No sample recommendations are inserted into a live account.</p></div></li>`;
    return;
  }
  mount.innerHTML = items.map((item, index) => {
    const confidence = Math.round((Number(item.confidence) || 0) * 100);
    const evidence = Object.entries(item.evidence || {}).filter(([, value]) => ["string", "number"].includes(typeof value)).slice(0, 6);
    return `<li><article class="insight-card insight-card--premium insight-card--${actionTone(item.action)}">
      <div class="insight-card__topline"><span class="insight-card__badge">${index + 1}</span><span class="insight-card__priority">${escapeHtml(item.severity || "medium")} priority</span></div>
      <div class="ai-action-row"><span class="ai-action ai-action--${escapeHtml(item.action)}">${escapeHtml(item.action)}</span>${item.campaign_name ? `<span class="ai-campaign" title="${escapeHtml(item.campaign_name)}">${escapeHtml(item.campaign_name)}</span>` : '<span class="ai-campaign">Portfolio-wide</span>'}</div>
      <h3 class="insight-card__title">${escapeHtml(item.title)}</h3>
      <p class="insight-card__text">${escapeHtml(item.rationale)}</p>
      <div class="ai-confidence-meter"><div><span>Model confidence</span><strong>${confidence}%</strong></div><div class="ai-confidence-meter__track" role="img" aria-label="Model confidence ${confidence} percent"><span style="width:${confidence}%"></span></div></div>
      ${evidence.length ? `<dl class="ai-evidence-list">${evidence.map(([key, value]) => `<div><dt>${escapeHtml(evidenceLabel(key))}</dt><dd>${escapeHtml(evidenceValue(key, value))}</dd></div>`).join("")}</dl>` : '<p class="ai-evidence-empty">No numeric evidence was returned for this recommendation.</p>'}
      <div class="ai-feedback" aria-label="Recommendation feedback"><span>Was this useful?</span><button type="button" data-ai-feedback="helpful" aria-pressed="false">Yes</button><button type="button" data-ai-feedback="not-helpful" aria-pressed="false">No</button></div>
    </article></li>`;
  }).join("");
}

function controlState() {
  const focus = document.getElementById("ai-focus-select");
  const confidence = document.getElementById("ai-confidence-range");
  return {
    focus: focus instanceof HTMLSelectElement ? focus.value : "all",
    confidence: confidence instanceof HTMLInputElement ? Number(confidence.value) / 100 : 0,
  };
}

function filteredRecommendations() {
  const { focus, confidence } = controlState();
  return currentRecommendations.filter((item) => {
    if ((Number(item.confidence) || 0) < confidence) return false;
    if (focus === "scale") return item.action === "scale";
    if (focus === "risk") return item.action === "pause" || item.action === "review";
    if (focus === "efficiency") return item.action === "review" || item.action === "hold";
    if (focus === "hold") return item.action === "hold";
    return true;
  });
}

function applyControls() {
  const items = filteredRecommendations();
  renderRecommendationSummary(items);
  renderRecommendations(items);
  const summary = document.getElementById("ai-result-summary");
  if (summary) summary.textContent = `Showing ${items.length} of ${currentRecommendations.length} recommendations. Filters do not alter source data or trigger a new model run.`;
}

function renderRun(run, recommendations, connection, demo) {
  currentRun = run;
  currentRecommendations = recommendations;
  applyControls();
  const completed = run?.completed_at ? new Date(run.completed_at) : null;
  const validCompleted = completed && !Number.isNaN(completed.getTime());
  const message = document.getElementById("insights-live-msg");
  const summary = document.getElementById("ai-executive-summary");
  const provider = document.getElementById("ai-provider-badge");
  const status = document.getElementById("ai-run-status");
  const account = document.getElementById("ai-scope-account");
  const completedField = document.getElementById("ai-scope-completed");
  const campaignCount = document.getElementById("ai-scope-campaigns");
  const windowField = document.getElementById("ai-scope-window");
  if (account) account.textContent = demo ? "Sample Meta account" : connection?.accountName || connection?.accountId || "Not connected";
  if (!run) {
    if (message) message.textContent = "Ready for the first evidence-based campaign analysis.";
    if (summary) summary.textContent = "Connect Meta Ads and run an analysis to receive a prioritized, evidence-led decision brief.";
    if (provider) provider.textContent = "Awaiting analysis";
    if (status) { status.textContent = "Not run"; status.className = "status-pill status-pill--neutral"; }
    if (completedField) completedField.textContent = "—";
    if (campaignCount) campaignCount.textContent = "—";
    return;
  }
  if (message) message.textContent = `Last analyzed ${validCompleted ? completed.toLocaleString() : "recently"} · ${run.campaign_count || 0} campaigns`;
  if (summary) summary.textContent = run.executive_summary || "Analysis completed without an executive summary.";
  if (provider) provider.textContent = demo ? `Sample · ${providerLabel(run)}` : providerLabel(run);
  if (status) { status.textContent = demo ? "Sample" : "Completed"; status.className = `status-pill ${demo ? "status-pill--neutral" : "status-pill--healthy"}`; }
  if (completedField) completedField.textContent = validCompleted ? completed.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Recently";
  if (campaignCount) campaignCount.textContent = String(run.campaign_count || 0);
  if (windowField) windowField.textContent = run.period_start && run.period_end ? `${new Date(`${run.period_start}T00:00:00Z`).toLocaleDateString()} – ${new Date(`${run.period_end}T00:00:00Z`).toLocaleDateString()}` : "Last 30 days";
}

function renderPortfolio(portfolio, model, live, demo) {
  currentPortfolio = portfolio;
  const profit = document.getElementById("ai-portfolio-profit");
  const margin = document.getElementById("ai-portfolio-margin");
  const risk = document.getElementById("ai-portfolio-risk");
  if (profit) profit.textContent = portfolio.rows.length ? signedCurrency(portfolio.profit, portfolio.currency) : "—";
  if (margin) margin.textContent = portfolio.rows.length ? `${formatPercent(portfolio.margin)} contribution margin` : "No campaign evidence";
  if (risk) risk.textContent = portfolio.rows.length ? formatCurrency(portfolio.riskSpend, portfolio.currency) : "—";
  const source = document.getElementById("ai-boundary-source");
  const modelCopy = document.getElementById("ai-boundary-model");
  if (source) source.textContent = demo ? "Explicit sample dataset" : live ? "Live Meta metrics" : "No live campaign dataset";
  if (modelCopy) modelCopy.textContent = `${Math.round(getProfitModelRate(model) * 100)}% variable cost`;

  const diagnostics = document.getElementById("ai-diagnostic-grid");
  if (diagnostics) {
    const rows = [
      ["Ad spend", formatCurrency(portfolio.spend, portfolio.currency), "Meta delivery"],
      ["Purchase value", formatCurrency(portfolio.revenue, portfolio.currency), "Meta attribution"],
      ["Blended ROAS", formatRatio(portfolio.roas), `Break-even ${formatRatio(portfolio.breakEvenRoas)}`],
      ["Purchase coverage", formatPercent(portfolio.attributionCoverage), "Spending campaigns with purchases"],
      ["Top-3 spend share", formatPercent(portfolio.topThreeSpendShare), "Portfolio concentration"],
      ["Median CPC", portfolio.medianCpc == null ? "Unavailable" : formatCurrency(portfolio.medianCpc, portfolio.currency, 2), "Available campaign rows"],
    ];
    diagnostics.innerHTML = rows.map(([term, value, note]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd><small>${escapeHtml(note)}</small></div>`).join("");
  }

  const mix = document.getElementById("ai-decision-mix");
  if (mix) {
    const total = Math.max(1, portfolio.campaignCount);
    const labels = { scale: "Scale", hold: "Hold", repair: "Repair", stop: "Stop-loss" };
    mix.innerHTML = Object.entries(labels).map(([key, label]) => {
      const count = portfolio.decisions[key] || 0;
      return `<div class="ai-decision-mix__row"><div><strong>${label}</strong><span>${count} campaign${count === 1 ? "" : "s"}</span></div><div class="ai-decision-mix__track" role="img" aria-label="${label}: ${count} of ${portfolio.campaignCount} campaigns"><span class="ai-decision-mix__fill ai-decision-mix__fill--${key}" style="width:${portfolio.campaignCount ? Math.max(count ? 4 : 0, count / total * 100) : 0}%"></span></div></div>`;
    }).join("");
  }
}

function renderHistory(history, demo) {
  currentHistory = Array.isArray(history) ? history : [];
  const mount = document.getElementById("ai-history-list");
  if (!mount) return;
  if (!currentHistory.length) {
    mount.innerHTML = '<li class="ai-history-list__empty">No analysis runs yet. The first completed run will create an audit entry.</li>';
    return;
  }
  mount.innerHTML = currentHistory.map((run) => {
    const date = new Date(run.completed_at || run.created_at);
    const valid = !Number.isNaN(date.getTime());
    const statusTone = run.status === "completed" ? "healthy" : run.status === "failed" ? "risk" : "neutral";
    return `<li><span class="ai-history-list__marker" aria-hidden="true"></span><div><strong>${escapeHtml(demo ? "Sample analysis" : providerLabel(run))}</strong><small>${valid ? date.toLocaleString() : "Unknown time"} · ${Number(run.campaign_count) || 0} campaigns</small></div><span class="status-pill status-pill--${statusTone}">${escapeHtml(demo ? "sample" : run.status || "unknown")}</span></li>`;
  }).join("");
}

function demoPayload() {
  const completed = new Date().toISOString();
  const run = { id: "demo_run", status: "completed", completed_at: completed, created_at: completed, period_start: new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10), period_end: completed.slice(0, 10), campaign_count: 4, executive_summary: "Two campaigns protect modeled contribution, while one broad prospecting test needs a creative repair before more budget is committed.", provider: "rules", model: "sample", analysis_payload: { version: 1, layers: [
    { key: "posture", title: "Executive posture", summary: "Selective growth with one repair priority and protected human approval.", signals: [{ label: "Portfolio posture", value: "Selective growth", interpretation: "Scale only the proven lane while holding the rest stable.", tone: "positive" }], actions: ["Review the repair priority first.", "Protect the strongest retargeting signal."] },
    { key: "economics", title: "Portfolio economics", summary: "$1,005 spend produced $2,614 attributed purchase value in this sample.", signals: [{ label: "Blended ROAS", value: "2.60", interpretation: "Above the sample break-even threshold, with uneven campaign distribution.", tone: "positive" }], actions: ["Compare marginal CPA after any budget increase."] },
    { key: "diagnosis", title: "Signal diagnosis", summary: "Broad prospecting loses efficiency after the click and needs measurement-aware creative review.", signals: [{ label: "Primary risk", value: "ASC · Broad test", interpretation: "Spend is rising faster than attributed value.", tone: "warning" }], actions: ["Validate purchase tracking.", "Separate offer, creative and landing-page hypotheses."] },
    { key: "action_plan", title: "Priority action plan", summary: "Repair the broad test, scale retargeting gradually and hold the core campaign stable.", signals: [{ label: "Priority actions", value: "3", interpretation: "One scale, one repair and one hold decision.", tone: "neutral" }], actions: ["Scale retargeting by 10–15%.", "Refresh broad-test creative.", "Hold the core campaign."] },
    { key: "guardrails", title: "Guardrails and measurement", summary: "No action is automatic; every recommendation requires review and a rollback threshold.", signals: [{ label: "Automatic execution", value: "Disabled", interpretation: "The sample never changes campaign state.", tone: "positive" }], actions: ["Change one variable per test.", "Observe a full attribution window.", "Rollback on material CPA drift."] },
  ], scenarios: [{ name: "Controlled scale", change: "Increase retargeting by 10–15%.", expected: "More volume with observable marginal efficiency.", guardrail: "Rollback if CPA drifts materially." }, { name: "Risk containment", change: "Hold broad prospecting after tracking validation.", expected: "Contain exposed spend while testing creative.", guardrail: "Do not pause if attribution is delayed." }, { name: "Measurement hold", change: "Keep core budgets stable.", expected: "Collect cleaner conversion evidence.", guardrail: "Escalate if spend continues without purchases." }] } };
  return {
    run,
    history: [run, { ...run, id: "demo_run_2", completed_at: new Date(Date.now() - 86_400_000).toISOString(), created_at: new Date(Date.now() - 86_400_000).toISOString(), campaign_count: 3 }],
    recommendations: [
      { action: "scale", severity: "high", confidence: 0.92, campaign_name: "Retargeting · 30 days", title: "Scale the most efficient retargeting campaign", rationale: "CPA is below the modeled threshold and contribution remains protected. Increase budget gradually and monitor marginal efficiency.", evidence: { roas: 4.12, purchases: 18, spend: 420, profit: 286 } },
      { action: "review", severity: "high", confidence: 0.87, campaign_name: "ASC · Broad test", title: "Refresh creative before increasing spend", rationale: "Spend is rising faster than purchase value. Hold budget and test a clearer offer with a new creative angle.", evidence: { roas: 1.18, purchases: 3, spend: 310, ctr: 0.012 } },
      { action: "hold", severity: "medium", confidence: 0.78, campaign_name: "Prospecting · Core", title: "Keep the core campaign stable", rationale: "Efficiency is near the acceptable range. Preserve the learning state while collecting more purchase evidence.", evidence: { roas: 2.34, purchases: 9, spend: 275, cpc: 1.14 } },
    ],
  };
}

function renderAiPayload(payload, connection, demo) {
  renderRun(payload.run || null, payload.recommendations || [], connection, demo);
  renderHistory(payload.history || [], demo);
  renderDecisionSystem(payload);
}

async function loadAiPayload(connection) {
  const result = await fetchAiInsights();
  if (!result.ok) throw new Error(result.data?.message || "Could not load AI insights.");
  renderAiPayload(result.data, connection, false);
}

function wireControls(connection, demo) {
  const focus = document.getElementById("ai-focus-select");
  const confidence = document.getElementById("ai-confidence-range");
  const output = document.getElementById("ai-confidence-output");
  const sync = () => {
    if (confidence instanceof HTMLInputElement && output) output.textContent = `${confidence.value}%`;
    applyControls();
  };
  focus?.addEventListener("change", applyControls);
  confidence?.addEventListener("input", sync);
  document.getElementById("ai-reset-controls")?.addEventListener("click", () => {
    if (focus instanceof HTMLSelectElement) focus.value = "all";
    if (confidence instanceof HTMLInputElement) confidence.value = "0";
    sync();
  });
  document.getElementById("ai-export-btn")?.addEventListener("click", () => {
    const items = filteredRecommendations();
    const lines = [
      "AdsForecast AI decision brief",
      currentRun?.completed_at ? `Generated: ${new Date(currentRun.completed_at).toLocaleString()}` : "",
      currentRun?.executive_summary || "",
      currentPortfolio ? `Portfolio: ${formatCurrency(currentPortfolio.spend, currentPortfolio.currency)} spend · ${formatRatio(currentPortfolio.roas)} ROAS · ${signedCurrency(currentPortfolio.profit, currentPortfolio.currency)} modeled profit` : "",
      "",
      ...items.flatMap((item, index) => [`${index + 1}. [${String(item.action).toUpperCase()}] ${item.title}`, `Campaign: ${item.campaign_name || "Workspace"}`, `Confidence: ${Math.round(Number(item.confidence) * 100)}%`, item.rationale, ""]),
      "Advisory only. No campaign changes were made.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `adsforecast-ai-brief-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
  document.getElementById("insights-list")?.addEventListener("click", (event) => {
    const control = event.target.closest("[data-ai-feedback]");
    if (!(control instanceof HTMLButtonElement)) return;
    const group = control.closest(".ai-feedback");
    group?.querySelectorAll("button").forEach((item) => item.setAttribute("aria-pressed", String(item === control)));
    const label = group?.querySelector("span");
    if (label) label.textContent = "Feedback noted";
  });

  const button = document.getElementById("insights-refresh-btn");
  const error = document.getElementById("ai-analysis-error");
  if (!(button instanceof HTMLButtonElement) || !error) return;
  if (demo) {
    button.textContent = "Refresh sample analysis";
    button.addEventListener("click", () => renderAiPayload(demoPayload(), connection, true));
    return;
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Analyzing live campaigns…";
    error.textContent = "";
    try {
      const period = document.getElementById("ai-period-select")?.value || "30d";
      const result = await runAiAnalysis(analysisRange(period));
      if (!result.ok) throw new Error(result.data?.message || "Analysis could not be completed.");
      await loadAiPayload(connection);
    } catch (analysisError) {
      error.textContent = analysisError instanceof Error ? analysisError.message : "Analysis could not be completed.";
    } finally {
      button.disabled = false;
      button.textContent = "Run AI analysis";
    }
  });
}

async function init() {
  wireCommonShell("insights");
  const auth = await initAppPage("insights.html");
  if (!auth.ok) return;
  const demo = Boolean(auth.demo);
  const preferences = readPreferences(demo);
  const periodSelect = document.getElementById("ai-period-select");
  if (periodSelect instanceof HTMLSelectElement) periodSelect.value = auth.profile?.workspaceSettings?.default_period || "30d";
  document.body.classList.toggle("app-density-compact", Boolean(preferences.compactMode));
  const error = document.getElementById("ai-analysis-error");

  const metaContext = demo
    ? { connection: null, campaigns: [], live: false, message: "Sample campaign dataset" }
    : await getMetaCampaignContext(null, analysisRange(periodSelect?.value || "30d"));
  const basePage = buildPageData({
    liveCampaigns: normalizeLiveCampaignRows(metaContext.campaigns),
    liveAccountId: metaContext.connection?.accountId || "",
    liveCurrency: metaContext.connection?.currency || "",
    liveSource: metaContext.live,
    liveUnavailableMessage: metaContext.message,
    useDemoFallback: demo,
  });
  const page = applyProfitModelToPage(basePage, preferences.profitModel);
  renderPortfolio(page.portfolio, preferences.profitModel, page.live, demo);
  setTopbarIdentity(auth.profile, page.live, metaContext.message, demo ? "demo" : page.live ? "live" : "offline");
  if (demo) renderSidebarMetaConnection({ accountId: "demo", accountName: "Sample Meta account" }, "demo");
  else if (metaContext.connection) renderSidebarMetaConnection({ ...metaContext.connection, ...(metaContext.live ? { lastSyncAt: new Date().toISOString(), lastSyncStatus: "success" } : {}) }, "live");

  const payload = demo ? demoPayload() : null;
  if (payload) renderAiPayload(payload, metaContext.connection, true);
  else {
    try {
      await loadAiPayload(metaContext.connection);
    } catch (loadError) {
      if (error) error.textContent = loadError instanceof Error ? loadError.message : "Could not load AI insights.";
      renderAiPayload({ run: null, recommendations: [], history: [] }, metaContext.connection, false);
    }
  }
  wireControls(metaContext.connection, demo);
}

init().catch((error) => {
  const message = document.getElementById("ai-analysis-error");
  if (message) message.textContent = error instanceof Error ? error.message : "Could not initialize AI Analyst.";
});
