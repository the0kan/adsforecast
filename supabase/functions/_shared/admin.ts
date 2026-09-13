import { requireBearerUser } from "./auth.ts";
import { jsonError } from "./response.ts";
import { ensureWorkspaceBootstrap } from "./workspace.ts";
import type { User } from "jsr:@supabase/supabase-js@2";
import type { AdminClient } from "./supabase.ts";

export type PlatformAdminRole = "super_admin" | "billing_admin" | "support_admin" | "operator" | "viewer";

export type PlatformAdminContext = {
  ok: true;
  user: User;
  appUser: { id: string; email: string; name: string | null };
  adminRecord: { user_id: string; role: PlatformAdminRole; status: string };
  client: AdminClient;
};

export async function requirePlatformAdmin(req: Request): Promise<PlatformAdminContext | { ok: false; response: Response }> {
  const auth = await requireBearerUser(req);
  if (!auth.ok) return auth;
  try {
    const bundle = await ensureWorkspaceBootstrap(auth.admin, auth.user);
    const row = await auth.admin
      .from("platform_admins")
      .select("user_id,role,status")
      .eq("user_id", bundle.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (row.error) return { ok: false, response: jsonError(500, "ADMIN_LOOKUP_FAILED", "Could not verify platform access.") };
    if (!row.data) return { ok: false, response: jsonError(403, "ADMIN_FORBIDDEN", "Platform administrator access is required.") };
    return {
      ok: true,
      user: auth.user,
      appUser: { id: bundle.user.id, email: bundle.user.email, name: bundle.user.name },
      adminRecord: row.data as PlatformAdminContext["adminRecord"],
      client: auth.admin,
    };
  } catch {
    return { ok: false, response: jsonError(500, "ADMIN_LOOKUP_FAILED", "Could not verify platform access.") };
  }
}

export function adminCan(role: PlatformAdminRole, capability: "plans" | "tickets" | "admins" | "operations"): boolean {
  const map: Record<PlatformAdminRole, Set<string>> = {
    super_admin: new Set(["plans", "tickets", "admins", "operations"]),
    billing_admin: new Set(["plans"]),
    support_admin: new Set(["tickets"]),
    operator: new Set(["tickets", "operations"]),
    viewer: new Set(),
  };
  return map[role]?.has(capability) || false;
}

export async function writeAdminAudit(
  ctx: PlatformAdminContext,
  action: string,
  targetType: string,
  targetId: string | null,
  safeMetadata: Record<string, unknown> = {},
) {
  await ctx.client.from("admin_audit_logs").insert({
    admin_user_id: ctx.appUser.id,
    action: action.slice(0, 120),
    target_type: targetType.slice(0, 60),
    target_id: targetId?.slice(0, 200) || null,
    safe_metadata: safeMetadata,
  });
}
