import { handleOptions } from "../_shared/cors.ts";
import { adminCan, requirePlatformAdmin, writeAdminAudit } from "../_shared/admin.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import {
  booleanField,
  enumField,
  inputErrorResponse,
  integerField,
  readJsonObject,
  textField,
} from "../_shared/validation.ts";

const VIEWS = ["overview", "customers", "workspaces", "subscriptions", "plans", "tickets", "integrations", "audit", "system", "admins"] as const;
const ACTIONS = ["update_ticket", "reply_ticket", "update_plan", "set_admin_role", "update_launch_state"] as const;
const TICKET_STATUSES = ["open", "waiting_customer", "in_progress", "resolved", "closed"] as const;
const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const PLAN_STATUSES = ["draft", "active", "archived"] as const;
const ADMIN_ROLES = ["super_admin", "billing_admin", "support_admin", "operator", "viewer"] as const;
const ADMIN_STATUSES = ["active", "suspended"] as const;
const LAUNCH_STATES = ["private_beta", "invite_only", "public"] as const;

type AdminContext = Awaited<ReturnType<typeof requirePlatformAdmin>> & { ok: true };
type Row = Record<string, any>;

function pageParams(url: URL) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
  const pageSize = Math.max(10, Math.min(100, Number.parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

function rowsBy<T extends Row>(rows: T[] | null, key: string): Map<string, T> {
  return new Map((rows || []).map((row) => [String(row[key]), row]));
}

function safeArray(value: unknown, label: string, maxItems = 30): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label.toUpperCase()}_INVALID`);
  return value.map((item) => textField(item, label, { min: 2, max: 180, required: true }));
}

async function overview(ctx: AdminContext) {
  const db = ctx.client;
  const [users, workspaces, integrations, openTickets, activeSubscriptions, failedAi, settings, latestEvents] = await Promise.all([
    db.from("app_users").select("id", { count: "exact", head: true }),
    db.from("workspaces").select("id", { count: "exact", head: true }),
    db.from("meta_connections").select("id", { count: "exact", head: true }).eq("status", "connected"),
    db.from("support_tickets").select("id", { count: "exact", head: true }).in("status", ["open", "waiting_customer", "in_progress"]),
    db.from("workspace_subscriptions").select("workspace_id", { count: "exact", head: true }).in("status", ["active", "trialing"]),
    db.from("ai_analysis_runs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
    db.from("platform_settings").select("key,value,description,updated_at").order("key", { ascending: true }),
    db.from("billing_events").select("provider_event_id,event_type,processing_status,safe_summary,error_code,received_at,processed_at").order("received_at", { ascending: false }).limit(8),
  ]);
  const failed = [users, workspaces, integrations, openTickets, activeSubscriptions, failedAi, settings, latestEvents].find((result) => result.error);
  if (failed?.error) throw new Error("OVERVIEW_LOAD_FAILED");
  return {
    counts: {
      customers: users.count || 0,
      workspaces: workspaces.count || 0,
      connectedMetaAccounts: integrations.count || 0,
      openTickets: openTickets.count || 0,
      activeSubscriptions: activeSubscriptions.count || 0,
      failedAiRuns24h: failedAi.count || 0,
    },
    readiness: {
      stripeSecret: Boolean((Deno.env.get("STRIPE_SECRET_KEY") || "").trim()),
      stripeWebhook: Boolean((Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim()),
      metaApp: Boolean((Deno.env.get("META_APP_ID") || "").trim() && (Deno.env.get("META_APP_SECRET") || "").trim()),
      aiProvider: Boolean((Deno.env.get("GEMINI_API_KEY") || "").trim() || (Deno.env.get("OPENAI_API_KEY") || "").trim()),
      tokenEncryption: Boolean((Deno.env.get("TOKEN_ENCRYPTION_SECRET") || "").trim()),
      mode: (Deno.env.get("STRIPE_MODE") || "test").trim() === "live" ? "live" : "test",
    },
    settings: settings.data || [],
    billingEvents: latestEvents.data || [],
  };
}

async function customers(ctx: AdminContext, url: URL) {
  const { page, pageSize, from, to } = pageParams(url);
  let query = ctx.client.from("app_users").select("id,email,name,created_at,updated_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  const search = (url.searchParams.get("search") || "").trim().slice(0, 120);
  if (search) query = query.or(`email.ilike.%${search.replace(/[,%()]/g, "")}%,name.ilike.%${search.replace(/[,%()]/g, "")}%`);
  const users = await query;
  if (users.error) throw new Error("CUSTOMERS_LOAD_FAILED");
  const ids = (users.data || []).map((user) => user.id);
  if (!ids.length) return { items: [], page, pageSize, total: users.count || 0 };
  const [profiles, memberships, admins] = await Promise.all([
    ctx.client.from("user_profiles").select("user_id,display_name,company_name,role_title,locale").in("user_id", ids),
    ctx.client.from("workspace_members").select("user_id,workspace_id,role").in("user_id", ids),
    ctx.client.from("platform_admins").select("user_id,role,status").in("user_id", ids),
  ]);
  if (profiles.error || memberships.error || admins.error) throw new Error("CUSTOMERS_LOAD_FAILED");
  const workspaceIds = [...new Set((memberships.data || []).map((row) => row.workspace_id))];
  const [workspaces, subscriptions] = await Promise.all([
    workspaceIds.length ? ctx.client.from("workspaces").select("id,name").in("id", workspaceIds) : Promise.resolve({ data: [], error: null }),
    workspaceIds.length ? ctx.client.from("workspace_subscriptions").select("workspace_id,plan_id,status,cadence,current_period_end").in("workspace_id", workspaceIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (workspaces.error || subscriptions.error) throw new Error("CUSTOMERS_LOAD_FAILED");
  const profileMap = rowsBy(profiles.data, "user_id");
  const membershipMap = rowsBy(memberships.data, "user_id");
  const workspaceMap = rowsBy(workspaces.data, "id");
  const subscriptionMap = rowsBy(subscriptions.data, "workspace_id");
  const adminMap = rowsBy(admins.data, "user_id");
  return {
    items: (users.data || []).map((user) => {
      const membership = membershipMap.get(user.id);
      return {
        ...user,
        profile: profileMap.get(user.id) || null,
        membership: membership || null,
        workspace: membership ? workspaceMap.get(membership.workspace_id) || null : null,
        subscription: membership ? subscriptionMap.get(membership.workspace_id) || null : null,
        platformAdmin: adminMap.get(user.id) || null,
      };
    }),
    page,
    pageSize,
    total: users.count || 0,
  };
}

async function workspaces(ctx: AdminContext, url: URL) {
  const { page, pageSize, from, to } = pageParams(url);
  const list = await ctx.client.from("workspaces").select("id,name,created_at,updated_at", { count: "exact" })
    .order("created_at", { ascending: false }).range(from, to);
  if (list.error) throw new Error("WORKSPACES_LOAD_FAILED");
  const ids = (list.data || []).map((row) => row.id);
  if (!ids.length) return { items: [], page, pageSize, total: list.count || 0 };
  const [members, subscriptions, connections, settings, tickets] = await Promise.all([
    ctx.client.from("workspace_members").select("workspace_id,user_id,role").in("workspace_id", ids),
    ctx.client.from("workspace_subscriptions").select("workspace_id,plan_id,status,cadence,current_period_end").in("workspace_id", ids),
    ctx.client.from("meta_connections").select("workspace_id,account_id,account_name,currency,status,connected_at,updated_at").in("workspace_id", ids),
    ctx.client.from("workspace_settings").select("workspace_id,timezone,currency,default_period,data_retention_days").in("workspace_id", ids),
    ctx.client.from("support_tickets").select("workspace_id,id,status").in("workspace_id", ids).in("status", ["open", "waiting_customer", "in_progress"]),
  ]);
  if (members.error || subscriptions.error || connections.error || settings.error || tickets.error) throw new Error("WORKSPACES_LOAD_FAILED");
  const subscriptionsMap = rowsBy(subscriptions.data, "workspace_id");
  const connectionMap = rowsBy(connections.data, "workspace_id");
  const settingsMap = rowsBy(settings.data, "workspace_id");
  return {
    items: (list.data || []).map((workspace) => ({
      ...workspace,
      memberCount: (members.data || []).filter((member) => member.workspace_id === workspace.id).length,
      subscription: subscriptionsMap.get(workspace.id) || null,
      metaConnection: connectionMap.get(workspace.id) || null,
      settings: settingsMap.get(workspace.id) || null,
      openTicketCount: (tickets.data || []).filter((ticket) => ticket.workspace_id === workspace.id).length,
    })),
    page,
    pageSize,
    total: list.count || 0,
  };
}

async function subscriptions(ctx: AdminContext, url: URL) {
  const { page, pageSize, from, to } = pageParams(url);
  const list = await ctx.client.from("workspace_subscriptions").select("*", { count: "exact" }).order("updated_at", { ascending: false }).range(from, to);
  if (list.error) throw new Error("SUBSCRIPTIONS_LOAD_FAILED");
  const workspaceIds = (list.data || []).map((row) => row.workspace_id);
  const planIds = [...new Set((list.data || []).flatMap((row) => [row.plan_id, row.draft_plan_id]).filter(Boolean))];
  const [workspaceRows, planRows] = await Promise.all([
    workspaceIds.length ? ctx.client.from("workspaces").select("id,name").in("id", workspaceIds) : Promise.resolve({ data: [], error: null }),
    planIds.length ? ctx.client.from("plan_catalog").select("id,name,currency,monthly_price_cents,annual_price_cents").in("id", planIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (workspaceRows.error || planRows.error) throw new Error("SUBSCRIPTIONS_LOAD_FAILED");
  const wsMap = rowsBy(workspaceRows.data, "id");
  const planMap = rowsBy(planRows.data, "id");
  return {
    items: (list.data || []).map((row) => ({
      ...row,
      stripe_customer_id: row.stripe_customer_id ? "configured" : null,
      stripe_subscription_id: row.stripe_subscription_id ? "configured" : null,
      workspace: wsMap.get(row.workspace_id) || null,
      plan: row.plan_id ? planMap.get(row.plan_id) || null : null,
      draftPlan: row.draft_plan_id ? planMap.get(row.draft_plan_id) || null : null,
    })),
    page,
    pageSize,
    total: list.count || 0,
  };
}

async function tickets(ctx: AdminContext, url: URL) {
  const { page, pageSize, from, to } = pageParams(url);
  let query = ctx.client.from("support_tickets").select("*", { count: "exact" }).order("last_activity_at", { ascending: false }).range(from, to);
  const status = (url.searchParams.get("status") || "").trim();
  if (status && TICKET_STATUSES.includes(status as typeof TICKET_STATUSES[number])) query = query.eq("status", status);
  const list = await query;
  if (list.error) throw new Error("TICKETS_LOAD_FAILED");
  const workspaceIds = [...new Set((list.data || []).map((row) => row.workspace_id))];
  const userIds = [...new Set((list.data || []).flatMap((row) => [row.created_by, row.assigned_admin_id]).filter(Boolean))];
  const [workspaceRows, userRows] = await Promise.all([
    workspaceIds.length ? ctx.client.from("workspaces").select("id,name").in("id", workspaceIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? ctx.client.from("app_users").select("id,email,name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (workspaceRows.error || userRows.error) throw new Error("TICKETS_LOAD_FAILED");
  const wsMap = rowsBy(workspaceRows.data, "id");
  const userMap = rowsBy(userRows.data, "id");
  let selected = null;
  let messages: Row[] = [];
  const ticketId = (url.searchParams.get("ticketId") || "").trim();
  if (ticketId) {
    const ticket = await ctx.client.from("support_tickets").select("*").eq("id", ticketId).maybeSingle();
    if (ticket.error) throw new Error("TICKET_LOAD_FAILED");
    if (!ticket.data) throw new Error("TICKET_NOT_FOUND");
    selected = ticket.data;
    const thread = await ctx.client.from("support_ticket_messages").select("id,author_user_id,author_kind,body,is_internal,created_at").eq("ticket_id", ticketId).order("created_at", { ascending: true }).limit(300);
    if (thread.error) throw new Error("TICKET_THREAD_FAILED");
    messages = thread.data || [];
  }
  return {
    items: (list.data || []).map((row) => ({ ...row, workspace: wsMap.get(row.workspace_id) || null, customer: userMap.get(row.created_by) || null, assignee: row.assigned_admin_id ? userMap.get(row.assigned_admin_id) || null : null })),
    selected,
    messages,
    page,
    pageSize,
    total: list.count || 0,
  };
}

async function integrations(ctx: AdminContext, url: URL) {
  const { page, pageSize, from, to } = pageParams(url);
  const list = await ctx.client.from("meta_connections").select("id,workspace_id,account_id,account_name,currency,timezone_name,status,token_expires_at,connected_at,updated_at", { count: "exact" })
    .order("updated_at", { ascending: false }).range(from, to);
  if (list.error) throw new Error("INTEGRATIONS_LOAD_FAILED");
  const workspaceIds = [...new Set((list.data || []).map((row) => row.workspace_id))];
  const [workspaceRows, syncRows] = await Promise.all([
    workspaceIds.length ? ctx.client.from("workspaces").select("id,name").in("id", workspaceIds) : Promise.resolve({ data: [], error: null }),
    workspaceIds.length ? ctx.client.from("meta_sync_logs").select("workspace_id,status,message,created_at").in("workspace_id", workspaceIds).order("created_at", { ascending: false }).limit(Math.min(500, workspaceIds.length * 10)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (workspaceRows.error || syncRows.error) throw new Error("INTEGRATIONS_LOAD_FAILED");
  const wsMap = rowsBy(workspaceRows.data, "id");
  return {
    items: (list.data || []).map((row) => ({
      ...row,
      workspace: wsMap.get(row.workspace_id) || null,
      latestSync: (syncRows.data || []).find((sync) => sync.workspace_id === row.workspace_id) || null,
    })),
    page,
    pageSize,
    total: list.count || 0,
  };
}

async function loadView(ctx: AdminContext, view: typeof VIEWS[number], url: URL) {
  if (view === "overview") return overview(ctx);
  if (view === "customers") return customers(ctx, url);
  if (view === "workspaces") return workspaces(ctx, url);
  if (view === "subscriptions") return subscriptions(ctx, url);
  if (view === "tickets") return tickets(ctx, url);
  if (view === "integrations") return integrations(ctx, url);
  if (view === "plans") {
    const result = await ctx.client.from("plan_catalog").select("*").order("sort_order", { ascending: true });
    if (result.error) throw new Error("PLANS_LOAD_FAILED");
    return { items: result.data || [] };
  }
  if (view === "audit") {
    const { page, pageSize, from, to } = pageParams(url);
    const result = await ctx.client.from("admin_audit_logs").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
    if (result.error) throw new Error("AUDIT_LOAD_FAILED");
    return { items: result.data || [], page, pageSize, total: result.count || 0 };
  }
  if (view === "admins") {
    const result = await ctx.client.from("platform_admins").select("*").order("created_at", { ascending: true });
    if (result.error) throw new Error("ADMINS_LOAD_FAILED");
    const userIds = (result.data || []).map((row) => row.user_id);
    const users = userIds.length ? await ctx.client.from("app_users").select("id,email,name").in("id", userIds) : { data: [], error: null };
    if (users.error) throw new Error("ADMINS_LOAD_FAILED");
    const userMap = rowsBy(users.data, "id");
    return { items: (result.data || []).map((row) => ({ ...row, user: userMap.get(row.user_id) || null })) };
  }
  const [settings, failedEvents, failedRuns] = await Promise.all([
    ctx.client.from("platform_settings").select("key,value,description,updated_at").order("key", { ascending: true }),
    ctx.client.from("billing_events").select("provider_event_id,event_type,processing_status,error_code,received_at").eq("processing_status", "failed").order("received_at", { ascending: false }).limit(50),
    ctx.client.from("ai_analysis_runs").select("id,workspace_id,provider,model,error_code,created_at,completed_at").eq("status", "failed").order("created_at", { ascending: false }).limit(50),
  ]);
  if (settings.error || failedEvents.error || failedRuns.error) throw new Error("SYSTEM_LOAD_FAILED");
  return { settings: settings.data || [], failedBillingEvents: failedEvents.data || [], failedAiRuns: failedRuns.data || [] };
}

async function mutate(ctx: AdminContext, body: Record<string, unknown>) {
  const action = enumField(body.action, ACTIONS, "Action");
  const now = new Date().toISOString();

  if (action === "update_ticket" || action === "reply_ticket") {
    if (!adminCan(ctx.adminRecord.role, "tickets")) return jsonError(403, "ADMIN_FORBIDDEN", "Your admin role cannot manage support tickets.");
    const ticketId = textField(body.ticketId, "Ticket", { min: 8, max: 80, required: true });
    const ticket = await ctx.client.from("support_tickets").select("id,status").eq("id", ticketId).maybeSingle();
    if (ticket.error) return jsonError(500, "TICKET_LOAD_FAILED", "Could not load the support ticket.");
    if (!ticket.data) return jsonError(404, "TICKET_NOT_FOUND", "Support ticket was not found.");

    if (action === "reply_ticket") {
      const internal = booleanField(body.internal, false);
      const message = textField(body.message, "Message", { min: 2, max: 5000, required: true });
      const inserted = await ctx.client.from("support_ticket_messages").insert({
        ticket_id: ticketId,
        author_user_id: ctx.appUser.id,
        author_kind: "admin",
        body: message,
        is_internal: internal,
      });
      if (inserted.error) return jsonError(500, "TICKET_REPLY_FAILED", "Could not save the support reply.");
      const nextStatus = internal ? ticket.data.status : "waiting_customer";
      const updated = await ctx.client.from("support_tickets").update({ status: nextStatus, assigned_admin_id: ctx.appUser.id, last_activity_at: now, updated_at: now }).eq("id", ticketId);
      if (updated.error) return jsonError(500, "TICKET_REPLY_FAILED", "Reply was saved but ticket state could not be updated.");
      await writeAdminAudit(ctx, internal ? "ticket.internal_note" : "ticket.reply", "support_ticket", ticketId, { status: nextStatus });
      return jsonOk({ success: true });
    }

    const status = enumField(body.status, TICKET_STATUSES, "Ticket status");
    const priority = enumField(body.priority, TICKET_PRIORITIES, "Ticket priority");
    const assignedToMe = booleanField(body.assignedToMe, false);
    const updated = await ctx.client.from("support_tickets").update({
      status,
      priority,
      assigned_admin_id: assignedToMe ? ctx.appUser.id : null,
      resolved_at: ["resolved", "closed"].includes(status) ? now : null,
      updated_at: now,
      last_activity_at: now,
    }).eq("id", ticketId);
    if (updated.error) return jsonError(500, "TICKET_UPDATE_FAILED", "Could not update the support ticket.");
    await writeAdminAudit(ctx, "ticket.update", "support_ticket", ticketId, { status, priority, assignedToMe });
    return jsonOk({ success: true });
  }

  if (action === "update_plan") {
    if (!adminCan(ctx.adminRecord.role, "plans")) return jsonError(403, "ADMIN_FORBIDDEN", "Your admin role cannot manage plans.");
    const planId = textField(body.planId, "Plan", { min: 2, max: 40, required: true });
    const monthly = integerField(body.monthlyPriceCents, "Monthly price", { min: 0, max: 10_000_000 });
    const annual = integerField(body.annualPriceCents, "Annual price", { min: 0, max: 100_000_000 });
    const limits = body.limits && typeof body.limits === "object" && !Array.isArray(body.limits) ? body.limits : {};
    const row = {
      name: textField(body.name, "Plan name", { min: 2, max: 80, required: true }),
      tagline: textField(body.tagline, "Plan tagline", { min: 10, max: 180, required: true }),
      monthly_price_cents: monthly,
      annual_price_cents: annual,
      features: safeArray(body.features, "Feature", 30),
      limits,
      stripe_product_id: textField(body.stripeProductId, "Stripe product ID", { max: 120 }) || null,
      stripe_monthly_price_id: textField(body.stripeMonthlyPriceId, "Stripe monthly price ID", { max: 120 }) || null,
      stripe_annual_price_id: textField(body.stripeAnnualPriceId, "Stripe annual price ID", { max: 120 }) || null,
      status: enumField(body.status, PLAN_STATUSES, "Plan status"),
      recommended: booleanField(body.recommended),
      sort_order: integerField(body.sortOrder, "Sort order", { min: 0, max: 1000 }),
      updated_at: now,
    };
    if (row.stripe_product_id && !row.stripe_product_id.startsWith("prod_")) return jsonError(422, "VALIDATION_ERROR", "Stripe product ID must start with prod_.");
    if (row.stripe_monthly_price_id && !row.stripe_monthly_price_id.startsWith("price_")) return jsonError(422, "VALIDATION_ERROR", "Monthly Stripe price ID must start with price_.");
    if (row.stripe_annual_price_id && !row.stripe_annual_price_id.startsWith("price_")) return jsonError(422, "VALIDATION_ERROR", "Annual Stripe price ID must start with price_.");
    if (row.recommended) await ctx.client.from("plan_catalog").update({ recommended: false, updated_at: now }).neq("id", planId);
    const saved = await ctx.client.from("plan_catalog").update(row).eq("id", planId).select("id").maybeSingle();
    if (saved.error) return jsonError(500, "PLAN_UPDATE_FAILED", "Could not update the billing plan.");
    if (!saved.data) return jsonError(404, "PLAN_NOT_FOUND", "Billing plan was not found.");
    await writeAdminAudit(ctx, "plan.update", "plan", planId, { status: row.status, recommended: row.recommended, stripeConfigured: Boolean(row.stripe_product_id && row.stripe_monthly_price_id && row.stripe_annual_price_id) });
    return jsonOk({ success: true });
  }

  if (action === "set_admin_role") {
    if (ctx.adminRecord.role !== "super_admin") return jsonError(403, "ADMIN_FORBIDDEN", "Only a super administrator can manage platform roles.");
    const userId = textField(body.userId, "User", { min: 8, max: 80, required: true });
    const role = enumField(body.role, ADMIN_ROLES, "Admin role");
    const status = enumField(body.status, ADMIN_STATUSES, "Admin status");
    if (userId === ctx.appUser.id && status === "suspended") return jsonError(409, "SELF_SUSPEND_BLOCKED", "You cannot suspend your own administrator access.");
    const user = await ctx.client.from("app_users").select("id").eq("id", userId).maybeSingle();
    if (user.error) return jsonError(500, "USER_LOOKUP_FAILED", "Could not verify the user.");
    if (!user.data) return jsonError(404, "USER_NOT_FOUND", "User was not found.");
    const saved = await ctx.client.from("platform_admins").upsert({ user_id: userId, role, status, created_by: ctx.appUser.id, updated_at: now }, { onConflict: "user_id" });
    if (saved.error) return jsonError(500, "ADMIN_UPDATE_FAILED", "Could not update administrator access.");
    await writeAdminAudit(ctx, "admin.role_update", "platform_admin", userId, { role, status });
    return jsonOk({ success: true });
  }

  if (!adminCan(ctx.adminRecord.role, "operations")) return jsonError(403, "ADMIN_FORBIDDEN", "Your admin role cannot change launch state.");
  const state = enumField(body.state, LAUNCH_STATES, "Launch state");
  const saved = await ctx.client.from("platform_settings").upsert({
    key: "launch.state",
    value: { customerAccess: state },
    description: "Customer access stage used by the admin readiness view.",
    updated_by: ctx.appUser.id,
    updated_at: now,
  }, { onConflict: "key" });
  if (saved.error) return jsonError(500, "LAUNCH_STATE_FAILED", "Could not update customer access state.");
  await writeAdminAudit(ctx, "launch.state_update", "platform_setting", "launch.state", { state });
  return jsonOk({ success: true });
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (!["GET", "POST"].includes(req.method)) return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");

  const auth = await requirePlatformAdmin(req);
  if (!auth.ok) return auth.response;
  const ctx = auth as AdminContext;

  try {
    if (req.method === "POST") return await mutate(ctx, await readJsonObject(req, 48_000));
    const url = new URL(req.url);
    const view = enumField(url.searchParams.get("view") || "overview", VIEWS, "Admin view");
    return jsonOk({ success: true, admin: { role: ctx.adminRecord.role, name: ctx.appUser.name, email: ctx.appUser.email }, data: await loadView(ctx, view, url) });
  } catch (error) {
    const input = inputErrorResponse(error, jsonError);
    if (input) return input;
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (code === "TICKET_NOT_FOUND") return jsonError(404, code, "Support ticket was not found.");
    if (code.endsWith("_INVALID")) return jsonError(422, "VALIDATION_ERROR", "One or more plan fields are invalid.");
    return jsonError(500, "INTERNAL_ERROR", "Could not complete the administrator request.");
  }
});
