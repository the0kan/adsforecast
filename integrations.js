import { initAppPage, setTopbarIdentity, wireCommonShell } from "./app-shell.js?v=10";
import {
  fetchMetaAccounts,
  fetchMetaConnection,
  postMetaConnect,
  startMetaOauth,
} from "./app-meta.js?v=8";

const mountId = "meta-integration-mount";
const activeSourceEl = document.getElementById("integration-active-source");

function setActiveSource(label) {
  if (activeSourceEl) activeSourceEl.textContent = label;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getMount(message = "") {
  const el = document.getElementById(mountId);
  if (!el) return null;
  if (message) {
    el.innerHTML = `
      <article class="integration-card integration-card--meta-live integration-card--notice">
        <p class="dashboard-empty">${esc(message)}</p>
      </article>`;
  }
  return el;
}

function setBusy(button, isBusy, text = "Working…") {
  if (!(button instanceof HTMLButtonElement)) return;
  if (isBusy) {
    button.dataset.originalText = button.textContent || "";
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent || "";
    button.disabled = false;
  }
}

async function startOauthFromButton(button) {
  setBusy(button, true, "Opening Meta…");
  const res = await startMetaOauth();
  if (!res.ok) {
    if (res.status === 401) {
      getMount("Please sign in again before connecting Meta Ads.");
    } else {
      getMount(res.data?.message || "Could not start Meta connection. Try again.");
    }
    return;
  }
  window.location.href = res.data.authUrl;
}

function readMetaReturnState() {
  try {
    const url = new URL(window.location.href);
    const meta = url.searchParams.get("meta") || "";
    const error = url.searchParams.get("error") || "";
    if (!meta && !error) return { meta: "", error: "" };
    url.searchParams.delete("meta");
    url.searchParams.delete("error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return { meta, error };
  } catch {
    return { meta: "", error: "" };
  }
}

function renderMetaNotice(type) {
  if (!type) return "";
  const map = {
    connected: "Meta OAuth completed. Confirm the ad account below.",
    "select-account": "Meta connected. Select which ad account should power this workspace.",
    denied: "Meta authorization was denied. You can reconnect whenever you are ready.",
    oauth_error: "Meta returned an OAuth error. Try reconnecting.",
  };
  const text = map[type] || "Meta connection updated.";
  return `<div class="integration-flow-note">${esc(text)}</div>`;
}

function renderNoConnection(returnState = "", demoMode = false) {
  const el = getMount();
  if (!el) return;
  setActiveSource(demoMode ? "Demo only" : "Not connected");
  el.innerHTML = `
    ${renderMetaNotice(returnState)}
    <article class="integration-card integration-card--meta-live integration-card--meta-cta integration-card--hero">
      <div class="integration-card__shine" aria-hidden="true"></div>
      <div class="integration-card__main">
        <p class="integration-card__eyebrow">Primary live source</p>
        <h3 class="integration-card__name">Connect Meta Ads</h3>
        <p class="integration-card__detail">${demoMode
          ? "This sample workspace does not call Meta. Exit demo mode and sign in to connect a real ad account."
          : "Start live campaign reporting for spend, purchases, revenue, ROAS, CPA, CTR, and recommendations. The browser never receives Meta access tokens."}</p>
        <div class="integration-card__actions integration-card__actions--wide">
          ${demoMode
            ? '<a class="integration-card__btn integration-card__btn--primary" href="login.html?next=integrations.html">Sign in to connect</a>'
            : '<button type="button" class="integration-card__btn integration-card__btn--primary" id="meta-connect-start-btn">Connect Meta Ads</button>'}
          <a class="integration-card__btn" href="settings.html${demoMode ? "?demo=1" : ""}">Review workspace</a>
        </div>
      </div>
      <div class="integration-card__visual" aria-hidden="true">
        <div class="meta-cube">
          <span>Meta</span>
          <strong>Live</strong>
        </div>
        <div class="meta-signal meta-signal--a"></div>
        <div class="meta-signal meta-signal--b"></div>
      </div>
    </article>`;

  const btn = document.getElementById("meta-connect-start-btn");
  if (btn instanceof HTMLButtonElement) {
    btn.addEventListener("click", () => startOauthFromButton(btn));
  }
}

function renderConnected(connection) {
  const el = getMount();
  if (!el) return;
  setActiveSource("Meta Ads · Live");
  const accountName = connection?.accountName || "Selected ad account";
  const accountId = connection?.accountId || "—";
  const currency = connection?.currency || "—";
  const timezone = connection?.timezoneName || connection?.timezone_name || "—";
  const lastSync = connection?.lastSyncAt ? new Date(connection.lastSyncAt) : null;
  const lastSyncLabel = lastSync && !Number.isNaN(lastSync.getTime()) ? lastSync.toLocaleString() : "Not synced yet";

  el.innerHTML = `
    <article class="integration-card integration-card--meta-live integration-card--connected integration-card--hero">
      <div class="integration-card__shine" aria-hidden="true"></div>
      <div class="integration-card__main">
        <p class="integration-card__eyebrow">Live integration</p>
        <h3 class="integration-card__name">Meta Ads connected</h3>
        <p class="integration-card__detail">${esc(accountName)}</p>
        <dl class="integration-meta-grid">
          <div><dt>Account</dt><dd>${esc(accountId)}</dd></div>
          <div><dt>Currency</dt><dd>${esc(currency)}</dd></div>
          <div><dt>Timezone</dt><dd>${esc(timezone)}</dd></div>
          <div><dt>Connection status</dt><dd>${esc(connection?.status || "connected")}</dd></div>
          <div><dt>Latest sync</dt><dd>${esc(lastSyncLabel)}</dd></div>
          <div><dt>Sync result</dt><dd>${esc(connection?.lastSyncStatus || "Not run")}</dd></div>
        </dl>
        <div class="integration-card__actions integration-card__actions--wide">
          <a class="integration-card__btn integration-card__btn--primary" href="campaigns.html">View campaigns</a>
          <button type="button" class="integration-card__btn" id="meta-refresh-now-btn">Refresh data</button>
          <button type="button" class="integration-card__btn" id="meta-change-account-btn">Change account</button>
          <button type="button" class="integration-card__btn" id="meta-reconnect-btn">Reconnect</button>
        </div>
      </div>
      <div class="integration-card__visual" aria-hidden="true">
        <div class="meta-cube meta-cube--connected">
          <span>Meta</span>
          <strong>Synced</strong>
        </div>
        <div class="meta-checkmark">✓</div>
      </div>
    </article>`;

  const refresh = document.getElementById("meta-refresh-now-btn");
  if (refresh instanceof HTMLButtonElement) refresh.addEventListener("click", () => window.location.reload());

  const change = document.getElementById("meta-change-account-btn");
  if (change instanceof HTMLButtonElement) change.addEventListener("click", () => loadState({ forceChooser: true }));

  const reconnect = document.getElementById("meta-reconnect-btn");
  if (reconnect instanceof HTMLButtonElement) reconnect.addEventListener("click", () => startOauthFromButton(reconnect));
}

function renderAccountSelector(accounts) {
  const el = getMount();
  if (!el) return;
  setActiveSource("Meta Ads · Select account");
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  el.innerHTML = `
    <article class="integration-card integration-card--meta-live integration-card--account-selector">
      <div class="integration-card__main">
        <p class="integration-card__eyebrow">Meta Ads</p>
        <h3 class="integration-card__name">Select an ad account</h3>
        <p class="integration-card__detail">Choose the account that should power live campaign tables and profitability calculations.</p>
        <ul class="meta-account-list">
          ${safeAccounts.map((account) => {
            const id = account?.id || "";
            const name = account?.name || id || "Unnamed account";
            const currency = account?.currency || "—";
            const timezone = account?.timezone_name || account?.timezoneName || "—";
            return `<li class="meta-account-list__item">
              <div class="meta-account-list__body">
                <p class="meta-account-list__title">${esc(name)}</p>
                <p class="meta-account-list__meta">${esc(id || "—")} · ${esc(currency)} · ${esc(timezone)}</p>
              </div>
              <button type="button" class="integration-card__btn integration-card__btn--primary" data-use-account="${esc(id)}">Use this account</button>
            </li>`;
          }).join("")}
        </ul>
      </div>
    </article>`;

  el.querySelectorAll("[data-use-account]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const button = btn instanceof HTMLButtonElement ? btn : null;
      const id = btn.getAttribute("data-use-account") || "";
      const account = safeAccounts.find((x) => x?.id === id);
      if (!id || !account) return;
      setBusy(button, true, "Connecting…");
      const res = await postMetaConnect({
        accountId: id,
        accountName: account.name || "",
        currency: account.currency || "",
        timezoneName: account.timezone_name || account.timezoneName || "",
      });
      if (!res.ok) {
        getMount(res.data?.message || "Could not connect selected account. Try again.");
        return;
      }
      window.location.href = "campaigns.html";
    });
  });
}

function renderLoading() {
  const el = getMount();
  if (!el) return;
  el.innerHTML = `
    <article class="integration-card integration-card--meta-live integration-card--skeleton" aria-busy="true">
      <div class="integration-skeleton-line integration-skeleton-line--wide"></div>
      <div class="integration-skeleton-line"></div>
      <div class="integration-skeleton-line integration-skeleton-line--short"></div>
    </article>`;
}

async function loadState(options = {}) {
  const { forceChooser = false, returnState = "" } = options;
  renderLoading();

  if (!forceChooser) {
    const connection = await fetchMetaConnection();
    if (connection.ok && connection.data?.connection) {
      renderConnected(connection.data.connection);
      return "connected";
    }
  }

  if (forceChooser || returnState === "select-account" || returnState === "connected") {
    const accounts = await fetchMetaAccounts();
    if (accounts.ok && Array.isArray(accounts.data?.accounts) && accounts.data.accounts.length > 0) {
      renderAccountSelector(accounts.data.accounts);
      return "select-account";
    }
  }

  renderNoConnection(returnState);
  return "not-connected";
}

async function init() {
  wireCommonShell("integrations");
  const auth = await initAppPage("integrations.html");
  if (!auth.ok) return;

  const returnState = readMetaReturnState();
  if (auth.demo) {
    setTopbarIdentity(auth.profile, false, "Sample workspace · no live connection", "demo");
    renderNoConnection("", true);
    return;
  }

  const state = await loadState({
    forceChooser: returnState.meta === "select-account",
    returnState: returnState.meta || returnState.error,
  });
  setTopbarIdentity(auth.profile, state === "connected", returnState.error || "No live Meta source connected", "offline");
}

init();
