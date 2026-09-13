import { fetchBillingCenter, updateBillingCenter } from "./app-account.js?v=1";
import { initAppPage, setTopbarIdentity, wireCommonShell } from "./app-shell.js?v=10";

const DEMO_PLANS = [
  { id: "starter", name: "Starter", tagline: "For solo operators building a reliable paid-media profit habit.", monthlyPriceCents: 2900, annualPriceCents: 29000, currency: "USD", limits: { metaAccounts: 1, teamSeats: 1, aiRunsMonthly: 12, historyMonths: 3, dataExports: "csv" }, features: ["Campaign performance workspace", "Profitability and break-even model", "Core AI decision brief", "Daily, weekly and monthly reporting", "CSV campaign export", "Standard email support"], recommended: false, status: "active", checkoutConfigured: false },
  { id: "growth", name: "Growth", tagline: "For growing teams making budget decisions every day.", monthlyPriceCents: 7900, annualPriceCents: 79000, currency: "USD", limits: { metaAccounts: 3, teamSeats: 5, aiRunsMonthly: 60, historyMonths: 13, dataExports: "advanced" }, features: ["Everything in Starter", "Five-layer AI Analyst", "Custom reporting periods", "Advanced decision filters", "Downloadable decision briefs", "Priority support"], recommended: true, status: "active", checkoutConfigured: false },
  { id: "scale", name: "Scale", tagline: "For agencies and multi-account commerce operations.", monthlyPriceCents: 17900, annualPriceCents: 179000, currency: "USD", limits: { metaAccounts: 10, teamSeats: 15, aiRunsMonthly: 250, historyMonths: 24, dataExports: "advanced" }, features: ["Everything in Growth", "Multi-account operating limits", "Team and client-ready workflows", "Extended analysis history", "Advanced export capacity", "Priority escalation support"], recommended: false, status: "active", checkoutConfigured: false },
];

let demo = false;
let plans = [];
let subscription = null;
let billing = { checkoutReady: false, webhookReady: false, portalReady: false, mode: "test" };
let cadence = "monthly";
let pendingPlan = "growth";

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const money = (cents, currency = "USD", digits = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format((Number(cents) || 0) / 100);
const monthlyEquivalent = (plan) => cadence === "annual" ? Math.round(plan.annualPriceCents / 12) : plan.monthlyPriceCents;
function setFeedback(message, kind = "") { const node = document.getElementById("billing-feedback"); if (!node) return; node.textContent = message; node.className = `launch-feedback${kind ? ` launch-feedback--${kind}` : ""}`; }

function renderStatus() {
  const active = ["active", "trialing"].includes(subscription?.status);
  const verifiedPlan = plans.find((plan) => plan.id === subscription?.planId);
  const draftPlan = plans.find((plan) => plan.id === subscription?.draftPlanId);
  document.getElementById("billing-current-status").textContent = demo ? "Demo preview" : active ? `${verifiedPlan?.name || "Verified"} · ${subscription.status}` : subscription?.status && subscription.status !== "draft" ? subscription.status.replace("_", " ") : "No paid plan active";
  document.getElementById("billing-checkout-draft").textContent = draftPlan ? `${draftPlan.name} · ${subscription.draftCadence === "annual" ? "Annual" : "Monthly"}` : "Not selected";
  const provider = document.getElementById("billing-provider-status");
  if (provider) provider.textContent = demo ? "Demo · no payment" : billing.checkoutReady && billing.webhookReady ? `Stripe ${billing.mode} mode ready` : "Stripe setup incomplete";
  const portal = document.getElementById("billing-manage-portal");
  if (portal instanceof HTMLButtonElement) portal.disabled = !billing.portalReady;
}

function renderPlans() {
  const mount = document.getElementById("billing-plan-grid"); if (!mount) return;
  mount.innerHTML = plans.filter((plan) => plan.status !== "archived").map((plan) => {
    const selected = subscription?.draftPlanId === plan.id && subscription?.draftCadence === cadence;
    const yearlySaving = plan.monthlyPriceCents * 12 - plan.annualPriceCents;
    return `<article class="billing-plan-card${plan.recommended ? " billing-plan-card--featured" : ""}${selected ? " billing-plan-card--selected" : ""}"><div class="billing-plan-card__top"><div><span>${plan.recommended ? "Recommended" : "AdsForecast plan"}</span><h3>${esc(plan.name)}</h3></div>${selected ? '<span class="billing-plan-card__selected-label">Draft saved</span>' : ""}</div><p class="billing-plan-card__description">${esc(plan.tagline)}</p><div class="billing-plan-card__price"><strong>${money(monthlyEquivalent(plan), plan.currency)}</strong><span>/ month</span></div><p class="billing-plan-card__billing">${cadence === "annual" ? `Billed ${money(plan.annualPriceCents, plan.currency)} yearly · save ${money(yearlySaving, plan.currency)}` : "Billed monthly inside secure Stripe checkout"}</p><div class="billing-plan-card__limit">${esc(plan.limits?.metaAccounts || 0)} Meta account${Number(plan.limits?.metaAccounts) === 1 ? "" : "s"} · ${esc(plan.limits?.teamSeats || 1)} team seat${Number(plan.limits?.teamSeats) === 1 ? "" : "s"}</div><ul>${(plan.features || []).map((feature) => `<li><span aria-hidden="true">✓</span>${esc(feature)}</li>`).join("")}</ul><button class="btn ${plan.recommended ? "btn--primary" : "btn--ghost"}" type="button" data-choose-plan="${esc(plan.id)}">${selected ? "Review saved selection" : `Choose ${esc(plan.name)}`}</button></article>`;
  }).join("");
}

function renderComparison() {
  const visible = plans.filter((plan) => plan.status === "active");
  const head = document.getElementById("billing-comparison-head"); const body = document.getElementById("billing-comparison-body"); if (!head || !body) return;
  head.innerHTML = `<tr><th>Capability</th>${visible.map((plan) => `<th>${esc(plan.name)}</th>`).join("")}</tr>`;
  const rows = [
    ["Meta ad accounts", (plan) => plan.limits?.metaAccounts], ["Team seats", (plan) => plan.limits?.teamSeats], ["AI analyses / month", (plan) => plan.limits?.aiRunsMonthly], ["History", (plan) => `${plan.limits?.historyMonths || 0} months`], ["Data export", (plan) => plan.limits?.dataExports === "advanced" ? "Advanced" : "CSV"], ["Reporting periods", () => "Daily · weekly · monthly"], ["Five-layer analyst", (plan) => plan.id === "starter" ? "Core brief" : "Included"], ["Support", (plan) => plan.id === "starter" ? "Standard" : plan.id === "growth" ? "Priority" : "Priority escalation"],
  ];
  body.innerHTML = rows.map(([label, resolve]) => `<tr><th>${esc(label)}</th>${visible.map((plan) => `<td>${esc(resolve(plan) ?? "—")}</td>`).join("")}</tr>`).join("");
}

function setCadence(next) { cadence = next === "annual" ? "annual" : "monthly"; document.querySelectorAll("[data-billing-cadence]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.billingCadence === cadence))); renderPlans(); }

function openDialog(planId) {
  const plan = plans.find((item) => item.id === planId); const dialog = document.getElementById("billing-dialog"); const content = document.getElementById("billing-dialog-content"); if (!plan || !content) return;
  pendingPlan = planId; const total = cadence === "annual" ? plan.annualPriceCents : plan.monthlyPriceCents;
  content.innerHTML = `<div class="billing-dialog__summary"><div><span>Plan</span><strong>${esc(plan.name)}</strong></div><div><span>Billing cadence</span><strong>${cadence === "annual" ? "Annual" : "Monthly"}</strong></div><div><span>Secure checkout total</span><strong>${money(total, plan.currency)}</strong></div><div><span>Activation</span><strong>After verified Stripe event</strong></div></div><p class="billing-dialog__notice"><strong>${billing.checkoutReady && billing.webhookReady ? "Secure checkout is ready." : "Checkout setup is incomplete."}</strong>${billing.checkoutReady && billing.webhookReady ? " Continue to Stripe to review and confirm payment. AdsForecast activates the plan only after a signed webhook event." : " You can save this selection now. No payment information is collected and no subscription is activated."}</p>`;
  const checkout = document.getElementById("billing-checkout"); if (checkout) checkout.hidden = !(billing.checkoutReady && billing.webhookReady && plan.checkoutConfigured && !demo);
  dialog.showModal();
}

async function save(action) {
  const buttons = [document.getElementById("billing-save-draft"), document.getElementById("billing-checkout")].filter(Boolean); buttons.forEach((button) => { button.disabled = true; }); setFeedback(action === "create_checkout" ? "Preparing secure Stripe checkout…" : "Saving plan selection…");
  if (demo) { subscription = { ...(subscription || {}), draftPlanId: pendingPlan, draftCadence: cadence, status: "draft" }; renderStatus(); renderPlans(); document.getElementById("billing-dialog")?.close(); setFeedback("Demo plan selection saved for this preview.", "success"); buttons.forEach((button) => { button.disabled = false; }); return; }
  const result = await updateBillingCenter(action, { planId: pendingPlan, cadence }); buttons.forEach((button) => { button.disabled = false; });
  if (!result.ok) { setFeedback(result.data?.message || "Billing selection could not be saved.", "error"); return; }
  if (result.data.redirectUrl) { window.location.assign(result.data.redirectUrl); return; }
  subscription = result.data.subscription || subscription; document.getElementById("billing-dialog")?.close(); renderStatus(); renderPlans(); setFeedback("Plan selection saved. No charge was made.", "success");
}

async function init() {
  wireCommonShell("billing"); const auth = await initAppPage("billing.html"); if (!auth.ok) return; demo = Boolean(auth.demo);
  setTopbarIdentity(auth.profile, false, demo ? "Demo workspace · no payment" : "Authenticated billing workspace", demo ? "demo" : "account");
  if (demo) { plans = DEMO_PLANS; billing = { checkoutReady: false, webhookReady: false, portalReady: false, mode: "test" }; subscription = { status: "inactive", draftPlanId: null, draftCadence: null }; }
  else { const result = await fetchBillingCenter(); if (!result.ok) { setFeedback(result.data?.message || "Billing information could not be loaded.", "error"); return; } plans = result.data.plans || []; subscription = result.data.subscription; billing = result.data.billing || billing; }
  const params = new URLSearchParams(location.search); const requestedCadence = params.get("cadence"); cadence = ["monthly", "annual"].includes(requestedCadence) ? requestedCadence : subscription?.draftCadence || subscription?.cadence || "monthly"; pendingPlan = params.get("plan") || subscription?.draftPlanId || "growth";
  setCadence(cadence); renderStatus(); renderComparison();
  document.querySelectorAll("[data-billing-cadence]").forEach((button) => button.addEventListener("click", () => setCadence(button.dataset.billingCadence)));
  document.getElementById("billing-plan-grid")?.addEventListener("click", (event) => { const button = event.target.closest("[data-choose-plan]"); if (button) openDialog(button.dataset.choosePlan); });
  document.querySelectorAll("[data-billing-dialog-close]").forEach((button) => button.addEventListener("click", () => document.getElementById("billing-dialog")?.close()));
  document.getElementById("billing-save-draft")?.addEventListener("click", () => save("save_draft")); document.getElementById("billing-checkout")?.addEventListener("click", () => save("create_checkout"));
  document.getElementById("billing-manage-portal")?.addEventListener("click", async () => { const result = await updateBillingCenter("create_portal"); if (!result.ok) { setFeedback(result.data?.message || "Billing portal is not ready.", "error"); return; } if (result.data.redirectUrl) window.location.assign(result.data.redirectUrl); });
  if (params.get("checkout") === "success") setFeedback("Stripe checkout returned successfully. Subscription status will update after the verified webhook is processed.", "success");
  if (params.get("checkout") === "cancelled") setFeedback("Checkout was cancelled. Your saved selection is unchanged.");
}

init();
