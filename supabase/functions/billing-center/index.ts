import Stripe from "npm:stripe@22.6.0";
import { handleOptions } from "../_shared/cors.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { ensureWorkspaceBootstrap } from "../_shared/workspace.ts";
import { enumField, inputErrorResponse, readJsonObject, textField } from "../_shared/validation.ts";

const ACTIONS = ["save_draft", "create_checkout", "create_portal"] as const;
const CADENCES = ["monthly", "annual"] as const;

function appUrl(): string {
  const legacyKey = ["AD", "PROFIT_APP_URL"].join("");
  const raw = (Deno.env.get("ADSFORECAST_APP_URL") || Deno.env.get(legacyKey) || "https://adsforecast.com").trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("invalid");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new Error("APP_URL_INVALID");
  }
}

function stripeClient(): Stripe | null {
  const secret = (Deno.env.get("STRIPE_SECRET_KEY") || "").trim();
  if (!secret) return null;
  return new Stripe(secret, { httpClient: Stripe.createFetchHttpClient() });
}

function presentPlan(plan: Record<string, unknown>) {
  return {
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    monthlyPriceCents: plan.monthly_price_cents,
    annualPriceCents: plan.annual_price_cents,
    currency: plan.currency,
    limits: plan.limits || {},
    features: Array.isArray(plan.features) ? plan.features : [],
    recommended: Boolean(plan.recommended),
    status: plan.status,
    checkoutConfigured: Boolean(plan.stripe_product_id && plan.stripe_monthly_price_id && plan.stripe_annual_price_id),
  };
}

function presentSubscription(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    planId: row.plan_id,
    draftPlanId: row.draft_plan_id,
    status: row.status,
    cadence: row.cadence,
    draftCadence: row.draft_cadence,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    checkoutSelectedAt: row.checkout_selected_at,
    customerReady: Boolean(row.stripe_customer_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (!["GET", "POST"].includes(req.method)) return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");

  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await ensureWorkspaceBootstrap(auth.admin, auth.user);
    const [plansResult, subscriptionResult] = await Promise.all([
      auth.admin.from("plan_catalog").select("*").neq("status", "archived").order("sort_order", { ascending: true }),
      auth.admin.from("workspace_subscriptions").select("*").eq("workspace_id", bundle.workspace.id).maybeSingle(),
    ]);
    if (plansResult.error || subscriptionResult.error) return jsonError(500, "BILLING_LOAD_FAILED", "Could not load billing information.");

    const plans = (plansResult.data || []).map((plan) => presentPlan(plan));
    const subscription = subscriptionResult.data || null;
    const secretReady = Boolean((Deno.env.get("STRIPE_SECRET_KEY") || "").trim());
    const webhookReady = Boolean((Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim());
    const billing = {
      provider: "stripe",
      checkoutReady: secretReady && plans.some((plan) => plan.checkoutConfigured),
      webhookReady,
      portalReady: secretReady && Boolean(subscription?.stripe_customer_id),
      mode: (Deno.env.get("STRIPE_MODE") || "test").trim() === "live" ? "live" : "test",
    };

    if (req.method === "GET") {
      return jsonOk({ success: true, plans, subscription: presentSubscription(subscription), billing });
    }

    if (!["owner", "admin"].includes(bundle.membership.role)) {
      return jsonError(403, "BILLING_FORBIDDEN", "Workspace owner or admin access is required for billing changes.");
    }

    const body = await readJsonObject(req);
    const action = enumField(body.action, ACTIONS, "Action");

    if (action === "create_portal") {
      const stripe = stripeClient();
      if (!stripe || !subscription?.stripe_customer_id) {
        return jsonError(409, "BILLING_PORTAL_NOT_READY", "Stripe customer portal is not ready for this workspace.");
      }
      const session = await stripe.billingPortal.sessions.create({
        customer: String(subscription.stripe_customer_id),
        return_url: `${appUrl()}/billing.html`,
      });
      return jsonOk({ success: true, redirectUrl: session.url });
    }

    const planId = textField(body.planId, "Plan", { min: 2, max: 40, required: true });
    const cadence = enumField(body.cadence, CADENCES, "Billing cadence");
    const plan = plansResult.data?.find((item) => item.id === planId && item.status === "active");
    if (!plan) return jsonError(404, "PLAN_NOT_FOUND", "The selected plan is not available.");

    const now = new Date().toISOString();
    const draft = await auth.admin.from("workspace_subscriptions").upsert({
      workspace_id: bundle.workspace.id,
      draft_plan_id: plan.id,
      draft_cadence: cadence,
      checkout_selected_at: now,
      status: subscription?.status && !["inactive", "draft", "incomplete"].includes(subscription.status)
        ? subscription.status
        : "draft",
      updated_at: now,
    }, { onConflict: "workspace_id" }).select("*").single();
    if (draft.error || !draft.data) return jsonError(500, "BILLING_DRAFT_FAILED", "Could not save the checkout selection.");

    if (action === "save_draft") {
      return jsonOk({ success: true, subscription: presentSubscription(draft.data), billing });
    }

    const stripe = stripeClient();
    const priceId = cadence === "annual" ? plan.stripe_annual_price_id : plan.stripe_monthly_price_id;
    if (!stripe || typeof priceId !== "string" || !priceId.startsWith("price_")) {
      return jsonError(409, "STRIPE_NOT_CONFIGURED", "Checkout is prepared but Stripe keys and plan price IDs are not configured yet.");
    }

    const base = appUrl();
    const metadata = { workspace_id: bundle.workspace.id, plan_id: plan.id, cadence };
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/billing.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing.html?checkout=cancelled`,
      client_reference_id: bundle.workspace.id,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      metadata,
      subscription_data: { metadata },
    };
    if (draft.data.stripe_customer_id) params.customer = String(draft.data.stripe_customer_id);
    else params.customer_email = bundle.user.email;

    const windowBucket = Math.floor(Date.now() / 600_000);
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: `checkout:${bundle.workspace.id}:${plan.id}:${cadence}:${windowBucket}`,
    });
    if (!session.url) return jsonError(502, "CHECKOUT_CREATE_FAILED", "Stripe did not return a checkout URL.");
    return jsonOk({ success: true, redirectUrl: session.url });
  } catch (error) {
    const input = inputErrorResponse(error, jsonError);
    if (input) return input;
    if (error instanceof Error && error.message === "APP_URL_INVALID") {
      return jsonError(500, "APP_URL_INVALID", "Billing return URL is not configured safely.");
    }
    return jsonError(500, "INTERNAL_ERROR", "Could not complete the billing request.");
  }
});
