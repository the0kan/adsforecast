/**
 * AdsForecast — dashboard client (mock data → DOM)
 * Swap `getDashboardPayload()` for a fetch later; keep render functions pure where possible.
 */

import { getDashboardPayload } from "./data.js";
import { deriveCampaignMetrics } from "./metrics.js";
import { runInsightsEngine, DEMO_SIGNALS } from "./insights-engine.js";
import {
  getSession,
  signOutToLogin,
  setSession,
} from "./auth.js";
import {
  getFunctionsBase,
  isSupabaseMode,
} from "./config.js";
import { renderSpendRevenueChart } from "./chart.js";
import { getSupabaseAccessToken, getSupabaseClient } from "./supabase.js";

const DISMISSED_ALERTS_KEY = "adsforecast.dismissedAlertIds.v1";
const INTEGRATION_DEMO_KEY = "adsforecast.demo.integrationOverrides.v1";
const LIVE_META_STATE_KEY = "adsforecast.meta.liveState.v1";
const LEGACY_STORAGE_PREFIX = ["ad", "profit"].join("");

function readStorageWithMigration(key) {
  const current = localStorage.getItem(key);
  if (current != null) return current;
  const legacyKey = key.replace(/^adsforecast/, LEGACY_STORAGE_PREFIX);
  const legacy = localStorage.getItem(legacyKey);
  if (legacy != null) localStorage.setItem(key, legacy);
  return legacy;
}

/**
 * Reads `?meta=` from the URL (OAuth return), then removes it from the address bar.
 * @returns {string} e.g. connected | select-account | denied | oauth_error
 */
function consumeMetaOAuthQueryParams() {
  try {
    const u = new URL(window.location.href);
    const meta = u.searchParams.get("meta");
    if (!meta) return "";
    u.searchParams.delete("meta");
    const q = u.searchParams.toString();
    window.history.replaceState({}, "", u.pathname + (q ? `?${q}` : ""));
    return meta;
  } catch {
    return "";
  }
}

function renderAuthRequiredState() {
  document.body.classList.remove("dashboard--loading");
  const root = document.querySelector(".dashboard-main");
  if (!root) return;
  root.innerHTML = `
    <main class="dashboard-content">
      <section class="dashboard-section">
        <div class="dashboard-section__header">
          <h2 class="dashboard-section__title">Sign in required</h2>
          <p class="dashboard-section__description">Please sign in with Supabase before accessing your workspace dashboard.</p>
        </div>
        <p class="dashboard-empty">Your session is missing or expired.</p>
        <p><a class="btn btn--primary" href="login.html?next=dashboard.html">Sign in to continue</a></p>
      </section>
    </main>`;
}

/** @returns {string[]} */
function readDismissedAlertIds() {
  try {
    const raw = readStorageWithMigration(DISMISSED_ALERTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** @param {string[]} ids */
function writeDismissedAlertIds(ids) {
  try {
    const unique = [...new Set(ids.filter((x) => typeof x === "string"))];
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(unique));
  } catch {
    /* ignore */
  }
}

/**
 * @param {object[]} allAlerts
 * @returns {object[]}
 */
function filterActiveAlerts(allAlerts) {
  const dismissed = new Set(readDismissedAlertIds());
  return (Array.isArray(allAlerts) ? allAlerts : []).filter(
    (a) => a?.id && !dismissed.has(a.id)
  );
}

function updateAlertsToolbar() {
  const bar = document.getElementById("alerts-toolbar");
  const btn = document.getElementById("alerts-restore-dismissed");
  const meta = document.getElementById("alerts-dismiss-meta");
  if (!bar || !btn) return;
  const n = readDismissedAlertIds().length;
  const show = n > 0;
  bar.hidden = !show;
  btn.disabled = !show;
  if (meta) {
    meta.textContent = show
      ? `${n} hidden until restored`
      : "";
  }
}

/**
 * Drop stale integration override keys when the payload no longer includes that id.
 * @param {Array<{ id: string }>} integrations
 */
function pruneIntegrationOverrides(integrations) {
  const valid = new Set(integrations.map((i) => i.id));
  const o = readIntegrationOverrides();
  const next = {};
  let changed = false;
  for (const [k, v] of Object.entries(o)) {
    if (valid.has(k)) next[k] = v;
    else changed = true;
  }
  if (changed) writeIntegrationOverrides(next);
}

/** @returns {Record<string, { state?: string, meta?: string, detail?: string }>} */
function readIntegrationOverrides() {
  try {
    const raw = readStorageWithMigration(INTEGRATION_DEMO_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, unknown>} o */
function writeIntegrationOverrides(o) {
  try {
    localStorage.setItem(INTEGRATION_DEMO_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

/** @param {string} unsafe */
function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * @param {number} amount
 * @param {string} [currency='USD']
 * @param {Intl.NumberFormatOptions} [opts]
 */
function formatCurrency(amount, currency = "USD", opts = {}) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    ...opts,
  }).format(amount);
}

/**
 * @param {number} amount
 * @param {string} [currency='USD']
 */
function formatCurrency2(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * @param {number} amount
 * @param {string} [currency='USD']
 */
function formatSignedProfit(amount, currency = "USD") {
  const nf = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  if (amount >= 0) return "+" + nf.format(amount);
  return "−" + nf.format(Math.abs(amount));
}

/**
 * @param {number} ratio
 * @param {number} [digits=2]
 */
function formatRatio(ratio, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio);
}

/**
 * @param {number} ratio 0–1
 */
function formatPercent(ratio) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

/**
 * CTR from API may be ratio (0.02) or already percentage-like; normalize to 0–1 for display.
 * @param {unknown} raw
 */
function normalizeCtrRatio(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw > 1 && raw <= 100) return raw / 100;
  if (raw > 100) return null;
  return raw;
}

/**
 * @param {number} spend
 * @param {number} purchases
 * @param {number} roas
 * @returns {{ statusLabel: string, statusTone: "healthy" | "warn" | "risk" | "neutral", recommendation: string }}
 */
function computeCampaignSaasStatus(spend, purchases, roas) {
  const s = Number(spend) || 0;
  const p = Number(purchases) || 0;
  const r = Number(roas) || 0;
  if (p === 0 && s > 0) {
    return {
      statusLabel: "No purchases",
      statusTone: "risk",
      recommendation:
        "Verify pixel events and landing paths; reduce spend until conversions appear.",
    };
  }
  if (r >= 3) {
    return {
      statusLabel: "Strong",
      statusTone: "healthy",
      recommendation:
        "Scale in steps; watch frequency and marginal ROAS as you increase budget.",
    };
  }
  if (r < 1.5) {
    return {
      statusLabel: "Warning",
      statusTone: "warn",
      recommendation:
        "Audit creative fatigue, audience overlap, and post-click experience.",
    };
  }
  return {
    statusLabel: "Monitoring",
    statusTone: "neutral",
    recommendation:
      "Hold spend steady; validate incrementality before scaling further.",
  };
}

/** @param {'healthy'|'warn'|'risk'|'neutral'} tone */
function statusToneToPillClass(tone) {
  const map = {
    healthy: "status-pill status-pill--healthy",
    warn: "status-pill status-pill--warn",
    risk: "status-pill status-pill--risk",
    neutral: "status-pill status-pill--neutral",
  };
  return map[tone] || map.neutral;
}

/** @param {'critical'|'warning'|'info'} severity */
function alertSeverityToCardClass(severity) {
  const map = {
    critical: "alert-card alert-card--critical",
    warning: "alert-card alert-card--warning",
    info: "alert-card alert-card--info",
  };
  return map[severity] || map.warning;
}

/** @param {'connected'|'syncing'|'disconnected'} state */
function integrationStateToClass(state) {
  const map = {
    connected: "connection-status connection-status--connected",
    syncing: "connection-status connection-status--syncing",
    disconnected: "connection-status connection-status--disconnected",
  };
  return map[state] || map.disconnected;
}

/** @param {'connected'|'syncing'|'disconnected'} state */
function integrationStateLabel(state) {
  const map = {
    connected: "Connected",
    syncing: "Syncing",
    disconnected: "Not connected",
  };
  return map[state] || map.disconnected;
}

/**
 * @param {object} pm
 * @param {object} period
 */
function renderMetrics(pm, period) {
  const grid = document.querySelector("#metrics-grid") || document.querySelector(".metrics-grid");
  if (!grid) return;
  if (!pm || !period) {
    console.warn("[AdsForecast] Missing portfolio metrics or reporting period.");
    return;
  }

  grid.classList.remove("metrics-grid--skeleton");
  grid.removeAttribute("aria-busy");

  const currency = pm.currency || "USD";
  const periodDesc = `${period.label} · ${period.sourceLabel}`;

  const purchases =
    typeof pm.purchases === "number" && Number.isFinite(pm.purchases)
      ? pm.purchases
      : null;

  const cards = [
    {
      label: "Total spend",
      value: formatCurrency(pm.totalSpend, currency),
      hint: `${period.label} · ad platforms`,
    },
    {
      label: "Revenue",
      value: formatCurrency(pm.revenue, currency),
      hint: "Attributed purchase value",
    },
    {
      label: "Purchases",
      value:
        purchases != null
          ? new Intl.NumberFormat("en-US").format(purchases)
          : "—",
      hint: "Orders attributed in window",
    },
    {
      label: "ROAS",
      value: formatRatio(pm.roas, 2),
      hint: "Revenue ÷ spend",
    },
    {
      label: "CPA",
      value: formatCurrency2(pm.cpa, currency),
      hint: "Spend ÷ purchases",
    },
    {
      labelHtml: 'Profit <span class="metric-card__tag">est.</span>',
      value: formatCurrency(pm.estimatedProfit, currency),
      hint: "Purchase value × 35% − spend (model)",
    },
    {
      label: "Margin",
      value: formatPercent(pm.margin),
      hint: "Estimated profit ÷ revenue",
    },
  ];

  grid.innerHTML = cards
    .map((c) => {
      const labelInner =
        "labelHtml" in c && c.labelHtml
          ? c.labelHtml
          : escapeHtml(/** @type {{ label: string }} */ (c).label);
      return `
        <article class="metric-card">
          <h3 class="metric-card__label">${labelInner}</h3>
          <p class="metric-card__value">${escapeHtml(c.value)}</p>
          <p class="metric-card__hint">${escapeHtml(c.hint)}</p>
        </article>`;
    })
    .join("");

  const desc =
    document.querySelector("#metrics-period-desc") ||
    document.querySelector("section.metrics .dashboard-section__description");
  if (desc) desc.textContent = periodDesc;
}

/**
 * @param {object} snap
 * @param {string} currency
 */
function renderPerformanceSummary(snap, currency) {
  if (!snap) return;

  const title = document.querySelector(".performance-summary__title");
  if (title) title.textContent = snap.label;

  const cur = currency || "USD";
  const rev = "+" + formatCurrency(snap.revenue, cur);
  const spend = "−" + formatCurrency(snap.spend, cur);
  const roasCell =
    snap.roas != null && Number.isFinite(snap.roas)
      ? escapeHtml(formatRatio(snap.roas, 2))
      : "—";
  const profitCell =
    snap.estimatedProfit != null
      ? escapeHtml(formatSignedProfit(snap.estimatedProfit, cur))
      : "—";
  const profitValClass =
    snap.estimatedProfit != null && snap.estimatedProfit < 0
      ? "performance-summary__value performance-summary__value--negative"
      : "performance-summary__value performance-summary__value--positive";

  const list = document.querySelector(".performance-summary__list");
  if (list) {
    list.innerHTML = `
      <li class="performance-summary__row">
        <span class="performance-summary__metric">Revenue</span>
        <span class="performance-summary__value">${escapeHtml(rev)}</span>
      </li>
      <li class="performance-summary__row">
        <span class="performance-summary__metric">Spend</span>
        <span class="performance-summary__value">${escapeHtml(spend)}</span>
      </li>
      <li class="performance-summary__row">
        <span class="performance-summary__metric">ROAS</span>
        <span class="performance-summary__value">${roasCell}</span>
      </li>
      <li class="performance-summary__row">
        <span class="performance-summary__metric">Est. profit</span>
        <span class="${profitValClass}">${profitCell}</span>
      </li>`;
  }

  const foot = document.querySelector(".performance-summary__footnote");
  if (foot) {
    foot.textContent = `${snap.compareToLabel} · synced ${snap.lastSyncedRelative}`;
  }
}

/**
 * @param {object} c
 */
function campaignSearchBlob(c) {
  const tags = Array.isArray(c.tags) ? c.tags.join(" ") : "";
  const st = typeof c.statusLabel === "string" ? c.statusLabel : "";
  return `${c.name} ${st} ${tags}`.trim().toLowerCase();
}

/**
 * @param {{ mode?: string, message?: string } | undefined} state
 */
function renderDataSourceBadge(state) {
  const el = document.getElementById("dashboard-env-badge");
  if (!el) return;
  const mode = state?.mode || "demo";
  if (mode === "live") {
    el.textContent = "Live";
    el.className = "dashboard-env-badge dashboard-env-badge--live";
    el.hidden = false;
    el.title = "Campaign rows from Meta Ads API";
  } else if (mode === "loading") {
    el.textContent = "";
    el.hidden = true;
    el.removeAttribute("title");
  } else {
    el.textContent = "Demo";
    el.className = "dashboard-env-badge dashboard-env-badge--demo";
    el.hidden = false;
    el.title =
      typeof state?.message === "string" && state.message
        ? state.message
        : "Embedded sample data";
  }
}

function setupDashboardNav() {
  const links = document.querySelectorAll("a[data-nav-anchor]");
  function syncActive() {
    const raw = (location.hash || "#overview").replace(/^#/, "") || "overview";
    links.forEach((a) => {
      const anchor = a.getAttribute("data-nav-anchor");
      a.classList.toggle(
        "dashboard-nav__link--active",
        anchor === raw
      );
    });
  }
  window.addEventListener("hashchange", syncActive);
  syncActive();
}

/**
 * @param {object[]} rows
 * @param {string} currency
 */
function renderCampaignTable(rows, currency) {
  const tbody =
    document.querySelector("#campaign-table-body") ||
    document.querySelector(".data-table tbody");
  if (!tbody) return;
  if (!Array.isArray(rows)) return;

  const cur = currency || "USD";

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="data-table__empty">No campaigns match your filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((c) => {
      const derived = deriveCampaignMetrics(c);
      const roasNum = derived.roas ?? c.roas ?? 0;
      const spend = Number(c.spend) || 0;
      const purchases = Number(c.purchases) || 0;
      const saas = computeCampaignSaasStatus(spend, purchases, Number(roasNum));
      const statusLabel = saas.statusLabel;
      const pillClass = statusToneToPillClass(saas.statusTone);
      const recommendation = escapeHtml(
        typeof c.recommendation === "string" && c.recommendation.trim()
          ? c.recommendation.trim()
          : saas.recommendation
      );
      const profit =
        c.estimatedProfit != null ? c.estimatedProfit : derived.profit;
      const profitClass =
        profit != null && profit >= 0
          ? "data-table__positive"
          : "data-table__negative";
      const roasCell =
        roasNum != null && roasNum > 0
          ? escapeHtml(formatRatio(roasNum, 2))
          : "—";
      const cpa = derived.cpa ?? c.cpa;
      const cpc = Number.isFinite(Number(c.cpc)) ? Number(c.cpc) : null;
      let cpaCpcHtml = "—";
      if (cpa != null) {
        cpaCpcHtml = `<span class="data-table__stack-main">${escapeHtml(formatCurrency2(cpa, cur))}</span>`;
        if (cpc != null) {
          cpaCpcHtml += `<span class="data-table__stack-sub">CPC ${escapeHtml(formatCurrency2(cpc, cur))}</span>`;
        }
      } else if (cpc != null) {
        cpaCpcHtml = `<span class="data-table__stack-main">—</span><span class="data-table__stack-sub">CPC ${escapeHtml(formatCurrency2(cpc, cur))}</span>`;
      }
      const ctrRatio = normalizeCtrRatio(c.ctr);
      const ctrCell =
        ctrRatio != null ? escapeHtml(formatPercent(ctrRatio)) : "—";
      const profitCell =
        profit != null ? escapeHtml(formatSignedProfit(profit, cur)) : "—";
      const blob = escapeHtml(campaignSearchBlob({ ...c, statusLabel }));
      return `
      <tr data-campaign-id="${escapeHtml(c.id)}" data-search-blob="${blob}">
        <td class="data-table__primary">${escapeHtml(c.name)}</td>
        <td>${escapeHtml(formatCurrency(c.spend, cur))}</td>
        <td>${escapeHtml(String(c.purchases))}</td>
        <td>${escapeHtml(formatCurrency(c.revenue, cur))}</td>
        <td>${roasCell}</td>
        <td class="data-table__stack">${cpaCpcHtml}</td>
        <td>${ctrCell}</td>
        <td class="${profitClass}">${profitCell}</td>
        <td><span class="${pillClass}">${escapeHtml(statusLabel)}</span></td>
        <td class="data-table__rec">${recommendation}</td>
      </tr>`;
    })
    .join("");
}

/** @type {object[]} */
let currentCampaignRows = [];

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
function getCampaignRowsAfterControls(rows) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const filterSel = document.getElementById("campaign-filter-select");
  const sortSel = document.getElementById("campaign-sort-select");
  const filter = filterSel instanceof HTMLSelectElement ? filterSel.value : "all";
  const sort = sortSel instanceof HTMLSelectElement ? sortSel.value : "spend_desc";

  const filtered = list.filter((c) => {
    const purchases = Number(c?.purchases) || 0;
    const roas = Number(c?.roas) || 0;
    const profit = Number(c?.estimatedProfit) || 0;
    if (filter === "profitable") return profit > 0 || roas >= 1.5;
    if (filter === "losing") return profit < 0 || roas < 1;
    if (filter === "no_purchases") return purchases <= 0;
    return true;
  });

  const sorters = {
    spend_desc: (a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0),
    revenue_desc: (a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0),
    purchases_desc: (a, b) => (Number(b.purchases) || 0) - (Number(a.purchases) || 0),
    roas_desc: (a, b) => (Number(b.roas) || 0) - (Number(a.roas) || 0),
  };
  const sorter = sorters[sort] || sorters.spend_desc;
  filtered.sort(sorter);
  return filtered;
}

function renderCampaignRowsWithControls() {
  const currency =
    latestRenderedPayload?.portfolioMetrics?.currency ||
    latestRenderedPayload?.workspace?.currency ||
    "USD";
  renderCampaignTable(getCampaignRowsAfterControls(currentCampaignRows), currency);
  const input = document.querySelector("#dashboard-search-input");
  if (input instanceof HTMLInputElement) applyCampaignSearch(input.value);
}

/** @type {object[]} */
let dashboardAlerts = [];

/** @param {object[]} items */
function renderAlerts(items) {
  const grid =
    document.querySelector("#alert-grid") || document.querySelector(".alert-grid");
  if (!grid) return;
  if (!Array.isArray(items)) return;

  const dismissed = readDismissedAlertIds();
  const visible = items.filter((a) => a?.id && !dismissed.includes(a.id));

  if (visible.length === 0) {
    const withIds = items.filter((a) => a?.id);
    let msg =
      "No alerts from the rules engine for this workspace right now.";
    if (withIds.length > 0 && dismissed.length > 0) {
      msg =
        "Every alert is dismissed. Restore them with the control above the grid — stored in this browser only.";
    } else if (items.length > 0 && withIds.length === 0) {
      msg =
        "Alerts are missing stable IDs in the payload, so cards cannot be shown.";
    }
    grid.innerHTML = `
      <li class="alert-grid__empty">
        <p class="dashboard-empty">${escapeHtml(msg)}</p>
      </li>`;
    updateAlertsToolbar();
    return;
  }

  grid.innerHTML = visible
    .map((a) => {
      const cardClass = alertSeverityToCardClass(a.severity);
      const meta = a.campaignName ? escapeHtml(a.campaignName) : "";
      return `
      <li>
        <article class="${cardClass}" data-alert-id="${escapeHtml(a.id)}">
          <div class="alert-card__head">
            <h3 class="alert-card__title">${escapeHtml(a.title)}</h3>
            <button type="button" class="alert-card__dismiss" aria-label="Dismiss alert (stored in this browser)"><span aria-hidden="true">×</span></button>
          </div>
          <p class="alert-card__meta">${meta}</p>
          <p class="alert-card__text">${escapeHtml(a.body)}</p>
        </article>
      </li>`;
    })
    .join("");

  grid.querySelectorAll(".alert-card__dismiss").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest("[data-alert-id]");
      const id = card?.getAttribute("data-alert-id");
      if (!id) return;
      writeDismissedAlertIds([...readDismissedAlertIds(), id]);
      renderAlerts(dashboardAlerts);
      const active = filterActiveAlerts(dashboardAlerts);
      renderNotifyPanel(active);
      notifyUi?.setBadgeCount?.(active.length);
      showDemoToast("Alert dismissed — stays hidden on reload in this browser.");
    });
  });

  updateAlertsToolbar();
}

/** @param {object[]} items */
function renderInsights(items) {
  const grid =
    document.querySelector("#insight-grid") || document.querySelector(".insight-grid");
  if (!grid) return;
  if (!Array.isArray(items)) return;

  if (items.length === 0) {
    grid.innerHTML = `
      <li class="insight-grid__empty-wrap">
        <div class="insight-empty" role="status">
          <p class="insight-empty__title">No recommendations yet</p>
          <p class="insight-empty__text">When the rules engine finds patterns in your spend, revenue, and margin, prioritized suggestions will appear here. Connect more data or check back after the next sync.</p>
        </div>
      </li>`;
    return;
  }

  grid.innerHTML = items
    .map(
      (i) => `
    <li>
      <article class="insight-card">
        <h3 class="insight-card__title">${escapeHtml(i.title)}</h3>
        <p class="insight-card__text">${escapeHtml(i.body)}</p>
      </article>
    </li>`
    )
    .join("");
}

/**
 * @param {object} i
 */
function integrationCardActions(i) {
  const id = escapeHtml(i.id);
  if (i.state === "disconnected") {
    return `<div class="integration-card__actions">
      <button type="button" class="integration-card__btn integration-card__btn--primary" data-int-action="connect" data-int-id="${id}">Connect</button>
      <button type="button" class="integration-card__btn" data-int-action="details" data-int-id="${id}">Details</button>
    </div>`;
  }
  if (i.state === "syncing") {
    return `<div class="integration-card__actions">
      <button type="button" class="integration-card__btn" data-int-action="retry" data-int-id="${id}">Retry sync</button>
      <button type="button" class="integration-card__btn" data-int-action="details" data-int-id="${id}">Details</button>
    </div>`;
  }
  return `<div class="integration-card__actions">
    <button type="button" class="integration-card__btn" data-int-action="sync" data-int-id="${id}">Sync now</button>
    <button type="button" class="integration-card__btn" data-int-action="details" data-int-id="${id}">Details</button>
  </div>`;
}

/** @param {object[]} items */
function renderIntegrations(items) {
  const grid =
    document.querySelector("#integration-grid") ||
    document.querySelector(".integration-grid");
  if (!grid) return;
  grid.innerHTML = `
    <li>
      <article class="integration-card integration-card--coming-soon">
        <h3 class="integration-card__name">WooCommerce</h3>
        <p class="integration-card__detail">Commerce revenue sync for richer profitability modeling.</p>
        <p class="integration-card__status"><span class="connection-status connection-status--disconnected">Coming soon</span></p>
      </article>
    </li>
    <li>
      <article class="integration-card integration-card--coming-soon">
        <h3 class="integration-card__name">Shopify</h3>
        <p class="integration-card__detail">Native store sync to unify spend with net order value.</p>
        <p class="integration-card__status"><span class="connection-status connection-status--disconnected">Coming soon</span></p>
      </article>
    </li>`;
}

/** @param {object} po */
function renderProfitability(po) {
  const root =
    document.querySelector("#profit-snapshot") ||
    document.querySelector(".profit-snapshot");
  if (!root) return;
  if (!po || typeof po !== "object") return;

  const blocks = [
    { key: "highestProfit", data: po.highestProfit, valueClass: "profit-snapshot__value profit-snapshot__value--positive" },
    { key: "worst", data: po.worst, valueClass: "profit-snapshot__value profit-snapshot__value--negative" },
    { key: "strongestRoas", data: po.strongestRoas, valueClass: "profit-snapshot__value" },
    { key: "biggestWaste", data: po.biggestWaste, valueClass: "profit-snapshot__value profit-snapshot__value--negative" },
  ];

  root.innerHTML = blocks
    .filter((b) => b.data?.label)
    .map(({ data, valueClass }) => {
      return `
      <article class="profit-snapshot__card">
        <h3 class="profit-snapshot__label">${escapeHtml(data.label)}</h3>
        <p class="profit-snapshot__name">${escapeHtml(data.campaignName)}</p>
        <p class="${valueClass}">${escapeHtml(data.valueLabel)}</p>
      </article>`;
    })
    .join("");
}

/** @param {object | undefined} pe */
function renderProfitExplainer(pe) {
  const mount = document.getElementById("profit-explainer-mount");
  if (!mount) return;
  if (!pe || typeof pe !== "object") {
    mount.innerHTML = "";
    return;
  }
  const bullets = Array.isArray(pe.bullets)
    ? pe.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")
    : "";
  mount.innerHTML = `
    <div class="profit-explainer__inner">
      <h2 class="profit-explainer__title">${escapeHtml(pe.title || "")}</h2>
      <p class="profit-explainer__lead">${escapeHtml(pe.lead || "")}</p>
      <ul class="profit-explainer__list">${bullets}</ul>
    </div>`;
}

let demoToastTimer = 0;

/** @param {string} message */
function showDemoToast(message) {
  let el = document.getElementById("demo-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "demo-toast";
    el.className = "demo-toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.hidden = false;
  window.clearTimeout(demoToastTimer);
  demoToastTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 3400);
}

/** @param {string} rawQuery */
function applyCampaignSearch(rawQuery) {
  const tbody =
    document.querySelector("#campaign-table-body") ||
    document.querySelector(".data-table tbody");
  const statusEl = document.getElementById("campaign-search-status");
  if (!tbody) return;

  const q = String(rawQuery || "")
    .trim()
    .toLowerCase();
  const rows = tbody.querySelectorAll("tr[data-search-blob]");
  let visible = 0;

  rows.forEach((tr) => {
    const blob = tr.getAttribute("data-search-blob") || "";
    const match = !q || blob.includes(q);
    tr.classList.toggle("data-table__row--muted", Boolean(q) && !match);
    if (match) visible += 1;
  });

  let empty = tbody.querySelector("tr[data-search-empty]");
  if (q && visible === 0) {
    if (!empty) {
      empty = document.createElement("tr");
      empty.setAttribute("data-search-empty", "1");
      empty.innerHTML =
        '<td colspan="8" class="data-table__empty">No campaigns match this search.</td>';
      tbody.appendChild(empty);
    }
    empty.hidden = false;
  } else if (empty) {
    empty.hidden = true;
  }

  if (statusEl) {
    if (!q) {
      statusEl.textContent = "";
    } else {
      statusEl.textContent = `Showing ${visible} campaign${visible === 1 ? "" : "s"} matching “${rawQuery.trim()}”.`;
    }
  }
}

function setupCampaignSearch() {
  const input = document.querySelector("#dashboard-search-input");
  if (!(input instanceof HTMLInputElement)) return;

  let t = 0;
  input.addEventListener("input", () => {
    window.clearTimeout(t);
    t = window.setTimeout(() => applyCampaignSearch(input.value), 120);
  });
}

function setupCampaignControls() {
  const filterSel = document.getElementById("campaign-filter-select");
  const sortSel = document.getElementById("campaign-sort-select");
  const refreshBtn = document.getElementById("campaign-refresh-btn");
  if (filterSel instanceof HTMLSelectElement) {
    filterSel.addEventListener("change", () => renderCampaignRowsWithControls());
  }
  if (sortSel instanceof HTMLSelectElement) {
    sortSel.addEventListener("change", () => renderCampaignRowsWithControls());
  }
  if (refreshBtn instanceof HTMLButtonElement) {
    refreshBtn.addEventListener("click", () => window.location.reload());
  }
}

/**
 * @param {object[]} alerts
 */
function renderNotifyPanel(alerts) {
  const panel = document.getElementById("notify-panel");
  if (!panel) return;
  const slice = (Array.isArray(alerts) ? alerts : []).slice(0, 6);
  if (slice.length === 0) {
    panel.innerHTML =
      '<p class="notify-panel__empty">No active alerts (dismissed items are hidden here too).</p><a class="notify-panel__link" href="#alerts">Go to alerts</a>';
    return;
  }
  panel.innerHTML = `
    <div class="notify-panel__head">
      <span class="notify-panel__title">Recent alerts</span>
      <a class="notify-panel__link" href="#alerts">View all</a>
    </div>
    <ul class="notify-panel__list" role="list">
      ${slice
        .map((a) => {
          const meta = a.campaignName
            ? `<span class="notify-panel__meta">${escapeHtml(a.campaignName)}</span>`
            : "";
          return `<li class="notify-panel__item">
            <p class="notify-panel__item-title">${escapeHtml(a.title)}</p>
            ${meta}
          </li>`;
        })
        .join("")}
    </ul>`;
}

function setupNotifications() {
  const btn = document.getElementById("dashboard-notify-btn");
  const panel = document.getElementById("notify-panel");
  const badge = document.getElementById("dashboard-notify-badge");
  if (!(btn instanceof HTMLButtonElement) || !panel) return;

  function close() {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function open() {
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panel.hidden) open();
    else close();
  });

  document.addEventListener("click", (e) => {
    if (!panel.hidden && e.target instanceof Node) {
      const wrap = btn.closest(".dashboard-notify-wrap");
      if (wrap && !wrap.contains(e.target)) close();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return {
    open,
    close,
    setBadgeCount(count) {
      if (!badge) return;
      const n = Math.min(99, Math.max(0, count));
      if (n > 0) {
        badge.hidden = false;
        badge.textContent = String(n);
        badge.classList.add("dashboard-notify__badge--count");
        badge.classList.remove("dashboard-notify__badge--dot");
      } else {
        badge.textContent = "";
        badge.classList.remove("dashboard-notify__badge--count");
        badge.classList.remove("dashboard-notify__badge--dot");
        badge.hidden = true;
      }
    },
  };
}

/** @param {object} shell */
function renderShell(shell, sessionUserName) {
  if (!shell) return;

  const title = document.querySelector(".dashboard-topbar__title");
  if (title) title.textContent = shell.pageTitle ?? "";

  const sub = document.querySelector(".dashboard-topbar__subtitle");
  if (sub) sub.textContent = shell.pageSubtitle ?? "";

  const input = document.querySelector("#dashboard-search-input");
  if (input) input.setAttribute("placeholder", shell.searchPlaceholder ?? "");

  const user = document.querySelector(".dashboard-user__name");
  if (user) {
    user.textContent = sessionUserName || shell.user?.displayName || "";
  }
}

/** @param {object} m */
function renderMeta(m) {
  if (!m) return;
  document.documentElement.dataset.adsforecastSchema = m.schemaVersion ?? "";
  document.documentElement.dataset.adsforecastEnv = m.environment ?? "";
}

/**
 * @param {{ mode: "loading" | "live" | "demo", message?: string, accountId?: string, currency?: string }} state
 */
function renderCampaignDataState(state) {
  const desc = document.getElementById("campaigns-section-desc");
  if (!desc) return;
  if (state.mode === "loading") {
    desc.textContent = "Loading live Meta data…";
    return;
  }
  if (state.mode === "live") {
    const bits = ["Live Meta data"];
    if (state.accountId) bits.push(state.accountId);
    if (state.currency) bits.push(state.currency);
    desc.textContent = bits.join(" · ");
    return;
  }
  desc.textContent =
    state.message ||
    "Using demo data. Live Meta data is currently unavailable.";
}

/**
 * @param {unknown[]} campaigns
 */
function normalizeLiveCampaignRows(campaigns) {
  return (Array.isArray(campaigns) ? campaigns : [])
    .map((c, idx) => {
      const name =
        typeof c?.campaignName === "string" && c.campaignName.trim()
          ? c.campaignName.trim()
          : `Campaign ${idx + 1}`;
      const id =
        typeof c?.campaignId === "string" && c.campaignId.trim()
          ? c.campaignId.trim()
          : `live_${idx + 1}`;
      const spend = Number(c?.spend) || 0;
      const purchases = Number(c?.purchases) || 0;
      const revenue = Number(c?.purchaseValue) || 0;
      const currency =
        typeof c?.currency === "string" && c.currency.trim()
          ? c.currency.trim()
          : null;
      const roas =
        Number.isFinite(Number(c?.roas)) && Number(c?.roas) > 0
          ? Number(c.roas)
          : spend > 0
            ? revenue / spend
            : 0;
      const cpa =
        purchases > 0
          ? spend / purchases
          : Number.isFinite(Number(c?.cpc))
            ? Number(c.cpc)
            : null;
      const cpc = Number.isFinite(Number(c?.cpc)) ? Number(c.cpc) : null;
      const ctrRaw = normalizeCtrRatio(c?.ctr);
      const estimatedProfit = revenue * 0.35 - spend;
      const saas = computeCampaignSaasStatus(spend, purchases, roas);
      return {
        id,
        externalId: id,
        name,
        spend,
        purchases,
        revenue,
        costs: { product: 0, shipping: 0, fees: 0 },
        estimatedProfit,
        roas,
        cpa,
        cpc,
        ctr: ctrRaw,
        currency,
        statusLabel: saas.statusLabel,
        statusTone: saas.statusTone,
        recommendation: saas.recommendation,
        tags: ["live-meta"],
      };
    })
    .filter((c) => c.id);
}

/**
 * @param {ReturnType<typeof getDashboardPayload> & { alerts?: unknown[], insights?: unknown[] }} payload
 * @param {ReturnType<typeof normalizeLiveCampaignRows>} campaigns
 * @param {{ accountId?: string, currency?: string }} info
 */
function applyLiveCampaignData(payload, campaigns, info) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) return payload;
  const currency =
    info.currency ||
    campaigns.find((c) => typeof c?.currency === "string")?.currency ||
    payload.portfolioMetrics?.currency ||
    payload.workspace?.currency ||
    "USD";
  const totals = campaigns.reduce(
    (acc, c) => {
      acc.spend += c.spend || 0;
      acc.revenue += c.revenue || 0;
      acc.purchases += c.purchases || 0;
      acc.estimatedProfit += c.estimatedProfit || 0;
      return acc;
    },
    { spend: 0, revenue: 0, purchases: 0, estimatedProfit: 0 }
  );
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
  const cpa = totals.purchases > 0 ? totals.spend / totals.purchases : 0;
  const margin = totals.revenue > 0 ? totals.estimatedProfit / totals.revenue : 0;
  return {
    ...payload,
    campaigns,
    portfolioMetrics: {
      ...(payload.portfolioMetrics || {}),
      currency,
      totalSpend: totals.spend,
      revenue: totals.revenue,
      purchases: totals.purchases,
      roas,
      cpa,
      estimatedProfit: totals.estimatedProfit,
      margin,
    },
    _campaignDataState: {
      mode: "live",
      accountId: info.accountId || "",
      currency,
    },
  };
}

/**
 * @param {string} base
 */
async function fetchLiveMetaCampaigns(base) {
  const url = `${base}/meta-campaigns`;
  const headers = { Accept: "application/json" };
  const accessToken = await getSupabaseAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(url, {
    headers,
    credentials: "omit",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("meta_campaigns_unavailable");
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * @param {string} key
 * @param {string} fallback
 */
function safeStorageRead(key, fallback = "") {
  try {
    return readStorageWithMigration(key) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {string} value
 */
function safeStorageWrite(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} base
 */
async function fetchMetaAccounts(base) {
  const accessToken = await getSupabaseAccessToken();
  const headers = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const url = `${base}/meta-accounts`;
  const res = await fetch(url, {
    headers,
    cache: "no-store",
    credentials: "omit",
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * @param {string} base
 */
async function fetchMetaConnection(base) {
  const accessToken = await getSupabaseAccessToken();
  const headers = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const url = `${base}/meta-connection`;
  const res = await fetch(url, {
    headers,
    cache: "no-store",
    credentials: "omit",
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * @param {string} base
 * @param {{ accountId: string, accountName?: string | null, currency?: string | null, timezoneName?: string | null }} body
 */
async function connectMetaAccount(base, body) {
  const accessToken = await getSupabaseAccessToken();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const url = `${base}/meta-connect`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    cache: "no-store",
    credentials: "omit",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * @param {string} message
 */
function renderMetaPanelInfo(message) {
  const panel = document.getElementById("meta-connection-panel");
  if (!panel) return;
  panel.innerHTML = `<p class="dashboard-empty">${escapeHtml(message)}</p>`;
}

/**
 * @param {string} base
 * @param {{ accountId: string, accountName?: string | null, currency?: string | null, timezoneName?: string | null, connectedAt?: string }} connection
 */
function renderConnectedMetaPanel(base, connection) {
  const panel = document.getElementById("meta-connection-panel");
  if (!panel) return;
  const connectedAt = connection?.connectedAt
    ? new Date(connection.connectedAt).toLocaleString()
    : "Unknown";
  const lastSync =
    typeof connection?.lastSyncAt === "string" && connection.lastSyncAt
      ? new Date(connection.lastSyncAt).toLocaleString()
      : safeStorageRead(LIVE_META_STATE_KEY, "Not synced yet");
  panel.innerHTML = `
    <article class="integration-card integration-card--meta-live">
      <h3 class="integration-card__name">Meta Ads connected</h3>
      <p class="integration-card__detail">${escapeHtml(connection.accountName || "Selected ad account")}</p>
      <p class="integration-card__meta">Account: ${escapeHtml(connection.accountId || "—")} · Currency: ${escapeHtml(connection.currency || "—")} · Timezone: ${escapeHtml(connection.timezoneName || "—")}</p>
      <p class="integration-card__meta">Last synced: ${escapeHtml(lastSync)} · Connected: ${escapeHtml(connectedAt)}</p>
      <div class="integration-card__actions">
        <button type="button" class="integration-card__btn" id="meta-change-account-btn">Change account</button>
        <button type="button" class="integration-card__btn integration-card__btn--primary" id="meta-refresh-btn">Refresh data</button>
      </div>
    </article>`;

  const changeBtn = document.getElementById("meta-change-account-btn");
  if (changeBtn instanceof HTMLButtonElement) {
    changeBtn.addEventListener("click", () => hydrateMetaIntegrationUx(base, true));
  }

  const refreshBtn = document.getElementById("meta-refresh-btn");
  if (refreshBtn instanceof HTMLButtonElement) {
    refreshBtn.addEventListener("click", () => {
      window.location.reload();
    });
  }
}

/**
 * @param {string} base
 * @param {Array<any>} accounts
 */
function renderMetaAccountChooser(base, accounts) {
  const panel = document.getElementById("meta-connection-panel");
  if (!panel) return;
  panel.innerHTML = `
    <article class="integration-card integration-card--meta-live">
      <h3 class="integration-card__name">Select Meta ad account</h3>
      <p class="integration-card__detail">Choose which account to connect for live campaign analytics.</p>
      <ul class="meta-account-list">
        ${accounts
          .map(
            (a) => `
          <li class="meta-account-list__item">
            <div class="meta-account-list__body">
              <p class="meta-account-list__title">${escapeHtml(a.name || a.account_id || a.id || "Ad account")}</p>
              <p class="meta-account-list__meta">${escapeHtml(a.id || "—")} · ${escapeHtml(a.currency || "—")} · ${escapeHtml(a.timezone_name || "—")}</p>
            </div>
            <button type="button" class="integration-card__btn integration-card__btn--primary" data-meta-connect="${escapeHtml(a.id || "")}">Connect</button>
          </li>`
          )
          .join("")}
      </ul>
    </article>`;

  panel.querySelectorAll("[data-meta-connect]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-meta-connect");
      const account = accounts.find((a) => a.id === id);
      if (!account || !id) return;
      btn.setAttribute("disabled", "true");
      const { res } = await connectMetaAccount(base, {
        accountId: id,
        accountName: account.name || "",
        currency: account.currency || "",
        timezoneName: account.timezone_name || "",
      });
      if (!res.ok) {
        showDemoToast("Could not connect selected account right now.");
        btn.removeAttribute("disabled");
        return;
      }
      showDemoToast("Meta account connected.");
      window.location.reload();
    });
  });
}

/**
 * @param {string} base
 * @param {boolean} [forceChooser=false]
 */
async function hydrateMetaIntegrationUx(base, forceChooser = false) {
  if (!base) {
    renderMetaPanelInfo("Supabase functions base is missing.");
    return;
  }
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) {
    const panel = document.getElementById("meta-connection-panel");
    if (!panel) return;
    panel.innerHTML = `
      <article class="integration-card integration-card--meta-live integration-card--meta-cta">
        <p class="integration-card__eyebrow">Meta Ads</p>
        <h3 class="integration-card__name">Sign in required</h3>
        <p class="integration-card__detail">Please sign in with Supabase before connecting Meta Ads.</p>
        <div class="integration-card__actions">
          <a class="integration-card__btn integration-card__btn--primary" href="login.html?next=dashboard.html">Sign in to continue</a>
        </div>
      </article>`;
    return;
  }
  const oauthStartHref = "#";
  renderMetaPanelInfo("Checking Meta connection…");

  if (!forceChooser) {
    const conn = await fetchMetaConnection(base);
    if (conn.res.ok && conn.data?.connection) {
      renderConnectedMetaPanel(base, conn.data.connection);
      return;
    }
  }

  const accountsRes = await fetchMetaAccounts(base);
  if (accountsRes.res.status === 401) {
    const panel = document.getElementById("meta-connection-panel");
    if (!panel) return;
    const err = accountsRes.data?.error;
    const isToken =
      err === "meta_token_invalid" ||
      err === "meta_token_missing" ||
      err === "meta_no_token";
    const title = isToken ? "Reconnect Meta Ads" : "Connect Meta Ads";
    const detail = isToken
      ? "Your Meta session expired or is missing. Re-authorize to continue loading live data."
      : "Authorize Meta to discover ad accounts and pull campaign insights.";
    panel.innerHTML = `
      <article class="integration-card integration-card--meta-live integration-card--meta-cta">
        <p class="integration-card__eyebrow">Meta Ads</p>
        <h3 class="integration-card__name">${escapeHtml(title)}</h3>
        <p class="integration-card__detail">${escapeHtml(detail)}</p>
        <div class="integration-card__actions">
          <a class="integration-card__btn integration-card__btn--primary" href="${escapeHtml(oauthStartHref)}" id="meta-oauth-start-link">${escapeHtml(isToken ? "Reconnect Meta Ads" : "Connect Meta Ads")}</a>
        </div>
      </article>`;
    wireMetaOauthStart(base);
    return;
  }

  if (!accountsRes.res.ok) {
    renderMetaPanelInfo(
      typeof accountsRes.data?.message === "string"
        ? accountsRes.data.message
        : "Could not load Meta ad accounts right now."
    );
    return;
  }

  if (accountsRes.res.ok && Array.isArray(accountsRes.data?.accounts) && accountsRes.data.accounts.length > 0) {
    renderMetaAccountChooser(base, accountsRes.data.accounts);
    return;
  }

  const panel = document.getElementById("meta-connection-panel");
  if (!panel) return;
  panel.innerHTML = `
    <article class="integration-card integration-card--meta-live integration-card--meta-cta">
      <p class="integration-card__eyebrow">Meta Ads</p>
      <h3 class="integration-card__name">Connect your ad account</h3>
      <p class="integration-card__detail">Connect your ad account to load live spend, purchases, revenue, and ROAS.</p>
      <ul class="integration-card__bullets">
        <li>Campaign spend, revenue, and efficiency metrics</li>
        <li>One-click reconnect if your session expires</li>
      </ul>
      <div class="integration-card__actions">
        <a class="integration-card__btn integration-card__btn--primary" href="${escapeHtml(oauthStartHref)}" id="meta-oauth-start-link">Connect Meta Ads</a>
      </div>
    </article>`;
  wireMetaOauthStart(base);
}

/**
 * @param {string} base
 */
function wireMetaOauthStart(base) {
  const link = document.getElementById("meta-oauth-start-link");
  if (!(link instanceof HTMLAnchorElement)) return;
  link.addEventListener("click", async (e) => {
    e.preventDefault();
    await startMetaOauthViaSupabase(base);
  });
}

/**
 * Start Meta OAuth via authenticated Supabase edge function call.
 * @param {string} base
 */
async function startMetaOauthViaSupabase(base) {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) {
    showDemoToast("Please sign in with Supabase before connecting Meta Ads.");
    window.setTimeout(() => {
      window.location.href = "login.html?next=dashboard.html";
    }, 700);
    return;
  }
  try {
    const res = await fetch(`${base}/meta-start`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      credentials: "omit",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      showDemoToast("Please sign in again to connect Meta Ads.");
      return;
    }
    if (!res.ok || !data?.success || typeof data?.authUrl !== "string") {
      throw new Error("meta_start_failed");
    }
    window.location.href = data.authUrl;
  } catch {
    showDemoToast("Could not start Meta connection. Try again.");
  }
}

/** @type {{ setBadgeCount?: (n: number) => void } | null} */
let notifyUi = null;
/** @type {any | null} */
let latestRenderedPayload = null;

/**
 * Hydrate dashboard from payload (allows future API injection).
 * @param {ReturnType<typeof getDashboardPayload>} payload
 */
export function renderDashboard(payload, sessionDisplayName) {
  latestRenderedPayload = payload;
  const currency =
    payload.portfolioMetrics?.currency ||
    payload.workspace?.currency ||
    "USD";

  renderDataSourceBadge(payload._campaignDataState);
  renderMeta(payload.meta);
  renderShell(payload.dashboardShell, sessionDisplayName);
  renderProfitExplainer(payload.profitExplainer);
  renderMetrics(payload.portfolioMetrics, payload.reportingPeriod);

  const perfDesc = document.getElementById("performance-section-desc");
  const series = payload.performanceSeries;
  if (perfDesc && series?.points?.length) {
    perfDesc.textContent = `Daily spend vs revenue · ${series.points.length} ${series.granularity || "day"} points`;
  }

  renderPerformanceSummary(payload.performanceLastSevenDays, currency);

  const chartMount = document.getElementById("performance-chart-mount");
  if (chartMount) {
    chartMount.removeAttribute("aria-busy");
    renderSpendRevenueChart(chartMount, series || { points: [] });
  }

  currentCampaignRows = Array.isArray(payload.campaigns) ? payload.campaigns : [];
  renderCampaignTable(getCampaignRowsAfterControls(currentCampaignRows), currency);

  dashboardAlerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  renderAlerts(dashboardAlerts);
  const activeAlertList = filterActiveAlerts(dashboardAlerts);
  renderNotifyPanel(activeAlertList);
  notifyUi?.setBadgeCount?.(activeAlertList.length);

  renderInsights(Array.isArray(payload.insights) ? payload.insights : []);
  renderIntegrations(
    Array.isArray(payload.integrations) ? payload.integrations : []
  );
  renderProfitability(payload.profitabilityOverview);

  document.body.classList.remove("dashboard--loading");
}

/**
 * Load dashboard JSON from API when configured, else mock + rule engine.
 * @returns {Promise<ReturnType<typeof getDashboardPayload> & { alerts: unknown[], insights: unknown[] }>}
 */
async function loadDashboardPayload() {
  const payload = getDashboardPayload();
  const { alerts, insights } = runInsightsEngine(payload, {
    signals: DEMO_SIGNALS,
  });
  return { ...payload, alerts, insights, _campaignDataState: { mode: "demo" } };
}

/**
 * @param {Awaited<ReturnType<typeof loadDashboardPayload>>} payload
 * @returns {payload is NonNullable<typeof payload>}
 */
function isDashboardPayload(payload) {
  return payload != null;
}

async function init() {
  if (!isSupabaseMode()) {
    renderMetaPanelInfo("Supabase configuration is required for dashboard access.");
    renderAuthRequiredState();
    return;
  }

  const supabase = await getSupabaseClient();
  if (!supabase) {
    renderMetaPanelInfo("Could not initialize Supabase client.");
    renderAuthRequiredState();
    return;
  }

  const sessionResult = await supabase.auth.getSession();
  const sbSession = sessionResult.data?.session || null;
  if (!sbSession?.access_token || !sbSession.user) {
    renderAuthRequiredState();
    return;
  }

  const functionsBase = getFunctionsBase();
  if (!functionsBase) {
    renderMetaPanelInfo("Supabase functions URL is missing.");
    return;
  }

  let workspaceId = "ws_nw_01";
  try {
    const wsRes = await fetch(`${functionsBase}/workspace-bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${sbSession.access_token}`,
      },
      body: JSON.stringify({ email: sbSession.user.email || "" }),
      cache: "no-store",
      credentials: "omit",
    });
    const wsData = await wsRes.json().catch(() => ({}));
    if (wsRes.ok && typeof wsData?.workspace?.id === "string") {
      workspaceId = wsData.workspace.id;
    }
  } catch {
    /* keep fallback */
  }

  setSession({
    userId: sbSession.user.id,
    email: sbSession.user.email || "user@example.com",
    displayName:
      sbSession.user.user_metadata?.display_name ||
      (sbSession.user.email || "member").split("@")[0],
    workspaceId,
    accessToken: sbSession.access_token,
    expiresAt: sbSession.expires_at
      ? new Date(sbSession.expires_at * 1000).toISOString()
      : null,
    issuedAt: new Date().toISOString(),
  });

  const session = getSession();
  const sessionDisplayName = session?.displayName || (sbSession.user.email || "").split("@")[0];

  notifyUi = setupNotifications();
  renderCampaignDataState({ mode: "loading" });
  renderDataSourceBadge({ mode: "loading" });

  const payload = await loadDashboardPayload();
  if (!isDashboardPayload(payload)) return;

  renderDashboard(payload, sessionDisplayName);
  renderCampaignDataState(
    payload._campaignDataState || { mode: "demo", message: "Using demo data." }
  );
  setupDashboardNav();

  setupCampaignControls();
  setupCampaignSearch();
  applyCampaignSearch("");
  const endpointBase = functionsBase;
  const metaOAuth = consumeMetaOAuthQueryParams();
  if (metaOAuth === "connected") {
    showDemoToast("Meta connected. Loading your ad accounts…");
  } else if (metaOAuth === "select-account") {
    showDemoToast("Choose the Meta ad account to use for this workspace.");
  } else if (metaOAuth === "denied") {
    showDemoToast("Meta login was cancelled.");
  } else if (metaOAuth === "oauth_error") {
    showDemoToast("Meta sign-in did not complete. Try again.");
  }

  hydrateMetaIntegrationUx(endpointBase, metaOAuth === "select-account").catch((e) => {
    console.warn("[AdsForecast] Meta integration panel failed to load.", e);
    renderMetaPanelInfo("Could not load Meta connection status.");
  });

  try {
    const live = await fetchLiveMetaCampaigns(endpointBase);
    const mapped = normalizeLiveCampaignRows(live?.campaigns);
    if (mapped.length > 0) {
      safeStorageWrite(LIVE_META_STATE_KEY, new Date().toLocaleString());
      const nextPayload = applyLiveCampaignData(payload, mapped, {
        accountId: typeof live?.accountId === "string" ? live.accountId : "",
        currency: typeof mapped[0]?.currency === "string" ? mapped[0].currency : "USD",
      });
      renderDashboard(nextPayload, sessionDisplayName);
      renderCampaignDataState(nextPayload._campaignDataState || { mode: "live" });
    } else {
      renderCampaignDataState({
        mode: "demo",
        message: "Demo data shown because live Meta data is unavailable.",
      });
      renderDataSourceBadge({
        mode: "demo",
        message: "Demo data shown because live Meta data is unavailable.",
      });
    }
  } catch {
    renderCampaignDataState({
      mode: "demo",
      message: "Demo data shown because live Meta data is unavailable.",
    });
    renderDataSourceBadge({
      mode: "demo",
      message: "Demo data shown because live Meta data is unavailable.",
    });
  }

  const restoreAlerts = document.getElementById("alerts-restore-dismissed");
  if (restoreAlerts instanceof HTMLButtonElement) {
    restoreAlerts.addEventListener("click", () => {
      writeDismissedAlertIds([]);
      renderAlerts(dashboardAlerts);
      const active = filterActiveAlerts(dashboardAlerts);
      renderNotifyPanel(active);
      notifyUi?.setBadgeCount?.(active.length);
      showDemoToast("Dismissed alerts restored.");
    });
  }
  updateAlertsToolbar();

  const signOut = document.getElementById("dashboard-sign-out");
  if (signOut instanceof HTMLButtonElement) {
    signOut.addEventListener("click", () => signOutToLogin());
  }
  const refresh = document.getElementById("dashboard-refresh-btn");
  if (refresh instanceof HTMLButtonElement) {
    refresh.addEventListener("click", () => window.location.reload());
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => console.error("[AdsForecast] Dashboard init failed", err));
  });
} else {
  init().catch((err) => console.error("[AdsForecast] Dashboard init failed", err));
}
