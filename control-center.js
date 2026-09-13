import { fetchAdminConsole, updateAdminConsole } from "./app-account.js?v=1";
import { initAppPage, setTopbarIdentity, wireCommonShell } from "./app-shell.js?v=10";

let currentView = "overview";
let currentData = null;
let adminRole = "viewer";
let dialogOpener = null;

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const formatDate = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
const money = (cents, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format((Number(cents) || 0) / 100);
const tone = (status) => ["active", "trialing", "connected", "processed", "resolved", "closed"].includes(status) ? "healthy" : ["failed", "past_due", "unpaid", "urgent"].includes(status) ? "risk" : "neutral";
const pill = (value) => `<span class="status-pill status-pill--${tone(String(value))}">${esc(String(value || "—").replaceAll("_", " "))}</span>`;

function feedback(message, kind = "") { const node = document.getElementById("admin-feedback"); if (!node) return; node.textContent = message; node.className = `launch-feedback${kind ? ` launch-feedback--${kind}` : ""}`; }
function section(title, description, body, actions = "") { return `<section class="dashboard-section admin-v2-panel"><div class="launch-section-head"><div><span class="app-section-kicker">Control plane</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${actions}</div>${body}</section>`; }
function table(headers, rows, empty = "No records found.") { return `<div class="table-wrap admin-v2-table"><table class="data-table"><thead><tr>${headers.map((head) => `<th>${esc(head)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="data-table__empty">${esc(empty)}</td></tr>`}</tbody></table></div>`; }

function renderOverview(data) {
  const entries = [["Customers", data.counts.customers, "Registered identity records"], ["Workspaces", data.counts.workspaces, "Customer tenants"], ["Live Meta", data.counts.connectedMetaAccounts, "Connected ad accounts"], ["Open tickets", data.counts.openTickets, "Needs support attention"], ["Paid workspaces", data.counts.activeSubscriptions, "Active or trialing"], ["AI failures · 24h", data.counts.failedAiRuns24h, "Operator review queue"]];
  const readiness = [["Stripe secret", data.readiness.stripeSecret], ["Stripe webhook", data.readiness.stripeWebhook], ["Meta app", data.readiness.metaApp], ["AI provider", data.readiness.aiProvider], ["Token encryption", data.readiness.tokenEncryption]];
  const launch = (data.settings || []).find((item) => item.key === "launch.state")?.value?.customerAccess || "private_beta";
  const select = document.getElementById("admin-launch-state"); if (select) select.value = launch;
  return `<section class="admin-kpi-grid">${entries.map(([label, value, note]) => `<article class="metric-card"><h3 class="metric-card__label">${label}</h3><p class="metric-card__value">${value}</p><p class="metric-card__hint">${note}</p></article>`).join("")}</section><section class="admin-overview-grid">${section("Launch readiness", "Server-side provider checks; secrets are never returned to the browser.", `<div class="admin-readiness-list">${readiness.map(([label, ready]) => `<div><span>${label}</span>${pill(ready ? "ready" : "missing")}</div>`).join("")}<div><span>Stripe mode</span>${pill(data.readiness.mode)}</div></div>`)}${section("Recent billing events", "Verified Stripe events and processing outcomes.", `<ol class="admin-event-list">${(data.billingEvents || []).map((event) => `<li><div><strong>${esc(event.event_type)}</strong><small>${formatDate(event.received_at)}</small></div>${pill(event.processing_status)}</li>`).join("") || "<li>No billing events received yet.</li>"}</ol>`)}</section>`;
}

function renderCustomers(data) {
  return section("Customers", `${data.total} registered users with tenant and subscription context.`, table(["Customer", "Company", "Workspace", "Role", "Subscription", "Joined"], (data.items || []).map((item) => `<tr><td><strong>${esc(item.profile?.display_name || item.name || "Member")}</strong><small>${esc(item.email)}</small></td><td>${esc(item.profile?.company_name || "—")}</td><td>${esc(item.workspace?.name || "—")}</td><td>${pill(item.membership?.role || "none")}</td><td>${pill(item.subscription?.status || "inactive")}<small>${esc(item.subscription?.plan_id || "No verified plan")}</small></td><td>${formatDate(item.created_at)}</td></tr>`)));
}

function renderWorkspaces(data) {
  return section("Workspaces", `${data.total} customer tenants and their operating state.`, table(["Workspace", "Members", "Plan", "Meta", "Open tickets", "Reporting defaults", "Created"], (data.items || []).map((item) => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.id)}</small></td><td>${item.memberCount}</td><td>${pill(item.subscription?.status || "inactive")}<small>${esc(item.subscription?.plan_id || "No plan")}</small></td><td>${pill(item.metaConnection?.status || "not connected")}<small>${esc(item.metaConnection?.account_name || "—")}</small></td><td>${item.openTicketCount}</td><td>${esc(item.settings?.currency || "—")} · ${esc(item.settings?.default_period || "—")}</td><td>${formatDate(item.created_at)}</td></tr>`)));
}

function renderSubscriptions(data) {
  return section("Subscriptions", "Webhook-authoritative subscription status; checkout drafts remain visibly separate.", table(["Workspace", "Verified plan", "Status", "Cadence", "Draft", "Period end", "Stripe"], (data.items || []).map((item) => `<tr><td><strong>${esc(item.workspace?.name || item.workspace_id)}</strong></td><td>${esc(item.plan?.name || "—")}</td><td>${pill(item.status)}</td><td>${esc(item.cadence || "—")}</td><td>${esc(item.draftPlan?.name || "—")}<small>${esc(item.draft_cadence || "")}</small></td><td>${formatDate(item.current_period_end)}</td><td>${pill(item.stripe_subscription_id ? "configured" : "not linked")}</td></tr>`)));
}

function renderPlans(data) {
  const cards = (data.items || []).map((plan) => `<article class="admin-plan-editor${plan.recommended ? " admin-plan-editor--featured" : ""}"><div><span>${plan.recommended ? "Recommended" : "Plan"}</span><h3>${esc(plan.name)}</h3><p>${esc(plan.tagline)}</p></div><div class="admin-plan-editor__price"><strong>${money(plan.monthly_price_cents, plan.currency)}</strong><span>/ month</span></div><dl><div><dt>Annual</dt><dd>${money(plan.annual_price_cents, plan.currency)}</dd></div><div><dt>AI runs</dt><dd>${esc(plan.limits?.aiRunsMonthly || "—")}/mo</dd></div><div><dt>Meta accounts</dt><dd>${esc(plan.limits?.metaAccounts || "—")}</dd></div><div><dt>Stripe mapping</dt><dd>${plan.stripe_product_id && plan.stripe_monthly_price_id && plan.stripe_annual_price_id ? "Ready" : "Missing"}</dd></div></dl><button class="btn btn--ghost" type="button" data-edit-plan="${esc(plan.id)}">Edit plan</button></article>`).join("");
  return section("Plan catalog", "Public pricing, limits, feature separation and Stripe product mappings.", `<div class="admin-plan-grid">${cards}</div>`);
}

function renderTickets(data) {
  return section("Support operations", `${data.total} requests in the selected queue.`, table(["Request", "Customer", "Workspace", "Priority", "Status", "Last activity", "Action"], (data.items || []).map((item) => `<tr><td><strong>${esc(item.subject)}</strong><small>${esc(item.category)} · ${esc(item.id)}</small></td><td>${esc(item.customer?.email || "—")}</td><td>${esc(item.workspace?.name || "—")}</td><td>${pill(item.priority)}</td><td>${pill(item.status)}</td><td>${formatDate(item.last_activity_at)}</td><td><button class="btn btn--ghost btn--compact" type="button" data-open-ticket="${esc(item.id)}">Open</button></td></tr>`)));
}

function renderIntegrations(data) {
  return section("Integration operations", `${data.total} Meta connections with latest synchronization evidence.`, table(["Workspace", "Account", "Currency", "Connection", "Token expiry", "Latest sync", "Updated"], (data.items || []).map((item) => `<tr><td>${esc(item.workspace?.name || item.workspace_id)}</td><td><strong>${esc(item.account_name || "—")}</strong><small>${esc(item.account_id || "—")}</small></td><td>${esc(item.currency || "—")}</td><td>${pill(item.status)}</td><td>${formatDate(item.token_expires_at)}</td><td>${pill(item.latestSync?.status || "never")}<small>${esc(item.latestSync?.message || "No sync log")}</small></td><td>${formatDate(item.updated_at)}</td></tr>`)));
}

function renderSystem(data) {
  const settings = (data.settings || []).map((item) => `<div><span>${esc(item.key)}</span><strong>${esc(JSON.stringify(item.value))}</strong><small>${esc(item.description)}</small></div>`).join("");
  return `<section class="admin-system-grid">${section("Platform settings", "Database-backed operational flags.", `<div class="admin-setting-list">${settings}</div>`)}${section("Failed billing events", "Verified events that need operator review.", `<ol class="admin-event-list">${(data.failedBillingEvents || []).map((item) => `<li><div><strong>${esc(item.event_type)}</strong><small>${esc(item.error_code || "Unknown error")} · ${formatDate(item.received_at)}</small></div>${pill(item.processing_status)}</li>`).join("") || "<li>No failed billing events.</li>"}</ol>`)}${section("Failed AI runs", "Recent analysis failures with safe error codes.", `<ol class="admin-event-list">${(data.failedAiRuns || []).map((item) => `<li><div><strong>${esc(item.provider)} · ${esc(item.model || "rules")}</strong><small>${esc(item.error_code || "Unknown error")} · ${formatDate(item.created_at)}</small></div>${pill("failed")}</li>`).join("") || "<li>No failed AI runs.</li>"}</ol>`)}</section>`;
}

function renderAdmins(data) {
  const form = adminRole === "super_admin" ? `<form class="admin-role-form" id="admin-role-form"><label class="app-pref-field">Existing app user ID<input class="app-pref-input" name="userId" required placeholder="usr_…"></label><label class="app-pref-field">Role<select class="app-pref-input" name="role"><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="support_admin">Support admin</option><option value="billing_admin">Billing admin</option><option value="super_admin">Super admin</option></select></label><label class="app-pref-field">Status<select class="app-pref-input" name="status"><option value="active">Active</option><option value="suspended">Suspended</option></select></label><button class="btn btn--primary" type="submit">Save access</button></form>` : "";
  return section("Platform administrators", "Explicit global roles. Workspace ownership never grants platform access.", `${form}${table(["Administrator", "Role", "Status", "Created"], (data.items || []).map((item) => `<tr><td><strong>${esc(item.user?.name || "Administrator")}</strong><small>${esc(item.user?.email || item.user_id)}</small></td><td>${pill(item.role)}</td><td>${pill(item.status)}</td><td>${formatDate(item.created_at)}</td></tr>`))}`);
}

function renderAudit(data) {
  return section("Administrator audit log", `${data.total} recorded control-plane actions.`, table(["Time", "Administrator", "Action", "Target", "Safe metadata"], (data.items || []).map((item) => `<tr><td>${formatDate(item.created_at)}</td><td><small>${esc(item.admin_user_id)}</small></td><td><strong>${esc(item.action)}</strong></td><td>${esc(item.target_type)}<small>${esc(item.target_id || "—")}</small></td><td><small>${esc(JSON.stringify(item.safe_metadata || {}))}</small></td></tr>`)));
}

function render(view, data) {
  const mount = document.getElementById("admin-view"); if (!mount) return;
  const renders = { overview: renderOverview, customers: renderCustomers, workspaces: renderWorkspaces, subscriptions: renderSubscriptions, plans: renderPlans, tickets: renderTickets, integrations: renderIntegrations, system: renderSystem, admins: renderAdmins, audit: renderAudit };
  mount.innerHTML = (renders[view] || renderOverview)(data);
  wireRenderedControls();
}

async function load(view = currentView) {
  currentView = view; document.querySelectorAll("[data-admin-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.adminView === view)));
  const mount = document.getElementById("admin-view"); if (mount) mount.innerHTML = '<section class="dashboard-section"><p class="dashboard-empty">Loading verified platform state…</p></section>';
  const result = await fetchAdminConsole(view);
  if (!result.ok) { feedback(result.status === 403 ? "This account is not a platform administrator." : result.data?.message || "Admin data could not be loaded.", "error"); if (mount) mount.innerHTML = section("Access unavailable", "The control plane returned no data.", '<p class="dashboard-empty">Return to the customer workspace or verify administrator access.</p>'); return; }
  adminRole = result.data.admin?.role || "viewer"; currentData = result.data.data; const role = document.getElementById("admin-role-copy"); if (role) role.textContent = `${adminRole.replaceAll("_", " ")} · database-backed platform access`; render(view, currentData);
}

function closeDialog() {
  document.getElementById("admin-record-dialog")?.close();
  if (dialogOpener instanceof HTMLElement && dialogOpener.isConnected) dialogOpener.focus();
  dialogOpener = null;
}

function openPlan(planId) {
  const plan = (currentData?.items || []).find((item) => item.id === planId); if (!plan) return;
  dialogOpener = document.activeElement;
  const dialog = document.getElementById("admin-record-dialog"); const mount = document.getElementById("admin-dialog-content");
  mount.innerHTML = `<form id="admin-plan-form"><div class="app-dialog__head"><div><span class="app-section-kicker">Plan catalog</span><h2 id="admin-dialog-title">Edit ${esc(plan.name)}</h2></div><button class="app-dialog__close" type="button" data-admin-dialog-close>×</button></div><input type="hidden" name="planId" value="${esc(plan.id)}"><div class="admin-dialog-grid"><label class="app-pref-field">Name<input class="app-pref-input" name="name" value="${esc(plan.name)}" required></label><label class="app-pref-field">Status<select class="app-pref-input" name="status">${["draft", "active", "archived"].map((value) => `<option ${plan.status === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label class="app-pref-field admin-dialog-grid__wide">Tagline<input class="app-pref-input" name="tagline" value="${esc(plan.tagline)}" required></label><label class="app-pref-field">Monthly price · cents<input class="app-pref-input" name="monthlyPriceCents" type="number" min="0" value="${plan.monthly_price_cents}"></label><label class="app-pref-field">Annual price · cents<input class="app-pref-input" name="annualPriceCents" type="number" min="0" value="${plan.annual_price_cents}"></label><label class="app-pref-field admin-dialog-grid__wide">Features · one per line<textarea class="app-pref-input" name="features" rows="6">${esc((plan.features || []).join("\n"))}</textarea></label><label class="app-pref-field">Stripe product ID<input class="app-pref-input" name="stripeProductId" value="${esc(plan.stripe_product_id || "")}" placeholder="prod_…"></label><label class="app-pref-field">Monthly Stripe price<input class="app-pref-input" name="stripeMonthlyPriceId" value="${esc(plan.stripe_monthly_price_id || "")}" placeholder="price_…"></label><label class="app-pref-field">Annual Stripe price<input class="app-pref-input" name="stripeAnnualPriceId" value="${esc(plan.stripe_annual_price_id || "")}" placeholder="price_…"></label><label class="app-pref-check"><input type="checkbox" name="recommended" ${plan.recommended ? "checked" : ""}><span>Recommended plan</span></label></div><div class="billing-dialog__actions"><button class="btn btn--primary" type="submit">Save plan</button><button class="btn btn--ghost" type="button" data-admin-dialog-close>Cancel</button></div></form>`;
  dialog.showModal(); mount.querySelectorAll("[data-admin-dialog-close]").forEach((button) => button.addEventListener("click", closeDialog));
  document.getElementById("admin-plan-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; const result = await updateAdminConsole("update_plan", { ...values, monthlyPriceCents: Number(values.monthlyPriceCents), annualPriceCents: Number(values.annualPriceCents), sortOrder: plan.sort_order, recommended: values.recommended === "on", features: String(values.features).split("\n").map((item) => item.trim()).filter(Boolean), limits: plan.limits || {} }); if (!result.ok) { button.disabled = false; feedback(result.data?.message || "Plan could not be saved.", "error"); return; } closeDialog(); feedback("Plan catalog updated and audit logged.", "success"); await load("plans"); });
}

async function openTicket(ticketId) {
  dialogOpener = document.activeElement;
  const result = await fetchAdminConsole("tickets", { ticketId }); if (!result.ok) { feedback(result.data?.message || "Ticket could not be loaded.", "error"); return; }
  const ticket = result.data.data.selected; const messages = result.data.data.messages || []; const dialog = document.getElementById("admin-record-dialog"); const mount = document.getElementById("admin-dialog-content");
  mount.innerHTML = `<div class="app-dialog__head"><div><span class="app-section-kicker">Support operations</span><h2 id="admin-dialog-title">${esc(ticket.subject)}</h2><p>${esc(ticket.id)}</p></div><button class="app-dialog__close" type="button" data-admin-dialog-close>×</button></div><div class="support-messages admin-ticket-messages">${messages.map((message) => `<article class="support-message support-message--${message.is_internal ? "internal" : esc(message.author_kind)}"><div><strong>${message.is_internal ? "Internal note" : message.author_kind === "admin" ? "AdsForecast support" : "Customer"}</strong><time>${formatDate(message.created_at)}</time></div><p>${esc(message.body).replace(/\n/g, "<br>")}</p></article>`).join("")}</div><form id="admin-ticket-form"><div class="admin-dialog-grid"><label class="app-pref-field">Status<select class="app-pref-input" name="status">${["open", "in_progress", "waiting_customer", "resolved", "closed"].map((value) => `<option value="${value}" ${ticket.status === value ? "selected" : ""}>${value.replace("_", " ")}</option>`).join("")}</select></label><label class="app-pref-field">Priority<select class="app-pref-input" name="priority">${["low", "normal", "high", "urgent"].map((value) => `<option ${ticket.priority === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label class="app-pref-check"><input name="assignedToMe" type="checkbox" ${ticket.assigned_admin_id ? "checked" : ""}><span>Assigned to me</span></label><button class="btn btn--ghost" type="button" id="admin-ticket-update">Update ticket</button><label class="app-pref-field admin-dialog-grid__wide">Reply or internal note<textarea class="app-pref-input" name="message" rows="5" maxlength="5000"></textarea></label><label class="app-pref-check"><input name="internal" type="checkbox"><span>Internal note — hidden from customer</span></label></div><div class="billing-dialog__actions"><button class="btn btn--primary" type="submit">Send reply</button><button class="btn btn--ghost" type="button" data-admin-dialog-close>Close</button></div></form>`;
  dialog.showModal(); mount.querySelectorAll("[data-admin-dialog-close]").forEach((button) => button.addEventListener("click", closeDialog));
  document.getElementById("admin-ticket-update")?.addEventListener("click", async () => { const form = document.getElementById("admin-ticket-form"); const values = Object.fromEntries(new FormData(form)); const saved = await updateAdminConsole("update_ticket", { ticketId, status: values.status, priority: values.priority, assignedToMe: values.assignedToMe === "on" }); if (!saved.ok) { feedback(saved.data?.message || "Ticket could not be updated.", "error"); return; } closeDialog(); feedback("Ticket updated and audit logged.", "success"); await load("tickets"); });
  document.getElementById("admin-ticket-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); if (!String(values.message || "").trim()) return; const saved = await updateAdminConsole("reply_ticket", { ticketId, message: values.message, internal: values.internal === "on" }); if (!saved.ok) { feedback(saved.data?.message || "Reply could not be saved.", "error"); return; } closeDialog(); feedback(values.internal === "on" ? "Internal note saved." : "Customer reply sent.", "success"); await load("tickets"); });
}

function wireRenderedControls() {
  document.querySelectorAll("[data-edit-plan]").forEach((button) => button.addEventListener("click", () => openPlan(button.dataset.editPlan)));
  document.querySelectorAll("[data-open-ticket]").forEach((button) => button.addEventListener("click", () => openTicket(button.dataset.openTicket)));
  document.getElementById("admin-role-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const result = await updateAdminConsole("set_admin_role", values); if (!result.ok) { feedback(result.data?.message || "Administrator access could not be updated.", "error"); return; } feedback("Administrator access updated and audit logged.", "success"); event.currentTarget.reset(); await load("admins"); });
}

async function init() {
  wireCommonShell("admin"); const auth = await initAppPage("control-center.html"); if (!auth.ok) return;
  setTopbarIdentity(auth.profile, false, "Platform control plane", "account");
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => load(button.dataset.adminView)));
  document.getElementById("admin-refresh")?.addEventListener("click", () => load(currentView));
  document.getElementById("admin-save-launch")?.addEventListener("click", async () => { const state = document.getElementById("admin-launch-state")?.value || "private_beta"; const result = await updateAdminConsole("update_launch_state", { state }); if (!result.ok) { feedback(result.data?.message || "Launch state could not be updated.", "error"); return; } feedback("Launch state updated and audit logged.", "success"); await load("overview"); });
  await load("overview");
}

init();
