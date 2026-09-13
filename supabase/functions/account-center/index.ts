import { handleOptions } from "../_shared/cors.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { ensureWorkspaceBootstrap } from "../_shared/workspace.ts";
import type { AdminClient } from "../_shared/supabase.ts";
import {
  booleanField,
  enumField,
  inputErrorResponse,
  integerField,
  readJsonObject,
  textField,
} from "../_shared/validation.ts";

const TIMEZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "Europe/Warsaw",
  "Europe/Istanbul",
  "Europe/London",
] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "TRY", "PLN"] as const;
const PERIODS = ["today", "7d", "30d", "90d"] as const;
const LOCALES = ["en-US", "en-GB", "tr-TR", "pl-PL", "de-DE"] as const;

type Bundle = Awaited<ReturnType<typeof ensureWorkspaceBootstrap>>;

async function loadSnapshot(admin: AdminClient, bundle: Bundle) {
  const [profile, settings, subscription, members, platformAdmin] = await Promise.all([
    admin.from("user_profiles").select("*").eq("user_id", bundle.user.id).maybeSingle(),
    admin.from("workspace_settings").select("*").eq("workspace_id", bundle.workspace.id).maybeSingle(),
    admin.from("workspace_subscriptions").select("*").eq("workspace_id", bundle.workspace.id).maybeSingle(),
    admin.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", bundle.workspace.id),
    admin.from("platform_admins").select("role,status").eq("user_id", bundle.user.id).maybeSingle(),
  ]);
  if (profile.error || settings.error || subscription.error || members.error || platformAdmin.error) {
    throw new Error("ACCOUNT_LOAD_FAILED");
  }

  let verifiedPlan = null;
  let draftPlan = null;
  const planIds = [subscription.data?.plan_id, subscription.data?.draft_plan_id].filter(Boolean) as string[];
  if (planIds.length) {
    const plans = await admin
      .from("plan_catalog")
      .select("id,name,tagline,monthly_price_cents,annual_price_cents,currency,limits,features,status,recommended")
      .in("id", planIds);
    if (plans.error) throw new Error("ACCOUNT_LOAD_FAILED");
    verifiedPlan = plans.data?.find((plan) => plan.id === subscription.data?.plan_id) || null;
    draftPlan = plans.data?.find((plan) => plan.id === subscription.data?.draft_plan_id) || null;
  }

  return {
    user: {
      id: bundle.user.id,
      authUserId: bundle.user.auth_user_id,
      email: bundle.user.email,
      name: bundle.user.name,
      createdAt: bundle.user.created_at,
    },
    profile: profile.data || {
      user_id: bundle.user.id,
      display_name: bundle.user.name || "",
      company_name: "",
      role_title: "",
      phone: "",
      locale: "en-US",
    },
    workspace: {
      id: bundle.workspace.id,
      name: bundle.workspace.name,
      role: bundle.membership.role,
      memberCount: members.count || 1,
      createdAt: bundle.workspace.created_at,
    },
    settings: settings.data || null,
    subscription: subscription.data || null,
    verifiedPlan,
    draftPlan,
    platformAdmin: platformAdmin.data?.status === "active" ? { role: platformAdmin.data.role } : null,
  };
}

async function ensureAccountRows(admin: AdminClient, bundle: Bundle) {
  const [profile, settings] = await Promise.all([
    admin.from("user_profiles").upsert({
      user_id: bundle.user.id,
      display_name: bundle.user.name || bundle.user.email.split("@")[0],
    }, { onConflict: "user_id", ignoreDuplicates: true }),
    admin.from("workspace_settings").upsert({
      workspace_id: bundle.workspace.id,
      updated_by: bundle.user.id,
    }, { onConflict: "workspace_id", ignoreDuplicates: true }),
  ]);
  if (profile.error || settings.error) throw new Error("ACCOUNT_INITIALIZE_FAILED");
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (!["GET", "PATCH"].includes(req.method)) return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed.");

  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await ensureWorkspaceBootstrap(auth.admin, auth.user);
    await ensureAccountRows(auth.admin, bundle);

    if (req.method === "GET") {
      return jsonOk({ success: true, ...(await loadSnapshot(auth.admin, bundle)) });
    }

    const body = await readJsonObject(req);
    const section = enumField(body.section, ["profile", "workspace", "notifications", "profit_model"] as const, "Section");
    const canManageWorkspace = ["owner", "admin"].includes(bundle.membership.role);

    if (section === "profile") {
      const displayName = textField(body.displayName, "Display name", { min: 2, max: 80, required: true });
      const row = {
        user_id: bundle.user.id,
        display_name: displayName,
        company_name: textField(body.companyName, "Company name", { max: 120 }),
        role_title: textField(body.roleTitle, "Role title", { max: 120 }),
        phone: textField(body.phone, "Phone", { max: 40 }),
        locale: enumField(body.locale || "en-US", LOCALES, "Locale"),
        updated_at: new Date().toISOString(),
      };
      const [profile, user] = await Promise.all([
        auth.admin.from("user_profiles").upsert(row, { onConflict: "user_id" }),
        auth.admin.from("app_users").update({ name: displayName, updated_at: new Date().toISOString() }).eq("id", bundle.user.id),
      ]);
      if (profile.error || user.error) return jsonError(500, "PROFILE_SAVE_FAILED", "Could not save profile details.");
    } else {
      if (!canManageWorkspace) return jsonError(403, "WORKSPACE_FORBIDDEN", "Workspace owner or admin access is required.");
      const current = await auth.admin.from("workspace_settings").select("*").eq("workspace_id", bundle.workspace.id).single();
      if (current.error || !current.data) return jsonError(500, "SETTINGS_LOAD_FAILED", "Could not load workspace settings.");
      const patch: Record<string, unknown> = { updated_by: bundle.user.id, updated_at: new Date().toISOString() };

      if (section === "workspace") {
        patch.timezone = enumField(body.timezone, TIMEZONES, "Timezone");
        patch.currency = enumField(body.currency, CURRENCIES, "Currency");
        patch.week_starts_on = integerField(body.weekStartsOn, "Week start", { min: 0, max: 6 });
        patch.default_period = enumField(body.defaultPeriod, PERIODS, "Default reporting period");
        patch.compact_mode = booleanField(body.compactMode);
        patch.data_retention_days = integerField(body.dataRetentionDays, "Data retention", { min: 30, max: 1825 });
        const workspaceName = textField(body.workspaceName || bundle.workspace.name, "Workspace name", { min: 2, max: 100, required: true });
        const renamed = await auth.admin.from("workspaces").update({ name: workspaceName, updated_at: new Date().toISOString() }).eq("id", bundle.workspace.id);
        if (renamed.error) return jsonError(500, "WORKSPACE_SAVE_FAILED", "Could not update the workspace name.");
      }

      if (section === "notifications") {
        const existing = current.data.notifications && typeof current.data.notifications === "object" ? current.data.notifications : {};
        patch.notifications = {
          ...existing,
          analysisReady: booleanField(body.analysisReady),
          performanceRisk: booleanField(body.performanceRisk),
          weeklyDigest: booleanField(body.weeklyDigest),
          productUpdates: booleanField(body.productUpdates),
          supportReplies: booleanField(body.supportReplies, true),
          billingEvents: booleanField(body.billingEvents, true),
        };
      }

      if (section === "profit_model") {
        const cogs = Number(body.cogs);
        const fulfillment = Number(body.fulfillment);
        const fees = Number(body.fees);
        if (![cogs, fulfillment, fees].every((value) => Number.isFinite(value) && value >= 0 && value <= 95)) {
          return jsonError(422, "VALIDATION_ERROR", "Profit model rates must be between 0 and 95 percent.");
        }
        if (cogs + fulfillment + fees > 95) {
          return jsonError(422, "VALIDATION_ERROR", "Combined variable costs must not exceed 95 percent.");
        }
        patch.profit_model = { cogs, fulfillment, fees };
      }

      const saved = await auth.admin.from("workspace_settings").update(patch).eq("workspace_id", bundle.workspace.id);
      if (saved.error) return jsonError(500, "SETTINGS_SAVE_FAILED", "Could not save workspace settings.");
    }

    const refreshed = await ensureWorkspaceBootstrap(auth.admin, auth.user);
    return jsonOk({ success: true, ...(await loadSnapshot(auth.admin, refreshed)) });
  } catch (error) {
    const input = inputErrorResponse(error, jsonError);
    if (input) return input;
    return jsonError(500, "INTERNAL_ERROR", "Could not load or update account settings.");
  }
});

