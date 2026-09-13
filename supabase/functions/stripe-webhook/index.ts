import Stripe from "npm:stripe@22.6.0";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { getSupabaseAdmin } from "../_shared/supabase.ts";

type StripeObject = Record<string, any>;

function cleanId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 2 && value.length <= 255) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return String((value as { id: string }).id).slice(0, 255);
  }
  return null;
}

function safeStatus(value: unknown): string {
  const status = typeof value === "string" ? value : "inactive";
  if (["incomplete", "trialing", "active", "past_due", "canceled", "unpaid", "paused"].includes(status)) return status;
  return "inactive";
}

function isoFromUnix(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function eventObject(event: Stripe.Event): StripeObject {
  return event.data.object as unknown as StripeObject;
}

function extractMetadata(object: StripeObject): Record<string, string> {
  const direct = object?.metadata;
  const subscriptionDetails = object?.parent?.subscription_details?.metadata;
  const source = direct && typeof direct === "object" && Object.keys(direct).length ? direct : subscriptionDetails;
  if (!source || typeof source !== "object") return {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key.slice(0, 80), String(value).slice(0, 255)]),
  );
}

function subscriptionIdFrom(object: StripeObject): string | null {
  return cleanId(
    object.subscription || object?.parent?.subscription_details?.subscription ||
      (object.object === "subscription" ? object.id : null),
  );
}

function priceAndProduct(subscription: StripeObject): { priceId: string | null; productId: string | null } {
  const item = subscription?.items?.data?.[0];
  return { priceId: cleanId(item?.price), productId: cleanId(item?.price?.product) };
}

function cadenceFrom(subscription: StripeObject): "monthly" | "annual" | null {
  const interval = subscription?.items?.data?.[0]?.price?.recurring?.interval;
  if (interval === "year") return "annual";
  if (interval === "month") return "monthly";
  return null;
}

async function updateEvent(
  admin: ReturnType<typeof getSupabaseAdmin>,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  workspaceId: string | null,
  summary: Record<string, unknown>,
  errorCode: string | null = null,
) {
  await admin.from("billing_events").update({
    workspace_id: workspaceId,
    processing_status: status,
    safe_summary: summary,
    error_code: errorCode,
    processed_at: new Date().toISOString(),
  }).eq("provider_event_id", eventId);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");

  const stripeSecret = (Deno.env.get("STRIPE_SECRET_KEY") || "").trim();
  const webhookSecret = (Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();
  if (!stripeSecret || !webhookSecret) {
    return jsonError(503, "STRIPE_NOT_CONFIGURED", "Stripe webhook processing is not configured.");
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return jsonError(400, "SIGNATURE_REQUIRED", "Stripe signature is required.");

  const stripe = new Stripe(stripeSecret, { httpClient: Stripe.createFetchHttpClient() });
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch {
    return jsonError(400, "SIGNATURE_INVALID", "Stripe signature could not be verified.");
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return jsonError(500, "CONFIG_MISSING", "Server configuration is incomplete.");
  }

  const tracked = await admin.from("billing_events").insert({
    provider_event_id: event.id,
    event_type: event.type,
    processing_status: "received",
    safe_summary: { livemode: event.livemode, created: event.created },
  });
  if (tracked.error?.code === "23505") return jsonOk({ success: true, duplicate: true });
  if (tracked.error) return jsonError(500, "EVENT_TRACK_FAILED", "Billing event could not be recorded.");

  const supported = new Set([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ]);
  if (!supported.has(event.type)) {
    await updateEvent(admin, event.id, "ignored", null, { reason: "unhandled_event_type", type: event.type });
    return jsonOk({ success: true, ignored: true });
  }

  try {
    const object = eventObject(event);
    const metadata = extractMetadata(object);
    let subscriptionId = subscriptionIdFrom(object);
    const customerId = cleanId(object.customer);
    let workspaceId = typeof metadata.workspace_id === "string" ? metadata.workspace_id : null;
    let existing: StripeObject | null = null;

    if (workspaceId) {
      const row = await admin.from("workspace_subscriptions").select("*").eq("workspace_id", workspaceId).maybeSingle();
      if (row.error) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
      existing = row.data;
    }
    if (!workspaceId && subscriptionId) {
      const row = await admin.from("workspace_subscriptions").select("*").eq("stripe_subscription_id", subscriptionId).maybeSingle();
      if (row.error) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
      existing = row.data;
      workspaceId = row.data?.workspace_id || null;
    }
    if (!workspaceId && customerId) {
      const row = await admin.from("workspace_subscriptions").select("*").eq("stripe_customer_id", customerId).maybeSingle();
      if (row.error) throw new Error("SUBSCRIPTION_LOOKUP_FAILED");
      existing = row.data;
      workspaceId = row.data?.workspace_id || null;
    }

    if (!workspaceId) {
      await updateEvent(admin, event.id, "ignored", null, {
        reason: "workspace_not_resolved",
        type: event.type,
        customerPresent: Boolean(customerId),
        subscriptionPresent: Boolean(subscriptionId),
      });
      return jsonOk({ success: true, ignored: true });
    }

    const workspace = await admin.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
    if (workspace.error) throw new Error("WORKSPACE_LOOKUP_FAILED");
    if (!workspace.data) {
      await updateEvent(admin, event.id, "ignored", null, { reason: "workspace_not_found", type: event.type });
      return jsonOk({ success: true, ignored: true });
    }

    const eventAt = new Date(event.created * 1000).toISOString();
    if (existing?.last_event_at && new Date(existing.last_event_at).getTime() > new Date(eventAt).getTime()) {
      await updateEvent(admin, event.id, "ignored", workspaceId, { reason: "out_of_order_event", type: event.type });
      return jsonOk({ success: true, ignored: true });
    }

    let stripeSubscription: StripeObject | null = object.object === "subscription" ? object : null;
    if (event.type === "checkout.session.completed") subscriptionId = cleanId(object.subscription);
    if (!stripeSubscription && subscriptionId) {
      stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId) as unknown as StripeObject;
    }

    const ids = stripeSubscription ? priceAndProduct(stripeSubscription) : { priceId: null, productId: null };
    const planHint = metadata.plan_id || stripeSubscription?.metadata?.plan_id || null;
    let plan: StripeObject | null = null;
    if (typeof planHint === "string") {
      const result = await admin.from("plan_catalog").select("id").eq("id", planHint).maybeSingle();
      if (result.error) throw new Error("PLAN_LOOKUP_FAILED");
      plan = result.data;
    }
    if (!plan && ids.priceId) {
      const result = await admin.from("plan_catalog").select("id")
        .or(`stripe_monthly_price_id.eq.${ids.priceId},stripe_annual_price_id.eq.${ids.priceId}`).maybeSingle();
      if (result.error) throw new Error("PLAN_LOOKUP_FAILED");
      plan = result.data;
    }
    if (!plan && ids.productId) {
      const result = await admin.from("plan_catalog").select("id").eq("stripe_product_id", ids.productId).maybeSingle();
      if (result.error) throw new Error("PLAN_LOOKUP_FAILED");
      plan = result.data;
    }

    const status = stripeSubscription ? safeStatus(stripeSubscription.status)
      : event.type === "invoice.payment_failed" ? "past_due" : event.type === "invoice.paid" ? "active" : "inactive";
    const cadence = stripeSubscription ? cadenceFrom(stripeSubscription) : null;
    const now = new Date().toISOString();
    const subscriptionUpdate: Record<string, unknown> = {
      workspace_id: workspaceId,
      provider: "stripe",
      status,
      stripe_customer_id: cleanId(stripeSubscription?.customer) || customerId || existing?.stripe_customer_id || null,
      stripe_subscription_id: cleanId(stripeSubscription?.id) || subscriptionId || existing?.stripe_subscription_id || null,
      stripe_product_id: ids.productId || existing?.stripe_product_id || null,
      last_event_at: eventAt,
      updated_at: now,
    };
    if (plan?.id) subscriptionUpdate.plan_id = plan.id;
    if (cadence) subscriptionUpdate.cadence = cadence;
    if (stripeSubscription) {
      subscriptionUpdate.current_period_start = isoFromUnix(stripeSubscription.current_period_start);
      subscriptionUpdate.current_period_end = isoFromUnix(stripeSubscription.current_period_end);
      subscriptionUpdate.cancel_at_period_end = Boolean(stripeSubscription.cancel_at_period_end);
    }

    const saved = await admin.from("workspace_subscriptions").upsert(subscriptionUpdate, { onConflict: "workspace_id" });
    if (saved.error) throw new Error("SUBSCRIPTION_UPDATE_FAILED");

    await updateEvent(admin, event.id, "processed", workspaceId, {
      type: event.type,
      status,
      planId: plan?.id || null,
      cadence,
      livemode: event.livemode,
    });
    return jsonOk({ success: true });
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 80) : "PROCESSING_FAILED";
    await updateEvent(admin, event.id, "failed", null, { type: event.type }, code);
    return jsonError(500, "WEBHOOK_PROCESSING_FAILED", "Verified billing event could not be processed.");
  }
});
