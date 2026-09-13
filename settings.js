import { fetchAccountCenter, fetchBillingCenter, updateAccountCenter } from "./app-account.js?v=1";
import { fetchMetaConnection, startMetaOauth } from "./app-meta.js?v=8";
import { clearPreferences, updatePreferences } from "./app-preferences.js";
import { getSession } from "./auth.js";
import { initAppPage, setTopbarIdentity, signOutAndRedirect, wireCommonShell } from "./app-shell.js?v=10";

const el = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
let snapshot = null;
let demo = false;

function setFeedback(target, message, tone = "") { if (!target) return; target.textContent = message; target.className = `account-feedback${tone === "error" ? " account-feedback--error" : ""}`; }
function setMetaStatus(label, tone = "neutral") { const node = el("settings-meta-status"); if (!node) return; node.textContent = label; node.className = `account-status account-status--${tone}`; }
function value(id) { return el(id)?.value ?? ""; }
function checked(id) { return Boolean(el(id)?.checked); }

function activateTab(name, updateHash = true) {
  const tabs = [...document.querySelectorAll("[data-settings-tab]")]; const panels = [...document.querySelectorAll("[data-settings-panel]")]; const valid = tabs.some((tab) => tab.dataset.settingsTab === name) ? name : "general";
  tabs.forEach((tab) => { const active = tab.dataset.settingsTab === valid; tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1; }); panels.forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== valid; }); if (updateHash) history.replaceState(null, "", `#${valid}`);
}

function wireTabs() {
  const tabs = [...document.querySelectorAll("[data-settings-tab]")]; tabs.forEach((tab, index) => { tab.addEventListener("click", () => activateTab(tab.dataset.settingsTab)); tab.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); let next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length; activateTab(tabs[next].dataset.settingsTab); tabs[next].focus(); }); }); activateTab(location.hash.slice(1) || "general", false);
}

function demoData(auth) {
  return { user: { email: auth.profile.email, createdAt: new Date(Date.now() - 7_776_000_000).toISOString() }, profile: { display_name: "Demo Workspace" }, workspace: { id: auth.profile.workspaceId, name: "Northwind Commerce", role: "owner", memberCount: 3 }, settings: { timezone: "Europe/Warsaw", currency: "USD", week_starts_on: 1, default_period: "30d", compact_mode: false, data_retention_days: 395, notifications: { analysisReady: true, performanceRisk: true, weeklyDigest: true, productUpdates: false, supportReplies: true, billingEvents: true } }, subscription: { status: "inactive", draft_plan_id: "growth", draft_cadence: "annual" }, draftPlan: { name: "Growth" }, verifiedPlan: null };
}

function hydrateGeneral(auth) {
  const profile = snapshot.profile || {}; const settings = snapshot.settings || {}; el("settings-user").innerHTML = `<span>${esc(profile.display_name || auth.profile.displayName || "Member")}</span><small>${esc(snapshot.user?.email || auth.profile.email)}</small>`; el("settings-workspace-info").innerHTML = `<span>${esc(snapshot.workspace?.name || "Workspace")}</span><small>${esc(snapshot.workspace?.role || "member")} · ${esc(snapshot.workspace?.memberCount || 1)} member${snapshot.workspace?.memberCount === 1 ? "" : "s"}</small>`;
  const fields = { "settings-display-name": profile.display_name || auth.profile.displayName || "", "settings-workspace-name": snapshot.workspace?.name || "", "settings-timezone": settings.timezone || "Europe/Warsaw", "settings-currency": settings.currency || "USD", "settings-default-period": settings.default_period || "30d", "settings-week-start": String(settings.week_starts_on ?? 1), "settings-retention": String(settings.data_retention_days || 395) }; Object.entries(fields).forEach(([id, entry]) => { if (el(id)) el(id).value = entry; }); el("settings-compact-mode").checked = Boolean(settings.compact_mode);
  const notifications = settings.notifications || {}; const map = { "settings-notify-analysis": "analysisReady", "settings-notify-risk": "performanceRisk", "settings-notify-weekly": "weeklyDigest", "settings-notify-product": "productUpdates", "settings-notify-support": "supportReplies", "settings-notify-billing": "billingEvents" }; Object.entries(map).forEach(([id, key]) => { if (el(id)) el(id).checked = Boolean(notifications[key]); });
}

function renderSession(auth) {
  const session = demo ? null : getSession(); const rows = [["Provider", demo ? "Demo preview" : "Supabase Auth"], ["Email", snapshot.user?.email || auth.profile.email], ["Workspace role", snapshot.workspace?.role], ["Issued", session?.issuedAt ? new Date(session.issuedAt).toLocaleString() : "Managed by provider"], ["Expires", session?.expiresAt ? new Date(session.expiresAt).toLocaleString() : "Managed by provider"]]; el("settings-session-details").innerHTML = rows.map(([label, entry]) => `<div class="profile-detail-row"><span>${esc(label)}</span><strong>${esc(entry || "—")}</strong></div>`).join("");
}

function renderBilling(result) {
  const subscription = result?.subscription || snapshot.subscription; const plans = result?.plans || []; const active = ["active", "trialing"].includes(subscription?.status); const plan = plans.find((item) => item.id === (active ? subscription?.planId : subscription?.draftPlanId)) || (active ? snapshot.verifiedPlan : snapshot.draftPlan); const readiness = result?.billing;
  el("settings-billing-summary").innerHTML = `<div class="settings-billing-summary"><div><span>${active ? "Verified subscription" : subscription?.draft_plan_id || subscription?.draftPlanId ? "Checkout draft" : "Subscription status"}</span><strong>${esc(plan?.name || (active ? "Active plan" : "No paid plan active"))}</strong><p>${active ? `${esc(subscription.status)} · ${esc(subscription.cadence || "")}` : subscription?.draft_plan_id || subscription?.draftPlanId ? `${esc(subscription.draft_cadence || subscription.draftCadence || "monthly")} selection · no charge made` : "Compare plans and choose a billing cadence when ready."}</p>${readiness ? `<small>Checkout ${readiness.checkoutReady ? "ready" : "not configured"} · webhook ${readiness.webhookReady ? "ready" : "not configured"} · ${esc(readiness.mode)} mode</small>` : ""}</div><a class="integration-card__btn integration-card__btn--primary" href="billing.html${demo ? "?demo=1" : ""}">Open plans &amp; billing</a></div>`;
}

async function hydrateMeta() {
  if (demo) { setMetaStatus("Demo mode"); el("settings-meta-connection").innerHTML = "<strong>No live source queried</strong><span>Exit demo and sign in to connect Meta Ads.</span>"; return false; }
  setMetaStatus("Checking"); const result = await fetchMetaConnection(); const connection = result.ok ? result.data?.connection : null; if (!connection) { setMetaStatus("Not connected", "warning"); el("settings-meta-connection").innerHTML = "<strong>Meta Ads needs setup</strong><span>Connect or re-authorize a Meta ad account.</span>"; return false; } setMetaStatus("Connected", "success"); el("settings-meta-connection").innerHTML = `<strong>${esc(connection.accountName || "Selected Meta account")}</strong><span>${esc(connection.accountId || "—")} · ${esc(connection.currency || "—")} · ${esc(connection.timezoneName || "—")}</span>`; return true;
}

async function init() {
  wireCommonShell("settings"); wireTabs(); const auth = await initAppPage("settings.html"); if (!auth.ok) return; demo = Boolean(auth.demo); setTopbarIdentity(auth.profile, false, demo ? "Sample workspace" : "Authenticated settings", demo ? "demo" : "account");
  if (demo) snapshot = demoData(auth); else { const result = await fetchAccountCenter(); if (!result.ok) throw new Error(result.data?.message || "Settings could not be loaded."); snapshot = result.data; }
  hydrateGeneral(auth); renderSession(auth); const billingResult = demo ? null : await fetchBillingCenter(); renderBilling(billingResult?.ok ? billingResult.data : null); const connected = await hydrateMeta(); if (!demo) setTopbarIdentity(auth.profile, connected, connected ? "Connected Meta workspace" : "No live Meta source verified", connected ? "live" : "offline");

  el("settings-save-preferences")?.addEventListener("click", async () => {
    const button = el("settings-save-preferences"); button.disabled = true; setFeedback(el("settings-save-feedback"), "Saving workspace settings…"); const profileFields = { displayName: value("settings-display-name").trim(), companyName: snapshot.profile?.company_name || "", roleTitle: snapshot.profile?.role_title || "", phone: snapshot.profile?.phone || "", locale: snapshot.profile?.locale || "en-US" }; const workspaceFields = { workspaceName: value("settings-workspace-name").trim(), timezone: value("settings-timezone"), currency: value("settings-currency"), weekStartsOn: Number(value("settings-week-start")), defaultPeriod: value("settings-default-period"), compactMode: checked("settings-compact-mode"), dataRetentionDays: Number(value("settings-retention")) };
    const results = demo ? [{ ok: true }, { ok: true }] : [await updateAccountCenter("profile", profileFields), await updateAccountCenter("workspace", workspaceFields)]; button.disabled = false; const failed = results.find((result) => !result.ok); if (failed) { setFeedback(el("settings-save-feedback"), failed.data?.message || "Settings could not be saved.", "error"); return; }
    snapshot = demo ? { ...snapshot, profile: { ...snapshot.profile, display_name: profileFields.displayName }, workspace: { ...snapshot.workspace, name: workspaceFields.workspaceName }, settings: { ...snapshot.settings, timezone: workspaceFields.timezone, currency: workspaceFields.currency, week_starts_on: workspaceFields.weekStartsOn, default_period: workspaceFields.defaultPeriod, compact_mode: workspaceFields.compactMode, data_retention_days: workspaceFields.dataRetentionDays } } : results[1].data;
    updatePreferences({ displayName: profileFields.displayName, timezone: workspaceFields.timezone, currency: workspaceFields.currency, compactMode: workspaceFields.compactMode }, demo); hydrateGeneral(auth); setTopbarIdentity({ ...auth.profile, displayName: profileFields.displayName }, connected, connected ? "Connected Meta workspace" : "Authenticated settings", demo ? "demo" : connected ? "live" : "account"); setFeedback(el("settings-save-feedback"), "Workspace settings saved to your account.");
  });

  el("settings-save-notifications")?.addEventListener("click", async () => { const fields = { analysisReady: checked("settings-notify-analysis"), performanceRisk: checked("settings-notify-risk"), weeklyDigest: checked("settings-notify-weekly"), productUpdates: checked("settings-notify-product"), supportReplies: checked("settings-notify-support"), billingEvents: checked("settings-notify-billing") }; const result = demo ? { ok: true, data: snapshot } : await updateAccountCenter("notifications", fields); if (!result.ok) { setFeedback(el("settings-notification-feedback"), result.data?.message || "Notification preferences could not be saved.", "error"); return; } snapshot = result.data; setFeedback(el("settings-notification-feedback"), "Notification preferences saved."); });
  el("settings-meta-reconnect-link")?.addEventListener("click", async () => { if (demo) return location.assign("login.html?next=integrations.html"); const button = el("settings-meta-reconnect-link"); button.disabled = true; button.textContent = "Opening Meta…"; const result = await startMetaOauth(); if (!result.ok) { button.disabled = false; button.textContent = "Reconnect Meta Ads"; setMetaStatus("Could not connect", "danger"); return; } location.assign(result.data.authUrl); });
  el("settings-sign-out")?.addEventListener("click", () => demo ? location.assign("index.html") : signOutAndRedirect()); el("settings-reset-preferences")?.addEventListener("click", () => { if (!confirm("Reset local display cache in this browser? Server account and Meta data will not be deleted.")) return; if (clearPreferences(demo)) location.reload(); });
}

init().catch((error) => { const main = el("main-content"); if (main) main.innerHTML = `<section class="dashboard-section"><h2>Settings unavailable</h2><p class="dashboard-empty">${esc(error.message || "Could not load settings.")}</p></section>`; });
