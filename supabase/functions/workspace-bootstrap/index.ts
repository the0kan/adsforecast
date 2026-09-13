import { handleOptions } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/response.ts";
import { requireBearerUser } from "../_shared/auth.ts";
import { ensureWorkspaceBootstrap } from "../_shared/workspace.ts";

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  if (req.method !== "POST") {
    return jsonError(405, "INTERNAL_ERROR", "Method not allowed.");
  }

  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth.response;

  try {
    const bundle = await ensureWorkspaceBootstrap(auth.admin, auth.user);
    const initialized = await Promise.all([
      auth.admin.from("user_profiles").upsert({
        user_id: bundle.user.id,
        display_name: bundle.user.name || bundle.user.email.split("@")[0],
      }, { onConflict: "user_id", ignoreDuplicates: true }),
      auth.admin.from("workspace_settings").upsert({
        workspace_id: bundle.workspace.id,
        updated_by: bundle.user.id,
      }, { onConflict: "workspace_id", ignoreDuplicates: true }),
    ]);
    if (initialized.some((result) => result.error)) {
      return jsonError(500, "ACCOUNT_INITIALIZE_FAILED", "Could not initialize account preferences.");
    }
    const [profile, settings, subscription, platformAdmin] = await Promise.all([
      auth.admin.from("user_profiles").select("display_name,company_name,role_title,phone,locale,avatar_url").eq("user_id", bundle.user.id).maybeSingle(),
      auth.admin.from("workspace_settings").select("timezone,currency,week_starts_on,default_period,compact_mode,data_retention_days,notifications,profit_model").eq("workspace_id", bundle.workspace.id).maybeSingle(),
      auth.admin.from("workspace_subscriptions").select("plan_id,draft_plan_id,status,cadence,draft_cadence,current_period_start,current_period_end,cancel_at_period_end").eq("workspace_id", bundle.workspace.id).maybeSingle(),
      auth.admin.from("platform_admins").select("role,status").eq("user_id", bundle.user.id).maybeSingle(),
    ]);
    if (profile.error || settings.error || subscription.error || platformAdmin.error) {
      return jsonError(500, "ACCOUNT_LOAD_FAILED", "Could not load account context.");
    }
    return jsonOk({
      success: true,
      user: {
        id: bundle.user.id,
        email: bundle.user.email,
        name: bundle.user.name,
        createdAt: bundle.user.created_at,
        updatedAt: bundle.user.updated_at,
      },
      workspace: {
        id: bundle.workspace.id,
        name: bundle.workspace.name,
        createdAt: bundle.workspace.created_at,
        updatedAt: bundle.workspace.updated_at,
      },
      membership: {
        id: bundle.membership.id,
        workspaceId: bundle.membership.workspace_id,
        userId: bundle.membership.user_id,
        role: bundle.membership.role,
        createdAt: bundle.membership.created_at,
      },
      profile: profile.data || null,
      settings: settings.data || null,
      subscription: subscription.data || null,
      platformAdmin: platformAdmin.data?.status === "active" ? { role: platformAdmin.data.role } : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    if (msg === "CONFIG_MISSING") {
      return jsonError(500, "CONFIG_MISSING", "Server configuration is incomplete.");
    }
    return jsonError(500, "INTERNAL_ERROR", "Could not initialize workspace.");
  }
});
