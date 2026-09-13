import { bootstrapWorkspace, renderAuthRequiredScreen, requireAppSession, signOutAndRedirect } from "./app-auth.js";
import { fetchMetaConnection } from "./app-meta.js?v=8";
import { readBillingPreference } from "./app-preferences.js";

export { signOutAndRedirect };

export function formatCurrency(amount, currency = "USD", digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(amount) || 0);
}

export function formatPercent(ratio) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(ratio) || 0);
}

export function formatRatio(n, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(n) || 0);
}

function initialsFromProfile(profile) {
  const raw = profile?.displayName || profile?.email || "AF";
  const cleaned = String(raw).replace(/@.*$/, "").replace(/[._-]+/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "A") + (parts[1]?.[0] || parts[0]?.[1] || "P");
}

export function setTopbarIdentity(profile, isLive, liveMessage, mode = isLive ? "live" : "demo") {
  const name = profile?.displayName || profile?.email || "Member";
  const userEls = document.querySelectorAll(".dashboard-user__name");
  userEls.forEach((user) => {
    user.textContent = name;
    user.setAttribute("title", profile?.email || name);
  });

  document.querySelectorAll(".dashboard-user__avatar").forEach((avatar) => {
    avatar.textContent = initialsFromProfile(profile).toUpperCase();
  });

  const badge = document.getElementById("dashboard-env-badge");
  if (badge) {
    const normalizedMode = isLive ? "live" : mode;
    const labels = { live: "Live", demo: "Demo", offline: "Needs setup", account: "Workspace" };
    badge.hidden = false;
    badge.textContent = labels[normalizedMode] || labels.account;
    badge.className = `dashboard-env-badge dashboard-env-badge--${normalizedMode}`;
    badge.title = isLive ? "Live data from connected sources" : liveMessage || (normalizedMode === "demo" ? "Sample data only" : "No live data source verified");
  }

  const sidebarStatus = document.getElementById("app-sidebar-status-copy");
  if (sidebarStatus && sidebarStatus.closest(".com-sidebar-status")?.getAttribute("data-meta-hydrated") !== "true") {
    sidebarStatus.textContent = isLive
      ? "Live Meta connection"
      : mode === "demo"
        ? "Sample workspace · no live sync"
        : mode === "offline"
          ? "No live source verified"
          : "Secure account workspace";
  }
  const sidebarDot = document.querySelector(".com-sidebar-status__dot");
  if (sidebarDot && sidebarDot.closest(".com-sidebar-status")?.getAttribute("data-meta-hydrated") !== "true") {
    sidebarDot.classList.toggle("app-sidebar-status__dot--demo", !isLive && mode === "demo");
    sidebarDot.classList.toggle("app-sidebar-status__dot--offline", !isLive && mode === "offline");
    sidebarDot.classList.toggle("app-sidebar-status__dot--account", !isLive && mode === "account");
  }
}

function formatRelativeTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Not synced yet";
  const delta = date.getTime() - Date.now();
  const abs = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return "Just now";
  if (abs < 3_600_000) return formatter.format(Math.round(delta / 60_000), "minute");
  if (abs < 86_400_000) return formatter.format(Math.round(delta / 3_600_000), "hour");
  if (abs < 604_800_000) return formatter.format(Math.round(delta / 86_400_000), "day");
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function compactAccountId(value) {
  const clean = String(value || "").replace(/^act_/, "");
  if (!clean) return "Account not selected";
  return clean.length > 8 ? `•••• ${clean.slice(-6)}` : clean;
}

export function renderSidebarMetaConnection(connection, mode = "live") {
  const card = document.querySelector(".com-sidebar-status");
  if (!(card instanceof HTMLElement)) return;
  const demo = mode === "demo";
  const connected = Boolean(connection?.accountId) || demo;
  const syncFailed = connection?.lastSyncStatus === "error";
  card.setAttribute("data-meta-hydrated", "true");
  card.classList.toggle("app-sidebar-status--connected", connected && !syncFailed);
  card.classList.toggle("app-sidebar-status--offline", !connected || syncFailed);
  const dot = card.querySelector(".com-sidebar-status__dot");
  dot?.classList.toggle("app-sidebar-status__dot--demo", demo);
  dot?.classList.toggle("app-sidebar-status__dot--offline", !connected || syncFailed);
  dot?.classList.toggle("app-sidebar-status__dot--account", false);

  const title = card.querySelector("[data-meta-account-name]");
  const account = card.querySelector("[data-meta-account-id]");
  const sync = card.querySelector("[data-meta-sync]");
  const status = card.querySelector("[data-meta-status]");
  const link = card.querySelector("a");
  if (title) title.textContent = demo ? "Sample Meta account" : connected ? connection.accountName || "Meta Ads account" : "Connect Meta Ads";
  if (account) account.textContent = demo ? "Demo workspace" : compactAccountId(connection?.accountId);
  if (sync) sync.textContent = demo ? "Sample data · no live sync" : connected ? `Synced ${formatRelativeTime(connection.lastSyncAt || connection.updatedAt)}` : "No verified data source";
  if (status) status.textContent = demo ? "Demo" : syncFailed ? "Sync issue" : connected ? "Connected" : "Setup required";
  if (link instanceof HTMLAnchorElement) {
    link.href = demo ? "integrations.html?demo=1" : "integrations.html";
    link.textContent = connected ? "Manage" : "Connect";
  }
}

async function hydrateSidebarMeta(demoMode) {
  if (demoMode) {
    renderSidebarMetaConnection({ accountId: "demo", accountName: "Sample Meta account" }, "demo");
    return null;
  }
  const result = await fetchMetaConnection();
  renderSidebarMetaConnection(result.ok ? result.data?.connection : null, result.ok ? "live" : "offline");
  return result.ok ? result.data?.connection || null : null;
}

export function wireCommonShell(pageId) {
  document.documentElement.classList.add("app-shell-ready");
  const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";

  document.querySelectorAll(".dashboard-sidebar__header .dashboard-logo").forEach((logo) => {
    logo.className = "dashboard-logo app-logo-premium";
    logo.setAttribute("href", demoMode ? "overview.html?demo=1" : "overview.html");
    logo.setAttribute("aria-label", "Go to AdsForecast overview");
    logo.innerHTML = '<span class="app-logo-premium__mark" aria-hidden="true">AF</span><span>AdsForecast</span>';
  });

  const navIcons = {
    overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></svg>',
    campaigns: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m5 10V5m6 14v-7m5 7V3"/></svg>',
    profitability: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16l5-5 4 4 7-8M15 7h5v5"/></svg>',
    integrations: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8m-8 0a4 4 0 1 1 0-8h2m6 8a4 4 0 1 1 0 8h-2"/></svg>',
    insights: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a7 7 0 0 0-4 12.74V19h8v-3.26A7 7 0 0 0 12 3Zm-3 20h6"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"/></svg>',
    billing: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4V6Zm0 4h16M8 15h3"/></svg>',
    support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v11H9l-4 4V5Zm4 4h6m-6 3h4"/></svg>',
    admin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 4.6 3.4 7.7 8 9 4.6-1.3 8-4.4 8-9V7l-8-4Zm-3 9 2 2 4-4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5 2-1-2-3-2.2.5a8 8 0 0 0-1.3-.8L16 4h-4l-.5 2.7a8 8 0 0 0-1.3.8L8 7 6 10l2 2-2 2 2 3 2.2-.5c.4.3.8.6 1.3.8L12 20h4l.5-2.7c.5-.2.9-.5 1.3-.8L20 17l2-3-2-2Z"/></svg>',
  };

  const nav = document.querySelector(".dashboard-sidebar__nav");
  if (nav) {
    nav.innerHTML = `
      <p class="dashboard-nav__label">Performance</p>
      <ul class="dashboard-nav">
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="overview" href="overview.html">Overview</a></li>
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="campaigns" href="campaigns.html">Campaigns</a></li>
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="profitability" href="profitability.html">Profitability</a></li>
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="insights" href="insights.html">AI Analyst</a></li>
      </ul>
      <p class="dashboard-nav__label dashboard-nav__label--spaced">Workspace</p>
      <ul class="dashboard-nav">
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="integrations" href="integrations.html">Integrations</a></li>
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="profile" href="profile.html">Profile</a></li>
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="billing" href="billing.html">Plans &amp; billing</a></li>
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="support" href="support.html">Support</a></li>
        <li class="dashboard-nav__item"><a class="dashboard-nav__link" data-app-nav="settings" href="settings.html">Settings</a></li>
      </ul>`;
  }

  const links = document.querySelectorAll("[data-app-nav]");
  links.forEach((a) => {
    const key = a.getAttribute("data-app-nav");
    if (key && navIcons[key] && !a.querySelector("svg")) {
      a.insertAdjacentHTML("afterbegin", navIcons[key]);
    }
    const active = key === pageId;
    a.classList.toggle("dashboard-nav__link--active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
    if (demoMode) {
      const url = new URL(a.href, window.location.href);
      url.searchParams.set("demo", "1");
      a.href = `${url.pathname.split("/").pop()}${url.search}`;
    }
  });

  if (demoMode) {
    const productPages = new Set(["overview.html", "campaigns.html", "profitability.html", "insights.html", "integrations.html", "profile.html", "billing.html", "support.html", "settings.html"]);
    document.querySelectorAll(".dashboard-main a[href]").forEach((link) => {
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href, window.location.href);
      const filename = url.pathname.split("/").pop();
      if (!productPages.has(filename)) return;
      url.searchParams.set("demo", "1");
      link.href = `${filename}${url.search}`;
    });
  }

  const sidebar = document.querySelector(".dashboard-sidebar");
  if (sidebar && !sidebar.querySelector(".com-sidebar-status")) {
    sidebar.insertAdjacentHTML("beforeend", `
      <div class="app-sidebar-status">
        <span class="app-sidebar-status__dot" aria-hidden="true"></span>
        <div class="app-sidebar-status__body">
          <div class="app-sidebar-status__topline"><strong data-meta-account-name>Meta workspace</strong><span data-meta-status>Checking</span></div>
          <small data-meta-account-id>Resolving account…</small>
          <small id="app-sidebar-status-copy" data-meta-sync>Checking data source…</small>
          <a href="integrations.html">Manage</a>
        </div>
      </div>`);
  }

  const signOut = document.getElementById("dashboard-sign-out");
  if (signOut instanceof HTMLButtonElement) {
    if (demoMode) signOut.textContent = "Exit demo";
    signOut.addEventListener("click", () => {
      if (demoMode) window.location.href = "index.html";
      else signOutAndRedirect();
    }, { once: true });
  }

  const profileLink = document.getElementById("dashboard-profile-link");
  if (profileLink instanceof HTMLAnchorElement) profileLink.href = demoMode ? "profile.html?demo=1" : "profile.html";

  const topbarActions = document.querySelector(".dashboard-topbar__actions");
  if (topbarActions && !topbarActions.querySelector(".app-account")) {
    const oldUser = topbarActions.querySelector(".dashboard-user");
    const oldSignOut = topbarActions.querySelector("#dashboard-sign-out");
    oldUser?.remove();
    oldSignOut?.remove();
    const billing = readBillingPreference(demoMode);
    const account = document.createElement("div");
    account.className = "app-account";
    account.innerHTML = `
      <button class="dashboard-user app-account__trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="app-account-menu">
        <span class="dashboard-user__avatar" aria-hidden="true">AF</span>
        <span class="app-account__identity"><span class="dashboard-user__name">Profile</span><small>${billing.selectedAt ? "Checkout draft saved" : "Workspace account"}</small></span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg>
      </button>
      <div class="app-account__menu" id="app-account-menu" role="menu" hidden>
        <div class="app-account__menu-head"><span class="dashboard-user__avatar" aria-hidden="true">AF</span><div><strong class="dashboard-user__name">Profile</strong><small>${demoMode ? "Demo workspace" : "Authenticated workspace"}</small></div></div>
        <a role="menuitem" href="profile.html">Profile</a>
        <a role="menuitem" href="settings.html">Settings</a>
        <a role="menuitem" href="billing.html">Plans &amp; billing</a>
        <a role="menuitem" href="support.html">Support</a>
        <a role="menuitem" href="control-center.html" data-admin-menu-link hidden>Control center</a>
        <button role="menuitem" type="button" class="app-account__signout">${demoMode ? "Exit demo" : "Sign out"}</button>
      </div>`;
    topbarActions.append(account);
    const trigger = account.querySelector(".app-account__trigger");
    const menu = account.querySelector(".app-account__menu");
    const closeMenu = (restore = false) => {
      if (!(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) return;
      const wasOpen = !menu.hidden;
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (restore && wasOpen) trigger.focus();
    };
    if (trigger instanceof HTMLButtonElement && menu instanceof HTMLElement) {
      trigger.addEventListener("click", () => {
        const open = menu.hidden;
        menu.hidden = !open;
        trigger.setAttribute("aria-expanded", String(open));
        if (open) menu.querySelector("[role=menuitem]")?.focus();
      });
      document.addEventListener("click", (event) => {
        if (!account.contains(event.target)) closeMenu();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !menu.hidden) closeMenu(true);
      });
    }
    account.querySelectorAll("a[href]").forEach((link) => {
      if (!(link instanceof HTMLAnchorElement) || !demoMode) return;
      const url = new URL(link.href, window.location.href);
      url.searchParams.set("demo", "1");
      link.href = `${url.pathname.split("/").pop()}${url.search}`;
    });
    account.querySelector(".app-account__signout")?.addEventListener("click", () => {
      if (demoMode) window.location.href = "index.html";
      else signOutAndRedirect();
    });
  }

  document.querySelectorAll("[data-refresh-page]").forEach((btn) => {
    btn.addEventListener("click", () => window.location.reload());
  });
}

function hydratePlatformAccess(profile) {
  const nav = document.querySelector(".dashboard-sidebar__nav .dashboard-nav:last-of-type");
  if (profile?.platformAdmin && nav && !nav.querySelector('[data-app-nav="admin"]')) {
    const item = document.createElement("li");
    item.className = "dashboard-nav__item";
    item.innerHTML = `<a class="dashboard-nav__link" data-app-nav="admin" href="control-center.html">${navIconsForAdmin()}Control center</a>`;
    nav.append(item);
  }
  document.querySelectorAll("[data-admin-menu-link]").forEach((link) => { link.hidden = !profile?.platformAdmin; });
  const planLabel = document.querySelector(".app-account__identity small");
  if (planLabel && profile?.subscription) {
    const verified = ["active", "trialing"].includes(profile.subscription.status);
    planLabel.textContent = verified ? `${profile.subscription.plan_id || "Active"} plan` : profile.subscription.draft_plan_id ? "Checkout draft saved" : "Workspace account";
  }
}

function navIconsForAdmin() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v5c0 4.6 3.4 7.7 8 9 4.6-1.3 8-4.4 8-9V7l-8-4Zm-3 9 2 2 4-4"/></svg>';
}

export async function initAppPage(pageFilename) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("dev") === "1" || params.get("demo") === "1") {
    void hydrateSidebarMeta(true);
    return {
      ok: true,
      profile: {
        userId: "demo_user",
        email: "demo@adsforecast.com",
        displayName: "Demo Workspace",
        workspaceId: "ws_nw_01",
      },
      session: null,
      demo: true,
    };
  }
  const root = document.querySelector(".dashboard-main");
  const auth = await requireAppSession();
  if (!auth.ok) {
    const reason = auth.reason === "supabase_not_configured"
      ? "Supabase is not configured on this page. Check the Supabase meta tags."
      : auth.reason === "supabase_client_failed"
        ? "Could not initialize Supabase client. Check network/CSP and try again."
        : "Your session is missing or expired.";
    renderAuthRequiredScreen(root, pageFilename, reason);
    return { ok: false, reason: auth.reason };
  }

  const boot = await bootstrapWorkspace(auth.session);
  if (!boot.ok) {
    const detail = boot.reason === "workspace_bootstrap_failed"
      ? `Workspace bootstrap failed${boot.data?.error ? ` (${boot.data.error})` : ""}.`
      : "Could not reach the workspace endpoint. Check Supabase functions deployment and CORS.";
    renderAuthRequiredScreen(root, pageFilename, detail);
    return { ok: false, reason: boot.reason };
  }

  hydratePlatformAccess(boot.profile);
  void hydrateSidebarMeta(false);
  return { ok: true, profile: boot.profile, session: auth.session };
}
